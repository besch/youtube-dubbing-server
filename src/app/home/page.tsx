import Image from "next/image";

export default function HomePage() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="flex justify-center w-full">
        <div className="rounded bg-neutral-50/10 px-3 py-1 text-sm leading-6 text-white ring-1 ring-neutral-50/10 hover:ring-neutral-50/20">
          <a
            href="https://github.com/yourusername/youtube-dubbing"
            target="_blank"
          >
            <span className="font-semibold">GitHub</span>
            <span className="hidden sm:inline">
              {" "}
              &bull; View the source code and contribute
            </span>
            <span aria-hidden="true"> &rarr;</span>
          </a>
        </div>
      </header>

      <main className="grid grid-rows-[auto_auto_1fr] gap-10 sm:w-[80vw] w-full max-w-5xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-4xl sm:text-6xl tracking-tight font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-500 to-orange-500">
            YouTube Dubbing
          </h1>
          <p className="text-base sm:text-lg text-white/70 max-w-prose">
            Watch YouTube videos with real-time AI-generated dubbing in multiple
            languages and voices
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <a
            href="/auth/signin"
            className="transform rounded-xl bg-neutral-50/10 p-6 text-white hover:bg-neutral-50/15 hover:shadow-lg transition-all"
          >
            <div className="font-semibold text-lg mb-1">
              Sign In / Create Account
            </div>
            <div className="text-sm text-white/70">
              Sign in to access all features including history and favorites
            </div>
          </a>
          <a
            href="/app"
            className="transform rounded-xl bg-gradient-to-br from-violet-500 to-orange-500 p-6 text-white hover:shadow-lg transition-all"
          >
            <div className="font-semibold text-lg mb-1">Launch Web App</div>
            <div className="text-sm text-white/90">
              Open the web application to start dubbing YouTube videos
            </div>
          </a>
        </div>

        <div className="relative w-full h-60 sm:h-96 mt-6 rounded-xl overflow-hidden">
          <Image
            src="/images/demo-screenshot.png"
            alt="YouTube Dubbing App Screenshot"
            fill
            priority
            className="object-cover object-center"
          />
        </div>
      </main>

      <footer className="text-sm text-white/50">
        &copy; {new Date().getFullYear()} YouTube Dubbing
      </footer>
    </div>
  );
}
