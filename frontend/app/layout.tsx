import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { AUTH_COOKIE, GUEST_SESSION } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Friday: Chief of Staff",
  description: "AI Chief of Staff for founder-led SMBs",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read on the server so locked tabs render correctly on first paint. Access itself
  // is enforced in middleware.ts; this only decides what the shell shows.
  const isGuest = (await cookies()).get(AUTH_COOKIE)?.value === GUEST_SESSION;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full bg-[#F5F6F8] text-slate-900" suppressHydrationWarning>
        <AppShell isGuest={isGuest}>{children}</AppShell>
      </body>
    </html>
  );
}
