
CREATE POLICY "workforce roles view projects" ON public.projects FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'trade_manager') OR public.has_role(auth.uid(),'transport_hub'));
