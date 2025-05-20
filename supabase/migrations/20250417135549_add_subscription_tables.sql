-- Add subscription-related columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free' CHECK (subscription_status IN ('free', 'premium')),
ADD COLUMN IF NOT EXISTS subscription_id text,
ADD COLUMN IF NOT EXISTS subscription_end_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_ip_address text,
ADD COLUMN IF NOT EXISTS daily_video_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_video_count_reset timestamp with time zone DEFAULT now();

-- Create table for tracking video generation limits
CREATE TABLE IF NOT EXISTS public.daily_video_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daily_video_limits_pkey PRIMARY KEY (id),
    CONSTRAINT daily_video_limits_user_id_video_id_key UNIQUE (user_id, video_id),
    CONSTRAINT daily_video_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT daily_video_limits_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE
);

-- Create table for tracking subscription events
CREATE TABLE IF NOT EXISTS public.subscription_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    event_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_events_pkey PRIMARY KEY (id),
    CONSTRAINT subscription_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Add RLS policies for new tables
ALTER TABLE public.daily_video_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Policies for daily_video_limits
CREATE POLICY "Users can view their own video limits" ON public.daily_video_limits
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage video limits" ON public.daily_video_limits
    FOR ALL TO service_role USING (true);

-- Policies for subscription_events
CREATE POLICY "Users can view their own subscription events" ON public.subscription_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage subscription events" ON public.subscription_events
    FOR ALL TO service_role USING (true);

-- Function to reset daily video count
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
    WHERE last_video_count_reset < now() - interval '1 day';
END;
$$;

-- Create a cron job to reset daily video count
SELECT cron.schedule(
    'reset-daily-video-count',
    '0 0 * * *', -- Run at midnight every day
    $$SELECT public.reset_daily_video_count()$$
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_video_limits_user_id ON public.daily_video_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_video_limits_created_at ON public.daily_video_limits(created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON public.subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created_at ON public.subscription_events(created_at);

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_video_limits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_events; 