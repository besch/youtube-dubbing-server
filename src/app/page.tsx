import HomePage from "@/app/home/page";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Movie and YouTube Dubbing",
  description: "Watch YouTube videos and movies with AI-generated dubbing",
};

export default function Page() {
  return <HomePage />;
}
