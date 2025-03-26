const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const execAsync = promisify(exec);
const s3 = new AWS.S3();

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const TMP_DIR = "/tmp";

exports.handler = async (event) => {
  try {
    // Parse input
    const { youtubeUrl, videoId } = JSON.parse(event.body || "{}");

    if (!youtubeUrl || !videoId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Missing youtubeUrl or videoId parameter",
        }),
      };
    }

    console.log(`Processing YouTube URL: ${youtubeUrl}`);

    // Generate unique ID for files
    const uniqueId = uuidv4();
    const audioFilePath = path.join(TMP_DIR, `${uniqueId}.mp3`);

    // Extract audio using yt-dlp
    console.log("Extracting audio from YouTube video...");
    await execAsync(
      `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${audioFilePath}" ${youtubeUrl}`,
      { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer
    );

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error("Failed to extract audio from YouTube video");
    }

    // Upload to S3
    console.log("Uploading audio to S3...");
    const s3Key = `youtube-audio/${videoId}/${uniqueId}.mp3`;

    await s3
      .upload({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fs.createReadStream(audioFilePath),
        ContentType: "audio/mpeg",
      })
      .promise();

    // Clean up
    fs.unlinkSync(audioFilePath);

    // Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        audioUrl: `s3://${BUCKET_NAME}/${s3Key}`,
        s3Key: s3Key,
        videoId: videoId,
      }),
    };
  } catch (error) {
    console.error("Error processing YouTube video:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || "Unknown error occurred",
      }),
    };
  }
};
