"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icons } from "@/components/icons";
import { toast } from "sonner";
import { checkVideoLimit } from "@/app/actions/subscription";

interface VideoProcessorProps {
  subscriptionStatus: "free" | "premium";
  dailyVideoCount: number;
}

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
];

const VOICES = {
  free: [
    { id: "en-US-Neural2-A", name: "English (US) - Female" },
    { id: "en-US-Neural2-C", name: "English (US) - Male" },
    { id: "en-GB-Neural2-A", name: "English (UK) - Female" },
    { id: "en-GB-Neural2-B", name: "English (UK) - Male" },
  ],
  premium: [
    { id: "en-US-Neural2-A", name: "English (US) - Female" },
    { id: "en-US-Neural2-C", name: "English (US) - Male" },
    { id: "en-GB-Neural2-A", name: "English (UK) - Female" },
    { id: "en-GB-Neural2-B", name: "English (UK) - Male" },
    { id: "es-ES-Neural2-A", name: "Spanish - Female" },
    { id: "es-ES-Neural2-B", name: "Spanish - Male" },
    { id: "fr-FR-Neural2-A", name: "French - Female" },
    { id: "fr-FR-Neural2-B", name: "French - Male" },
    { id: "de-DE-Neural2-A", name: "German - Female" },
    { id: "de-DE-Neural2-B", name: "German - Male" },
    { id: "it-IT-Neural2-A", name: "Italian - Female" },
    { id: "it-IT-Neural2-B", name: "Italian - Male" },
    { id: "pt-BR-Neural2-A", name: "Portuguese - Female" },
    { id: "pt-BR-Neural2-B", name: "Portuguese - Male" },
    { id: "ru-RU-Neural2-A", name: "Russian - Female" },
    { id: "ru-RU-Neural2-B", name: "Russian - Male" },
    { id: "ja-JP-Neural2-A", name: "Japanese - Female" },
    { id: "ja-JP-Neural2-B", name: "Japanese - Male" },
    { id: "ko-KR-Neural2-A", name: "Korean - Female" },
    { id: "ko-KR-Neural2-B", name: "Korean - Male" },
    { id: "zh-CN-Neural2-A", name: "Chinese - Female" },
    { id: "zh-CN-Neural2-B", name: "Chinese - Male" },
  ],
};

export function VideoProcessor({
  subscriptionStatus,
  dailyVideoCount,
}: VideoProcessorProps) {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("en");
  const [voice, setVoice] = useState("en-US-Neural2-A");
  const [isProcessing, setIsProcessing] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsProcessing(true);

      // Check video limit for free users
      if (subscriptionStatus === "free" && dailyVideoCount >= 4) {
        toast.error(
          "You've reached your daily limit. Upgrade to premium for unlimited videos."
        );
        return;
      }

      // Extract video ID from URL
      const videoId = extractVideoId(url);
      if (!videoId) {
        toast.error("Invalid YouTube URL");
        return;
      }

      // Check if user can generate this video
      const result = await checkVideoLimit({ videoId });
      if (!result.success) {
        toast.error(result.error || "Failed to check video limit");
        return;
      }

      if (!result.data?.canGenerate) {
        toast.error(
          "You've reached your daily limit. Upgrade to premium for unlimited videos."
        );
        return;
      }

      // Start processing
      router.push(`/video/${videoId}?language=${language}&voice=${voice}`);
    } catch (error) {
      toast.error("Failed to process video");
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const extractVideoId = (url: string) => {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">YouTube Dubbing</h1>
        <p className="text-muted-foreground">
          Watch YouTube videos with AI-generated dubbing in multiple languages
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">YouTube URL</Label>
          <Input
            id="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="language">Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice">Voice</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger>
                <SelectValue placeholder="Select voice" />
              </SelectTrigger>
              <SelectContent>
                {VOICES[subscriptionStatus].map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isProcessing || !url}
        >
          {isProcessing && (
            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
          )}
          {isProcessing ? "Processing..." : "Generate Dubbing"}
        </Button>

        {subscriptionStatus === "free" && (
          <p className="text-center text-sm text-muted-foreground">
            {4 - dailyVideoCount} videos remaining today.{" "}
            <a
              href="/subscription"
              className="font-medium text-primary hover:underline"
            >
              Upgrade to premium
            </a>{" "}
            for unlimited videos.
          </p>
        )}
      </form>
    </div>
  );
}
