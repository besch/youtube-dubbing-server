import { Tv2, Play, Globe, Zap } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0a] text-white relative overflow-hidden">
      {/* Advanced animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Cinematic gradient layers */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-transparent to-transparent"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent"></div>

        {/* Animated nebula effect */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-orange-500/8 rounded-full blur-3xl animate-pulse delay-2000"></div>

        {/* Film grain overlay */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml,%3Csvg%20viewBox=%220%200%20400%20400%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter%20id=%22noiseFilter%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%220.9%22%20numOctaves=%224%22%20stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')]"></div>

        {/* Floating cinematic particles */}
        <div className="absolute inset-0">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-violet-400/40 rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `float ${15 + Math.random() * 10}s linear infinite`,
                animationDelay: `${Math.random() * 10}s`,
              }}
            />
          ))}
        </div>

        {/* Light rays effect */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/2 w-1 h-full bg-gradient-to-b from-violet-500/20 via-transparent to-transparent animate-pulse"></div>
          <div className="absolute top-0 right-1/3 w-1 h-full bg-gradient-to-b from-purple-500/20 via-transparent to-transparent animate-pulse delay-1000"></div>
          <div className="absolute top-0 left-1/3 w-1 h-full bg-gradient-to-b from-orange-500/15 via-transparent to-transparent animate-pulse delay-2000"></div>
        </div>

        {/* Floating film strips with enhanced animation */}
        <div className="absolute inset-0">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `float-film ${
                  20 + Math.random() * 10
                }s linear infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            >
              <div className="relative">
                <div className="w-32 h-8 bg-gradient-to-r from-violet-500/20 via-purple-500/15 to-transparent rounded-sm backdrop-blur-sm border border-violet-500/20">
                  <div className="flex h-full">
                    {[...Array(16)].map((_, j) => (
                      <div
                        key={j}
                        className="flex-1 border-r border-violet-400/30 bg-gradient-to-b from-violet-500/10 to-transparent"
                      />
                    ))}
                  </div>
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-violet-500/10 to-transparent rounded-sm blur-sm"></div>
              </div>
            </div>
          ))}
        </div>

        {/* Enhanced video thumbnails */}
        <div className="absolute inset-0">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${10 + Math.random() * 80}%`,
                top: `${10 + Math.random() * 80}%`,
                animation: `float-video ${
                  25 + Math.random() * 15
                }s linear infinite`,
                animationDelay: `${i * 1.5}s`,
              }}
            >
              <div className="relative group">
                <div className="w-20 h-12 bg-gradient-to-br from-violet-500/25 via-purple-500/20 to-orange-500/15 rounded-lg border border-violet-500/30 backdrop-blur-sm">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-lg"></div>
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-0 h-0 border-l-[8px] border-l-white/80 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent"></div>
                  </div>
                </div>
                <div className="absolute -inset-2 bg-gradient-to-br from-violet-500/20 to-purple-500/20 rounded-lg blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              </div>
            </div>
          ))}
        </div>

        {/* Audio waveform visualization */}
        <div className="absolute bottom-0 left-0 right-0 h-32">
          {[...Array(100)].map((_, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-1 bg-gradient-to-t from-violet-500/40 via-purple-500/30 to-transparent"
              style={{
                left: `${i * 1}%`,
                height: `${20 + Math.sin(i * 0.1) * 15 + Math.random() * 20}px`,
                animation: `wave ${2 + Math.random()}s ease-in-out infinite`,
                animationDelay: `${i * 0.05}s`,
              }}
            />
          ))}
        </div>

        {/* Scanning lines effect */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-500/5 to-transparent h-px animate-scan-line"></div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-500/5 to-transparent h-px animate-scan-line-2"></div>
        </div>

        {/* Glowing orbs with trails */}
        <div className="absolute inset-0">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `orb-float ${
                  30 + Math.random() * 20
                }s linear infinite`,
                animationDelay: `${i * 2}s`,
              }}
            >
              <div className="relative">
                <div
                  className={`w-4 h-4 rounded-full blur-sm ${
                    i % 3 === 0
                      ? "bg-violet-500/60"
                      : i % 3 === 1
                      ? "bg-purple-500/60"
                      : "bg-orange-500/60"
                  }`}
                ></div>
                <div
                  className={`absolute inset-0 w-4 h-4 rounded-full blur-md animate-pulse ${
                    i % 3 === 0
                      ? "bg-violet-500/30"
                      : i % 3 === 1
                      ? "bg-purple-500/30"
                      : "bg-orange-500/30"
                  }`}
                ></div>
              </div>
            </div>
          ))}
        </div>

        {/* Lens flare effect */}
        <div className="absolute top-1/4 right-1/4 w-64 h-64">
          <div className="absolute inset-0 bg-gradient-radial from-violet-500/20 via-transparent to-transparent rounded-full blur-2xl animate-pulse"></div>
          <div className="absolute inset-0 bg-gradient-radial from-purple-500/15 via-transparent to-transparent rounded-full blur-2xl animate-pulse delay-1000"></div>
        </div>
      </div>

      <main className="flex flex-col items-center justify-center flex-grow px-4 sm:px-8 py-16 sm:py-24 text-center relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <a
              href="https://chromewebstore.google.com/detail/onedub/gnkcmnoobhckipojdkemkelghfjcpmdc"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-violet-600 via-purple-600 to-orange-600 hover:from-violet-700 hover:via-purple-700 hover:to-orange-700 text-white font-semibold rounded-full shadow-2xl shadow-violet-500/25 hover:shadow-violet-500/40 transition-all duration-300 transform hover:scale-105"
            >
              <Zap className="w-5 h-5" />
              Install Chrome Extension
            </a>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-purple-500 to-orange-500">
            AI Dubbing for YouTube, Movies and TV Shows
          </h1>

          <p className="text-lg sm:text-xl text-neutral-300 max-w-2xl mx-auto mb-10">
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
