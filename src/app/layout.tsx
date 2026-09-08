import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "./SiteNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * This said "Create Next App" until the delivery audit found it, and had survived every milestone
 * because nothing renders page metadata where a developer looks. A browser tab and a bookmark are
 * the first thing a user ever sees of a product.
 */
export const metadata: Metadata = {
  title: "Market OS",
  description:
    "Economic and market intelligence from stored, sourced filings and indicators. Not investment advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
