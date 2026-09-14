import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "Chart Studio — Python Research Terminal",
  description: "Custom Python indicators, market data and interactive chart analysis",
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        width: '100%',
        minHeight: '100dvh',
        overflow: 'auto',
        background: '#0d0d0d',
      }}
    >
      {children}
    </div>
  );
}
