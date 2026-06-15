/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "@mastra/core", "pg"],
    // Tree-shake the large CopilotKit barrel exports so dev/build compiles only
    // the modules actually used instead of the whole package graph.
    optimizePackageImports: ["@copilotkit/react-core", "@copilotkit/runtime"],
  },
};

export default nextConfig;
