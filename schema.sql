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
  audio_chunk_expiry_interval interval := interval '7 days';
  raw_audio_expiry_interval interval := interval '7 days';
  transcribed_segment_expiry_interval interval := interval '7 days';
  raw_segment_expiry_interval interval := interval '2 days';
begin
  WITH deleted_chunks AS (
    DELETE FROM public.translated_audio_chunks
    WHERE is_favorite = false
      AND expiry_at IS NOT NULL
      AND expiry_at < now()
    RETURNING storage_path
  ) SELECT count(*) FROM deleted_chunks;

  DELETE FROM public.transcription_segments
  WHERE completed_at IS NOT NULL
    AND completed_at < (now() - transcribed_segment_expiry_interval);

  WITH deleted_jobs AS (
      DELETE FROM public.download_jobs
      WHERE status IN ('completed', 'failed')
        AND updated_at < (now() - raw_audio_expiry_interval)
        AND NOT EXISTS (
          SELECT 1 FROM public.favorites f WHERE f.video_id = download_jobs.video_id
        )
      RETURNING storage_path
  ) SELECT count(*) FROM deleted_jobs;

  -- Placeholder comments for server-side deletion remain

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
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name', -- Adjust if using different metadata for display name
    new.raw_user_meta_data->>'avatar_url' -- Adjust if using different metadata for avatar
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_resources_as_favorite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- Update associated translated audio chunks as favorite (no expiry)
  update public.translated_audio_chunks
  set is_favorite = true, expiry_at = null
  where video_id = NEW.video_id;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."mark_resources_as_favorite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unmark_resources_as_favorite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  video_still_favorited_by_any_user boolean;
begin
  -- Check if any user still has this video_id as a favorite
  select exists (
    select 1 from public.favorites
    where video_id = OLD.video_id
  ) into video_still_favorited_by_any_user;

  if not video_still_favorited_by_any_user then
    -- No user has this video as a favorite anymore, so unmark all its chunks.
    update public.translated_audio_chunks
    set is_favorite = false, expiry_at = now() + interval '24 hours'
    where video_id = OLD.video_id;
  end if;
  return OLD;
end;
$$;


ALTER FUNCTION "public"."unmark_resources_as_favorite"() OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."download_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "status" "public"."job_status" DEFAULT 'pending'::"public"."job_status" NOT NULL,
    "storage_path" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."download_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "watched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_position" double precision DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settings" "jsonb" DEFAULT '{"voice_mapping": {"default": "alloy"}, "default_language": "en"}'::"jsonb" NOT NULL,
    "has_completed_onboarding" BOOLEAN DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transcription_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_id" "uuid" NOT NULL,
    "start_time" double precision NOT NULL, -- Represents start of full video (0)
    "end_time" double precision NOT NULL, -- Represents end of full video (duration)
    "status" "public"."job_status" DEFAULT 'pending'::"public"."job_status" NOT NULL, -- Status of full transcription
    "content" "jsonb", -- Full transcription output
    "replicate_prediction_id" "text", -- Replicate ID for the full transcription job
    "error_message" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "translations" "jsonb" -- Stores full translations keyed by lang code
);


ALTER TABLE "public"."transcription_segments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transcription_segments"."start_time" IS 'Start time of the transcribed section (usually 0 for full transcription).';
COMMENT ON COLUMN "public"."transcription_segments"."end_time" IS 'End time of the transcribed section (usually video duration for full transcription).';
COMMENT ON COLUMN "public"."transcription_segments"."status" IS 'Status of the full transcription job.';
COMMENT ON COLUMN "public"."transcription_segments"."content" IS 'Stores the full transcription output (e.g., from Replicate).';
COMMENT ON COLUMN "public"."transcription_segments"."replicate_prediction_id" IS 'Stores the prediction ID from the transcription service (e.g., Replicate) for the full audio.';
COMMENT ON COLUMN "public"."transcription_segments"."translations" IS 'Stores full translations keyed by language code, e.g., {"ru": {"segments": [...]}}';



CREATE TABLE IF NOT EXISTS "public"."translated_audio_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_id" "uuid" NOT NULL,
    "language" "text" NOT NULL,
    "voice" "text" NOT NULL,
    "chunk_start" double precision NOT NULL,
    "chunk_end" double precision NOT NULL,
    "storage_path" "text" NOT NULL,
    "is_favorite" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expiry_at" timestamp with time zone
);


ALTER TABLE "public"."translated_audio_chunks" OWNER TO "postgres";


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


ALTER TABLE ONLY "public"."download_jobs"
    ADD CONSTRAINT "download_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_id_video_id_key" UNIQUE ("user_id", "video_id");



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_user_id_video_id_key" UNIQUE ("user_id", "video_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_replicate_prediction_id_key" UNIQUE ("replicate_prediction_id");



ALTER TABLE ONLY "public"."transcription_segments"
    DROP CONSTRAINT IF EXISTS "transcription_segments_video_id_start_time_end_time_key";



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_video_id_key" UNIQUE ("video_id");



ALTER TABLE ONLY "public"."translated_audio_chunks"
    ADD CONSTRAINT "translated_audio_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translated_audio_chunks"
    ADD CONSTRAINT "translated_audio_chunks_video_id_language_voice_chunk_start_c_k" UNIQUE ("video_id", "language", "voice", "chunk_start", "chunk_end");



ALTER TABLE ONLY "public"."translated_audio_chunks"
    ADD CONSTRAINT "translated_audio_chunks_video_id_language_voice_chunk_start_key" UNIQUE ("video_id", "language", "voice", "chunk_start", "chunk_end");



ALTER TABLE ONLY "public"."videos"
    ADD CONSTRAINT "videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."videos"
    ADD CONSTRAINT "videos_youtube_id_key" UNIQUE ("youtube_id");



CREATE INDEX "idx_transcription_segments_replicate_id" ON "public"."transcription_segments" USING "btree" ("replicate_prediction_id");



DROP INDEX IF EXISTS "public"."idx_transcription_segments_video_time";



CREATE INDEX "idx_translated_audio_chunks_lookup" ON "public"."translated_audio_chunks" USING "btree" ("video_id", "language", "voice", "chunk_start", "chunk_end");



CREATE OR REPLACE TRIGGER "mark_resources_as_favorite_trigger" AFTER INSERT ON "public"."favorites" FOR EACH ROW EXECUTE FUNCTION "public"."mark_resources_as_favorite"();



CREATE OR REPLACE TRIGGER "unmark_resources_as_favorite_trigger" AFTER DELETE ON "public"."favorites" FOR EACH ROW EXECUTE FUNCTION "public"."unmark_resources_as_favorite"();



CREATE OR REPLACE TRIGGER "update_download_jobs_modtime" BEFORE UPDATE ON "public"."download_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_profiles_modtime" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_transcription_segments_modtime" BEFORE UPDATE ON "public"."transcription_segments" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_videos_modtime" BEFORE UPDATE ON "public"."videos" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



ALTER TABLE ONLY "public"."download_jobs"
    ADD CONSTRAINT "download_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."download_jobs"
    ADD CONSTRAINT "download_jobs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."translated_audio_chunks"
    ADD CONSTRAINT "translated_audio_chunks_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



CREATE POLICY "Allow authenticated read access" ON "public"."transcription_segments" FOR SELECT TO "authenticated" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Audio chunks are viewable by everyone" ON "public"."translated_audio_chunks" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can insert videos" ON "public"."videos" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Service role can manage audio chunks" ON "public"."translated_audio_chunks" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage transcription segments" ON "public"."transcription_segments" TO "service_role" USING (true);



CREATE POLICY "Service role can update jobs" ON "public"."download_jobs" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can view jobs" ON "public"."download_jobs" FOR SELECT USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Transcription segments are viewable by everyone" ON "public"."transcription_segments" FOR SELECT USING (true);



CREATE POLICY "Users can delete their own favorites" ON "public"."favorites" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own history" ON "public"."history" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert into their own favorites" ON "public"."favorites" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert into their own history" ON "public"."history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert jobs for themselves" ON "public"."download_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own history" ON "public"."history" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view jobs they initiated" ON "public"."download_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own favorites" ON "public"."favorites" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own history" ON "public"."history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Videos are viewable by everyone" ON "public"."videos" FOR SELECT USING (true);



ALTER TABLE "public"."download_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transcription_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translated_audio_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."videos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."download_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."transcription_segments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."translated_audio_chunks";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";









































































































































































































GRANT ALL ON FUNCTION "public"."cleanup_expired_resources"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_resources"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_resources"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_profile_for_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_profile_for_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_profile_for_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_resources_as_favorite"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_resources_as_favorite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_resources_as_favorite"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unmark_resources_as_favorite"() TO "anon";
GRANT ALL ON FUNCTION "public"."unmark_resources_as_favorite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."unmark_resources_as_favorite"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_vote_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_vote_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_vote_count"() TO "service_role";
























GRANT ALL ON TABLE "public"."download_jobs" TO "anon";
GRANT ALL ON TABLE "public"."download_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."download_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."favorites" TO "anon";
GRANT ALL ON TABLE "public"."favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."favorites" TO "service_role";



GRANT ALL ON TABLE "public"."history" TO "anon";
GRANT ALL ON TABLE "public"."history" TO "authenticated";
GRANT ALL ON TABLE "public"."history" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."transcription_segments" TO "anon";
GRANT ALL ON TABLE "public"."transcription_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."transcription_segments" TO "service_role";



GRANT ALL ON TABLE "public"."translated_audio_chunks" TO "anon";
GRANT ALL ON TABLE "public"."translated_audio_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."translated_audio_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."videos" TO "anon";
GRANT ALL ON TABLE "public"."videos" TO "authenticated";
GRANT ALL ON TABLE "public"."videos" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
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
