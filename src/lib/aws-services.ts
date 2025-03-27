import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { config } from "@/config";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fetch from "node-fetch";
import { createAdminClient } from "./supabase";

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
  console.log(`Starting audio extraction for YouTube video: ${videoId}`);
  let result;

  try {
    if (config.aws.apiGatewayUrl) {
      // If API Gateway URL is provided, use it
      console.log(`Using API Gateway: ${config.aws.apiGatewayUrl}`);
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
        console.error("API Gateway error response:", errorData);
        throw new Error(
          `Failed to extract audio: ${errorData.error || response.statusText}`
        );
      }

      result = await response.json();
      console.log("API Gateway success response:", result);
    } else {
      // Otherwise, invoke Lambda directly
      console.log(`Invoking Lambda function: ${config.aws.lambdaFunctionName}`);
      const payload = JSON.stringify({
        body: JSON.stringify({
          youtubeUrl,
          videoId,
        }),
      });

      console.log("Lambda payload:", payload);
      const command = new InvokeCommand({
        FunctionName: config.aws.lambdaFunctionName,
        Payload: new TextEncoder().encode(payload),
      });

      const { Payload, FunctionError } = await lambdaClient.send(command);

      if (FunctionError) {
        console.error("Lambda function error:", FunctionError);
        throw new Error(`Lambda function error: ${FunctionError}`);
      }

      if (!Payload) {
        throw new Error("Lambda function returned empty payload");
      }

      const lambdaResult = JSON.parse(
        new TextDecoder().decode(Payload as Uint8Array)
      );
      console.log("Lambda raw response:", lambdaResult);

      if (lambdaResult.statusCode !== 200) {
        console.error("Lambda error response:", lambdaResult);
        throw new Error(`Lambda error: ${lambdaResult.body}`);
      }

      result = JSON.parse(lambdaResult.body);
      console.log("Lambda parsed response:", result);

      if (!result.success) {
        console.error("Lambda success=false response:", result);
        throw new Error(`Failed to extract audio: ${result.error}`);
      }
    }

    // Store the audio extract information in the database
    const supabase = createAdminClient();
    console.log("Storing audio extract info:", {
      youtube_id: videoId,
      s3_key: result.s3Key,
    });

    const { data, error } = await supabase
      .from("audio_extracts")
      .insert({
        youtube_id: videoId,
        start_time: 0, // Assume the extract starts at the beginning
        end_time: 3600, // Assume the extract is up to 1 hour long (this is a placeholder)
        s3_key: result.s3Key,
        expiry_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      })
      .select();

    if (error) {
      console.error("Error storing audio extract info:", error);
      // Continue even if there's an error storing the info
    } else {
      console.log("Audio extract stored successfully:", data);
    }

    return result;
  } catch (error) {
    console.error("Audio extraction error:", error);
    throw error;
  }
}

/**
 * Checks if an object exists in S3
 * @param s3Key The S3 key to check
 * @returns Whether the object exists
 */
export async function checkS3ObjectExists(s3Key: string): Promise<boolean> {
  try {
    console.log(`Checking if S3 object exists: ${s3Key}`);
    const command = new HeadObjectCommand({
      Bucket: config.aws.s3BucketName,
      Key: s3Key,
    });
    await s3Client.send(command);
    console.log(`S3 object exists: ${s3Key}`);
    return true;
  } catch (error) {
    console.log(`S3 object does not exist: ${s3Key}`, error);
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
  console.log(`Generating pre-signed URL for S3 object: ${s3Key}`);
  const command = new GetObjectCommand({
    Bucket: config.aws.s3BucketName,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}
