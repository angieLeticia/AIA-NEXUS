/** @type {import('next').NextConfig} */
const nextConfig = {
  // Observability dashboard only — never needs to bundle or touch the core
  // pipeline packages (agent/, scripts/pipeline/, lib/social/, remotion/).
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
