/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship as TypeScript source.
  transpilePackages: ["@cwb/engine", "@cwb/cards", "@cwb/ai"],
};

export default nextConfig;
