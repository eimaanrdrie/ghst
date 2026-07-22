import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "export",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
