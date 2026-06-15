/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "@mastra/core", "pg"],
  },
};

export default nextConfig;
