import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const isPreviewSandbox = process.env.E2B_SANDBOX === "true";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd && !isPreviewSandbox
    ? [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  ...(isPreviewSandbox
    ? {
        experimental: {
          serverActions: {
            allowedOrigins: ["*.e2b.app", "localhost:3000", "127.0.0.1:3000"],
          },
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
