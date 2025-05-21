import HomePage from "@/app/home/page";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "YouTube Dubbing",
  description: "Watch YouTube videos with AI-generated dubbing",
};

export default function Page() {
  return <HomePage />;
}
