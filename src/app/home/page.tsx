import Image from "next/image";
import { Github, Smartphone, Apple, Play } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white font-[family-name:var(--font-geist-sans)]">
      <header className="flex justify-center w-full p-4 sm:p-6">
        <a
          href="https://github.com/yourusername/youtube-dubbing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-neutral-800/70 px-4 py-2 text-sm text-neutral-300 ring-1 ring-neutral-700/50 hover:bg-neutral-700/80 hover:text-white transition-all duration-200"
        >
          <Github size={16} />
          <span className="font-medium">View on GitHub</span>
          <span className="hidden sm:inline text-neutral-400">
            &bull; Contribute
          </span>
        </a>
      </header>

      <main className="flex flex-col items-center justify-center flex-grow px-4 sm:px-8 py-16 sm:py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-950/40 px-3 py-1 text-xs font-medium text-violet-300">
            <Smartphone size={14} className="text-violet-400" />
            <span>Mobile App First Experience</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500">
            AI Dubbing for YouTube
          </h1>
          <p className="text-lg sm:text-xl text-neutral-300/80 max-w-2xl mx-auto mb-10">
            Experience YouTube videos in your preferred language and voice with
            our real-time AI-powered dubbing mobile application.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-12">
            <a
              href="#"
              className="flex items-center justify-center gap-2.5 w-full sm:w-auto rounded-lg bg-white px-6 py-3 text-black font-semibold shadow-md hover:bg-neutral-200 transition-colors duration-200"
            >
              <Apple size={20} />
              <span>Download on the App Store</span>
            </a>
            <a
              href="#"
              className="flex items-center justify-center gap-2.5 w-full sm:w-auto rounded-lg bg-neutral-800 px-6 py-3 text-white font-semibold ring-1 ring-neutral-700 hover:bg-neutral-700 transition-colors duration-200"
            >
              <Play size={20} />
              <span>Get it on Google Play</span>
            </a>
          </div>

          <div className="mb-16 px-4">
            <h2 className="text-2xl font-semibold mb-6 text-neutral-200">
              Key Features
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="bg-neutral-800/50 p-5 rounded-lg border border-neutral-700/50">
                <h3 className="font-semibold text-lg mb-2 text-violet-400">
                  Real-time Dubbing
                </h3>
                <p className="text-sm text-neutral-400">
                  Instantly translate and dub videos as you watch.
                </p>
              </div>
              <div className="bg-neutral-800/50 p-5 rounded-lg border border-neutral-700/50">
                <h3 className="font-semibold text-lg mb-2 text-purple-400">
                  Multiple Languages & Voices
                </h3>
                <p className="text-sm text-neutral-400">
                  Choose from a wide range of languages and AI voices.
                </p>
              </div>
              <div className="bg-neutral-800/50 p-5 rounded-lg border border-neutral-700/50">
                <h3 className="font-semibold text-lg mb-2 text-orange-400">
                  Seamless Experience
                </h3>
                <p className="text-sm text-neutral-400">
                  Integrated player, history, and favorites sync.
                </p>
              </div>
            </div>
          </div>

          {/* TODO: Add a mobile app screenshot here */}
          {/* <div className="relative w-full aspect-video max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl border border-neutral-700/50">
            <Image
              src="/images/demo-screenshot.png" // This image does not exist
              alt="YouTube Dubbing App Screenshot"
              fill
              priority
              className="object-cover object-center"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div> */}
        </div>
      </main>

      <footer className="text-center p-6 text-sm text-neutral-500 space-x-4">
        <span>
          &copy; {new Date().getFullYear()} YouTube Dubbing. All rights
          reserved.
        </span>
        <span className="text-neutral-600">|</span>
        <Link
          href="/privacy"
          className="hover:text-neutral-300 transition-colors"
        >
          Privacy Policy
        </Link>
        <span className="text-neutral-600">|</span>
        <Link
          href="/support"
          className="hover:text-neutral-300 transition-colors"
        >
          Support
        </Link>
      </footer>
    </div>
  );
}
