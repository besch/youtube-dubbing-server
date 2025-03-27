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
const DEBUG = process.env.DEBUG === "true";

function debug(message, data) {
  if (DEBUG) {
    console.log(`DEBUG: ${message}`, data ? JSON.stringify(data) : "");
  }
}

exports.handler = async (event) => {
  try {
    debug("Event received", event);

    // Parse input
    let body;
    try {
      body = JSON.parse(event.body || "{}");
      debug("Parsed body", body);
    } catch (e) {
      console.error("Error parsing request body:", e);
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Invalid JSON in request body",
        }),
      };
    }

    const { youtubeUrl, videoId } = body;

    if (!youtubeUrl || !videoId) {
      console.error("Missing required parameters:", { youtubeUrl, videoId });
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
    debug("Generated audio file path", { audioFilePath });

    // Extract audio using yt-dlp
    console.log("Extracting audio from YouTube video...");
    try {
      const ytdlpCommand = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${audioFilePath}" ${youtubeUrl}`;
      debug("Running yt-dlp command", { ytdlpCommand });

      const { stdout, stderr } = await execAsync(
        ytdlpCommand,
        { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer
      );

      debug("yt-dlp stdout", stdout);
      if (stderr) {
        debug("yt-dlp stderr", stderr);
      }
    } catch (error) {
      console.error("Error executing yt-dlp:", error.message);
      if (error.stdout) debug("yt-dlp stdout", error.stdout);
      if (error.stderr) debug("yt-dlp stderr", error.stderr);
      throw new Error(`Failed to extract audio: ${error.message}`);
    }

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      console.error("Audio file not found at path:", audioFilePath);
      throw new Error("Failed to extract audio from YouTube video");
    }

    // Get file size and info
    const stats = fs.statSync(audioFilePath);
    debug("Audio file stats", {
      size: stats.size,
      path: audioFilePath,
      exists: fs.existsSync(audioFilePath),
    });

    // Upload to S3
    console.log("Uploading audio to S3...");
    const s3Key = `youtube-audio/${videoId}/${uniqueId}.mp3`;
    debug("S3 upload parameters", {
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    try {
      const uploadResult = await s3
        .upload({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: fs.createReadStream(audioFilePath),
          ContentType: "audio/mpeg",
        })
        .promise();

      debug("S3 upload result", uploadResult);
    } catch (error) {
      console.error("Error uploading to S3:", error);
      throw new Error(`Failed to upload audio to S3: ${error.message}`);
    }

    // Clean up
    fs.unlinkSync(audioFilePath);
    console.log("Temporary file deleted");

    // Return success response
    const response = {
      success: true,
      audioUrl: `s3://${BUCKET_NAME}/${s3Key}`,
      s3Key: s3Key,
      videoId: videoId,
    };

    debug("Response", response);

    return {
      statusCode: 200,
      body: JSON.stringify(response),
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
