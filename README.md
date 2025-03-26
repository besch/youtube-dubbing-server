# YouTube Dubbing Server

This is the server component of the YouTube Dubbing application.

## Setup

1. Create a `.env.local` file with the following variables:

```
OPENAI_API_KEY=your_openai_key
REPLICATE_API_KEY=your_replicate_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
ANTHROPIC_API_KEY=your_anthropic_key
YOUTUBE_API_KEY=your_youtube_api_key

# AWS Configuration
AWS_REGION=us-east-1
AWS_LAMBDA_FUNCTION_NAME=youtube-extractor
S3_BUCKET_NAME=youtube-dubbing-audio
AWS_API_GATEWAY_URL=https://your-api-gateway-url
```

2. Install dependencies:

```
npm install
```

3. Run the development server:

```
npm run dev
```

## AWS Lambda Setup

The application uses AWS Lambda to extract audio from YouTube videos. Follow these steps to set up the AWS resources:

1. Deploy the Lambda function:

```
cd lambda/youtube-extractor
npm install
```

2. Follow the deployment instructions in the `lambda/youtube-extractor/README.md` file to build and deploy the Docker image to AWS Lambda.

3. Create an S3 bucket for storing audio:

```
aws s3 mb s3://youtube-dubbing-audio
```

4. Configure IAM permissions for the Lambda function:

   - S3 access for uploading audio files
   - CloudWatch Logs for logging

5. Update your `.env.local` file with the AWS configuration variables.

## Supabase Setup

1. Import the `schema.sql` file into your Supabase project to set up the database schema.

2. Deploy the Supabase Edge Functions:

```
cd supabase
supabase functions deploy
```

3. Configure function secrets:

```
supabase secrets set NEXTJS_API_URL=https://your-vercel-deployment-url
```

## API Routes

- `POST /api/youtube/process` - Process a YouTube URL
- `POST /api/youtube/audio-chunk` - Get an audio chunk for a specific time range
- `POST /api/update-history` - Update watch history
- `POST /api/toggle-favorite` - Toggle favorite status for a video

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
