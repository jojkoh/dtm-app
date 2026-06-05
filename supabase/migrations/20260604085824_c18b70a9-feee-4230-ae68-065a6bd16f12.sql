
-- 1. drivers: vehicle-of-the-day
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS current_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- 2. deployment_templates
CREATE TABLE IF NOT EXISTS public.deployment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  trade_manager_id uuid NOT NULL,
  reporting_time time,
  return_time time,
  remarks text,
  recurrence text NOT NULL DEFAULT 'weekdays', -- daily | weekdays | weekly
  weekday_mask smallint NOT NULL DEFAULT 62, -- Mon-Fri = 2+4+8+16+32 = 62 (Sun=1..Sat=64)
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_templates TO authenticated;
GRANT ALL ON public.deployment_templates TO service_role;
ALTER TABLE public.deployment_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view templates" ON public.deployment_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage templates" ON public.deployment_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role) OR trade_manager_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role) OR trade_manager_id = auth.uid());

-- 3. deployment_template_workers
CREATE TABLE IF NOT EXISTS public.deployment_template_workers (
  template_id uuid NOT NULL REFERENCES public.deployment_templates(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, worker_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_template_workers TO authenticated;
GRANT ALL ON public.deployment_template_workers TO service_role;
ALTER TABLE public.deployment_template_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view template workers" ON public.deployment_template_workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage template workers" ON public.deployment_template_workers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deployment_templates t WHERE t.id = template_id AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role) OR t.trade_manager_id = auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.deployment_templates t WHERE t.id = template_id AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role) OR t.trade_manager_id = auth.uid())));

-- 4. deployments: template/source
ALTER TABLE public.deployments ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.deployment_templates(id) ON DELETE SET NULL;
ALTER TABLE public.deployments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS deployments_template_date_uidx ON public.deployments(template_id, deployment_date) WHERE template_id IS NOT NULL;

-- 5. dispatches
CREATE TABLE IF NOT EXISTS public.dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | published | completed
  created_by uuid NOT NULL,
  published_at timestamptz,
  published_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatches TO authenticated;
GRANT ALL ON public.dispatches TO service_role;
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view dispatches" ON public.dispatches FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage dispatches" ON public.dispatches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'transport_hub'::app_role));

-- 6. trips: dispatch link
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dispatch_id uuid REFERENCES public.dispatches(id) ON DELETE SET NULL;

-- 7. revert-to-draft trigger
CREATE OR REPLACE FUNCTION public.revert_dispatch_to_draft_for_dep(dep_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.dispatches
    SET status = 'draft', updated_at = now()
    WHERE status = 'published'
      AND id IN (SELECT DISTINCT dispatch_id FROM public.trips WHERE deployment_id = dep_id AND dispatch_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_deployment_updated_revert_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.revert_dispatch_to_draft_for_dep(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_deployment_workers_revert_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.revert_dispatch_to_draft_for_dep(COALESCE(NEW.deployment_id, OLD.deployment_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS deployments_revert_dispatch ON public.deployments;
CREATE TRIGGER deployments_revert_dispatch
  AFTER UPDATE OF reporting_time, return_time, project_id, deployment_date ON public.deployments
  FOR EACH ROW EXECUTE FUNCTION public.trg_deployment_updated_revert_dispatch();

DROP TRIGGER IF EXISTS deployment_workers_revert_dispatch ON public.deployment_workers;
CREATE TRIGGER deployment_workers_revert_dispatch
  AFTER INSERT OR DELETE ON public.deployment_workers
  FOR EACH ROW EXECUTE FUNCTION public.trg_deployment_workers_revert_dispatch();

-- 8. template generator
CREATE OR REPLACE FUNCTION public.generate_deployments_from_templates(target_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  dep_id uuid;
  inserted int := 0;
  dow_bit int;
BEGIN
  -- Postgres dow: Sun=0..Sat=6 -> bit Sun=1..Sat=64 -> 1 << dow
  dow_bit := (1 << EXTRACT(DOW FROM target_date)::int);
  FOR t IN
    SELECT * FROM public.deployment_templates
     WHERE is_active = true
       AND start_date <= target_date
       AND (end_date IS NULL OR end_date >= target_date)
       AND (
         recurrence = 'daily'
         OR (recurrence = 'weekdays' AND EXTRACT(DOW FROM target_date) BETWEEN 1 AND 5)
         OR (recurrence = 'weekly' AND (weekday_mask & dow_bit) <> 0)
       )
  LOOP
    BEGIN
      INSERT INTO public.deployments (deployment_date, project_id, reporting_time, return_time, trade_manager_id, remarks, deployment_status, template_id, source)
      VALUES (target_date, t.project_id, t.reporting_time, t.return_time, t.trade_manager_id, t.remarks, 'pending', t.id, 'template')
      RETURNING id INTO dep_id;
      INSERT INTO public.deployment_workers (deployment_id, worker_id)
        SELECT dep_id, worker_id FROM public.deployment_template_workers WHERE template_id = t.id;
      inserted := inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      -- already exists for that date, skip
      NULL;
    END;
  END LOOP;
  RETURN inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_deployments_from_templates(date) TO authenticated;

-- 9. updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS templates_updated_at ON public.deployment_templates;
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON public.deployment_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS dispatches_updated_at ON public.dispatches;
CREATE TRIGGER dispatches_updated_at BEFORE UPDATE ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
