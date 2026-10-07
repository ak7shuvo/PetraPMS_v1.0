import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "PetraPMS",
  description: "Hotel property management system",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  applicationName: "PetraPMS",
};

export const viewport: Viewport = { themeColor: "#111111", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
