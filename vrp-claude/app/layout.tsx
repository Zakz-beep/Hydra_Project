import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VRP Signal Engine",
  description: "Volatility Risk Premium Dashboard — IV vs RV, HAR-RV, BSM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 antialiased">{children}</body>
    </html>
  );
}
