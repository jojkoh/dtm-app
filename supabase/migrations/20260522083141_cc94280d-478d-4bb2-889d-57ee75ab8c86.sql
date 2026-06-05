
-- Extend role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trade_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'transport_hub';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'driver';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'worker';
