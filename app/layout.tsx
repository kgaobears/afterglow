import type { Metadata } from "next";
import "./globals.css";
import { LocalProcessingProvider } from "./local-processing-provider";
import RemoteRegressionWorker from "./remote-regression-worker";

export const metadata: Metadata = {
  title: "Afterglow — People & Conversations",
  description: "A quieter way to remember the people in your life.",
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
      <body className="antialiased"><LocalProcessingProvider><RemoteRegressionWorker/>{children}</LocalProcessingProvider></body>
    </html>
  );
}
