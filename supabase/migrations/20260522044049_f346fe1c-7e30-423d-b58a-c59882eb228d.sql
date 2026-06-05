
-- Daily submissions
CREATE TABLE public.daily_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  work_update TEXT NOT NULL,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view all submissions" ON public.daily_submissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert own submission" ON public.daily_submissions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "update own or admin" ON public.daily_submissions
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "delete own or admin" ON public.daily_submissions
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_daily_submissions_created_at ON public.daily_submissions (created_at DESC);

-- Report recipients
CREATE TABLE public.report_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view recipients" ON public.report_recipients
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin manage recipients" ON public.report_recipients
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
