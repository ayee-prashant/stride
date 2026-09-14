import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride — My Work",
  description: "A focused workspace for creating, organizing, and completing your team's tasks.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><a href="#main-content" className="skip-link">Skip to tasks</a>{children}</body>
    </html>
  );
}
