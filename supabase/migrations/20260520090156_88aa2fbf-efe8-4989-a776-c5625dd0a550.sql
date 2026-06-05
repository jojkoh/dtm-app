
INSERT INTO storage.buckets (id, name, public)
VALUES ('drawings-temp', 'drawings-temp', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "temp drawings read own" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'drawings-temp' AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "temp drawings upload own" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'drawings-temp' AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "temp drawings delete own" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'drawings-temp' AND (storage.foldername(name))[1] = auth.uid()::text
);
