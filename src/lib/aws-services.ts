import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { config } from "@/config";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fetch from "node-fetch";

const s3Client = new S3Client({
  region: config.aws.region,
});

const lambdaClient = new LambdaClient({
  region: config.aws.region,
});

/**
 * Extracts audio from a YouTube video using the AWS Lambda function
 * @param youtubeUrl The YouTube video URL
 * @param videoId A unique identifier for the video
 * @returns The S3 key and URL of the extracted audio file
 */
export async function extractYoutubeAudio(youtubeUrl: string, videoId: string) {
  if (config.aws.apiGatewayUrl) {
    // If API Gateway URL is provided, use it
    const response = await fetch(config.aws.apiGatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        youtubeUrl,
        videoId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Failed to extract audio: ${errorData.error || response.statusText}`
      );
    }

    return await response.json();
  } else {
    // Otherwise, invoke Lambda directly
    const payload = JSON.stringify({
      body: JSON.stringify({
        youtubeUrl,
        videoId,
      }),
    });

    const command = new InvokeCommand({
      FunctionName: config.aws.lambdaFunctionName,
      Payload: new TextEncoder().encode(payload),
    });

    const { Payload } = await lambdaClient.send(command);
    const result = JSON.parse(
      new TextDecoder().decode(Payload as Uint8Array)
    );
    const body = JSON.parse(result.body);

    if (!body.success) {
      throw new Error(`Failed to extract audio: ${body.error}`);
    }

    return body;
  }
}

/**
 * Checks if an object exists in S3
 * @param s3Key The S3 key to check
 * @returns Whether the object exists
 */
export async function checkS3ObjectExists(s3Key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: config.aws.s3BucketName,
      Key: s3Key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generates a pre-signed URL for an S3 object
 * @param s3Key The S3 key of the object
 * @param expiresIn Number of seconds until the URL expires (default: 3600)
 * @returns A pre-signed URL for the S3 object
 */
export async function getS3PreSignedUrl(
  s3Key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.aws.s3BucketName,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
} 