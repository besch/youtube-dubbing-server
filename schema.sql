SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."job_status" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


ALTER TYPE "public"."job_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_resources"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  -- transcribed_segment_expiry_interval interval := interval '7 days'; -- Variable not used anymore
begin
  -- DELETE FROM public.transcription_segments -- Table is being dropped
  -- WHERE completed_at IS NOT NULL
  --   AND completed_at < (now() - transcribed_segment_expiry_interval);

  -- Placeholder comments for server-side deletion remain (if any were intended beyond these tables)
  -- All cleanup logic related to tables being dropped has been removed.
  NULL; -- Function body cannot be empty
end;
$$;


ALTER FUNCTION "public"."cleanup_expired_resources"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_profile_for_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."create_profile_for_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;


ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vote_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE projects SET vote_count = vote_count + 1 WHERE id = NEW.project_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE projects SET vote_count = vote_count - 1 WHERE id = OLD.project_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_vote_count"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "subscription_status" "text" NOT NULL DEFAULT 'free' CHECK ("subscription_status" IN ('free', 'premium')),
    "daily_video_count" "integer" NOT NULL DEFAULT 0,
    "stripe_customer_id" "text" UNIQUE,
    "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    "settings" "jsonb" DEFAULT '{"voice_mapping": {"default": "alloy"}, "default_language": "en"}'::"jsonb" NOT NULL
);

-- Users table (managed by Supabase Auth)
-- profiles table is automatically created by Supabase when a user signs up.
-- We add custom columns to it.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_id TEXT,
ADD COLUMN IF NOT EXISTS daily_video_count INTEGER DEFAULT 0, -- This might be deprecated if we count from 'videos' table
ADD COLUMN IF NOT EXISTS last_ip_address TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Videos table to track dubbed videos
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_video_day UNIQUE (user_id, video_url, DATE(created_at)) -- Optional: if you want to prevent duplicate entries for the same video on the same day by the same user at DB level
);

-- Policy for profiles table (allow users to read their own profile)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User can see their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "User can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Policy for videos table (allow users to manage their own videos)
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User can manage their own videos" ON videos
  FOR ALL USING (auth.uid() = user_id);


-- Trial periods table
CREATE TABLE IF NOT EXISTS premium_trials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE, -- Each user can only have one trial entry
    trial_start_date TIMESTAMPTZ DEFAULT NOW(),
    trial_end_date TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE, -- To easily query active trials
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for trials table
ALTER TABLE premium_trials ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own trial status
CREATE POLICY "Users can read their own trial status" ON premium_trials
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Admins or server role can manage trials (example, adjust as needed)
-- CREATE POLICY "Admins can manage all trials" ON premium_trials
-- FOR ALL USING (is_claims_admin()); -- Requires a is_claims_admin() function

-- Function to automatically update trial_end_date (example: 7 days trial)
-- You might set this directly in your server action when creating a trial.
-- CREATE OR REPLACE FUNCTION set_trial_end_date() RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.trial_end_date = NEW.trial_start_date + INTERVAL '7 days';
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER before_insert_premium_trial
--   BEFORE INSERT ON premium_trials
--   FOR EACH ROW EXECUTE FUNCTION set_trial_end_date();

-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for 'premium_trials' to update 'updated_at'
CREATE TRIGGER set_premium_trials_updated_at
BEFORE UPDATE ON premium_trials
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp(); 


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "youtube_id" "text" NOT NULL,
    "title" "text" NOT NULL DEFAULT 'Untitled Video'::"text",
    "description" "text",
    "thumbnail_url" "text",
    "duration" integer,
    "translated_titles" jsonb DEFAULT '{}'::jsonb,
    "processing_status" jsonb DEFAULT '{}'::jsonb, -- Tracks status like {"lang_voice": "status"}
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."videos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



CREATE INDEX "idx_transcription_segments_replicate_id" ON "public"."transcription_segments" USING "btree" ("replicate_prediction_id");



DROP INDEX IF EXISTS "public"."idx_transcription_segments_video_time";



CREATE OR REPLACE TRIGGER "update_profiles_modtime" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE POLICY "Authenticated users can insert videos" ON "public"."videos" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Videos are viewable by everyone" ON "public"."videos" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."videos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."transcription_segments";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";









































































































































































































GRANT ALL ON FUNCTION "public"."cleanup_expired_resources"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_profile_for_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_profile_for_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_vote_count"() TO "service_role";
























GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;



ALTER TABLE public.videos
COMMENT ON COLUMN public.videos.processing_status IS 'Tracks processing status per language-voice combination, e.g., {"es_nova": {"status": "generating_audio", "progress": 85}}';

-- TRUNCATE TABLE public.download_jobs CASCADE;
-- TRUNCATE TABLE public.transcription_segments CASCADE;
-- TRUNCATE TABLE public.translated_audio_chunks CASCADE;
-- TRUNCATE TABLE public.videos CASCADE;
-- TRUNCATE TABLE public.history CASCADE;
-- TRUNCATE TABLE public.favorites CASCADE;

-- New Triggers for Backend Processing Pipeline

-- Trigger for Transcription Completion
-- Drop the trigger if it already exists
DROP TRIGGER IF EXISTS trigger_on_transcription_complete ON public.transcription_segments;

-- Create the trigger
CREATE TRIGGER trigger_on_transcription_complete
AFTER UPDATE ON public.transcription_segments
FOR EACH ROW
-- Only run if the status is updated TO 'completed' FROM a different status
WHEN (
  NEW.status = 'completed'::public.job_status AND OLD.status <> 'completed'::public.job_status
)
-- Execute the http_request function to call the Edge Function
EXECUTE FUNCTION supabase_functions.http_request(
    '{{ NEXT_PUBLIC_SUPABASE_FUNCTION_URL }}/on-transcription-complete', -- Use placeholder
    'POST',
    '{"Content-Type": "application/json", "Authorization": "Bearer {{ SUPABASE_SERVICE_ROLE_KEY }}"}', -- Use placeholder
    '{}', -- Body (Function parses the actual payload)
    10000 -- Timeout
);

DROP TRIGGER IF EXISTS trigger_on_transcription_translation_update ON public.transcription_segments;

-- Create the trigger with the CORRECT function URL
CREATE TRIGGER trigger_on_transcription_translation_update
AFTER UPDATE ON public.transcription_segments
FOR EACH ROW
-- Only run if the translations column actually changed
WHEN (NEW.translations IS DISTINCT FROM OLD.translations)
-- Execute the http_request function to call the correct Edge Function
EXECUTE FUNCTION supabase_functions.http_request(
    -- VVV CORRECT URL VVV --
    '{{ NEXT_PUBLIC_SUPABASE_FUNCTION_URL }}/on-translation-complete', -- Use placeholder
    -- ^^^ CORRECT URL ^^^ --
    'POST',
    '{"Content-Type": "application/json", "Authorization": "Bearer {{ SUPABASE_SERVICE_ROLE_KEY }}"}', -- Use placeholder
    '{}', -- Body (Function parses the actual payload)
    10000 -- Timeout
);

COMMENT ON TRIGGER trigger_on_transcription_translation_update ON public.transcription_segments
IS 'Calls the on-translation-complete function when the translations column is updated.';

-- Trigger for Audio Chunk Insertion
-- Drop the trigger if it already exists
DROP TRIGGER IF EXISTS trigger_on_audio_chunk_insert ON public.translated_audio_chunks;

-- Create the trigger
CREATE TRIGGER trigger_on_audio_chunk_insert
AFTER INSERT ON public.translated_audio_chunks -- Trigger on INSERT
FOR EACH ROW                                    -- For every new row
-- Execute the http_request function to call the Edge Function
EXECUTE FUNCTION supabase_functions.http_request(
    '{{ NEXT_PUBLIC_SUPABASE_FUNCTION_URL }}/on-audio-chunk-complete', -- Use placeholder
    'POST',
    '{"Content-Type": "application/json", "Authorization": "Bearer {{ SUPABASE_SERVICE_ROLE_KEY }}"}', -- Use placeholder
    '{}', -- Body (Function parses the actual payload)
    10000 -- Timeout
);


-- Trigger for Download Completion
-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS trigger_on_download_complete ON public.download_jobs;

-- Create the trigger
CREATE TRIGGER trigger_on_download_complete
AFTER UPDATE ON public.download_jobs
FOR EACH ROW
-- Only run if status becomes completed AND storage_path is set
WHEN (NEW.status = 'completed' AND OLD.status <> 'completed' AND NEW.storage_path IS NOT NULL)
EXECUTE FUNCTION supabase_functions.http_request(
    '{{ NEXT_PUBLIC_SUPABASE_FUNCTION_URL }}/on-download-complete', -- Use placeholder
    'POST',
    '{"Content-Type": "application/json", "Authorization": "Bearer {{ SUPABASE_SERVICE_ROLE_KEY }}"}', -- Use placeholder
    '{}', -- Body (Function parses the actual payload)
    10000 -- Timeout
);

-- New table for feature flags
CREATE TABLE IF NOT EXISTS "public"."features" (
    "feature_name" "text" PRIMARY KEY,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."features" OWNER TO "postgres";
COMMENT ON TABLE "public"."features" IS 'Stores global feature flags for the application.';

-- Enable RLS for features table
ALTER TABLE "public"."features" ENABLE ROW LEVEL SECURITY;

-- Policies for features table
CREATE POLICY "Features are viewable by everyone" ON "public"."features" FOR SELECT USING (true);
CREATE POLICY "Service role can manage features" ON "public"."features" FOR ALL TO "service_role" USING (true);

-- Trigger for updating features modtime
CREATE OR REPLACE TRIGGER "update_features_modtime" BEFORE UPDATE ON "public"."features" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();

-- Add initial paywall feature flag (defaulting to disabled)
INSERT INTO public.features (feature_name, is_enabled) VALUES ('show_paywall', false) ON CONFLICT (feature_name) DO NOTHING;


-- Add onboarding completion flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_completed_onboarding BOOLEAN DEFAULT false;
COMMENT ON COLUMN public.profiles.has_completed_onboarding IS 'Indicates if the user has completed the entire onboarding flow (including potential paywall).';


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


-- Add features table to realtime publication if needed (optional)
-- ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."features";

-- Helper function for atomic updates to the processing_status JSONB column
CREATE OR REPLACE FUNCTION public.update_processing_status(
    video_uuid uuid,
    status_key text,
    status_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Important for use in triggers/functions if needed
SET search_path = public
AS $$
BEGIN
    UPDATE public.videos
    SET processing_status = jsonb_set(
            COALESCE(processing_status, '{}'::jsonb), -- Ensure the column is not null
            ARRAY[status_key], -- Path to update (the lang_voice key)
            status_value, -- The new JSON object for this key
            true -- Create the key if it doesn't exist
        )
    WHERE id = video_uuid;
END;
$$;
COMMENT ON FUNCTION public.update_processing_status(uuid, text, jsonb) IS 'Atomically updates a specific key within the videos.processing_status JSONB column.';

-- Function to atomically update a specific language key in transcription_segments.translations
CREATE OR REPLACE FUNCTION public.update_translation_for_language(
    p_segment_id uuid,
    p_lang_code text,
    p_translation_content jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.transcription_segments
    SET translations = jsonb_set(
            COALESCE(translations, '{}'::jsonb), -- Ensure the column is not null
            ARRAY[p_lang_code], -- Path to update (the language code key)
            p_translation_content, -- The new JSON object for this language
            true -- Create the key if it doesn't exist
        )
    WHERE id = p_segment_id;
END;
$$;
COMMENT ON FUNCTION public.update_translation_for_language(uuid, text, jsonb) IS 'Atomically updates a specific language key within the transcription_segments.translations JSONB column.';

-- Update profiles table to match the actual structure
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS has_completed_onboarding,
  ADD COLUMN IF NOT EXISTS last_ip_address text,
  ADD COLUMN IF NOT EXISTS last_video_count_reset timestamp with time zone,
  ADD COLUMN IF NOT EXISTS subscription_end_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ALTER COLUMN daily_video_count DROP NOT NULL,
  ALTER COLUMN subscription_status DROP NOT NULL,
  ALTER COLUMN settings SET DEFAULT '{"voice_mapping": {"default": "alloy"}, "default_language": "en"}'::jsonb;

-- Add daily_video_limits table
CREATE TABLE IF NOT EXISTS public.daily_video_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    video_id TEXT NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daily_video_limits_pkey PRIMARY KEY (id),
    CONSTRAINT daily_video_limits_user_id_video_id_key UNIQUE (user_id, video_id),
    CONSTRAINT daily_video_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Add subscription_events table
CREATE TABLE IF NOT EXISTS public.subscription_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    event_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_events_pkey PRIMARY KEY (id),
    CONSTRAINT subscription_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Update transcription_segments table
ALTER TABLE public.transcription_segments
  ADD COLUMN IF NOT EXISTS segment_storage_path text;

-- Add RLS policies for new tables
ALTER TABLE public.daily_video_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Policies for daily_video_limits
CREATE POLICY "Users can view their own daily video limits" 
ON public.daily_video_limits FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own daily video limits" 
ON public.daily_video_limits FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Policies for subscription_events
CREATE POLICY "Users can view their own subscription events" 
ON public.subscription_events FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscription events" 
ON public.subscription_events FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_video_limits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_events;

-- Grant permissions
GRANT ALL ON TABLE public.daily_video_limits TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.subscription_events TO anon, authenticated, service_role;

-- Add function to reset daily video count
CREATE OR REPLACE FUNCTION public.reset_daily_video_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET daily_video_count = 0,
      last_video_count_reset = now()
  WHERE last_video_count_reset IS NULL 
     OR last_video_count_reset < now() - interval '1 day';
END;
$$;

-- Add cron job to reset daily video count
SELECT cron.schedule(
  'reset-daily-video-count',
  '0 0 * * *', -- Run at midnight every day
  $$SELECT public.reset_daily_video_count()$$
);

-- START: New Logging Infrastructure

-- Enum for log levels
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
        CREATE TYPE public.log_level AS ENUM (
            'DEBUG',
            'INFO',
            'WARN',
            'ERROR',
            'FATAL'
        );
    END IF;
END$$;

ALTER TYPE public.log_level OWNER TO postgres;
GRANT USAGE ON TYPE public.log_level TO anon, authenticated, service_role;

-- Application Logs Table
CREATE TABLE IF NOT EXISTS public.app_logs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    log_level public.log_level NOT NULL,
    service_name TEXT NOT NULL, -- e.g., 'auth', 'subtitles', 'audio', 'payments', 'search'
    action_name TEXT NOT NULL,  -- e.g., 'login_google', 'fetch_youtube_srt', 'generate_tts_openai'
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    session_id TEXT, -- Optional, for tracing
    ip_address INET, 
    request_payload JSONB,
    response_status_code INTEGER,
    response_payload JSONB,
    duration_ms BIGINT,
    error_code TEXT,
    error_message TEXT,
    stack_trace TEXT,
    tags JSONB, -- e.g., ["critical", "external_api_dependency"]
    metadata JSONB   -- Any other structured data
);

ALTER TABLE public.app_logs OWNER TO postgres;

-- Indexes for faster querying
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON public.app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_log_level ON public.app_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_app_logs_service_action ON public.app_logs(service_name, action_name);
CREATE INDEX IF NOT EXISTS idx_app_logs_user_id ON public.app_logs(user_id);

-- RLS for app_logs
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert logs"
ON public.app_logs
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Authenticated users can select logs" -- Further admin check will be done in API layer
ON public.app_logs
FOR SELECT
TO authenticated
USING (true);

-- Grant permissions
GRANT ALL ON TABLE public.app_logs TO service_role;
GRANT SELECT ON TABLE public.app_logs TO authenticated; -- Dashboard API will gate access for admins


-- RPC function for fetching log statistics
CREATE OR REPLACE FUNCTION public.get_log_stats(
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL,
    p_group_by text DEFAULT 'log_level'
)
RETURNS TABLE(group_key text, item_count bigint) -- Renamed count to item_count to avoid conflict with SQL COUNT keyword
LANGUAGE plpgsql
SECURITY DEFINER -- Define as SECURITY DEFINER if it needs to bypass RLS for aggregation, ensure proper controls
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format(
        'SELECT %I::text as group_key, COUNT(*) as item_count
         FROM public.app_logs
         WHERE (%L IS NULL OR created_at >= %L)
           AND (%L IS NULL OR created_at <= %L)
         GROUP BY %I
         ORDER BY item_count DESC',
        p_group_by,
        p_start_date, p_start_date,
        p_end_date, p_end_date,
        p_group_by
    );
END;
$$;

ALTER FUNCTION public.get_log_stats(timestamptz, timestamptz, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_log_stats(timestamptz, timestamptz, text) TO authenticated; -- Allow authenticated users (dashboard API) to call it

-- Optional: Add app_logs to realtime if needed, though it might be very high volume
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.app_logs;

-- END: New Logging Infrastructure
