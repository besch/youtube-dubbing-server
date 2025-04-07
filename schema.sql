

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
  where video_id = NEW.video_id and language = NEW.language and voice = NEW.voice;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."mark_resources_as_favorite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unmark_resources_as_favorite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  audio_favorite_exists boolean;
begin
  select exists (
    select 1 from public.favorites
    where video_id = OLD.video_id
      and language = OLD.language
      and voice = OLD.voice
      and id != OLD.id
  ) into audio_favorite_exists;

  if not audio_favorite_exists then
    update public.translated_audio_chunks
    set is_favorite = false, expiry_at = now() + interval '24 hours'
    where video_id = OLD.video_id and language = OLD.language and voice = OLD.voice;
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
    "language" "text" NOT NULL,
    "voice" "text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "language" "text" NOT NULL,
    "voice" "text" NOT NULL,
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
    "settings" "jsonb" DEFAULT '{"voice_mapping": {"default": "alloy"}, "default_language": "en"}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transcription_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_id" "uuid" NOT NULL,
    "start_time" double precision NOT NULL,
    "end_time" double precision NOT NULL,
    "status" "public"."job_status" DEFAULT 'pending'::"public"."job_status" NOT NULL,
    "content" "jsonb",
    "replicate_prediction_id" "text",
    "segment_storage_path" "text",
    "error_message" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "translations" "jsonb"
);


ALTER TABLE "public"."transcription_segments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transcription_segments"."translations" IS 'Stores translations keyed by language code, e.g., {"ru": {"segments": [...]}}';



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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."videos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."download_jobs"
    ADD CONSTRAINT "download_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_id_video_id_language_voice_key" UNIQUE ("user_id", "video_id", "language", "voice");



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."history"
    ADD CONSTRAINT "history_user_id_video_id_language_voice_key" UNIQUE ("user_id", "video_id", "language", "voice");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_replicate_prediction_id_key" UNIQUE ("replicate_prediction_id");



ALTER TABLE ONLY "public"."transcription_segments"
    ADD CONSTRAINT "transcription_segments_video_id_start_time_end_time_key" UNIQUE ("video_id", "start_time", "end_time");



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



CREATE INDEX "idx_transcription_segments_video_time" ON "public"."transcription_segments" USING "btree" ("video_id", "start_time");



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
