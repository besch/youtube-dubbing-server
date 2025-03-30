-- Users are managed by Supabase Auth
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  settings jsonb default '{"default_language": "en", "default_voice": "alloy"}' not null
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

-- Videos table to store information about processed videos
create table public.videos (
  id uuid default gen_random_uuid() primary key,
  youtube_id text not null,
  title text,
  description text,
  thumbnail_url text,
  duration integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  unique(youtube_id)
);

-- Enable RLS
alter table public.videos enable row level security;

-- Secure the tables
create policy "Videos are viewable by everyone" 
  on videos for select 
  using ( true );

-- Watch history
create table public.history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  video_id uuid references public.videos(id) on delete cascade not null,
  language text not null,
  voice text not null,
  watched_at timestamp with time zone default now() not null,
  last_position float default 0 not null,
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
  language text not null,
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

-- Transcriptions
create table public.transcriptions (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos(id) on delete cascade not null,
  chunk_start float not null,
  chunk_end float not null,
  content jsonb not null,
  created_at timestamp with time zone default now() not null,
  expiry_at timestamp with time zone not null,
  is_favorite boolean default false not null
);

-- Enable RLS
alter table public.transcriptions enable row level security;

-- Secure the tables
create policy "Transcriptions are viewable by everyone" 
  on transcriptions for select 
  using ( true );

-- Audio extracts from S3
create table public.youtube_audio (
  id uuid default gen_random_uuid() primary key,
  youtube_id text not null,
  created_at timestamp with time zone default now() not null,
  expiry_at timestamp with time zone default now() + interval '7 days' not null,
  unique(youtube_id)
);

-- Enable RLS
alter table public.youtube_audio enable row level security;

-- Secure the table
create policy "Audio extracts are viewable by everyone" 
  on youtube_audio for select 
  using ( true );

-- Function to clean up expired audio chunks and transcriptions
create or replace function cleanup_expired_resources()
returns void as $$
begin
  
  -- Delete expired transcriptions
  delete from public.transcriptions where expiry_at < now() and is_favorite = false;
  
  -- Delete expired audio extracts
  delete from public.youtube_audio where expiry_at < now();
end;
$$ language plpgsql security definer;

-- Create a cron job to run cleanup every day
select cron.schedule(
  'cleanup-expired-resources',
  '0 0 * * *', -- Run at midnight every day
  $$select cleanup_expired_resources()$$
);

-- Create a function to mark resources as favorite when a video is favorited
create or replace function mark_resources_as_favorite()
returns trigger as $$
begin
  -- Mark audio chunks as favorite
  update public.audio_chunks
  set is_favorite = true, expiry_at = now() + interval '30 days'
  where video_id = NEW.video_id and language = NEW.language and voice = NEW.voice;
  
  -- Mark transcriptions as favorite
  update public.transcriptions
  set is_favorite = true, expiry_at = now() + interval '30 days'
  where video_id = NEW.video_id;
  
  return NEW;
end;
$$ language plpgsql security definer;

-- Create a trigger to mark resources as favorite when a video is favorited
create trigger mark_resources_as_favorite_trigger
after insert on public.favorites
for each row
execute function mark_resources_as_favorite();

-- Function to handle unfavoriting
create or replace function unmark_resources_as_favorite()
returns trigger as $$
begin
  -- Check if there are other favorites for the same video with same language/voice
  if not exists (
    select 1 from public.favorites 
    where video_id = OLD.video_id 
    and language = OLD.language 
    and voice = OLD.voice
  ) then
    -- Unmark audio chunks
    update public.audio_chunks
    set is_favorite = false, expiry_at = now() + interval '24 hours'
    where video_id = OLD.video_id and language = OLD.language and voice = OLD.voice;
    
    -- Check if there are other favorites for the same video with any language/voice
    if not exists (select 1 from public.favorites where video_id = OLD.video_id) then
      -- Unmark transcriptions
      update public.transcriptions
      set is_favorite = false, expiry_at = now() + interval '24 hours'
      where video_id = OLD.video_id;
    end if;
  end if;
  
  return OLD;
end;
$$ language plpgsql security definer;

-- Create a trigger to unmark resources when a video is unfavorited
create trigger unmark_resources_as_favorite_trigger
after delete on public.favorites
for each row
execute function unmark_resources_as_favorite();

-- Create a trigger to update the updated_at column
create or replace function update_modified_column()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

create trigger update_profiles_modtime
before update on profiles
for each row
execute function update_modified_column();

create trigger update_videos_modtime
before update on videos
for each row
execute function update_modified_column(); 