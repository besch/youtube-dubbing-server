import { Tv2, Play, Globe, Zap } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Gradient orbs */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl animate-pulse delay-2000"></div>

        {/* Floating film strips - appear and disappear in random locations */}
        <div className="absolute top-16 left-16 w-32 h-6 bg-gradient-to-r from-violet-500/25 to-violet-500/8 animate-float-fade-1 rounded-sm shadow-lg">
          <div className="flex h-full">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-violet-400/50 bg-violet-500/15"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-32 right-20 w-40 h-6 bg-gradient-to-l from-purple-500/25 to-purple-500/8 animate-float-fade-2 animate-delay-2 rounded-sm shadow-lg">
          <div className="flex h-full">
            {[...Array(15)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-purple-400/50 bg-purple-500/15"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute top-20 right-32 w-28 h-5 bg-gradient-to-r from-orange-500/20 to-orange-500/8 animate-float-fade-3 animate-delay-4 rounded-sm shadow-md">
          <div className="flex h-full">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-orange-400/40 bg-orange-500/12"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-20 left-24 w-36 h-6 bg-gradient-to-r from-violet-500/20 to-transparent animate-float-fade-4 animate-delay-1 rounded-sm shadow-lg">
          <div className="flex h-full">
            {[...Array(14)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-violet-400/40 bg-violet-500/12"
              ></div>
            ))}
          </div>
        </div>

        <div className="absolute top-96 right-16 w-30 h-5 bg-gradient-to-l from-purple-500/18 to-purple-500/5 animate-float-fade-5 animate-delay-5 rounded-sm shadow-md">
          <div className="flex h-full">
            {[...Array(11)].map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-purple-400/35 bg-purple-500/10"
              ></div>
            ))}
          </div>
        </div>

        {/* Floating video thumbnails - random appearances */}
        <div className="absolute top-40 right-24 w-24 h-14 bg-gradient-to-br from-violet-500/20 to-purple-500/15 rounded-md animate-float-fade-1 animate-delay-1 border border-violet-400/30 shadow-lg">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/15 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[8px] border-l-white/60 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent"></div>
        </div>

        <div className="absolute bottom-40 left-32 w-28 h-16 bg-gradient-to-br from-orange-500/20 to-violet-500/15 rounded-md animate-float-fade-2 animate-delay-3 border border-orange-400/30 shadow-lg">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/15 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[8px] border-l-white/60 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent"></div>
        </div>

        <div className="absolute top-72 left-80 w-20 h-12 bg-gradient-to-br from-purple-500/20 to-orange-500/15 rounded-md animate-float-fade-3 animate-delay-6 border border-purple-400/30 shadow-md">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/12 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-l-white/50 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent"></div>
        </div>

        <div className="absolute top-24 left-60 w-22 h-13 bg-gradient-to-br from-violet-500/18 to-purple-500/12 rounded-md animate-float-fade-4 animate-delay-2 border border-violet-400/25 shadow-md">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/12 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-l-white/50 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent"></div>
        </div>

        <div className="absolute bottom-16 right-40 w-26 h-15 bg-gradient-to-br from-orange-500/18 to-violet-500/12 rounded-md animate-float-fade-5 animate-delay-4 border border-orange-400/25 shadow-md">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/12 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-l-white/50 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent"></div>
        </div>

        <div className="absolute top-80 right-28 w-18 h-11 bg-gradient-to-br from-purple-500/16 to-orange-500/12 rounded-md animate-float-fade-6 animate-delay-1 border border-purple-400/25 shadow-md">
          <div className="w-full h-full rounded-md bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[5px] border-l-white/45 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent"></div>
        </div>

        {/* Enhanced scan lines */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-500/12 to-transparent h-1 animate-scan-line opacity-90 shadow-violet-500/30 shadow-lg blur-sm"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-500/10 to-transparent h-1 animate-scan-line-2 opacity-80 shadow-purple-500/20 shadow-lg blur-sm"></div>

        {/* Floating play buttons - appearing randomly */}
        <div className="absolute top-52 left-28 w-12 h-12 animate-float-fade-1 animate-delay-3">
          <div className="w-0 h-0 border-l-[18px] border-l-violet-400/80 border-t-[9px] border-t-transparent border-b-[9px] border-b-transparent ml-3 drop-shadow-lg"></div>
        </div>

        <div className="absolute bottom-48 right-36 w-12 h-12 animate-float-fade-2 animate-delay-5">
          <div className="w-0 h-0 border-l-[18px] border-l-orange-400/80 border-t-[9px] border-t-transparent border-b-[9px] border-b-transparent ml-3 drop-shadow-lg"></div>
        </div>

        <div className="absolute top-12 right-48 w-10 h-10 animate-float-fade-3 animate-delay-1">
          <div className="w-0 h-0 border-l-[15px] border-l-purple-400/70 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent ml-2 drop-shadow-md"></div>
        </div>

        <div className="absolute bottom-24 left-72 w-11 h-11 animate-float-fade-4 animate-delay-4">
          <div className="w-0 h-0 border-l-[16px] border-l-violet-400/75 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent ml-2 drop-shadow-lg"></div>
        </div>

        <div className="absolute top-88 left-20 w-9 h-9 animate-float-fade-5 animate-delay-6">
          <div className="w-0 h-0 border-l-[14px] border-l-orange-400/65 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent ml-2 drop-shadow-md"></div>
        </div>

        {/* Floating particles - magical appearance */}
        <div className="absolute top-32 right-52 w-3 h-3 bg-violet-400/80 rounded-full animate-float-fade-1 animate-delay-2 shadow-lg shadow-violet-400/50"></div>
        <div className="absolute bottom-56 left-44 w-2 h-2 bg-orange-400/70 rounded-full animate-float-fade-2 animate-delay-4 shadow-md shadow-orange-400/40"></div>
        <div className="absolute top-76 left-36 w-4 h-4 bg-purple-400/75 rounded-full animate-float-fade-3 animate-delay-1 shadow-lg shadow-purple-400/50"></div>
        <div className="absolute bottom-12 right-56 w-2 h-2 bg-violet-400/65 rounded-full animate-float-fade-4 animate-delay-5 shadow-md shadow-violet-400/30"></div>
        <div className="absolute top-64 right-20 w-3 h-3 bg-orange-400/60 rounded-full animate-float-fade-5 animate-delay-3 shadow-lg shadow-orange-400/40"></div>
        <div className="absolute bottom-60 left-64 w-2.5 h-2.5 bg-purple-400/70 rounded-full animate-float-fade-6 animate-delay-6 shadow-md shadow-purple-400/35"></div>
        <div className="absolute top-8 left-96 w-2 h-2 bg-violet-400/55 rounded-full animate-float-fade-1 animate-delay-4 shadow-md shadow-violet-400/25"></div>
        <div className="absolute bottom-28 right-72 w-3 h-3 bg-orange-400/75 rounded-full animate-float-fade-2 animate-delay-1 shadow-lg shadow-orange-400/45"></div>
      </div>

      <main className="flex flex-col items-center justify-center flex-grow px-4 sm:px-8 py-16 sm:py-24 text-center relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <a
              href="https://chromewebstore.google.com/detail/onedub/gnkcmnoobhckipojdkemkelghfjcpmdc"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-violet-600 via-purple-600 to-orange-600 hover:from-violet-500 hover:via-purple-500 hover:to-orange-500 rounded-full border border-violet-400/50 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 text-white font-semibold text-lg group"
            >
              <Tv2
                size={20}
                className="text-white group-hover:rotate-12 transition-transform duration-300"
              />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-100">
                Get Chrome Extension
              </span>
              <div className="flex items-center">
                <span className="text-xs bg-orange-500 text-white px-2 py-1 rounded-full font-bold animate-pulse">
                  FREE
                </span>
              </div>
            </a>
          </div>

          <h1 className="text-4xl leading-loose sm:text-5xl sm:leading-loose md:text-6xl md:leading-loose font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500">
            AI Dubbing for YouTube, Movies and TV Shows
          </h1>
          <p className="text-lg sm:text-xl text-neutral-300/80 max-w-2xl mx-auto mb-10">
            Experience YouTube videos in your preferred language and voice with
            our real-time AI-powered dubbing Chrome Extension.
          </p>

          {/* Enhanced Video Section */}
          <div className="my-12 px-4">
            <div className="relative aspect-video max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl border border-neutral-700/50 group">
              <iframe
                width="100%"
                height="100%"
                src="https://www.youtube.com/embed/f9Ti7OfXIjQ?autoplay=1&mute=1&loop=1&playlist=f9Ti7OfXIjQ&controls=0&showinfo=0&rel=0&iv_load_policy=3&modestbranding=1"
                title="YouTube video player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="rounded-xl"
              ></iframe>
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="absolute bottom-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-white text-sm">
                  <div className="flex items-center gap-2">
                    <Play size={14} className="text-violet-400" />
                    <span>Watch Demo in Action</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Features Section */}
          <div className="mb-16 px-4">
            <h2 className="text-3xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-purple-500">
              Why Choose OneDub?
            </h2>
            <p className="text-neutral-400 mb-10">
              Experience the future of multilingual entertainment
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
              <div className="bg-gradient-to-br from-neutral-800/50 to-neutral-900/50 p-6 rounded-xl border border-neutral-700/50 hover:border-violet-500/50 transition-all duration-300 group hover:scale-105">
                <div className="mb-4 p-3 bg-violet-500/20 rounded-lg w-fit">
                  <Zap
                    size={24}
                    className="text-violet-400 group-hover:scale-110 transition-transform duration-300"
                  />
                </div>
                <h3 className="font-semibold text-xl mb-3 text-violet-400">
                  Real-time Dubbing
                </h3>
                <p className="text-neutral-400 leading-relaxed">
                  Instantly translate and dub videos as you watch. No waiting,
                  no delays - just seamless multilingual entertainment.
                </p>
              </div>

              <div className="bg-gradient-to-br from-neutral-800/50 to-neutral-900/50 p-6 rounded-xl border border-neutral-700/50 hover:border-purple-500/50 transition-all duration-300 group hover:scale-105">
                <div className="mb-4 p-3 bg-purple-500/20 rounded-lg w-fit">
                  <Globe
                    size={24}
                    className="text-purple-400 group-hover:scale-110 transition-transform duration-300"
                  />
                </div>
                <h3 className="font-semibold text-xl mb-3 text-purple-400">
                  Multiple Languages & Premium Voices
                </h3>
                <p className="text-neutral-400 leading-relaxed">
                  Choose from a wide range of languages with AI voices so
                  natural, you'll forget they're not human.
                </p>
              </div>

              <div className="bg-gradient-to-br from-neutral-800/50 to-neutral-900/50 p-6 rounded-xl border border-neutral-700/50 hover:border-orange-500/50 transition-all duration-300 group hover:scale-105">
                <div className="mb-4 p-3 bg-orange-500/20 rounded-lg w-fit">
                  <Tv2
                    size={24}
                    className="text-orange-400 group-hover:scale-110 transition-transform duration-300"
                  />
                </div>
                <h3 className="font-semibold text-xl mb-3 text-orange-400">
                  Universal Compatibility
                </h3>
                <p className="text-neutral-400 leading-relaxed">
                  Works seamlessly with YouTube, Netflix, Prime Video, and more.
                  Your entertainment, your language.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center p-6 text-sm text-neutral-500 space-x-4 relative z-10">
        <span>
          &copy; {new Date().getFullYear()} Dubabase. Movie and YouTube Dubbing.
          All rights reserved.
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
