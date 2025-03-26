# YouTube Audio Extractor Lambda

AWS Lambda function to extract audio from YouTube videos using yt-dlp and FFmpeg.

## Deployment Instructions

1. Set up AWS CLI and configure credentials:

   ```
   aws configure
   ```

2. Create an S3 bucket for storing extracted audio:

   ```
   aws s3 mb s3://your-bucket-name
   ```

3. Build and deploy the Lambda function:

   a. Build the Docker image:

   ```
   cd server/lambda/youtube-extractor
   docker build -t youtube-extractor .
   ```

   b. Authenticate Docker to your Amazon ECR registry:

   ```
   aws ecr get-login-password --region your-region | docker login --username AWS --password-stdin your-account-id.dkr.ecr.your-region.amazonaws.com
   ```

   c. Create ECR repository:

   ```
   aws ecr create-repository --repository-name youtube-extractor --image-scanning-configuration scanOnPush=true
   ```

   d. Tag and push the image:

   ```
   docker tag youtube-extractor:latest your-account-id.dkr.ecr.your-region.amazonaws.com/youtube-extractor:latest
   docker push your-account-id.dkr.ecr.your-region.amazonaws.com/youtube-extractor:latest
   ```

   e. Create Lambda function using AWS Console or CLI:

   ```
   aws lambda create-function \
     --function-name youtube-extractor \
     --package-type Image \
     --code ImageUri=your-account-id.dkr.ecr.your-region.amazonaws.com/youtube-extractor:latest \
     --role arn:aws:iam::your-account-id:role/lambda-execution-role \
     --timeout 300 \
     --memory-size 1024 \
     --environment Variables={S3_BUCKET_NAME=your-bucket-name}
   ```

4. Create API Gateway endpoint to trigger the Lambda function (Optional):

   ```
   aws apigateway create-rest-api --name youtube-extractor-api
   ```

5. Configure IAM permissions:
   - The Lambda execution role should have permissions for S3 access
   - Add CloudWatch Logs permissions

## Environment Variables

- `S3_BUCKET_NAME`: Name of the S3 bucket to store extracted audio files

## Usage

Send a POST request to the Lambda function with the following JSON body:

```json
{
  "youtubeUrl": "https://www.youtube.com/watch?v=example",
  "videoId": "unique-identifier-for-video"
}
```

The function will return:

```json
{
  "success": true,
  "audioUrl": "s3://your-bucket/youtube-audio/unique-identifier/uuid.mp3",
  "s3Key": "youtube-audio/unique-identifier/uuid.mp3",
  "videoId": "unique-identifier-for-video"
}
```
