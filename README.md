# YouTube Dubbing Server

A Next.js server application for dubbing YouTube videos with AI-generated voices.

## Features

- YouTube video processing with AI voice generation
- User authentication with Google OAuth
- Subscription management with Stripe
  - Free plan: 3 videos per day
  - Premium plan: Unlimited videos
    - Monthly: $9.99/month
    - Yearly: $99.99/year (17% savings)
- Video processing history and management
- Responsive and modern UI with dark mode support

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Shadcn UI, Radix UI
- **State Management**: Jotai
- **Database**: Supabase
- **Authentication**: Supabase Auth with Google Provider
- **Payments**: Stripe
- **AI Voice Generation**: OpenAI
- **Video Processing**: AWS S3, FFmpeg

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:

   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

   # Stripe
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID=your_stripe_monthly_price_id
   NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID=your_stripe_yearly_price_id

   # OpenAI
   OPENAI_API_KEY=your_openai_api_key

   # YouTube API
   YOUTUBE_API_KEY=your_youtube_api_key

   # TMDb (The Movie Database) - for movie/TV show search
   TMDB_API_KEY=your_tmdb_api_key

   # AWS
   AWS_ACCESS_KEY_ID=your_aws_access_key_id
   AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
   AWS_REGION=your_aws_region
   AWS_BUCKET_NAME=your_aws_bucket_name

   # App
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. Set up the database schema in Supabase:

   ```sql
   -- Create profiles table
   create table profiles (
     id uuid references auth.users on delete cascade,
     email text,
     full_name text,
     avatar_url text,
     subscription_status text default 'free',
     stripe_customer_id text,
     stripe_subscription_id text,
     daily_video_count integer default 0,
     last_ip_address text,
     created_at timestamp with time zone default timezone('utc'::text, now()) not null,
     updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
     primary key (id)
   );

   -- Create videos table
   create table videos (
     id uuid default uuid_generate_v4() primary key,
     user_id uuid references profiles(id) on delete cascade,
     youtube_id text not null,
     title text,
     description text,
     thumbnail_url text,
     status text default 'pending',
     audio_url text,
     created_at timestamp with time zone default timezone('utc'::text, now()) not null,
     updated_at timestamp with time zone default timezone('utc'::text, now()) not null
   );

   -- Create RLS policies
   alter table profiles enable row level security;
   alter table videos enable row level security;

   create policy "Users can view their own profile"
     on profiles for select
     using (auth.uid() = id);

   create policy "Users can update their own profile"
     on profiles for update
     using (auth.uid() = id);

   create policy "Users can view their own videos"
     on videos for select
     using (auth.uid() = user_id);

   create policy "Users can insert their own videos"
     on videos for insert
     with check (auth.uid() = user_id);

   create policy "Users can update their own videos"
     on videos for update
     using (auth.uid() = user_id);

   create policy "Users can delete their own videos"
     on videos for delete
     using (auth.uid() = user_id);
   ```

5. Run the development server:
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── actions/           # Server actions
│   └── (routes)/          # Page routes
├── components/            # React components
│   ├── ui/               # UI components
│   └── (feature)/        # Feature-specific components
├── lib/                   # Utility functions and configurations
├── types/                 # TypeScript type definitions
└── styles/               # Global styles
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
