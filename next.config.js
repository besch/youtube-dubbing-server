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
};

module.exports = nextConfig;
