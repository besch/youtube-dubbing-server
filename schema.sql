-- Users are managed by Supabase Auth
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  -- Store default settings like language and voice preferences
  settings jsonb default '{"default_language": "en", "voice_mapping": {"default": "alloy"}}'::jsonb not null
  -- Example voice_mapping: {"default": "alloy", "SPEAKER_00": "alloy", "SPEAKER_01": "echo"}
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Secure the tables
create policy "Users can view their own profile"
  on profiles for select
  using ( auth.uid() = id );

create policy "Users can update their own profile"
  on profiles for update
  using ( auth.uid() = id );

-- Videos table to store basic information about YouTube videos processed
create table public.videos (
  id uuid default gen_random_uuid() primary key,
  youtube_id text not null unique,
  title text,
  description text,
  thumbnail_url text,
  duration integer, -- in seconds
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS
alter table public.videos enable row level security;

-- Secure the tables
create policy "Videos are viewable by everyone"
  on videos for select
  using ( true );

-- Allow authenticated users to insert videos (e.g., when starting processing)
create policy "Authenticated users can insert videos"
  on videos for insert
  with check ( auth.role() = 'authenticated' );

-- Track download and initial audio extraction jobs
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.download_jobs (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null, -- User who initiated, optional
  status public.job_status default 'pending' not null,
  storage_path text, -- Path to the raw audio file in Supabase Storage (e.g., youtube-audio bucket)
  error_message text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS
alter table public.download_jobs enable row level security;

-- Secure the tables
create policy "Users can view jobs they initiated"
  on download_jobs for select
  using ( auth.uid() = user_id );

create policy "Users can insert jobs for themselves"
  on download_jobs for insert
  with check ( auth.uid() = user_id );

-- Allow service role to update any job (for the youtube-download service)
create policy "Service role can update jobs"
  on download_jobs for update
  using ( auth.role() = 'service_role' );

-- Allow service role to view all jobs
create policy "Service role can view jobs"
  on download_jobs for select
  using ( auth.role() = 'service_role' );


-- Deprecated: Store full transcription and diarization results from Replicate
-- comment out or remove this table definition
/*
create table public.transcriptions (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos(id) on delete cascade not null unique, -- One transcription per video
  job_id uuid references public.download_jobs(id) on delete set null, -- Link to the job that generated it
  status public.job_status default 'pending' not null, -- Track transcription status
  content jsonb, -- Store the full JSON output from Replicate (including words, speakers, timestamps)
  error_message text,
  replicate_prediction_id text, -- Store the prediction ID from Replicate
  is_favorite boolean default false not null, -- Mark if part of a favorited item
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  -- Expiry is primarily handled by the favorite status and cleanup job
  expiry_at timestamp with time zone, -- Can be set when unfavorited
  completed_at timestamp with time zone -- Add this column for when the transcription finishes
);

-- Enable RLS
alter table public.transcriptions enable row level security;

-- Secure the tables
create policy "Transcriptions are viewable by everyone"
  on transcriptions for select
  using ( true );

-- Allow service role to manage transcriptions
create policy "Service role can manage transcriptions"
  on transcriptions for all -- insert, update, delete
  using ( auth.role() = 'service_role' );
*/

-- Store individual transcribed audio segments
create table public.transcription_segments (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos(id) on delete cascade not null,
  start_time float not null, -- Start time of this segment in the original video (seconds)
  end_time float not null,   -- End time of this segment in the original video (seconds)
  status public.job_status default 'pending' not null, -- Track transcription status for this segment
  content jsonb,             -- Store the JSON output from Replicate for this segment (timestamps adjusted to be absolute)
  replicate_prediction_id text unique, -- Store the prediction ID from Replicate, should be unique
  segment_storage_path text, -- Optional: Path to the extracted segment audio file in storage
  error_message text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,

  -- Ensure segments for the same video don't have the exact same time range
  unique(video_id, start_time, end_time)
);

-- Add index for faster lookups by video_id and time
create index idx_transcription_segments_video_time
  on public.transcription_segments (video_id, start_time);

-- Add index for faster lookups by replicate_prediction_id for webhooks
create index idx_transcription_segments_replicate_id
  on public.transcription_segments (replicate_prediction_id);

-- Enable RLS
alter table public.transcription_segments enable row level security;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.transcription_segments;
DROP POLICY IF EXISTS "Service role can manage transcription segments" ON public.transcription_segments;

-- Allow authenticated users to read transcription segments
CREATE POLICY "Allow authenticated read access"
ON public.transcription_segments
FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

-- Allow service role full access
CREATE POLICY "Service role can manage transcription segments"
ON public.transcription_segments
FOR ALL -- Allows INSERT, SELECT, UPDATE, DELETE
TO service_role -- Explicitly grant to service_role
USING (true); -- Service role bypasses RLS checks defined by USING clause for other roles

-- Store generated translated audio chunks (TTS output)
create table public.translated_audio_chunks (
    id uuid default gen_random_uuid() primary key,
    video_id uuid references public.videos(id) on delete cascade not null,
    language text not null, -- Target language (e.g., 'es', 'fr')
    voice text not null, -- Target voice (e.g., 'alloy', 'shimmer')
    -- Removed speaker_id as diarization might be inconsistent across segments
    -- speaker_id text, -- Optional: Original speaker ID if diarized (e.g., 'SPEAKER_00')
    chunk_start float not null, -- Start time of the original text segment (absolute)
    chunk_end float not null, -- End time of the original text segment (absolute)
    storage_path text not null, -- Path to the TTS audio file in Supabase Storage (e.g., translated-audio bucket)
    is_favorite boolean default false not null, -- Mark if part of a favorited item
    created_at timestamp with time zone default now() not null,
    expiry_at timestamp with time zone, -- Can be set when unfavorited

    -- Use text segment hash or similar for uniqueness? For now, allow potential duplicates if text differs slightly.
    unique(video_id, language, voice, chunk_start, chunk_end) -- Ensure uniqueness per original text segment time range
);
-- Update index to reflect removed speaker_id
create index idx_translated_audio_chunks_lookup
  on public.translated_audio_chunks (video_id, language, voice, chunk_start, chunk_end);

-- Enable RLS
alter table public.translated_audio_chunks enable row level security;

-- Secure the tables
create policy "Audio chunks are viewable by everyone"
  on translated_audio_chunks for select
  using ( true );

-- Allow service role to manage audio chunks
create policy "Service role can manage audio chunks"
  on translated_audio_chunks for all -- insert, update, delete
  using ( auth.role() = 'service_role' );


-- Watch history
create table public.history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  video_id uuid references public.videos(id) on delete cascade not null,
  language text not null, -- Language watched
  voice text not null, -- Voice used
  watched_at timestamp with time zone default now() not null,
  last_position float default 0 not null, -- Last playback position in seconds
  unique(user_id, video_id, language, voice)
);

-- Enable RLS
alter table public.history enable row level security;

-- Secure the tables
create policy "Users can view their own history"
  on history for select
  using ( auth.uid() = user_id );

create policy "Users can insert into their own history"
  on history for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own history"
  on history for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own history"
  on history for delete
  using ( auth.uid() = user_id );

-- Favorites
create table public.favorites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  video_id uuid references public.videos(id) on delete cascade not null,
  language text not null, -- Specific language/voice combo favorited
  voice text not null,
  added_at timestamp with time zone default now() not null,
  unique(user_id, video_id, language, voice)
);

-- Enable RLS
alter table public.favorites enable row level security;

-- Secure the tables
create policy "Users can view their own favorites"
  on favorites for select
  using ( auth.uid() = user_id );

create policy "Users can insert into their own favorites"
  on favorites for insert
  with check ( auth.uid() = user_id );

create policy "Users can delete their own favorites"
  on favorites for delete
  using ( auth.uid() = user_id );

-- Function to update the updated_at column automatically
create or replace function public.update_modified_column()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

-- Apply the trigger to tables with updated_at
create trigger update_profiles_modtime
before update on public.profiles
for each row execute function public.update_modified_column();

create trigger update_videos_modtime
before update on public.videos
for each row execute function public.update_modified_column();

create trigger update_download_jobs_modtime
before update on public.download_jobs
for each row execute function public.update_modified_column();

-- Remove trigger for old transcriptions table
-- DROP TRIGGER IF EXISTS update_transcriptions_modtime ON public.transcriptions;

-- Add trigger for new transcription_segments table
create trigger update_transcription_segments_modtime
before update on public.transcription_segments
for each row execute function public.update_modified_column();

-- Add trigger for translated_audio_chunks table (if not already present)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_translated_audio_chunks_modtime'
    ) THEN
        CREATE TRIGGER update_translated_audio_chunks_modtime
        BEFORE UPDATE ON public.translated_audio_chunks
        FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
    END IF;
END;
$$;


-- Function to handle resource updates when a video is favorited
create or replace function public.mark_resources_as_favorite()
returns trigger as $$
begin
  -- Update associated translated audio chunks as favorite (no expiry)
  update public.translated_audio_chunks
  set is_favorite = true, expiry_at = null
  where video_id = NEW.video_id and language = NEW.language and voice = NEW.voice;

  -- Note: We don't automatically mark transcription *segments* as favorite
  -- because they are generated on demand. If needed, this could be added.

  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger to mark resources when a video is favorited
-- Recreate or ensure trigger exists and points to updated function
DROP TRIGGER IF EXISTS mark_resources_as_favorite_trigger ON public.favorites;
create trigger mark_resources_as_favorite_trigger
after insert on public.favorites
for each row
execute function public.mark_resources_as_favorite();


-- Function to handle resource updates when a video is unfavorited
create or replace function public.unmark_resources_as_favorite()
returns trigger as $$
declare
  audio_favorite_exists boolean;
begin
  -- Check if other favorites exist for this specific video/language/voice combination (any user)
  select exists (
    select 1 from public.favorites
    where video_id = OLD.video_id
      and language = OLD.language
      and voice = OLD.voice
      and id != OLD.id -- Exclude the one being deleted
  ) into audio_favorite_exists;

  -- If no other favorites exist for this specific language/voice, mark audio chunks for expiry
  if not audio_favorite_exists then
    update public.translated_audio_chunks
    set is_favorite = false, expiry_at = now() + interval '24 hours' -- Or adjust interval
    where video_id = OLD.video_id and language = OLD.language and voice = OLD.voice;
  end if;

  -- Note: Transcription segments are not marked for expiry here as they don't have an is_favorite flag
  -- Their cleanup depends on the translated_audio_chunks or potentially the raw segment file.

  return OLD;
end;
$$ language plpgsql security definer;

-- Trigger to potentially unmark resources when a favorite is removed
-- Recreate or ensure trigger exists and points to updated function
DROP TRIGGER IF EXISTS unmark_resources_as_favorite_trigger ON public.favorites;
create trigger unmark_resources_as_favorite_trigger
after delete on public.favorites
for each row
execute function public.unmark_resources_as_favorite();


-- Function to clean up expired resources
create or replace function public.cleanup_expired_resources()
returns void as $$
declare
  -- Define expiry intervals
  audio_chunk_expiry_interval interval := interval '7 days';
  raw_audio_expiry_interval interval := interval '7 days';
  transcribed_segment_expiry_interval interval := interval '7 days'; -- How long to keep transcribed text segment records?
  raw_segment_expiry_interval interval := interval '2 days'; -- How long to keep raw audio segment files in storage?
begin

  -- Delete expired translated audio chunks that are not favorited
  -- Store deleted paths for potential storage cleanup
  WITH deleted_chunks AS (
    DELETE FROM public.translated_audio_chunks
    WHERE is_favorite = false
      AND expiry_at IS NOT NULL
      AND expiry_at < now()
    RETURNING storage_path
  )
  -- Placeholder for server-side storage cleanup logic using deleted_chunks.storage_path
  SELECT count(*) FROM deleted_chunks; -- Prevent optimization removal

  -- Delete old transcription segment *records* (optional, keeps history shorter)
  DELETE FROM public.transcription_segments
  WHERE completed_at IS NOT NULL
    AND completed_at < (now() - transcribed_segment_expiry_interval)
    -- Add condition: AND NOT EXISTS (SELECT 1 FROM favorites WHERE favorites.video_id = transcription_segments.video_id)?
    -- Or based on associated audio chunks?
    ;

  -- Find old download jobs (full audio) not linked to any favorites
  WITH deleted_jobs AS (
      DELETE FROM public.download_jobs
      WHERE status IN ('completed', 'failed')
        AND updated_at < (now() - raw_audio_expiry_interval)
        AND NOT EXISTS (
          SELECT 1 FROM public.favorites f WHERE f.video_id = download_jobs.video_id
        )
      RETURNING storage_path
  )
  -- Placeholder for server-side storage cleanup logic for full audio files
  SELECT count(*) FROM deleted_jobs; -- Prevent optimization removal


  -- Placeholder: Server-side logic is needed to:
  -- 1. Delete actual files from 'translated-audio' bucket based on deleted_chunks.
  -- 2. Delete actual files from 'youtube-audio' bucket based on deleted_jobs.
  -- 3. Delete files from 'transcription-segments' bucket older than raw_segment_expiry_interval.
  --    This requires querying Storage API directly as segment records might be deleted earlier.

end;
$$ language plpgsql security definer;

-- Schedule the cleanup job using pg_cron
-- Ensure pg_cron is enabled
-- Drop old job if exists
select cron.unschedule('cleanup-expired-resources');
-- Schedule new job
select cron.schedule(
  'cleanup-expired-resources',
  '0 1 * * *', -- Run at 01:00 UTC every day
  $$select public.cleanup_expired_resources()$$
);

-- Setup Storage buckets (Ensure these exist)
/*
-- Bucket for original YouTube audio extracts (existing)
insert into storage.buckets (id, name, public) values ('youtube-audio', 'youtube-audio', false) on conflict (id) do nothing;

-- Bucket for extracted audio segments for transcription
insert into storage.buckets (id, name, public) values ('transcription-segments', 'transcription-segments', false) on conflict (id) do nothing;

-- Bucket for translated TTS audio chunks (existing)
insert into storage.buckets (id, name, public) values ('translated-audio', 'translated-audio', false) on conflict (id) do nothing;

-- Policies for youtube-audio bucket (Allow read by audio-segmenter service role)
-- Ensure existing service role policies are sufficient or add specific read policy

-- Policies for transcription-segments bucket (Allow write by audio-segmenter, read by server action service role)
create policy "Allow audio-segmenter service role write access to transcription-segments"
  on storage.objects for insert, update
  using ( bucket_id = 'transcription-segments' and auth.role() = 'service_role' ) -- Restrict further if roles differ
  with check ( bucket_id = 'transcription-segments' and auth.role() = 'service_role' );

create policy "Allow server service role read access to transcription-segments"
  on storage.objects for select
  using ( bucket_id = 'transcription-segments' and auth.role() = 'service_role' ); -- Restrict further if roles differ

-- Policies for translated-audio bucket (Allow write by server service role, public read)
create policy "Allow public read access to translated-audio" on storage.objects for select using ( bucket_id = 'translated-audio' );
create policy "Allow server service role write access to translated-audio" on storage.objects for insert, update using ( bucket_id = 'translated-audio' and auth.role() = 'service_role' );
create policy "Allow server service role delete access to translated-audio" on storage.objects for delete using ( bucket_id = 'translated-audio' and auth.role() = 'service_role' );
*/

-- Initial data for profiles based on auth users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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

-- Trigger to create a profile when a new user signs up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user(); 