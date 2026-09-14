'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
const Studio = dynamic(() => import('../components/lwc/studio/ChartWorkspace'), { ssr: false });
const Legacy = dynamic(() => import('./LegacyTerminal'), { ssr: false });
export default function TerminalPage() {
  const [legacy, setLegacy] = useState(false);
  return legacy ? <><button className="fixed right-4 top-2 z-50 rounded bg-teal-900 px-3 py-2 text-xs text-white" onClick={() => setLegacy(false)}>Back to Chart Studio</button><Legacy /></> : <div className="cs-terminal-shell"><Studio onLegacy={() => setLegacy(true)} /></div>;
}
