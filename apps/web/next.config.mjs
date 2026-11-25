/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship as TypeScript source.
  transpilePackages: ["@cwb/engine", "@cwb/cards", "@cwb/ai"],
  // Lets the dev server be reached from another device on the LAN (e.g. a phone).
  // Update this if the machine's LAN IP changes.
  allowedDevOrigins: ["192.168.86.24"],
};

export default nextConfig;
