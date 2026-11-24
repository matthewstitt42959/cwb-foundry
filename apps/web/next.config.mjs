/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine ships as TypeScript source inside the workspace.
  transpilePackages: ["@cwb/engine"],
};

export default nextConfig;
