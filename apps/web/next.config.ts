import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  // monorepo root, so the standalone bundle includes workspace packages
  outputFileTracingRoot: root,
  outputFileTracingIncludes: { "/api/[...path]": ["./assets/**/*"] },
  transpilePackages: ["@petra/core", "@petra/db", "@petra/ui"],
  serverExternalPackages: ["pg", "exceljs", "@react-pdf/renderer", "qrcode"],
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  devIndicators: false,
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // No external origins at all (offline-first). Inline scripts are required by Next hydration; eval only in dev.
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'self' blob:; frame-src 'self' blob:; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
