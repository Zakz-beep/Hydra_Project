import React, { useState, useEffect } from 'react';

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
}

interface NewsDashboardProps {
  ticker: string;
}

export default function NewsDashboard({ ticker }: NewsDashboardProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | '3d' | '7d'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Yahoo Finance' | 'Google News'>('all');
  const [newsMode, setNewsMode] = useState<'ticker' | 'general'>('ticker');

  useEffect(() => {
    let active = true;
    
    const fetchNews = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}&type=${newsMode}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch news (Status: ${res.status})`);
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (active) {
          setNews(data.news || []);
        }
      } catch (err: any) {
        if (active) setError(err.message || "Failed to fetch news");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchNews();

    return () => { active = false; };
  }, [ticker, newsMode]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return `Yesterday`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateString;
    }
  };

  const filteredNews = news.filter(item => {
    // Source filter
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
    
    // Time filter
    if (timeFilter !== 'all') {
      try {
        const itemDate = new Date(item.pubDate);
        const now = new Date();
        const diffMs = now.getTime() - itemDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        
        if (timeFilter === '24h' && diffHours > 24) return false;
        if (timeFilter === '3d' && diffHours > 24 * 3) return false;
        if (timeFilter === '7d' && diffHours > 24 * 7) return false;
      } catch {
        // If date parsing fails, just include it
      }
    }
    
    return true;
  });

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl min-h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-6 border-b border-zinc-800/80 pb-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2 font-mono">
            <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-lg">
              📰
            </span>
            News & Intelligence
          </h2>
          <p className="text-xs text-zinc-500 font-mono mt-1 uppercase tracking-wider">
            {newsMode === 'ticker' ? `Aggregated feed for ${ticker}` : 'General Market & Economy'}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
           <div className="flex bg-zinc-900 border border-zinc-700 rounded-md overflow-hidden">
             <button
                onClick={() => setNewsMode('ticker')}
                className={`px-3 py-1 text-[10px] font-mono font-bold transition-colors ${
                  newsMode === 'ticker' 
                    ? 'bg-indigo-600 text-white' 
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
             >
                {ticker}
             </button>
             <button
                onClick={() => setNewsMode('general')}
                className={`px-3 py-1 text-[10px] font-mono font-bold transition-colors ${
                  newsMode === 'general' 
                    ? 'bg-indigo-600 text-white' 
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
             >
                MARKET
             </button>
           </div>

           <div className="flex gap-2">
               <select 
                  value={sourceFilter} 
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono py-1 px-2 rounded focus:outline-none focus:border-emerald-500 cursor-pointer"
           >
              <option value="all">All Sources</option>
              <option value="Yahoo Finance">Yahoo Finance</option>
              <option value="Google News">Google News</option>
           </select>
           
           <select 
              value={timeFilter} 
              onChange={(e) => setTimeFilter(e.target.value as any)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono py-1 px-2 rounded focus:outline-none focus:border-emerald-500 cursor-pointer"
           >
              <option value="all">All Time</option>
              <option value="24h">Past 24 Hours</option>
              <option value="3d">Past 3 Days</option>
              <option value="7d">Past 7 Days</option>
           </select>
        </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
             <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
             <span className="text-xs font-mono uppercase tracking-wider">Scraping global feeds...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-xs font-mono bg-red-500/5 rounded-xl border border-red-500/10 p-4">
            ⚠ {error}
          </div>
        ) : filteredNews.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-xs font-mono bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
            No news matches your current filters {newsMode === 'ticker' ? `for ${ticker}` : 'for general market'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNews.map((item, idx) => (
              <a 
                key={idx} 
                href={item.link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="group flex flex-col bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 hover:border-emerald-500/30 rounded-xl p-4 transition-all duration-300 hover:shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm ${
                    item.source === 'Yahoo Finance' 
                      ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {item.source}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">
                    {formatDate(item.pubDate)}
                  </span>
                </div>
                
                <h3 className="text-sm font-bold text-zinc-200 group-hover:text-emerald-400 transition-colors line-clamp-3 leading-snug mb-2 font-sans">
                  {item.title}
                </h3>
                
                {/* Strip HTML tags from description if any, using a simple regex, then slice */}
                <p className="text-xs text-zinc-500 line-clamp-2 mt-auto leading-relaxed" dangerouslySetInnerHTML={{ 
                  __html: item.description 
                    ? item.description.replace(/<[^>]*>?/gm, '').slice(0, 120) + (item.description.length > 120 ? '...' : '')
                    : ''
                }} />
                
                <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest group-hover:text-zinc-400 transition-colors">Read Article</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 group-hover:text-emerald-400 transition-colors"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}
