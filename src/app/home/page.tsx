import { Tv2 } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col items-center justify-center flex-grow px-4 sm:px-8 py-16 sm:py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-950/40 px-3 py-1 text-xs font-medium text-violet-300">
            <Tv2 size={14} className="text-violet-400" />
            <span>
              <a
                href="https://chromewebstore.google.com/detail/onedub/gnkcmnoobhckipojdkemkelghfjcpmdc"
                target="_blank"
                rel="noopener noreferrer"
              >
                Chrome Extension Experience
              </a>
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500 line-height-[75px]">
            AI Dubbing for YouTube
          </h1>
          <p className="text-lg sm:text-xl text-neutral-300/80 max-w-2xl mx-auto mb-10">
            Experience YouTube videos in your preferred language and voice with
            our real-time AI-powered dubbing Chrome Extension.
          </p>

          <div className="my-12 px-4">
            <div className="aspect-video max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl border border-neutral-700/50">
              <iframe
                width="100%"
                height="100%"
                src="https://www.youtube.com/embed/f9Ti7OfXIjQ?autoplay=1&mute=1&loop=1&playlist=f9Ti7OfXIjQ&controls=0&showinfo=0&rel=0&iv_load_policy=3&modestbranding=1"
                title="YouTube video player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="rounded-xl"
              ></iframe>
            </div>
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
