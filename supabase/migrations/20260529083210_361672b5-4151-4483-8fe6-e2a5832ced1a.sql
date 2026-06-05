-- 1) Operational roster flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_operational boolean NOT NULL DEFAULT false;

-- Seed the initial 10 operational users by name (case-insensitive, first-word match)
UPDATE public.profiles
SET is_operational = true
WHERE is_operational = false
  AND (
    full_name ILIKE 'Frank%' OR full_name ILIKE 'Admond%' OR full_name ILIKE 'Allson%' OR
    full_name ILIKE 'Faizal%' OR full_name ILIKE 'Gary%' OR full_name ILIKE 'Marcus%' OR
    full_name ILIKE 'Johnson%' OR full_name ILIKE 'Nagel%' OR full_name ILIKE 'Phone%' OR
    full_name ILIKE 'Steven%'
  );

-- 2) Daily availability (On Leave / MC / Exempted)
CREATE TABLE IF NOT EXISTS public.daily_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('on_leave','mc','exempted')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_availability TO authenticated;
GRANT ALL ON public.daily_availability TO service_role;

ALTER TABLE public.daily_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view availability"
  ON public.daily_availability FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "admin manage availability"
  ON public.daily_availability FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS daily_availability_date_idx ON public.daily_availability (date);
