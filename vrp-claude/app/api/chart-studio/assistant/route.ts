import { NextRequest, NextResponse } from 'next/server';
import { SDK_HELP } from '../../../lib/chart-studio/templates';
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'Set OPENROUTER_API_KEY in .env.local to enable AI drafts. Templates and Python Run work without it.' }, { status: 503 });
  try {
    const text = await req.text(); if (text.length > 110000) throw new Error('Request too large');
    const { prompt, code, error } = JSON.parse(text); if (typeof prompt !== 'string' || prompt.length > 4000) throw new Error('Describe your indicator in up to 4,000 characters');
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model: process.env.CHART_STUDIO_AI_MODEL || 'openai/gpt-4.1-mini', max_tokens: 4000, messages: [{ role: 'system', content: `Write a Python indicator for Chart Studio. Return only Python source, no markdown. This is a draft for user review, never execute it. Use calculate(ctx), numpy/pandas and the SDK below. No network calls, file access, package installation or orders. Available default input is OHLCV only; compare requires a user-added dataset. Do not pretend OHLCV is real trade delta or fabricate OI. Prefer closed-bar calculations without lookahead. SDK:\n${SDK_HELP}` }, { role: 'user', content: `${prompt}\n\nCurrent script:\n${typeof code === 'string' ? code.slice(0, 40000) : ''}\nLast error:\n${typeof error === 'string' ? error.slice(0, 4000) : ''}` }] }) });
    const result = await r.json(); if (!r.ok) throw new Error(result.error?.message || `Model returned ${r.status}`);
    const output = result.choices?.[0]?.message?.content;
    if (typeof output !== 'string' || !output.includes('def calculate')) throw new Error('Model did not return a calculate(ctx) script. Try a more specific request.');
    return NextResponse.json({ code: output.replace(/^```(?:python)?\s*/i, '').replace(/\s*```$/, '') });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'AI draft unavailable' }, { status: 400 }); }
}
