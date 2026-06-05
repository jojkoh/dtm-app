
-- Retention setting (default 14 days)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view settings" ON public.app_settings;
CREATE POLICY "view settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage settings" ON public.app_settings;
CREATE POLICY "admin manage settings" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.app_settings (key, value) VALUES ('dwm_retention_days', '14'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_daily_submissions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  days int;
BEGIN
  SELECT COALESCE((value)::text::int, 14) INTO days
  FROM public.app_settings WHERE key = 'dwm_retention_days';
  IF days IS NULL THEN days := 14; END IF;
  DELETE FROM public.daily_submissions
  WHERE created_at < now() - (days || ' days')::interval;
END;
$$;

-- Schedule daily cleanup at 02:00 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('dwm-cleanup-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('dwm-cleanup-daily', '0 2 * * *', $$SELECT public.cleanup_old_daily_submissions();$$);
