/**
 * RSS Reader — Core App
 * Gatsby-styled, uBlock-powered, extensible feed reader.
 */

const App = (() => {
  // ── State ───────────────────────────────────────────────────

  let state = {
    feeds: [],
    items: [],          // all fetched items across all feeds
    activeFeedId: 'all', // 'all' | feed.id
    activeItemId: null,
    filter: 'all',       // 'all' | 'unread'
    searchQuery: '',
    loading: new Set(),  // feed IDs currently loading
    errors: new Map(),   // feedId → error message
    lastRefresh: null
  };

  // ── Default Feeds ────────────────────────────────────────────

  const DEFAULT_FEEDS = [
    { id: 'hacker_news', name: 'Hacker News', url: 'https://news.ycombinator.com/rss', type: 'rss', favicon: 'https://news.ycombinator.com/favicon.ico' },
    { id: 'smashing_mag', name: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', type: 'rss', favicon: 'https://www.smashingmagazine.com/favicon.ico' },
    { id: 'css_tricks', name: 'CSS-Tricks', url: 'https://css-tricks.com/feed/', type: 'rss', favicon: 'https://css-tricks.com/favicon.ico' },
    { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', type: 'rss', favicon: 'https://www.theverge.com/favicon.ico' },
    { id: 'wired', name: 'Wired', url: 'https://www.wired.com/feed/rss', type: 'rss', favicon: 'https://www.wired.com/favicon.ico' },
    { id: 'fireship_yt', name: 'Fireship', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA', type: 'youtube', favicon: '' },
    { id: 'linus_yt', name: 'Linus Tech Tips', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw', type: 'youtube', favicon: '' },
  ];

  // ── Storage ──────────────────────────────────────────────────

  const STORAGE_KEY = 'rss_reader_v2';

  function loadStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        state.feeds = data.feeds || [...DEFAULT_FEEDS];
        // Restore read status from saved items
        const readIds = new Set(data.readIds || []);
        state._readIds = readIds;
        return;
      }
    } catch(e) {}
    state.feeds = [...DEFAULT_FEEDS];
    state._readIds = new Set();
  }

  function saveStorage() {
    try {
      const readIds = state.items.filter(i => i.read).map(i => i.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        feeds: state.feeds,
        readIds
      }));
    } catch(e) {}
  }

  // ── RSS/Atom/YouTube Fetch & Parse ───────────────────────────

  // CORS proxies — ordered by reliability (fastest/most reliable first)
  const CORS_PROXIES = [
    {
      // corsproxy.io — fast, returns raw body directly
      build: url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      extract: async res => res.text(),
      timeout: 10000
    },
    {
      // rss2json — great for RSS feeds specifically, returns JSON
      build: url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
      extract: async res => {
        const data = await res.json();
        if (data.status !== 'ok') throw new Error('rss2json error: ' + data.message);
        return rss2jsonToXML(data);
      },
      timeout: 10000
    },
    {
      // allorigins — fallback, returns JSON: { contents: '<xml>...' }
      build: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      extract: async res => {
        const data = await res.json();
        if (!data || !data.contents) throw new Error('Empty allorigins response');
        return data.contents;
      },
      timeout: 8000
    },
  ];

  // Convert rss2json response to RSS XML string so parseRSSFeed can handle it
  function rss2jsonToXML(data) {
    const items = (data.items || []).map(item => {
      // Extract YouTube video ID from guid ("yt:video:VIDEO_ID") or link
      let videoId = '';
      if (item.guid && item.guid.startsWith('yt:video:')) {
        videoId = item.guid.replace('yt:video:', '').trim();
      } else if (item.link && item.link.includes('watch?v=')) {
        const m = item.link.match(/watch\?v=([A-Za-z0-9_-]+)/);
        if (m) videoId = m[1];
      }
      // Embed yt:videoId so YouTube parser can detect and extract it
      const ytTag = videoId ? `<yt:videoId>${videoId}</yt:videoId>` : '';
      return `
      <item>
        <title><![CDATA[${item.title || ''}]]></title>
        <link>${escHTML(item.link || '')}</link>
        <description><![CDATA[${item.description || item.content || ''}]]></description>
        <pubDate>${item.pubDate || ''}</pubDate>
        <author>${escHTML(item.author || '')}</author>
        <guid>${escHTML(item.guid || item.link || '')}</guid>
        ${item.thumbnail ? `<media:thumbnail url="${escHTML(item.thumbnail)}"/>` : ''}
        ${ytTag}
      </item>`;
    }).join('');
    return `<?xml version="1.0"?><rss version="2.0" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><channel>
      <title>${escHTML(data.feed?.title || '')}</title>
      ${items}
    </channel></rss>`;
  }

  // Returns true if text looks like an HTML error/bot-block page rather than feed content
  function looksLikeErrorPage(text) {
    if (!text) return true;
    const t = text.trim().toLowerCase();
    // Must start with XML/feed markers to be valid
    if (t.startsWith('<?xml') || t.startsWith('<rss') || t.startsWith('<feed') || t.startsWith('<channel')) return false;
    // Google "Sorry..." bot block, or any HTML page
    if (t.startsWith('<html') || t.startsWith('<!doctype') || t.startsWith('<!')) return true;
    return false;
  }

  async function fetchWithProxy(url) {
    const errors = [];
    // For YouTube feeds, rss2json handles them much better than raw proxies
    const isYouTubeUrl = url.includes('youtube.com/feeds') || url.includes('youtube.com/watch');
    const proxies = isYouTubeUrl
      ? [CORS_PROXIES[1], CORS_PROXIES[0], CORS_PROXIES[2]]  // rss2json first for YouTube
      : CORS_PROXIES;

    for (const proxy of proxies) {
      try {
        const proxyUrl = proxy.build(url);
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(proxy.timeout || 10000) });
        if (!res.ok) { errors.push(`${proxyUrl.split('?')[0]}: HTTP ${res.status}`); continue; }
        const text = await proxy.extract(res);
        if (!text || text.length < 50) { errors.push('Empty response'); continue; }
        // Reject HTML error/bot-block pages (e.g. Google's "Sorry..." for YouTube)
        if (looksLikeErrorPage(text)) { errors.push(`${proxyUrl.split('?')[0]}: got HTML instead of feed`); continue; }
        return text;
      } catch(e) {
        errors.push(e.message);
      }
    }
    // Last resort: direct fetch (works if the feed has permissive CORS headers)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch(e) {
      errors.push('Direct: ' + e.message);
    }
    throw new Error(`Could not fetch feed. Tried all proxies.\n${errors.join('\n')}`);
  }

  function parseRSSFeed(xmlText, feedConfig) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      // Try again as text/html (some feeds are served with wrong content-type)
      const doc2 = parser.parseFromString(xmlText, 'text/html');
      if (!doc2.querySelector('channel, feed')) throw new Error('Invalid XML — could not parse feed');
    }

    // Detect YouTube feed
    const isYouTubeFeed = feedConfig.type === 'youtube'
      || feedConfig.url.includes('youtube.com/feeds')
      || xmlText.includes('yt:videoId')
      || xmlText.includes('www.youtube.com/watch');

    if (isYouTubeFeed) {
      // If it's an Atom feed (has <entry> tags), use the YouTube extension parser
      if (doc.querySelector('entry')) {
        const ext = ExtensionRegistry.get('youtube');
        if (ext) return ext.parseXML(doc, feedConfig);
      }
      // Otherwise it's RSS format from rss2json — parse <item> tags directly
      const channel = doc.querySelector('channel');
      const rssItems = channel ? channel.querySelectorAll('item') : [];
      const items = [];
      for (const item of rssItems) {
        const title = item.querySelector('title')?.textContent || 'Untitled';
        const link = item.querySelector('link')?.textContent || '#';
        const pubDate = item.querySelector('pubDate')?.textContent || '';
        const thumbnail = item.querySelector('thumbnail')?.getAttribute('url')
          || item.querySelector('enclosure')?.getAttribute('thumbnail') || '';

        // Extract videoId from yt:videoId tag (via regex since namespace), or from link/guid
        let videoId = '';
        const itemStr = new XMLSerializer().serializeToString(item);
        const vidMatch = itemStr.match(/videoId[^>]*>([A-Za-z0-9_-]{6,})</);
        if (vidMatch) videoId = vidMatch[1];
        if (!videoId) {
          const watchMatch = link.match(/watch\?v=([A-Za-z0-9_-]+)/);
          if (watchMatch) videoId = watchMatch[1];
        }
        if (!videoId) {
          const guid = item.querySelector('guid')?.textContent || '';
          const guidMatch = guid.match(/yt:video:([A-Za-z0-9_-]+)/);
          if (guidMatch) videoId = guidMatch[1];
        }

        const finalThumbnail = thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '');
        const uid = `yt_${videoId || hashStr(title)}`;

        items.push({
          id: uid,
          type: 'youtube',
          feedId: feedConfig.id,
          feedName: feedConfig.name,
          videoId,
          title: title.trim(),
          description: '',
          thumbnail: finalThumbnail,
          link: videoId ? `https://www.youtube.com/watch?v=${videoId}` : link,
          date: parseDateFlexible(pubDate),
          dateStr: pubDate,
          read: state._readIds ? state._readIds.has(uid) : false
        });
      }
      return items;
    }

    // Standard RSS 2.0 or Atom
    const isAtom = !!doc.querySelector('feed');
    const items = [];

    if (isAtom) {
      const entries = doc.querySelectorAll('entry');
      for (const entry of entries) {
        const title = entry.querySelector('title')?.textContent || 'Untitled';
        const link = entry.querySelector('link[rel="alternate"]')?.getAttribute('href')
          || entry.querySelector('link')?.getAttribute('href')
          || entry.querySelector('id')?.textContent || '#';
        const summary = entry.querySelector('summary, content')?.textContent || '';
        const published = entry.querySelector('published, updated')?.textContent || '';
        const author = entry.querySelector('author name')?.textContent || '';
        const id = entry.querySelector('id')?.textContent || link;

        items.push(buildItem(id, title, link, summary, published, author, feedConfig));
      }
    } else {
      // RSS 2.0
      const channel = doc.querySelector('channel');
      if (!channel) return [];
      const rssItems = channel.querySelectorAll('item');
      for (const item of rssItems) {
        const title = item.querySelector('title')?.textContent || 'Untitled';
        const link = item.querySelector('link')?.textContent
          || item.querySelector('link')?.getAttribute('href') || '#';
        const description = item.querySelector('description')?.textContent || '';
        const content = item.querySelector('content\\:encoded, encoded')?.textContent || '';
        const pubDate = item.querySelector('pubDate, dc\\:date, date')?.textContent || '';
        const author = item.querySelector('author, dc\\:creator, creator')?.textContent || '';
        const guid = item.querySelector('guid')?.textContent || link;

        // Media thumbnail
        const mediaThumbnail = item.querySelector('media\\:thumbnail, thumbnail')?.getAttribute('url') || '';
        const enclosure = item.querySelector('enclosure[type^="image"]')?.getAttribute('url') || '';
        const thumbnail = mediaThumbnail || enclosure;

        const built = buildItem(guid, title, link, content || description, pubDate, author, feedConfig);
        if (thumbnail) built.thumbnail = thumbnail;
        items.push(built);
      }
    }

    return items;
  }

  function buildItem(id, title, link, body, dateStr, author, feedConfig) {
    const cleanBody = AdBlock.sanitizeHTML(body, link);
    const snippet = stripHTML(body).slice(0, 200).trim();

    // Try to find first image in body
    let thumbnail = '';
    try {
      const imgMatch = body.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];
    } catch(e) {}

    const date = parseDateFlexible(dateStr);
    const uid = `${feedConfig.id}_${hashStr(id || title)}`;

    return {
      id: uid,
      type: 'rss',
      feedId: feedConfig.id,
      feedName: feedConfig.name,
      title: title.trim(),
      link: link.trim(),
      body: cleanBody,
      snippet,
      thumbnail,
      author: author.trim(),
      date,
      dateStr,
      read: state._readIds ? state._readIds.has(uid) : false
    };
  }

  function parseDateFlexible(str) {
    if (!str) return new Date(0);
    try { return new Date(str); } catch(e) { return new Date(0); }
  }

  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 64); i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  }

  // ── Feed Auto-Discovery ──────────────────────────────────────
  // Given any URL (homepage, article, etc.), find its RSS/Atom feed.

  // Well-known feed paths to probe as a fallback
  const FEED_PATHS = [
    '/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/feed/rss',
    '/blog/feed', '/blog/rss', '/news/feed', '/news/rss',
    '/?feed=rss2', '/?feed=rss', '/?feed=atom',
    '/index.xml', '/feeds/posts/default', '/feed/atom'
  ];

  // Known feed URLs for sites whose homepages are too large or don't expose <link> tags
  const KNOWN_FEEDS = {
    'washingtonpost.com':    'https://feeds.washingtonpost.com/rss/national',
    'nytimes.com':           'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'theguardian.com':       'https://www.theguardian.com/world/rss',
    'bbc.com':               'https://feeds.bbci.co.uk/news/rss.xml',
    'bbc.co.uk':             'https://feeds.bbci.co.uk/news/rss.xml',
    'reuters.com':           'https://feeds.reuters.com/reuters/topNews',
    'techcrunch.com':        'https://techcrunch.com/feed/',
    'arstechnica.com':       'https://feeds.arstechnica.com/arstechnica/index',
    'slashdot.org':          'https://rss.slashdot.org/Slashdot/slashdot',
    'reddit.com':            'https://www.reddit.com/.rss',
    'medium.com':            'https://medium.com/feed/',
    'cnn.com':               'https://rss.cnn.com/rss/cnn_topstories.rss',
    'apnews.com':            'https://apnews.com/feed',
    'npr.org':               'https://feeds.npr.org/1001/rss.xml',
    'wired.com':             'https://www.wired.com/feed/rss',
    'theredhandfiles.com':   'https://www.theredhandfiles.com/feed/',
    'kottke.org':            'https://feeds.kottke.org/main',
    'daring fireball.net':   'https://daringfireball.net/feeds/main',
    'daringfireball.net':    'https://daringfireball.net/feeds/main',
    'sixcolors.com':         'https://sixcolors.com/feed/',
    'stratechery.com':       'https://stratechery.com/feed/',
    'marginalia.nu':         'https://www.marginalia.nu/log/atom.xml',
  };

  async function discoverFeedUrl(inputUrl) {
    // If it already looks like a feed URL, return as-is
    if (/\.(xml|rss|atom)($|\?)/.test(inputUrl)) return inputUrl;
    if (inputUrl.includes('/feed') || inputUrl.includes('/rss') || inputUrl.includes('/atom')) return inputUrl;
    if (inputUrl.includes('youtube.com/feeds')) return inputUrl;
    if (inputUrl.includes('feedburner.com')) return inputUrl;
    // Known RSS subdomains like rss.slashdot.org, feeds.feedburner.com
    if (/^https?:\/\/(rss|feeds)\./i.test(inputUrl)) return inputUrl;

    // Check known-feeds lookup before making any network requests
    try {
      const hostname = new URL(inputUrl).hostname.replace(/^www\./, '');
      if (KNOWN_FEEDS[hostname]) return KNOWN_FEEDS[hostname];
    } catch(e) {}

    // Fetch the homepage HTML and look for <link rel="alternate" type="application/rss+xml">
    // Note: we fetch directly here (not via fetchWithProxy) because fetchWithProxy rejects HTML
    // pages via looksLikeErrorPage — but for discovery we WANT the HTML to scan for <link> tags.
    let html = '';
    try {
      const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(inputUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(inputUrl)}`,
      ];
      for (const proxyUrl of proxies) {
        try {
          const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const text = await res.text();
            if (text && text.length > 50) { html = text; break; }
          }
        } catch(e) { /* try next proxy */ }
      }
    } catch(e) {}
    if (!html) return inputUrl; // can't fetch, try the URL as-is

    // Parse discovered feed links from <link> tags
    const linkMatches = [...html.matchAll(/<link[^>]+type=["'](application\/(?:rss|atom)\+xml|text\/xml)["'][^>]*href=["']([^"']+)["']/gi)];
    const linkMatches2 = [...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+type=["'](application\/(?:rss|atom)\+xml|text\/xml)["']/gi)];

    const discovered = [
      ...linkMatches.map(m => m[2]),
      ...linkMatches2.map(m => m[1])
    ].filter(Boolean);

    if (discovered.length > 0) {
      // Resolve relative URLs
      const base = new URL(inputUrl);
      const resolved = discovered.map(href => {
        try { return new URL(href, base).href; } catch(e) { return href; }
      });
      return resolved[0];
    }

    // Fallback: try common feed paths on the same origin
    const base = new URL(inputUrl);
    const origin = base.origin;
    for (const path of FEED_PATHS) {
      const candidate = origin + path;
      try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(candidate)}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const text = await res.text();
          if (text.includes('<rss') || text.includes('<feed') || text.includes('<channel')) {
            return candidate;
          }
        }
      } catch(e) { /* try next */ }
    }

    // Nothing found — return original URL and let the parser try
    return inputUrl;
  }

  // Extract a site name from a URL for use as the feed name
  function siteNameFromUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
    } catch(e) { return url; }
  }

  // ── Feed Management ──────────────────────────────────────────

  // Returns true if a URL looks like it's already a direct feed URL (not a homepage)
  function looksLikeFeedUrl(url) {
    if (!url) return false;
    if (/\.(xml|rss|atom)($|\?)/i.test(url)) return true;
    if (url.includes('youtube.com/feeds')) return true;
    if (url.includes('feedburner.com')) return true;
    if (/^https?:\/\/(rss|feeds)\./i.test(url)) return true;
    if (url.includes('/feed') || url.includes('/rss') || url.includes('/atom')) return true;
    return false;
  }

  async function fetchFeed(feed) {
    state.loading.add(feed.id);
    renderSidebar();

    try {
      let url = feed.url;

      // Let YouTube extension resolve its URL if needed
      if (feed.type === 'youtube') {
        const ext = ExtensionRegistry.get('youtube');
        if (ext) url = ext.resolveUrl(url);

        // If still a @handle, /user/, or /c/ URL, scrape the channel page to find the channel ID
        if (url.includes('youtube.com/@') || url.includes('youtube.com/user/') || url.includes('youtube.com/c/')) {
          try {
            const pageRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
            if (pageRes.ok) {
              const html = await pageRes.text();
              // Use canonical URL or og:url — these always point to /channel/UC...
              // This is more reliable than "channelId" in JSON which can be a related channel
              const canonMatch = html.match(/rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
              const ogMatch = !canonMatch && html.match(/og:url[^>]+content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
              const channelId = canonMatch?.[1] || ogMatch?.[1];
              if (channelId) {
                const resolvedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
                console.log(`[Feed] Resolved @handle to channel feed: ${resolvedUrl}`);
                feed.url = resolvedUrl;
                const feedInState = state.feeds.find(f => f.id === feed.id);
                if (feedInState) feedInState.url = resolvedUrl;
                saveStorage();
                url = resolvedUrl;
              }
            }
          } catch(e) { /* fall through */ }
        }
      }

      // If this looks like a homepage URL (not a direct feed), run auto-discovery
      // first so we save the correct feed URL and don't keep re-failing.
      if (feed.type !== 'youtube' && !looksLikeFeedUrl(url)) {
        try {
          const discovered = await discoverFeedUrl(url);
          if (discovered && discovered !== url) {
            console.log(`[Feed] Auto-discovered RSS URL for ${feed.name}: ${discovered}`);
            // Persist the discovered URL back into the feed so future refreshes use it
            feed.url = discovered;
            const feedInState = state.feeds.find(f => f.id === feed.id);
            if (feedInState) feedInState.url = discovered;
            saveStorage();
            url = discovered;
          }
        } catch(e) {
          // Discovery failed — proceed with original URL and let parser handle it
        }
      }

      let xmlText = await fetchWithProxy(url);

      // If we got back HTML instead of XML (i.e., still landed on a homepage),
      // try one more discovery pass on the fetched content.
      if (feed.type !== 'youtube' && xmlText && !xmlText.trim().startsWith('<') === false) {
        // Check if it looks like XML/feed content
        const trimmed = xmlText.trim();
        const looksLikeFeed = trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') ||
                              trimmed.startsWith('<feed') || trimmed.startsWith('<channel');
        if (!looksLikeFeed && (trimmed.startsWith('<html') || trimmed.startsWith('<!') ||
            trimmed.toLowerCase().includes('<html'))) {
          // Got HTML — try to pull a feed URL from the page content
          const linkMatches = [...trimmed.matchAll(/<link[^>]+type=["'](application\/(?:rss|atom)\+xml|text\/xml)["'][^>]*href=["']([^"']+)["']/gi)];
          const linkMatches2 = [...trimmed.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+type=["'](application\/(?:rss|atom)\+xml|text\/xml)["']/gi)];
          const discovered2 = [...linkMatches.map(m => m[2]), ...linkMatches2.map(m => m[1])].filter(Boolean);
          if (discovered2.length > 0) {
            try {
              const base = new URL(url);
              const resolvedUrl = new URL(discovered2[0], base).href;
              console.log(`[Feed] Discovered RSS from fetched HTML: ${resolvedUrl}`);
              feed.url = resolvedUrl;
              const feedInState = state.feeds.find(f => f.id === feed.id);
              if (feedInState) feedInState.url = resolvedUrl;
              saveStorage();
              xmlText = await fetchWithProxy(resolvedUrl);
            } catch(e) { /* proceed with what we have */ }
          }
        }
      }

      const newItems = parseRSSFeed(xmlText, feed);

      // Filter via adblock
      const filtered = AdBlock.filterFeedItems(newItems);

      // Merge: keep existing read state, deduplicate by id
      const existingIds = new Set(state.items.filter(i => i.feedId === feed.id).map(i => i.id));
      const merged = state.items.filter(i => i.feedId !== feed.id);
      for (const item of filtered) {
        if (!existingIds.has(item.id)) {
          merged.push(item);
        } else {
          // Preserve existing item (keeps read state)
          const existing = state.items.find(i => i.id === item.id);
          merged.push(existing || item);
        }
      }

      state.items = merged.sort((a, b) => b.date - a.date);
      state.errors.delete(feed.id);

      // Auto-fetch favicon if the feed doesn't have one yet
      if (!feed.favicon) {
        fetchFaviconForFeed(feed, xmlText);
      }

      saveStorage();
      showToast(`✓ ${feed.name} refreshed (${filtered.length} items)`, 'success');

    } catch(err) {
      console.error(`[Feed] Error fetching ${feed.name}:`, err);
      // Give user a friendlier hint
      let hint = err.message || 'Unknown error';
      if (hint.includes('Could not fetch')) hint = 'Could not reach feed — check the URL or try again later';
      else if (hint.includes('Invalid XML')) hint = 'Feed URL returned invalid data — make sure it\'s a valid RSS/Atom URL';
      else if (hint.includes('NetworkError') || hint.includes('Failed to fetch')) hint = 'Network error — check your internet connection';
      state.errors.set(feed.id, hint);
      showToast(`⚠ "${feed.name}": ${hint}`, 'error');
    } finally {
      state.loading.delete(feed.id);
      renderAll();
    }
  }

  // Fetch and store a favicon for the feed using Google's favicon service as primary source,
  // with a fallback to the feed XML's own <image><url> or <icon> tag.
  async function fetchFaviconForFeed(feed, xmlText) {
    try {
      // Try to get the site origin from the feed URL
      let siteOrigin = '';
      try {
        const feedUrl = new URL(feed.url);
        // For YouTube feeds use youtube.com
        if (feedUrl.hostname.includes('youtube.com')) {
          siteOrigin = 'youtube.com';
        } else {
          siteOrigin = feedUrl.hostname.replace(/^www\./, '');
        }
      } catch(e) {}

      // Also try to extract favicon from the RSS <image><url> or Atom <icon> tag in the XML
      if (xmlText) {
        const imgMatch = xmlText.match(/<image[^>]*>[\s\S]*?<url[^>]*>\s*([^\s<]+)\s*<\/url>/i);
        const iconMatch = xmlText.match(/<icon[^>]*>\s*([^\s<]+)\s*<\/icon>/i);
        const xmlFavicon = imgMatch?.[1] || iconMatch?.[1] || '';
        if (xmlFavicon && xmlFavicon.startsWith('http') && !xmlFavicon.includes('feedburner')) {
          feed.favicon = xmlFavicon;
          const feedInState = state.feeds.find(f => f.id === feed.id);
          if (feedInState) feedInState.favicon = xmlFavicon;
          saveStorage();
          renderSidebar();
          return;
        }
      }

      // Use Google's favicon service — reliable, no CORS issues, returns a real icon
      if (siteOrigin) {
        const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(siteOrigin)}&sz=32`;
        feed.favicon = googleFaviconUrl;
        const feedInState = state.feeds.find(f => f.id === feed.id);
        if (feedInState) feedInState.favicon = googleFaviconUrl;
        saveStorage();
        renderSidebar();
      }
    } catch(e) { /* favicon is non-critical, ignore errors */ }
  }

  function addFeed(feedData) {
    const id = feedData.id || `feed_${Date.now()}`;
    const feed = { ...feedData, id };
    state.feeds.push(feed);
    saveStorage();
    renderSidebar();
    fetchFeed(feed);
    return feed;
  }

  function removeFeed(feedId) {
    state.feeds = state.feeds.filter(f => f.id !== feedId);
    state.items = state.items.filter(i => i.feedId !== feedId);
    if (state.activeFeedId === feedId) state.activeFeedId = 'all';
    if (state.activeItemId) {
      const item = state.items.find(i => i.id === state.activeItemId);
      if (!item) state.activeItemId = null;
    }
    saveStorage();
    renderAll();
    showToast('Feed removed', 'success');
  }

  async function refreshAll() {
    if (state.feeds.length === 0) {
      showToast('No feeds to refresh', 'warning');
      return;
    }
    state.lastRefresh = new Date();
    // Fetch all concurrently
    await Promise.allSettled(state.feeds.map(f => fetchFeed(f)));
  }

  // ── Filtering & Search ───────────────────────────────────────

  function getVisibleItems() {
    let items = state.items;

    // Filter by active feed
    if (state.activeFeedId !== 'all') {
      items = items.filter(i => i.feedId === state.activeFeedId);
    }

    // Filter by read status
    if (state.filter === 'unread') {
      items = items.filter(i => !i.read);
    }

    // Search
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.snippet.toLowerCase().includes(q) ||
        (i.feedName && i.feedName.toLowerCase().includes(q))
      );
    }

    return items;
  }

  function markRead(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (item) {
      item.read = true;
      saveStorage();
    }
  }

  function markAllRead() {
    const visibleItems = getVisibleItems();
    visibleItems.forEach(i => { i.read = true; });
    saveStorage();
    renderArticleList();
    renderSidebar();
    showToast('All marked as read', 'success');
  }

  // ── DOM References ───────────────────────────────────────────

  let dom = {};

  function initDOM() {
    dom = {
      articlesList: document.getElementById('articles-list'),
      feedListTitle: document.getElementById('feed-list-title'),
      feedListMeta: document.getElementById('feed-list-meta'),
      feedItems: document.getElementById('sidebar-feeds'),
      readerContent: document.getElementById('reader-content'),
      readerPlaceholder: document.getElementById('reader-placeholder'),
      readerToolbar: document.getElementById('reader-toolbar'),
      readerOpenBtn: document.getElementById('reader-open-btn'),
      searchInput: document.getElementById('search-input'),
      adblockToggle: document.getElementById('adblock-toggle'),
      adblockToggleSwitch: document.getElementById('adblock-toggle-switch'),
      adblockCount: document.getElementById('adblock-count'),
      filterAll: document.getElementById('filter-all'),
      filterUnread: document.getElementById('filter-unread'),
      markAllReadBtn: document.getElementById('mark-all-read'),
      refreshBtn: document.getElementById('refresh-btn'),
      addFeedBtn: document.getElementById('add-feed-btn'),
      totalFeedsEl: document.getElementById('total-feeds'),
      totalItemsEl: document.getElementById('total-items'),
    };
  }

  // ── Render: Sidebar ──────────────────────────────────────────

  function renderSidebar() {
    const container = dom.feedItems;
    if (!container) return;

    // Unread counts per feed
    const unreadCounts = {};
    state.feeds.forEach(f => {
      unreadCounts[f.id] = state.items.filter(i => i.feedId === f.id && !i.read).length;
    });
    const totalUnread = state.items.filter(i => !i.read).length;

    // "All Feeds" entry
    const allHtml = `
      <div class="feed-item${state.activeFeedId === 'all' ? ' active' : ''}" data-feed-id="all">
        <div class="feed-favicon-placeholder" style="background:#663399">A</div>
        <span class="feed-name">All Feeds</span>
        ${totalUnread > 0 ? `<span class="feed-count">${totalUnread}</span>` : ''}
      </div>
    `;

    // Group feeds by type
    const rssFeedsHtml = state.feeds
      .filter(f => f.type !== 'youtube')
      .map(f => renderFeedItem(f, unreadCounts[f.id] || 0))
      .join('');

    const ytFeedsHtml = state.feeds
      .filter(f => f.type === 'youtube')
      .map(f => renderFeedItem(f, unreadCounts[f.id] || 0))
      .join('');

    container.innerHTML = allHtml
      + (rssFeedsHtml ? `<div class="sidebar-section-header">RSS Feeds <button onclick="App.openAddFeedModal('rss')" title="Add RSS feed">+</button></div>${rssFeedsHtml}` : `<div class="sidebar-section-header">RSS Feeds <button onclick="App.openAddFeedModal('rss')" title="Add RSS feed">+</button></div>`)
      + (ytFeedsHtml ? `<div class="sidebar-section-header" style="margin-top:8px">YouTube <button onclick="App.openAddFeedModal('youtube')" title="Add YouTube channel">+</button></div>${ytFeedsHtml}` : `<div class="sidebar-section-header" style="margin-top:8px">YouTube <button onclick="App.openAddFeedModal('youtube')" title="Add YouTube channel">+</button></div>`);

    // Attach feed click handlers
    container.querySelectorAll('.feed-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.feed-action-btn')) return;
        const feedId = el.dataset.feedId;
        selectFeed(feedId);
      });
    });

    // Stats
    if (dom.totalFeedsEl) dom.totalFeedsEl.textContent = state.feeds.length;
    if (dom.totalItemsEl) dom.totalItemsEl.textContent = state.items.length;

    // Adblock
    if (dom.adblockToggleSwitch) {
      dom.adblockToggleSwitch.classList.toggle('on', AdBlock.isEnabled());
    }
    if (dom.adblockCount) {
      dom.adblockCount.textContent = `${AdBlock.getBlockedCount()} blocked`;
    }
  }

  function renderFeedItem(feed, unreadCount) {
    const isActive = state.activeFeedId === feed.id;
    const isLoading = state.loading.has(feed.id);
    const hasError = state.errors.has(feed.id);

    const faviconEl = feed.favicon
      ? `<img class="feed-favicon" src="${escHTML(feed.favicon)}" alt="" onerror="this.style.display='none'">`
      : `<div class="feed-favicon-placeholder" style="background:${typeColor(feed.type)}">${escHTML((feed.name || '?')[0].toUpperCase())}</div>`;

    const badge = isLoading
      ? `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>`
      : hasError
        ? `<span title="${escHTML(state.errors.get(feed.id))}" style="color:#c0392b;font-size:14px">⚠</span>`
        : unreadCount > 0
          ? `<span class="feed-count">${unreadCount}</span>`
          : '';

    return `
      <div class="feed-item${isActive ? ' active' : ''}" data-feed-id="${escHTML(feed.id)}">
        ${faviconEl}
        <span class="feed-name">${escHTML(feed.name)}</span>
        ${badge}
        <div class="feed-item-actions">
          <button class="feed-action-btn" onclick="App.refreshFeed('${escHTML(feed.id)}')" title="Refresh">↻</button>
          <button class="feed-action-btn" onclick="App.confirmRemoveFeed('${escHTML(feed.id)}')" title="Remove">✕</button>
        </div>
      </div>
    `;
  }

  function typeColor(type) {
    const colors = { rss: '#ff6600', youtube: '#ff0000', discord: '#5865f2', spotify: '#1db954', default: '#663399' };
    return colors[type] || colors.default;
  }

  // ── Render: Article List ─────────────────────────────────────

  function renderArticleList() {
    const container = dom.articlesList;
    if (!container) return;

    const items = getVisibleItems();
    const activeFeed = state.activeFeedId === 'all' ? null : state.feeds.find(f => f.id === state.activeFeedId);

    // Update header
    if (dom.feedListTitle) {
      dom.feedListTitle.textContent = activeFeed ? activeFeed.name : 'All Feeds';
    }
    if (dom.feedListMeta) {
      const unread = items.filter(i => !i.read).length;
      dom.feedListMeta.textContent = `${items.length} items${unread > 0 ? ` · ${unread} unread` : ''}`;
    }

    if (items.length === 0) {
      const isLoading = state.loading.size > 0;
      container.innerHTML = isLoading
        ? `<div class="loading-row"><div class="spinner"></div><span>Loading feeds…</span></div>`
        : `<div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M6 3h12M6 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3M8 10h8M8 14h5"/>
            </svg>
            <h3>${state.searchQuery ? 'No results found' : 'No articles yet'}</h3>
            <p>${state.searchQuery ? 'Try a different search term.' : 'Add a feed and click Refresh to get started.'}</p>
           </div>`;
      return;
    }

    container.innerHTML = '';

    for (const item of items) {
      const isActive = item.id === state.activeItemId;

      if (item.type === 'youtube') {
        const ext = ExtensionRegistry.get('youtube');
        if (ext) {
          const card = ext.renderCard(item, isActive, selectItem);
          if (isActive) card.classList.add('active');
          container.appendChild(card);
        }
        continue;
      }

      // Standard RSS card
      const card = document.createElement('div');
      card.className = `article-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
      card.dataset.id = item.id;

      const showSource = state.activeFeedId === 'all';
      const thumbHtml = item.thumbnail
        ? `<img class="article-thumbnail" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">`
        : '';

      card.innerHTML = `
        <div class="article-card-meta">
          ${!item.read ? '<div class="unread-dot"></div>' : ''}
          ${showSource ? `<span class="article-source">${escHTML(item.feedName)}</span><span class="article-date">·</span>` : ''}
          <span class="article-date">${formatRelativeDate(item.date)}</span>
        </div>
        ${thumbHtml}
        <div class="article-title">${escHTML(item.title)}</div>
        <div class="article-snippet">${escHTML(item.snippet)}</div>
      `;

      card.addEventListener('click', () => selectItem(item));
      container.appendChild(card);
    }
  }

  // ── Render: Article Reader ───────────────────────────────────

  function renderReader(item) {
    const placeholder = dom.readerPlaceholder;
    const content = dom.readerContent;
    const toolbar = dom.readerToolbar;

    if (!item) {
      placeholder.classList.remove('hidden');
      content.classList.add('hidden');
      if (dom.readerOpenBtn) dom.readerOpenBtn.href = '#';
      return;
    }

    placeholder.classList.add('hidden');
    content.classList.remove('hidden');

    if (dom.readerOpenBtn) {
      dom.readerOpenBtn.href = item.link || '#';
      dom.readerOpenBtn.target = '_blank';
      dom.readerOpenBtn.rel = 'noopener noreferrer';
    }

    // YouTube: use extension renderer
    if (item.type === 'youtube') {
      const ext = ExtensionRegistry.get('youtube');
      if (ext) {
        content.innerHTML = '';
        content.appendChild(ext.renderReader(item));
        content.scrollTop = 0;
        return;
      }
    }

    // Standard RSS reader
    const heroHtml = item.thumbnail
      ? `<img class="reader-hero" src="${escHTML(item.thumbnail)}" alt="" onerror="this.remove()">`
      : '';

    const authorHtml = item.author ? `<div class="reader-author">By ${escHTML(item.author)}</div>` : '';

    content.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge">${escHTML(item.feedName)}</span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
        <h1 class="reader-title">${escHTML(item.title)}</h1>
        ${authorHtml}
      </div>
      ${heroHtml}
      <div class="reader-body">${item.body || `<p>${escHTML(item.snippet)}</p>`}</div>
    `;

    content.scrollTop = 0;
  }

  // ── Select ───────────────────────────────────────────────────

  function selectFeed(feedId) {
    state.activeFeedId = feedId;
    state.activeItemId = null;
    renderAll();
  }

  function selectItem(item) {
    state.activeItemId = item.id;
    markRead(item.id);
    renderArticleList();
    renderReader(item);
    renderSidebar();
  }

  // ── Full Render ──────────────────────────────────────────────

  function renderAll() {
    renderSidebar();
    renderArticleList();
    const activeItem = state.activeItemId ? state.items.find(i => i.id === state.activeItemId) : null;
    renderReader(activeItem || null);
  }

  // ── Modals ───────────────────────────────────────────────────

  function openAddFeedModal(defaultType = 'rss') {
    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';

    const typeOptions = ['rss', 'youtube'].map(t =>
      `<option value="${t}"${t === defaultType ? ' selected' : ''}>${t === 'rss' ? 'RSS / Atom' : 'YouTube Channel'}</option>`
    ).join('');

    const ytNote = defaultType === 'youtube'
      ? `<div style="font-size:12px;color:#78757a;background:#f5f5f5;padding:10px 12px;border-radius:4px;line-height:1.5;">
          <strong>YouTube RSS URL format:</strong><br>
          Channel ID: <code>https://www.youtube.com/feeds/videos.xml?channel_id=UC…</code><br>
          <em>Find channel ID: go to channel → View Source → search "channelId"</em>
         </div>`
      : '';

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Add Feed</span>
          <button class="modal-close" onclick="App.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Feed Type</label>
            <select id="modal-feed-type" onchange="App.onFeedTypeChange(this.value)">
              ${typeOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Feed Name</label>
            <input type="text" id="modal-feed-name" placeholder="e.g. My Tech Blog">
          </div>
          <div class="form-group">
            <label>URL</label>
            <input type="url" id="modal-feed-url" placeholder="${defaultType === 'youtube' ? 'https://www.youtube.com/feeds/videos.xml?channel_id=UC…' : 'Paste any website URL — e.g. nytimes.com'}">
          </div>
          <div id="modal-feed-note">${defaultType === 'rss' ? `<div style="font-size:12px;color:#78757a;background:#f5f5f5;padding:10px 12px;border-radius:4px;line-height:1.6;">
            Just paste a website URL like <strong>nytimes.com</strong> or <strong>slashdot.org</strong> — the reader will automatically find the RSS feed.
            You can also paste a direct feed URL like <code>https://example.com/feed.xml</code>.
          </div>` : ytNote}</div>
          <div id="modal-error" style="color:#c0392b;font-size:13px;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="App.submitAddFeed()">Add Feed</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('modal-feed-url')?.focus();
  }

  function onFeedTypeChange(type) {
    const urlInput = document.getElementById('modal-feed-url');
    const noteEl = document.getElementById('modal-feed-note');
    if (urlInput) urlInput.placeholder = type === 'youtube'
      ? 'https://www.youtube.com/feeds/videos.xml?channel_id=UC…'
      : 'Paste any website URL — e.g. nytimes.com';
    if (noteEl) {
      noteEl.innerHTML = type === 'youtube'
        ? `<div style="font-size:12px;color:#78757a;background:#f5f5f5;padding:10px 12px;border-radius:4px;line-height:1.5;">
            <strong>YouTube RSS URL format:</strong><br>
            Channel: <code>https://www.youtube.com/feeds/videos.xml?channel_id=UC…</code><br>
            <em>Find channel ID: go to channel → View Source → search "channelId"</em>
           </div>`
        : `<div style="font-size:12px;color:#78757a;background:#f5f5f5;padding:10px 12px;border-radius:4px;line-height:1.6;">
            Just paste a website URL like <strong>nytimes.com</strong> or <strong>slashdot.org</strong> — the reader will automatically find the RSS feed.
            You can also paste a direct feed URL like <code>https://example.com/feed.xml</code>.
           </div>`;
    }
  }

  async function submitAddFeed() {
    const type = document.getElementById('modal-feed-type')?.value || 'rss';
    const name = document.getElementById('modal-feed-name')?.value?.trim();
    let url = document.getElementById('modal-feed-url')?.value?.trim();
    const errorEl = document.getElementById('modal-error');
    const submitBtn = document.querySelector('#modal-overlay .btn-primary');

    if (!url) {
      if (errorEl) { errorEl.textContent = 'Please enter a URL.'; errorEl.style.display = 'block'; }
      return;
    }

    // Auto-add https:// if missing
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    // Basic URL validation
    try { new URL(url); } catch(e) {
      if (errorEl) { errorEl.textContent = 'Please enter a valid URL.'; errorEl.style.display = 'block'; }
      return;
    }

    // For RSS feeds, run auto-discovery if it looks like a homepage
    if (type === 'rss') {
      if (submitBtn) { submitBtn.textContent = 'Searching…'; submitBtn.disabled = true; }
      if (errorEl) { errorEl.style.display = 'none'; }

      try {
        const discovered = await discoverFeedUrl(url);
        if (discovered !== url) {
          url = discovered;
          // Update the input so user can see what was found
          const urlInput = document.getElementById('modal-feed-url');
          if (urlInput) urlInput.value = url;
        }
      } catch(e) { /* proceed with original url */ }

      if (submitBtn) { submitBtn.textContent = 'Add Feed'; submitBtn.disabled = false; }
    }

    // Check for duplicate
    if (state.feeds.find(f => f.url === url)) {
      if (errorEl) { errorEl.textContent = 'This feed is already added.'; errorEl.style.display = 'block'; }
      if (submitBtn) { submitBtn.textContent = 'Add Feed'; submitBtn.disabled = false; }
      return;
    }

    const feedName = name || siteNameFromUrl(url);
    const feed = { id: `feed_${Date.now()}`, name: feedName, url, type };
    closeModal();
    addFeed(feed);
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.remove();
  }

  function confirmRemoveFeed(feedId) {
    const feed = state.feeds.find(f => f.id === feedId);
    if (!feed) return;
    if (confirm(`Remove "${feed.name}"? This will also remove all its articles from the reader.`)) {
      removeFeed(feedId);
    }
  }

  // ── Toast ────────────────────────────────────────────────────

  function showToast(message, type = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast${type ? ' ' + type : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Event Wiring ─────────────────────────────────────────────

  function wireEvents() {
    // Search
    dom.searchInput?.addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderArticleList();
    });

    // Filter buttons
    dom.filterAll?.addEventListener('click', () => {
      state.filter = 'all';
      dom.filterAll.classList.add('active');
      dom.filterUnread?.classList.remove('active');
      renderArticleList();
    });

    dom.filterUnread?.addEventListener('click', () => {
      state.filter = 'unread';
      dom.filterUnread.classList.add('active');
      dom.filterAll?.classList.remove('active');
      renderArticleList();
    });

    // Mark all read
    dom.markAllReadBtn?.addEventListener('click', markAllRead);

    // Refresh all
    dom.refreshBtn?.addEventListener('click', refreshAll);

    // Add feed button
    dom.addFeedBtn?.addEventListener('click', () => openAddFeedModal('rss'));

    // Adblock toggle
    dom.adblockToggle?.addEventListener('click', () => {
      AdBlock.setEnabled(!AdBlock.isEnabled());
      renderSidebar();
      showToast(AdBlock.isEnabled() ? 'Ad blocking enabled' : 'Ad blocking disabled', AdBlock.isEnabled() ? 'success' : 'warning');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'r' || e.key === 'R') refreshAll();
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Init ─────────────────────────────────────────────────────

  async function init() {
    AdBlock.init();
    loadStorage();
    initDOM();
    wireEvents();
    renderAll();

    // Auto-refresh on load
    showToast('Loading feeds…');
    await refreshAll();
  }

  // ── Public API ───────────────────────────────────────────────

  return {
    init,
    openAddFeedModal,
    closeModal,
    onFeedTypeChange,
    submitAddFeed,
    confirmRemoveFeed,
    refreshFeed: (id) => {
      const feed = state.feeds.find(f => f.id === id);
      if (feed) fetchFeed(feed);
    },
    showToast,
    getState: () => state
  };
})();

// ── Shared utilities (also used by extensions) ───────────────

function stripHTML(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function escHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRelativeDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// ── Panel Resize ─────────────────────────────────────────────────────────────

(function initPanelResize() {
  const LAYOUT_KEY = 'rss_reader_layout';
  const MIN_SIDEBAR = 180;
  const MAX_SIDEBAR = 480;
  const MIN_ARTICLE_LIST = 260;
  const MAX_ARTICLE_LIST = 700;

  // Restore saved sizes
  function loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      if (saved.sidebarWidth) {
        document.documentElement.style.setProperty('--sidebar-width', saved.sidebarWidth + 'px');
        updateSidebarHandlePos(saved.sidebarWidth);
      }
      if (saved.articleListWidth) {
        document.documentElement.style.setProperty('--article-list-width', saved.articleListWidth + 'px');
      }
    } catch(e) {}
  }

  function saveLayout() {
    try {
      const sw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
      const aw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--article-list-width'));
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarWidth: sw, articleListWidth: aw }));
    } catch(e) {}
  }

  function updateSidebarHandlePos(width) {
    const handle = document.getElementById('sidebar-resize-handle');
    if (handle) handle.style.left = (width - 2) + 'px';
  }

  // ── Sidebar resize handle ─────────────────────────────────────
  const sidebarHandle = document.getElementById('sidebar-resize-handle');
  if (sidebarHandle) {
    sidebarHandle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 280;
      sidebarHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const dx = e.clientX - startX;
        const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + dx));
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        updateSidebarHandlePos(newWidth);
      }

      function onUp() {
        sidebarHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveLayout();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Article-list resize handle ────────────────────────────────
  const articleHandle = document.getElementById('article-list-resize-handle');
  if (articleHandle) {
    articleHandle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--article-list-width')) || 380;
      articleHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const dx = e.clientX - startX;
        const newWidth = Math.min(MAX_ARTICLE_LIST, Math.max(MIN_ARTICLE_LIST, startWidth + dx));
        document.documentElement.style.setProperty('--article-list-width', newWidth + 'px');
      }

      function onUp() {
        articleHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveLayout();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Load on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLayout);
  } else {
    loadLayout();
  }
})();
