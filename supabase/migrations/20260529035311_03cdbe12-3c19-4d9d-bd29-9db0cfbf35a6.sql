-- Add is_active flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Allow admins to update profiles (for enable/disable + role-related ops)
DROP POLICY IF EXISTS "admins update all profiles" ON public.profiles;
CREATE POLICY "admins update all profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Module permissions
CREATE TABLE IF NOT EXISTS public.module_permissions (
  module_name text PRIMARY KEY,
  is_live boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.module_permissions TO authenticated;
GRANT ALL ON public.module_permissions TO service_role;

ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view modules" ON public.module_permissions;
CREATE POLICY "view modules" ON public.module_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin manage modules" ON public.module_permissions;
CREATE POLICY "admin manage modules" ON public.module_permissions FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.module_permissions (module_name, is_live) VALUES
  ('daily_work_matters', true),
  ('quantify_ai', true),
  ('workforce_dispatch', true)
ON CONFLICT (module_name) DO NOTHING;