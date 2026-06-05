
-- Triggers to auto-revert published dispatch to draft when deployment changes
DROP TRIGGER IF EXISTS trg_deployment_update_revert ON public.deployments;
CREATE TRIGGER trg_deployment_update_revert
  AFTER UPDATE ON public.deployments
  FOR EACH ROW EXECUTE FUNCTION public.trg_deployment_updated_revert_dispatch();

DROP TRIGGER IF EXISTS trg_deployment_workers_revert ON public.deployment_workers;
CREATE TRIGGER trg_deployment_workers_revert
  AFTER INSERT OR DELETE OR UPDATE ON public.deployment_workers
  FOR EACH ROW EXECUTE FUNCTION public.trg_deployment_workers_revert_dispatch();

-- Allow trade managers to manage vehicles and drivers (in addition to admin/hub)
DROP POLICY IF EXISTS "manage vehicles" ON public.vehicles;
CREATE POLICY "manage vehicles" ON public.vehicles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'transport_hub'::app_role) OR has_role(auth.uid(), 'trade_manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'transport_hub'::app_role) OR has_role(auth.uid(), 'trade_manager'::app_role));

DROP POLICY IF EXISTS "manage drivers" ON public.drivers;
CREATE POLICY "manage drivers" ON public.drivers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'transport_hub'::app_role) OR has_role(auth.uid(), 'trade_manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'transport_hub'::app_role) OR has_role(auth.uid(), 'trade_manager'::app_role));
