create type "public"."video_processing_status" as enum ('pending', 'downloading', 'transcribing', 'translating', 'generating_audio', 'ready', 'failed');

drop trigger if exists "Trigger Downloader on New Job" on "public"."download_jobs";

alter table "public"."videos" add column "processing_status" jsonb default '{}'::jsonb;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_video_processing_status_jsonb()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  processing_statuses jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(vpj.language || '_' || vpj.voice, vpj.status), '{}'::jsonb)
  INTO processing_statuses
  FROM public.video_processing_jobs vpj
  WHERE vpj.video_id = COALESCE(NEW.video_id, OLD.video_id);

  UPDATE public.videos
  SET processing_status = processing_statuses,
      updated_at = now()
  WHERE id = COALESCE(NEW.video_id, OLD.video_id);

  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
EXCEPTION
  WHEN OTHERS THEN
     RAISE WARNING 'Error in update_video_processing_status_jsonb trigger: %', SQLERRM;
     IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$
;

CREATE TRIGGER trigger_on_download_complete AFTER UPDATE ON public.download_jobs FOR EACH ROW WHEN (((new.status = 'completed'::job_status) AND (old.status <> 'completed'::job_status))) EXECUTE FUNCTION supabase_functions.http_request('https://zzsjgheaghjdjqaupbxa.supabase.co/functions/v1/on-download-complete', 'POST', '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6c2pnaGVhZ2hqZGpxYXVwYnhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjU2NDIxNiwiZXhwIjoyMDU4MTQwMjE2fQ.lTiP5rOWppot7H95frtD4KHfMIyUgEOdki6854pGVSY"}', '{}', '10000');

CREATE TRIGGER trigger_on_transcription_complete AFTER UPDATE ON public.transcription_segments FOR EACH ROW WHEN (((new.status = 'completed'::job_status) AND (old.status <> 'completed'::job_status))) EXECUTE FUNCTION supabase_functions.http_request('https://zzsjgheaghjdjqaupbxa.supabase.co/functions/v1/on-transcription-complete', 'POST', '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6c2pnaGVhZ2hqZGpxYXVwYnhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjU2NDIxNiwiZXhwIjoyMDU4MTQwMjE2fQ.lTiP5rOWppot7H95frtD4KHfMIyUgEOdki6854pGVSY"}', '{}', '10000');

CREATE TRIGGER trigger_on_audio_chunk_insert AFTER INSERT ON public.translated_audio_chunks FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://zzsjgheaghjdjqaupbxa.supabase.co/functions/v1/on-audio-chunk-complete', 'POST', '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6c2pnaGVhZ2hqZGpxYXVwYnhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjU2NDIxNiwiZXhwIjoyMDU4MTQwMjE2fQ.lTiP5rOWppot7H95frtD4KHfMIyUgEOdki6854pGVSY"}', '{}', '10000');


