-- Remove orphan profile rows (profiles with no matching auth.users entry).
DELETE FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = p.id);

-- Also clean up any orphan user_roles (defensive).
DELETE FROM public.user_roles ur
WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = ur.user_id);