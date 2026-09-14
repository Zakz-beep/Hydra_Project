import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser({
    customFields: {
        item: ['media:content', 'description']
    }
});

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker');
    const type = searchParams.get('type') || 'ticker'; // 'ticker' or 'general'

    if (type === 'ticker' && !ticker) {
        return NextResponse.json({ error: 'Ticker is required for ticker news' }, { status: 400 });
    }

    try {
        const fetchFeeds = async () => {
            let urls: {source: string, url: string}[] = [];
            
            if (type === 'general') {
                urls = [
                    {
                        source: 'Yahoo Finance',
                        url: `https://finance.yahoo.com/news/rss`
                    },
                    {
                        source: 'Google News',
                        url: `https://news.google.com/rss/search?q=stock+market+OR+finance+OR+economy&hl=en-US&gl=US&ceid=US:en`
                    }
                ];
            } else {
                urls = [
                    {
                        source: 'Yahoo Finance',
                        url: `https://finance.yahoo.com/rss/headline?s=${ticker}`
                    },
                    {
                        source: 'Google News',
                        url: `https://news.google.com/rss/search?q=${ticker}+stock&hl=en-US&gl=US&ceid=US:en`
                    }
                ];
            }

            const results = await Promise.allSettled(
                urls.map(async ({ source, url }) => {
                    const feed = await parser.parseURL(url);
                    return feed.items.map(item => ({
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate || new Date().toISOString(),
                        source: source,
                        description: item.contentSnippet || item.description || ''
                    }));
                })
            );

            // Flatten and filter out failures
            let allNews: any[] = [];
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    allNews = [...allNews, ...result.value];
                } else {
                    console.error("Error fetching feed:", result.reason);
                }
            });

            // Sort by date descending
            allNews.sort((a, b) => {
                return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
            });

            // Deduplicate by title (simple deduplication)
            const uniqueNews = allNews.filter((v, i, a) => a.findIndex(t => (t.title === v.title)) === i);

            return uniqueNews.slice(0, 30); // Return top 30 news
        };

        const news = await fetchFeeds();
        return NextResponse.json({ news });

    } catch (error: any) {
        console.error('RSS Parsing Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch news' }, { status: 500 });
    }
}
