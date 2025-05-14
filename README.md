# YouTube Dubbing Server

This is the server component of the YouTube Dubbing application.

## Setup

1. Create a `.env.local` file with the following variables:

```
OPENAI_API_KEY_NEW=your_openai_key
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

2. Build and push the Docker image to ECR (follow the README.md in the lambda directory).

3. Create an S3 bucket for storing audio:

```
aws s3 mb s3://youtube-dubbing-audio
```

4. Set up API Gateway to expose the Lambda function:

```
# Create a resource for the YouTube endpoint
aws apigateway create-resource \
  --rest-api-id <API_ID> \
  --parent-id <PARENT_ID> \
  --path-part youtube

# Set up a POST method
aws apigateway put-method \
  --rest-api-id <API_ID> \
  --resource-id <RESOURCE_ID> \
  --http-method POST \
  --authorization-type NONE

# Connect the method to the Lambda function
aws apigateway put-integration \
  --rest-api-id <API_ID> \
  --resource-id <RESOURCE_ID> \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:<REGION>:lambda:path/2015-03-31/functions/arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:youtube-extractor/invocations

# Deploy the API
aws apigateway create-deployment \
  --rest-api-id <API_ID> \
  --stage-name prod

# Grant API Gateway permission to invoke the Lambda function
aws lambda add-permission \
  --function-name youtube-extractor \
  --statement-id apigateway-test \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:<REGION>:<ACCOUNT_ID>:<API_ID>/*/POST/youtube"
```

5. Update your `.env.local` file with the AWS configuration variables:

```
AWS_REGION=us-east-1
AWS_LAMBDA_FUNCTION_NAME=youtube-extractor
S3_BUCKET_NAME=youtube-dubbing-audio
AWS_API_GATEWAY_URL=https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod/youtube
```

## YouTube Dubbing System Architecture

The application uses the following workflow for dubbing YouTube videos:

1. User selects a video in the mobile app
2. Server extracts audio using AWS Lambda and stores it in S3
3. Video audio is transcribed using Replicate's Whisper model
4. Transcription is optionally translated to target language using Anthropic Claude
5. Audio is generated with OpenAI TTS in the selected voice/language
6. Audio chunks are stored in Supabase storage for streaming
7. Mobile app plays the dubbed audio in sync with the YouTube video

### Audio Chunking

For better performance, the system:

- Extracts full audio from the video upfront
- Transcribes in real-time as the user watches
- Generates audio in 30-second chunks as needed
- Caches chunks for reuse and better performance

### Handling Missing Audio

The system uses a fallback audio file in cases where:

- Audio extraction is still in progress
- No speech content is found in the time range
- An unexpected error occurs during processing

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
- `POST /api/youtube/yotube-audio` - Get an audio chunk for a specific time range
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
