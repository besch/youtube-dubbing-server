# Complete Setup Instructions for YouTube Dubbing App

## 1. AWS Configuration

### Set up AWS Credentials

Install AWS CLI: https://aws.amazon.com/cli/
Configure your AWS credentials:

```bash
aws configure
```

Enter your AWS access key, secret key, and preferred region (e.g., us-east-1)

### Create S3 Bucket

Create an S3 bucket to store audio files:

```bash
aws s3 mb s3://youtube-dubbing-audio
```

Configure bucket CORS to allow access from your app:

```bash
aws s3api put-bucket-cors --bucket youtube-dubbing-audio --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET"],
      "MaxAgeSeconds": 3000,
      "AllowedHeaders": ["*"]
    }
  ]
}'
```

### Deploy AWS Lambda Function

Navigate to the Lambda directory:

```bash
cd server/lambda/youtube-extractor
```

Install dependencies:

```bash
npm install
```

Update the Dockerfile FFmpeg installation section:

```dockerfile
# Install FFmpeg
RUN yum install -y wget && \
    wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar xf ffmpeg-release-amd64-static.tar.xz && \
    rm ffmpeg-release-amd64-static.tar.xz && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ && \
    rm -rf ffmpeg-*-amd64-static/
```

Build the Docker image:

```bash
docker build -t youtube-extractor .
```

Create an ECR repository:

```bash
aws ecr create-repository --repository-name youtube-extractor
```

Login to ECR:

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(aws configure get region).amazonaws.com
```

Tag and push the Docker image:

```bash
docker tag youtube-extractor:latest $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(aws configure get region).amazonaws.com/youtube-extractor:latest
docker push $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(aws configure get region).amazonaws.com/youtube-extractor:latest
```

Create an IAM role for the Lambda function:

```bash
aws iam create-role --role-name youtube-extractor-role --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}'
```

Attach policies to the role:

```bash
aws iam attach-role-policy --role-name youtube-extractor-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam attach-role-policy --role-name youtube-extractor-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

Create the Lambda function:

```bash
aws lambda create-function \
  --function-name youtube-extractor \
  --package-type Image \
  --code ImageUri=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(aws configure get region).amazonaws.com/youtube-extractor:latest \
  --role arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/youtube-extractor-role \
  --timeout 300 \
  --memory-size 1024 \
  --environment Variables={S3_BUCKET_NAME=youtube-dubbing-audio}
```

Create an API Gateway for the Lambda (optional):

```bash
aws apigateway create-rest-api --name youtube-extractor-api
```

Follow the AWS console to complete the API Gateway setup and note the API URL.

## 2. Supabase Configuration

### Database Setup

Log in to your Supabase dashboard
Navigate to the SQL Editor
Copy the contents of `server/schema.sql` and execute it to create all tables, policies, and functions

### Edge Functions Setup

Install Supabase CLI: https://supabase.com/docs/guides/cli
Login to Supabase CLI:

```bash
supabase login
```

Link your Supabase project:

```bash
cd server/supabase
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy the Edge Functions:

```bash
supabase functions deploy process-youtube-url
supabase functions deploy get-audio-chunk
supabase functions deploy update-history
supabase functions deploy toggle-favorite
```

Set environment secrets for the functions:

```bash
supabase secrets set SUPABASE_URL=$(supabase status --show-url)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set NEXTJS_API_URL=https://your-vercel-deployment-url
```

## 3. Server Configuration

Create a `.env.local` file in the `server` directory:

```plaintext
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

Install dependencies:

```bash
cd server
npm install
```

Deploy the server to Vercel:

```bash
npm install -g vercel
vercel login
vercel
```

Set environment variables in Vercel:

```bash
vercel env add
```

Add all the variables from your `.env.local` file.

Deploy to production:

```bash
vercel --prod
```

## 4. Mobile App Configuration

Create a `.env.local` file in the `mobile` directory:

```plaintext
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_API_URL=https://your-vercel-deployment-url
```

Install dependencies:

```bash
cd mobile
npm install @react-native-async-storage/async-storage
npm install
```

Start the Expo development server:

```bash
npx expo start
```

For development testing, you can use Expo Go on your mobile device

To build for production:

```bash
eas build --platform ios  # For iOS
eas build --platform android  # For Android
```

## 5. Testing the Complete Flow

1. Open the mobile app and log in using your Supabase authentication
2. Navigate to the YouTube search screen
3. Search for a video and select it
4. Choose your language and voice preferences
5. The system should:
   - Send the request to the Supabase Edge Function
   - The Edge Function forwards it to your Next.js API
   - The API calls AWS Lambda to extract audio from YouTube
   - Lambda extracts the audio and uploads to S3
   - When you play the video, transcription and TTS are done as needed
   - Generated audio is synced with the video playback

## 6. Maintenance and Monitoring

Monitor your AWS Lambda executions:

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/youtube-extractor
```

Check S3 bucket usage:

```bash
aws s3 ls s3://youtube-dubbing-audio --recursive --summarize
```

Monitor Supabase database through the dashboard

Regularly check for expired content in your Supabase storage

Consider setting up CloudWatch Alarms for Lambda and S3 usage to avoid unexpected costs
