export async function hyperInfo(body: object, signal?: AbortSignal) {
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal || AbortSignal.timeout(15000), cache: 'no-store' });
  if (!r.ok) throw new Error(`Hyperliquid returned ${r.status}. Please retry shortly.`);
  return r.json();
}
