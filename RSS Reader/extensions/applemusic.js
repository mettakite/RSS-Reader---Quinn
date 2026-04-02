/**
 * Apple Music Extension — subscribe to any Apple Music playlist, album new releases,
 * or top charts via Apple's free RSS generator (no API key or auth needed).
 *
 * Apple's RSS generator: https://rss.applemarketingtools.com/
 *
 * Supported URL patterns (paste any of these):
 *   Playlist:     https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb
 *   Album:        https://music.apple.com/us/album/folklore/1528828771
 *   Artist:       https://music.apple.com/us/artist/taylor-swift/159260351
 *   Top Charts:   https://rss.applemarketingtools.com/api/v2/us/music/most-played/25/albums.json
 *   New Releases: https://rss.applemarketingtools.com/api/v2/us/music/new-releases/albums/25/albums.json
 *
 * Feed config shape:
 *   { type: 'applemusic', name: 'Playlist Name', url: '<apple rss feed url>' }
 */

ExtensionRegistry.register({
  id: 'applemusic',
  name: 'Apple Music',
  icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.546-.645 9.15 9.15 0 0 0-1.813-.23c-.05-.003-.097-.01-.144-.017H5.93a9.388 9.388 0 0 0-1.994.234 5.12 5.12 0 0 0-1.524.638C1.277 1.815.528 2.83.24 4.17A9.108 9.108 0 0 0 0 5.994v12.012c.003.24.009.48.024.72a9.3 9.3 0 0 0 .217 1.476 5.06 5.06 0 0 0 .645 1.557c.733 1.14 1.74 1.89 3.066 2.18a9.107 9.107 0 0 0 1.822.228c.063.003.124.012.186.012h12.013c.24-.003.48-.009.72-.024a9.294 9.294 0 0 0 1.476-.216 5.07 5.07 0 0 0 1.558-.646c1.14-.733 1.888-1.74 2.18-3.066a9.152 9.152 0 0 0 .228-1.822c.003-.063.012-.124.012-.186V6.012l-.013-.111zm-9.895 2.735v5.44a2.89 2.89 0 0 1-.38 1.424 2.5 2.5 0 0 1-1.04 1.006 3.266 3.266 0 0 1-1.563.38c-.994 0-1.81-.396-2.396-1.073-.55-.634-.787-1.396-.707-2.209.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713.31.003.614.04.905.107V7.408c0-.268-.16-.397-.427-.34L8.11 7.79a.333.333 0 0 0-.268.32v7.21a2.872 2.872 0 0 1-.38 1.42 2.496 2.496 0 0 1-1.039 1.006 3.268 3.268 0 0 1-1.563.382c-.994 0-1.81-.397-2.397-1.074-.55-.634-.787-1.395-.707-2.208.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713a3.2 3.2 0 0 1 .905.107V6.378c0-.54.368-.993.897-1.101l5.845-1.168c.617-.123 1.107.347 1.107.98v3.77h-.01z"/></svg>`,
  color: '#fc3c44',
  feedPlaceholder: 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',

  /**
   * Convert any Apple Music URL to an RSS feed.
   * Uses Apple's Marketing Tools RSS API for charts/releases,
   * and RSSHub for playlist/album/artist pages.
   */
  resolveUrl(input) {
    input = input.trim();

    // Already an Apple RSS feed or RSSHub URL
    if (input.includes('rss.applemarketingtools.com')) return input;
    if (input.includes('rsshub.app/apple')) return input;
    if (input.includes('itunes.apple.com/rss') || input.includes('podcasts.apple.com')) return input;

    // Apple Music playlist URL
    const playlistMatch = input.match(/music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[a-f0-9]+)/i);
    if (playlistMatch) {
      const [, country, playlistId] = playlistMatch;
      // Use Apple's RSS Marketing Tools for playlists (returns JSON feed)
      return `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/50/albums.json`;
    }

    // Apple Music album URL — use RSSHub
    const albumMatch = input.match(/music\.apple\.com\/([a-z]{2})\/album\/[^/]+\/(\d+)/i);
    if (albumMatch) {
      const [, , albumId] = albumMatch;
      return `https://itunes.apple.com/lookup?id=${albumId}&entity=song&media=music&limit=50`;
    }

    // Apple Music artist URL — new releases via RSSHub
    const artistMatch = input.match(/music\.apple\.com\/([a-z]{2})\/artist\/[^/]+\/(\d+)/i);
    if (artistMatch) {
      const [, country, artistId] = artistMatch;
      return `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/25/albums.json`;
    }

    // Shorthand: "new releases us" or just "top us"
    if (/^(new.?releases?|top.?charts?)\s+([a-z]{2})$/i.test(input)) {
      const parts = input.split(/\s+/);
      const country = parts[parts.length - 1].toLowerCase();
      const isNew = /new/i.test(input);
      return isNew
        ? `https://rss.applemarketingtools.com/api/v2/${country}/music/new-releases/albums/25/albums.json`
        : `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/25/albums.json`;
    }

    return input;
  },

  /**
   * Parse Apple's JSON RSS feed or standard RSS XML into items.
   * Apple's Marketing Tools API returns JSON, not XML.
   */
  parseJSON(jsonData, feedConfig) {
    const items = [];
    const feed = jsonData.feed;
    if (!feed) return items;

    const feedTitle = feed.title || feedConfig.name;
    const results = feed.results || [];

    for (const result of results) {
      const id = `am_${result.id || btoa(result.name || Math.random()).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
      const title = result.name || 'Untitled';
      const artist = result.artistName || '';
      const releaseDate = result.releaseDate || '';
      const link = result.url || '';
      const thumbnail = result.artworkUrl100
        ? result.artworkUrl100.replace('100x100', '400x400')
        : '';
      const genre = (result.genres || []).map(g => g.name).filter(Boolean).join(', ');
      const snippet = [artist, genre, releaseDate].filter(Boolean).join(' · ');

      items.push({
        id,
        type: 'applemusic',
        feedId: feedConfig.id,
        feedName: feedConfig.name || feedTitle,
        title: `${title}${artist ? ` — ${artist}` : ''}`,
        snippet,
        body: `<p><strong>${escHTML(title)}</strong>${artist ? ` by <strong>${escHTML(artist)}</strong>` : ''}</p>${genre ? `<p>Genre: ${escHTML(genre)}</p>` : ''}${releaseDate ? `<p>Released: ${escHTML(releaseDate)}</p>` : ''}`,
        thumbnail,
        link,
        date: releaseDate ? new Date(releaseDate) : new Date(),
        dateStr: releaseDate,
        read: false
      });
    }

    return items;
  },

  /**
   * Parse standard RSS XML (podcasts, some Apple feeds).
   */
  parseXML(xmlDoc, feedConfig) {
    const items = [];
    const channel = xmlDoc.querySelector('channel');
    if (!channel) return items;

    const feedTitle = channel.querySelector('title')?.textContent || feedConfig.name;
    const entries = channel.querySelectorAll('item');

    for (const entry of entries) {
      const title = entry.querySelector('title')?.textContent || 'Untitled';
      const link = entry.querySelector('link')?.textContent || '';
      const description = entry.querySelector('description')?.textContent || '';
      const pubDate = entry.querySelector('pubDate')?.textContent || '';
      const guid = entry.querySelector('guid')?.textContent || link;

      let thumbnail = '';
      const enclosure = entry.querySelector('enclosure');
      if (enclosure?.getAttribute('type')?.startsWith('image')) {
        thumbnail = enclosure.getAttribute('url') || '';
      }
      if (!thumbnail) {
        const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) thumbnail = imgMatch[1];
      }

      const snippet = description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const id = `am_${btoa(guid).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;

      items.push({
        id,
        type: 'applemusic',
        feedId: feedConfig.id,
        feedName: feedConfig.name || feedTitle,
        title: title.trim(),
        snippet,
        body: description,
        thumbnail,
        link,
        date: pubDate ? new Date(pubDate) : new Date(),
        dateStr: pubDate,
        read: false
      });
    }

    return items;
  },

  /**
   * Compact card for the article list.
   */
  renderCard(item, isActive, onClick) {
    const card = document.createElement('div');
    card.className = `am-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="am-card-inner">
        ${item.thumbnail
          ? `<img class="am-thumb" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="am-thumb-placeholder"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style="color:#fc3c44"><path d="M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.546-.645 9.15 9.15 0 0 0-1.813-.23c-.05-.003-.097-.01-.144-.017H5.93a9.388 9.388 0 0 0-1.994.234 5.12 5.12 0 0 0-1.524.638C1.277 1.815.528 2.83.24 4.17A9.108 9.108 0 0 0 0 5.994v12.012c.003.24.009.48.024.72a9.3 9.3 0 0 0 .217 1.476 5.06 5.06 0 0 0 .645 1.557c.733 1.14 1.74 1.89 3.066 2.18a9.107 9.107 0 0 0 1.822.228c.063.003.124.012.186.012h12.013c.24-.003.48-.009.72-.024a9.294 9.294 0 0 0 1.476-.216 5.07 5.07 0 0 0 1.558-.646c1.14-.733 1.888-1.74 2.18-3.066a9.152 9.152 0 0 0 .228-1.822c.003-.063.012-.124.012-.186V6.012l-.013-.111zm-9.895 2.735v5.44a2.89 2.89 0 0 1-.38 1.424 2.5 2.5 0 0 1-1.04 1.006 3.266 3.266 0 0 1-1.563.38c-.994 0-1.81-.396-2.396-1.073-.55-.634-.787-1.396-.707-2.209.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713.31.003.614.04.905.107V7.408c0-.268-.16-.397-.427-.34L8.11 7.79a.333.333 0 0 0-.268.32v7.21a2.872 2.872 0 0 1-.38 1.42 2.496 2.496 0 0 1-1.039 1.006 3.268 3.268 0 0 1-1.563.382c-.994 0-1.81-.397-2.397-1.074-.55-.634-.787-1.395-.707-2.208.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713a3.2 3.2 0 0 1 .905.107V6.378c0-.54.368-.993.897-1.101l5.845-1.168c.617-.123 1.107.347 1.107.98v3.77h-.01z"/></svg></div>`
        }
        <div class="am-info">
          <div class="am-feed-name">${escHTML(item.feedName)}</div>
          <div class="am-title">${escHTML(item.title)}</div>
          ${item.snippet ? `<div class="am-snippet">${escHTML(item.snippet.slice(0, 80))}</div>` : ''}
          <div class="am-date">${formatRelativeDate(item.date)}</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => onClick(item));
    return card;
  },

  /**
   * Full reader view — artwork + details + link to Apple Music.
   */
  renderReader(item) {
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge" style="background:rgba(252,60,68,0.1);color:#fc3c44;">
            ${escHTML(item.feedName)}
          </span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
        <h1 class="reader-title">${escHTML(item.title)}</h1>
      </div>
      ${item.thumbnail ? `
        <div style="text-align:center;margin-bottom:24px;">
          <img src="${escHTML(item.thumbnail)}" alt="" style="width:220px;height:220px;object-fit:cover;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
        </div>` : ''}
      <div class="reader-body">
        ${item.body || `<p>${escHTML(item.snippet)}</p>`}
        ${item.link ? `
          <div style="margin-top:28px;text-align:center;">
            <a href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:8px;background:#fc3c44;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600;font-size:15px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.546-.645 9.15 9.15 0 0 0-1.813-.23c-.05-.003-.097-.01-.144-.017H5.93a9.388 9.388 0 0 0-1.994.234 5.12 5.12 0 0 0-1.524.638C1.277 1.815.528 2.83.24 4.17A9.108 9.108 0 0 0 0 5.994v12.012c.003.24.009.48.024.72a9.3 9.3 0 0 0 .217 1.476 5.06 5.06 0 0 0 .645 1.557c.733 1.14 1.74 1.89 3.066 2.18a9.107 9.107 0 0 0 1.822.228c.063.003.124.012.186.012h12.013c.24-.003.48-.009.72-.024a9.294 9.294 0 0 0 1.476-.216 5.07 5.07 0 0 0 1.558-.646c1.14-.733 1.888-1.74 2.18-3.066a9.152 9.152 0 0 0 .228-1.822c.003-.063.012-.124.012-.186V6.012l-.013-.111zm-9.895 2.735v5.44a2.89 2.89 0 0 1-.38 1.424 2.5 2.5 0 0 1-1.04 1.006 3.266 3.266 0 0 1-1.563.38c-.994 0-1.81-.396-2.396-1.073-.55-.634-.787-1.396-.707-2.209.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713.31.003.614.04.905.107V7.408c0-.268-.16-.397-.427-.34L8.11 7.79a.333.333 0 0 0-.268.32v7.21a2.872 2.872 0 0 1-.38 1.42 2.496 2.496 0 0 1-1.039 1.006 3.268 3.268 0 0 1-1.563.382c-.994 0-1.81-.397-2.397-1.074-.55-.634-.787-1.395-.707-2.208.09-.9.52-1.63 1.205-2.162.63-.49 1.368-.72 2.195-.713a3.2 3.2 0 0 1 .905.107V6.378c0-.54.368-.993.897-1.101l5.845-1.168c.617-.123 1.107.347 1.107.98v3.77h-.01z"/></svg>
              Open in Apple Music
            </a>
          </div>` : ''}
      </div>
    `;
    return el;
  }
});
