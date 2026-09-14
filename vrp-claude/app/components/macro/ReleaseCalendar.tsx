'use client';
import { useMemo, useState } from 'react';
import { MacroEvent, csv, day, timeLabel, useMacro } from './macroData';
import s from './MacroDashboard.module.css';

export function ReleaseDetail({ event, close, timezone }: { event: MacroEvent; close: () => void; timezone: string }) {
  const revision = useMacro<{ observed_at: string; event: MacroEvent }[]>(`revisions/${event.id}`);
  return <aside className={s.detail} aria-label="Release details">
    <div className={s.sectionHead}><div><span className={s.eyebrow}>{event.source} / {event.category}</span><h3>{event.title}</h3></div><button onClick={close}>Close details</button></div>
    <p>{day(event.date, timezone)} · {timeLabel(event, timezone)} · {timezone}</p>
    <div className={s.stats}><div><span>Actual</span><strong>{event.actual || '—'}</strong><small>{event.unit || 'Provider display units'}</small></div><div><span>Market consensus</span><strong>{event.forecast || '—'}</strong><small>Provider value, if supplied</small></div><div><span>Previous</span><strong>{event.previous || '—'}</strong><small>May include revisions</small></div></div>
    <p className={s.notice}>High-impact classification: {event.impact_basis}. An empty actual means unavailable, even after the scheduled time. First local capture: {new Date(event.first_seen).toLocaleString()}. A local capture timestamp is not proof that a forecast was known before release.</p>
    {event.url && <a href={event.url} target="_blank" rel="noreferrer">Open original source ↗</a>}
    <h4>Observed changes</h4>
    {revision.loading && <p role="status">Loading captured revisions…</p>}
    {revision.error && <p role="alert">{revision.error}<button onClick={revision.refresh}>Retry</button></p>}
    {revision.data && <ul className={s.revisions}>{revision.data.map((r, i) => <li key={`${r.observed_at}-${i}`}><span>{new Date(r.observed_at).toLocaleString()}</span><span>Actual {r.event.actual || '—'} · Consensus {r.event.forecast || '—'} · Previous {r.event.previous || '—'}</span></li>)}</ul>}
  </aside>;
}

export default function ReleaseCalendar({ events, history, timezone }: { events: MacroEvent[]; history: boolean; timezone: string }) {
  const today = day(new Date().toISOString(), timezone);
  const [from, setFrom] = useState(history ? `${new Date().getFullYear() - 1}-01-01` : today);
  const [to, setTo] = useState(history ? today : day(new Date(Date.now() + 90 * 864e5).toISOString(), timezone));
  const [category, setCategory] = useState('All'), [source, setSource] = useState('All'), [query, setQuery] = useState(''), [selected, setSelected] = useState<MacroEvent | null>(null), [limit, setLimit] = useState(80);
  const rows = useMemo(() => events.filter(e => {
    const d = day(e.date, timezone);
    const past = e.precision === 'date' ? d < today : Date.parse(e.date) < Date.now();
    return (history ? past : !past) && (!from || d >= from) && (!to || d <= to) && (category === 'All' || e.category === category) && (source === 'All' || e.source === source) && e.title.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => history ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)), [events, history, timezone, today, from, to, category, source, query]);
  return <section>
    <div className={s.sectionHead}><div><span className={s.eyebrow}>USD / HIGH IMPACT</span><h2>{history ? 'Release archive' : 'Upcoming catalysts'}</h2><p>{history ? 'Publication dates and archived reports. Latest-vintage economic values live in Forecast Lab.' : 'Plan around scheduled releases. Each source remains identifiable.'}</p></div><button onClick={() => csv(history ? 'usd-release-history.csv' : 'usd-calendar.csv', rows.map(e => ({ ...e })))} disabled={!rows.length}>Export CSV</button></div>
    <div className={s.controls}>
      <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Through<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <label>Theme<select value={category} onChange={e => setCategory(e.target.value)}>{['All','Inflation','Labor','Growth','Policy'].map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Source<select value={source} onChange={e => setSource(e.target.value)}>{['All',...Array.from(new Set(events.map(e => e.source)))].map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={s.search}>Search releases<input type="search" placeholder="CPI, payrolls, FOMC…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    </div>
    {from && to && from > to && <p role="alert" className={s.error}>From must be on or before Through.</p>}
    <div className={s.tableMeta}><span>{rows.length} source records · {timezone}</span><span>— = not supplied · Reports may appear from more than one source</span></div>
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Date / time</th><th>Release</th><th>Actual</th><th>Consensus</th><th>Previous</th><th>Source</th></tr></thead><tbody>{rows.slice(0, limit).map(e => <tr key={e.id} data-selected={selected?.id === e.id}><td><strong>{day(e.date, timezone)}</strong><small>{timeLabel(e, timezone)}</small></td><td><button className={s.eventButton} onClick={() => setSelected(e)}>{e.title}</button><small><span className={s.impact}>HIGH</span> {e.category}{e.unit ? ` · ${e.unit}` : ''}</small></td><td className={s.number}>{e.actual || '—'}</td><td className={s.number}>{e.forecast || '—'}</td><td className={s.number}>{e.previous || '—'}</td><td><span>{e.source}</span><small>{e.impact_basis === 'provider' ? 'Provider impact' : 'Curated impact'}</small></td></tr>)}</tbody></table></div>
    {!rows.length && <div className={s.empty}>No releases match this range. Try a wider date range or another source. Coverage is limited to successfully collected source records.</div>}
    {rows.length > limit && <button className={s.loadMore} onClick={() => setLimit(n => n + 80)}>Show 80 more</button>}
    {selected && <ReleaseDetail key={selected.id} event={selected} timezone={timezone} close={() => setSelected(null)} />}
    <p className={s.footnote}>Forex Factory provides a rolling weekly export; it is not a full historical consensus database. Official archives do not supply market consensus. BLS/Fed archive links may provide only a publication date, so release time remains unspecified.</p>
  </section>;
}
