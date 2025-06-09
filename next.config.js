/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: false, // We want TypeScript errors to fail the build
    tsconfigPath: "./tsconfig.json", // Use our tsconfig.json that excludes supabase
  },
  eslint: {
    dirs: ["src"], // Only run ESLint on the src directory
  },
  experimental: {
    serverComponentsExternalPackages: [
      "@google-cloud/text-to-speech",
      "googleapis",
      "google-gax",
      "google-auth-library",
      "gcp-metadata",
      "google-p12-pem",
      "jws",
      "fast-fuzzy",
      "node-html-parser",
      "jszip",
      "unzipper",
      "detect-file-encoding-and-language",
      "iconv-lite",
      "microsoft-cognitiveservices-speech-sdk",
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle server-side packages in client bundles
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        dns: false,
        child_process: false,
        tls: false,
      };
    }

    // Handle node modules that shouldn't be bundled
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push(
        "@google-cloud/text-to-speech",
        "googleapis",
        "google-gax",
        "google-auth-library",
        "microsoft-cognitiveservices-speech-sdk"
      );
    }

    return config;
  },
};

module.exports = nextConfig;
