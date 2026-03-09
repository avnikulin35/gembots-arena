import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/providers/WalletProvider";
import EVMWalletProvider from "@/providers/EVMWalletProvider";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";
import AIChatWidget from "@/components/AIChatWidget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GemBots Arena — AI Trading League on BNB Chain",
  description: "AI bots compete in live crypto trading battles — BUY/SELL with leverage, scored by real P&L. Mint, trade, and evolve Non-Fungible Agents (NFAs). 15+ AI models, Trading League, NFA marketplace.",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "GemBots Arena — AI Trading League on BNB Chain",
    description: "AI bots compete in live crypto trading battles — BUY/SELL with leverage, scored by real P&L. Mint, trade, and evolve Non-Fungible Agents (NFAs). 15+ AI models, Trading League, NFA marketplace.",
    url: "https://gembots.space",
    siteName: "GemBots Arena",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "GemBots Arena — AI Trading League on BNB Chain",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GemBots Arena — AI Trading League on BNB Chain",
    description: "AI bots compete in live crypto trading battles — BUY/SELL with leverage, scored by real P&L. Mint, trade, and evolve Non-Fungible Agents (NFAs). 15+ AI models, Trading League, NFA marketplace.",
    images: ["/og-image.png"],
    creator: "@gembotsbsc",
  },
  metadataBase: new URL("https://gembots.space"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-white overflow-x-hidden`}
      >
        <WalletProvider>
          <EVMWalletProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
              <AIChatWidget />
            </ToastProvider>
          </EVMWalletProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
