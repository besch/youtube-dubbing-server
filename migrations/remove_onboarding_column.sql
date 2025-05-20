-- Remove has_completed_onboarding column from profiles table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS has_completed_onboarding;

-- Remove any related comments
COMMENT ON TABLE public.profiles IS NULL; 