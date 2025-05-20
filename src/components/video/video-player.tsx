"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import { processVideo } from "@/app/actions/video";

interface VideoPlayerProps {
  videoId: string;
  language: string;
  voice: string;
  subscriptionStatus: "free" | "premium";
  existingVideo?: {
    id: string;
    status: "processing" | "completed" | "failed";
    audio_url?: string;
    error?: string;
  } | null;
}

export function VideoPlayer({
  videoId,
  language,
  voice,
  subscriptionStatus,
  existingVideo,
}: VideoPlayerProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "processing" | "completed" | "failed"
  >(existingVideo?.status || "idle");
  const [error, setError] = useState<string | null>(
    existingVideo?.error || null
  );
  const router = useRouter();

  useEffect(() => {
    if (existingVideo?.status === "processing") {
      setIsProcessing(true);
      setStatus("processing");
    }
  }, [existingVideo]);

  const handleProcess = async () => {
    try {
      setIsProcessing(true);
      setStatus("processing");
      setError(null);

      const result = await processVideo({
        videoId,
        language,
        voice,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to process video");
      }

      setStatus("completed");
      toast.success("Video processed successfully!");
    } catch (error) {
      setStatus("failed");
      setError(
        error instanceof Error ? error.message : "Failed to process video"
      );
      toast.error("Failed to process video");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Video Processing</h2>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Icons.arrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <span className="text-sm text-muted-foreground">
                {status === "idle" && "Ready to process"}
                {status === "processing" && "Processing..."}
                {status === "completed" && "Completed"}
                {status === "failed" && "Failed"}
              </span>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {status === "completed" && existingVideo?.audio_url && (
              <div className="space-y-2">
                <span className="text-sm font-medium">Audio Preview</span>
                <audio
                  controls
                  className="w-full"
                  src={existingVideo.audio_url}
                />
              </div>
            )}
          </div>
        </div>

        {status === "idle" && (
          <Button
            className="w-full"
            onClick={handleProcess}
            disabled={isProcessing}
          >
            {isProcessing && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isProcessing ? "Processing..." : "Start Processing"}
          </Button>
        )}

        {status === "failed" && (
          <Button
            className="w-full"
            onClick={handleProcess}
            disabled={isProcessing}
          >
            {isProcessing && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isProcessing ? "Processing..." : "Retry Processing"}
          </Button>
        )}
      </div>
    </div>
  );
}
