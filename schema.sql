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


-- Store full transcription and diarization results from Replicate
create table public.transcriptions (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos(id) on delete cascade not null unique, -- One transcription per video
  job_id uuid references public.download_jobs(id) on delete set null, -- Link to the job that generated it
  replicate_prediction_id text, -- Store the ID from Replicate API
  status public.job_status default 'pending' not null, -- Track transcription status
  content jsonb, -- Store the full JSON output from Replicate (including words, speakers, timestamps)
  error_message text,
  is_favorite boolean default false not null, -- Mark if part of a favorited item
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  -- Expiry is primarily handled by the favorite status and cleanup job
  expiry_at timestamp with time zone -- Can be set when unfavorited
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

-- Store generated translated audio chunks (TTS output)
create table public.translated_audio_chunks (
    id uuid default gen_random_uuid() primary key,
    video_id uuid references public.videos(id) on delete cascade not null,
    language text not null, -- Target language (e.g., 'es', 'fr')
    voice text not null, -- Target voice (e.g., 'alloy', 'shimmer')
    speaker_id text, -- Optional: Original speaker ID if diarized (e.g., 'SPEAKER_00')
    chunk_start float not null, -- Start time of the original text segment
    chunk_end float not null, -- End time of the original text segment
    storage_path text not null, -- Path to the audio file in Supabase Storage (e.g., translated-audio bucket)
    is_favorite boolean default false not null, -- Mark if part of a favorited item
    created_at timestamp with time zone default now() not null,
    expiry_at timestamp with time zone, -- Can be set when unfavorited

    unique(video_id, language, voice, chunk_start, chunk_end) -- Ensure uniqueness per segment
);
-- Add index for faster lookups
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

create trigger update_transcriptions_modtime
before update on public.transcriptions
for each row execute function public.update_modified_column();


-- Function to handle resource updates when a video is favorited
create or replace function public.mark_resources_as_favorite()
returns trigger as $$
begin
  -- Mark associated transcription as favorite (no expiry)
  update public.transcriptions
  set is_favorite = true, expiry_at = null
  where video_id = NEW.video_id;

  -- Mark associated translated audio chunks as favorite (no expiry)
  update public.translated_audio_chunks
  set is_favorite = true, expiry_at = null
  where video_id = NEW.video_id and language = NEW.language and voice = NEW.voice;

  return NEW;
end;
$$ language plpgsql security definer; -- Run with definer privileges to update tables

-- Trigger to mark resources when a video is favorited
create trigger mark_resources_as_favorite_trigger
after insert on public.favorites
for each row
execute function public.mark_resources_as_favorite();


-- Function to handle resource updates when a video is unfavorited
create or replace function public.unmark_resources_as_favorite()
returns trigger as $$
declare
  favorite_exists boolean;
  audio_favorite_exists boolean;
begin
  -- Check if any other favorite exists for the same video_id (any user, any lang/voice)
  select exists (
    select 1 from public.favorites where video_id = OLD.video_id and id != OLD.id
  ) into favorite_exists;

  -- If no other favorites exist for this video at all, mark transcription for expiry
  if not favorite_exists then
    update public.transcriptions
    set is_favorite = false, expiry_at = now() + interval '24 hours' -- Or longer? Configurable?
    where video_id = OLD.video_id;
  end if;

  -- Check if other favorites exist for this specific video/language/voice combination (any user)
  select exists (
    select 1 from public.favorites
    where video_id = OLD.video_id
      and language = OLD.language
      and voice = OLD.voice
      and id != OLD.id
  ) into audio_favorite_exists;

  -- If no other favorites exist for this specific language/voice, mark audio chunks for expiry
  if not audio_favorite_exists then
    update public.translated_audio_chunks
    set is_favorite = false, expiry_at = now() + interval '24 hours' -- Or longer?
    where video_id = OLD.video_id and language = OLD.language and voice = OLD.voice;
  end if;

  return OLD;
end;
$$ language plpgsql security definer; -- Run with definer privileges to update tables

-- Trigger to potentially unmark resources when a favorite is removed
create trigger unmark_resources_as_favorite_trigger
after delete on public.favorites
for each row
execute function public.unmark_resources_as_favorite();


-- Function to clean up expired resources (transcriptions, audio chunks, maybe old jobs?)
create or replace function public.cleanup_expired_resources()
returns void as $$
declare
  -- Define expiry intervals (could be moved to a config table later)
  transcription_expiry_interval interval := interval '7 days';
  audio_chunk_expiry_interval interval := interval '7 days';
  raw_audio_expiry_interval interval := interval '7 days'; -- For the original youtube audio
begin

  -- Delete expired transcriptions that are not favorited
  delete from public.transcriptions
  where is_favorite = false
    and expiry_at is not null
    and expiry_at < now();

  -- Delete expired translated audio chunks that are not favorited
  delete from public.translated_audio_chunks
  where is_favorite = false
    and expiry_at is not null
    and expiry_at < now();

  -- Find download jobs linked to deleted resources (or jobs older than interval without favorites)
  -- This requires knowing the storage path to delete from Supabase Storage
  -- Deleting from storage needs service_role key and is best handled by the server application
  -- or a dedicated cleanup function called via cron that can interact with storage.
  -- For now, just delete the job record if old and completed/failed.
  delete from public.download_jobs
  where status in ('completed', 'failed')
    and updated_at < (now() - raw_audio_expiry_interval)
    and not exists ( -- Don't delete if associated video is favorited
      select 1 from public.favorites f where f.video_id = download_jobs.video_id
    );

  -- TODO: Add logic here or in a separate server-side job to delete files
  -- from Supabase Storage ('youtube-audio', 'translated-audio' buckets)
  -- based on the deleted table rows or expiry_at timestamps.

end;
$$ language plpgsql security definer;

-- Schedule the cleanup job using pg_cron
-- Ensure pg_cron is enabled in your Supabase project
select cron.schedule(
  'cleanup-expired-resources',
  '0 1 * * *', -- Run at 01:00 UTC every day
  $$select public.cleanup_expired_resources()$$
);

-- Setup Storage buckets (Run these manually in Supabase SQL Editor or via migration)
-- Make sure these buckets exist. Policies determine access.
/*
-- Bucket for original YouTube audio extracts
insert into storage.buckets (id, name, public)
values ('youtube-audio', 'youtube-audio', false)
on conflict (id) do nothing;

-- Bucket for translated TTS audio chunks
insert into storage.buckets (id, name, public)
values ('translated-audio', 'translated-audio', false)
on conflict (id) do nothing;

-- Policies for youtube-audio bucket (example: service role access)
create policy "Allow service role full access to youtube-audio"
  on storage.objects for all
  using ( bucket_id = 'youtube-audio' and auth.role() = 'service_role' );

-- Policies for translated-audio bucket (example: public read, service role write)
create policy "Allow public read access to translated-audio"
  on storage.objects for select
  using ( bucket_id = 'translated-audio' );

create policy "Allow service role write access to translated-audio"
  on storage.objects for insert, update
  using ( bucket_id = 'translated-audio' and auth.role() = 'service_role' );

create policy "Allow service role delete access to translated-audio"
    on storage.objects for delete
    using ( bucket_id = 'translated-audio' and auth.role() = 'service_role' );
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