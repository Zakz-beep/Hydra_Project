'use client';
import { useState } from 'react';
import { Activity, ArrowUpRight, CalendarDays, Database, FlaskConical, Newspaper, RefreshCw } from 'lucide-react';
import ForecastLab from './ForecastLab';
import SurprisePanel from './SurprisePanel';
import EventReaction from './EventReaction';
import ReleaseCalendar from './ReleaseCalendar';
import { DashboardData, day, useMacro } from './macroData';
import s from './MacroDashboard.module.css';

const tabs = [{ key: 'calendar', label: 'Calendar', icon: CalendarDays }, { key: 'history', label: 'Release history', icon: Database }, { key: 'surprise', label: 'Surprise Monitor', icon: Activity }, { key: 'reaction', label: 'Event Reaction', icon: Activity }, { key: 'forecast', label: 'Forecast Lab', icon: FlaskConical }, { key: 'news', label: 'News & context', icon: Newspaper }, { key: 'sources', label: 'Data coverage', icon: Activity }];
export default function MacroDashboard() {
  const [tab, setTab] = useState('calendar'), [timezone, setTimezone] = useState('America/New_York'), [newsTheme, setNewsTheme] = useState('All');
  const { data, error, loading, refresh } = useMacro<DashboardData>('dashboard');
  const next = data?.events.filter(e => e.precision === 'time' && Date.parse(e.date) > Date.now()).sort((a,b) => a.date.localeCompare(b.date))[0];
  const upcoming = data?.events.filter(e => e.precision === 'time' && Date.parse(e.date) > Date.now() && Date.parse(e.date) < Date.now() + 7 * 864e5).length || 0;
  const failed = data?.sources.filter(s => s.error).length || 0;
  return <div className={s.root}>
    <header className={s.hero}>
      <div><span className={s.eyebrow}><span className={s.code}>ECO</span> UNITED STATES / MACRO RESEARCH</span><h1>The economic calendar,<br /><em>with a quantitative lens.</em></h1><p>Track the release. Read the evidence. Test your expectation.</p></div>
      <div className={s.heroAside}><span className={s.eyebrow}>NEXT TIMED RELEASE</span><strong>{next?.title || (loading ? 'Checking the calendar…' : 'No upcoming timed release in coverage')}</strong>{next && <span>{new Date(next.date).toLocaleString('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })} · {timezone}</span>}<small>USD high impact · official releases + public calendar</small></div>
    </header>
    <div className={s.topbar}><nav aria-label="Macro research sections">{tabs.map(t => <button key={t.key} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}><t.icon size={15} />{t.label}</button>)}</nav><div className={s.utilities}><label className={s.srOnly} htmlFor="macro-timezone">Calendar timezone</label><select id="macro-timezone" value={timezone} onChange={e => setTimezone(e.target.value)}><option value="America/New_York">New York</option><option value="Asia/Jakarta">Jakarta · WIB</option><option value="UTC">UTC</option></select><button onClick={refresh} disabled={loading} aria-label="Refresh macro data"><RefreshCw size={15} /></button></div></div>
    <main className={s.body}>
      {tab !== 'forecast' && tab !== 'surprise' && tab !== 'reaction' && <>
        {loading && <div role="status" className={s.skeleton}>Collecting public calendars, release archives and official headlines…</div>}
        {error && <div className={s.error} role="alert">{error}<button onClick={refresh}>Retry data</button></div>}
        {data && <>
          <div className={s.statusStrip}><span>{upcoming} records in the next 7 days</span><span>{data.events.length} archived / scheduled source records</span><button onClick={() => setTab('sources')}>{failed ? `${failed} source issues · view coverage` : 'Sources responding · view coverage'}</button><small>Checked {new Date(data.generated_at).toLocaleTimeString()} · cached feeds</small></div>
          {(tab === 'calendar' || tab === 'history') && <ReleaseCalendar key={`${tab}-${timezone}`} events={data.events} history={tab === 'history'} timezone={timezone} />}
          {tab === 'news' && <section><div className={s.sectionHead}><div><span className={s.eyebrow}>PRIMARY SOURCES / ECONOMIC RELEASES</span><h2>News & macro context</h2><p>Official headlines from BEA and the Federal Reserve. Open the source for the complete release.</p></div><label>Theme<select value={newsTheme} onChange={e => setNewsTheme(e.target.value)}>{['All','Inflation','Labor','Policy','Growth'].map(v => <option key={v}>{v}</option>)}</select></label></div>
            <div className={s.newsLayout}><div className={s.newsList}>{data.news.filter(n => newsTheme === 'All' || n.category === newsTheme).map(n => <article key={n.id}><span className={s.eyebrow}>{n.source} · {day(n.date, timezone)} · {n.category}</span><a href={n.url} target="_blank" rel="noreferrer">{n.title}<ArrowUpRight size={16} /></a></article>)}{!data.news.filter(n => newsTheme === 'All' || n.category === newsTheme).length && <p className={s.empty}>No collected headlines for this theme.</p>}</div><aside className={s.context}><span className={s.eyebrow}>ANALYSIS FRAMEWORK</span><h3>Separate the evidence</h3><ol><li><strong>Prior expectation</strong><p>Use the internal model distribution and available market consensus. They answer different questions.</p></li><li><strong>Release evidence</strong><p>Check the actual, units, reference period and revisions. Missing consensus means surprise cannot be measured.</p></li><li><strong>Posterior assessment</strong><p>Update the economic view, then check rates and market reaction. A hotter print does not mechanically determine USD or equity direction.</p></li></ol><button onClick={() => setTab('forecast')}>Open Forecast Lab →</button></aside></div>
          </section>}
          {tab === 'sources' && <section><div className={s.sectionHead}><div><span className={s.eyebrow}>PROVENANCE / HONEST COVERAGE</span><h2>Data coverage</h2><p>HTTPX retrieves public documents; Beautiful Soup parses HTML; the XML parser reads official RSS. Source failures remain visible.</p></div></div><div className={s.sourceList}>{data.sources.map(source => <article key={source.url}><div><h3>{source.name}</h3><a href={source.url} target="_blank" rel="noreferrer">Original feed / archive ↗</a><p>{source.fetched_at ? `Last successful retrieval: ${new Date(source.fetched_at).toLocaleString()}` : 'No successful retrieval yet'}</p></div><div><span className={source.error ? s.warn : s.good}>{source.error ? (source.fetched_at ? 'CACHED / REFRESH FAILED' : 'UNAVAILABLE') : 'FETCHED'}</span><p>{source.count || 0} release records parsed</p>{source.error && <p className={s.sourceError}>{source.error}</p>}</div></article>)}</div><details className={s.method} open><summary>What this dataset does and does not contain</summary><p>High impact is supplied by Forex Factory, or curated for major official releases. Duplicate reports across providers remain separate for provenance. Local SQLite storage preserves collected releases and observed changes; it does not reconstruct missing historical consensus or first-release values.</p><p>The BLS archive may reject automated access. No challenge bypass or invented fallback is used. News coverage is official economic releases, not a comprehensive breaking-news wire. The scheduled time passing does not prove the actual is available.</p><p>Calendar refresh: one hour; official HTML archives: one day; FRED: six hours. A failed fetch retries after five minutes and may serve clearly flagged cached data. Reloading the UI respects these limits. Forecasts are next-reference-period estimates using latest-revised data, not vintage-correct event forecasts.</p></details></section>}
        </>}
      </>}
      {tab === 'forecast' && <ForecastLab />}
      {tab === 'surprise' && <SurprisePanel timezone={timezone} />}
      {tab === 'reaction' && <EventReaction timezone={timezone} />}
    </main>
    <footer className={s.footer}><span>ECONOMIC RESEARCH / USD</span><span>Source timestamps · captured revisions · reproducible forecasts</span></footer>
  </div>;
}
