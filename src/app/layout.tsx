import "@/styles/globals.css";

import { type Metadata } from "next";
import { JetBrains_Mono, Urbanist } from "next/font/google";

import { TRPCReactProvider } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/app/_components/cart-context";

export const metadata: Metadata = {
  title: "Flash Sale Grosir",
  description: "Belanja flash sale grosir dengan harga spesial selagi stok dan kuota masih ada.",
  // `favicon.ico` stays first for legacy tabs; the supplied square mark
  // (1280x1280, downscaled by the browser — spec Ruling 5) is the modern icon.
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "icon", type: "image/png", url: "/brand/logo-square.png" },
  ],
};

const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-urbanist",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  // 600 is a real weight now — cart-drawer/mono plates use `font-semibold`
  // (final review R4; before this the semibold was synthesized).
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={cn(urbanist.variable, jetbrains.variable, "font-sans")}>
      <body>
        <CartProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </CartProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
