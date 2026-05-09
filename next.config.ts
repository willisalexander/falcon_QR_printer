import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // allowedDevOrigins solo en desarrollo
  ...(process.env.NODE_ENV === "development" && {
    allowedDevOrigins: ["192.168.3.59"],
  }),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
