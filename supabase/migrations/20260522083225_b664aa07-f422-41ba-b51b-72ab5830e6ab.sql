
CREATE TABLE public.workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL,
  phone text,
  trade text,
  worker_type text NOT NULL DEFAULT 'in-house',
  dormitory_block text,
  active_status boolean NOT NULL DEFAULT true,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_name text NOT NULL,
  vehicle_plate text NOT NULL,
  vehicle_type text,
  passenger_capacity int NOT NULL DEFAULT 0,
  vehicle_status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  driver_name text NOT NULL,
  phone text,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_date date NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  reporting_time time,
  return_time time,
  trade_manager_id uuid NOT NULL,
  remarks text,
  deployment_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.deployment_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.deployments(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  UNIQUE(deployment_id, worker_id)
);

CREATE TABLE public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.deployments(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  departure_time timestamptz,
  estimated_return_time timestamptz,
  trip_status text NOT NULL DEFAULT 'assigned',
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  UNIQUE(trip_id, worker_id)
);

-- Enable RLS
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_workers ENABLE ROW LEVEL SECURITY;

-- Helper predicate inline via has_role
-- WORKERS
CREATE POLICY "view workers" ON public.workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage workers" ON public.workers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR public.has_role(auth.uid(),'trade_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR public.has_role(auth.uid(),'trade_manager'));

-- VEHICLES
CREATE POLICY "view vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage vehicles" ON public.vehicles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'));

-- DRIVERS
CREATE POLICY "view drivers" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage drivers" ON public.drivers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'));

-- DEPLOYMENTS
CREATE POLICY "view deployments" ON public.deployments FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert deployments" ON public.deployments FOR INSERT TO authenticated
  WITH CHECK (
    (trade_manager_id = auth.uid()) AND
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR public.has_role(auth.uid(),'trade_manager'))
  );
CREATE POLICY "update deployments" ON public.deployments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR trade_manager_id = auth.uid());
CREATE POLICY "delete deployments" ON public.deployments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR trade_manager_id = auth.uid());

-- DEPLOYMENT_WORKERS
CREATE POLICY "view deployment_workers" ON public.deployment_workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage deployment_workers" ON public.deployment_workers FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR
    EXISTS (SELECT 1 FROM public.deployments d WHERE d.id = deployment_id AND d.trade_manager_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub') OR
    EXISTS (SELECT 1 FROM public.deployments d WHERE d.id = deployment_id AND d.trade_manager_id = auth.uid())
  );

-- TRIPS
CREATE POLICY "view trips" ON public.trips FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage trips" ON public.trips FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'));
CREATE POLICY "driver update own trip" ON public.trips FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.id = driver_id AND dr.user_id = auth.uid())
  );

-- TRIP_WORKERS
CREATE POLICY "view trip_workers" ON public.trip_workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage trip_workers" ON public.trip_workers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'transport_hub'));

CREATE INDEX idx_deployments_date ON public.deployments(deployment_date);
CREATE INDEX idx_trips_deployment ON public.trips(deployment_id);
CREATE INDEX idx_trips_driver ON public.trips(driver_id);
