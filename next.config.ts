import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // No image optimisation is used; avoids extra Vercel image-transformation usage.
  images: { unoptimized: true },
}

export default nextConfig
