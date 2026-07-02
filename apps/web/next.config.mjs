/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@oal/config', '@oal/sdk', '@oal/ui'],
  reactStrictMode: true,
};

export default nextConfig;
