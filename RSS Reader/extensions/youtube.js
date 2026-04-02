/**
 * YouTube Extension — fetches channel/playlist RSS feeds (no API key needed)
 *
 * YouTube exposes free public RSS feeds:
 *   Channel:  https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 *   Playlist: https://www.youtube.com/feeds/videos.xml?playlist_id=PL...
 *
 * Feed config shape:
 *   { type: 'youtube', name: 'Channel Name', url: '<youtube feed url>', channelId: '...' }
 *
 * Helper: given a channel URL like https://youtube.com/@mkbhd or /channel/UCxxx,
 * we can construct the RSS URL.
 */

ExtensionRegistry.register({
  id: 'youtube',
  name: 'YouTube',
  icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>`,
  color: '#ff0000',
  feedPlaceholder: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxx',

  /**
   * Convert a human YouTube URL to its RSS feed URL.
   * Accepts: channel page URL, @handle URL, or a direct RSS URL.
   */
  resolveUrl(input) {
    input = input.trim();

    // Already a feed URL
    if (input.includes('feeds/videos.xml')) return input;

    // Channel ID: UC...
    const channelMatch = input.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;

    // @handle or /user/
    // We can't resolve handles without the API, so return a helpful error URL
    // Users should paste the RSS URL directly (see instructions in add-feed modal)
    if (input.startsWith('UC') && input.length > 10) {
      // Bare channel ID
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${input}`;
    }

    // Playlist
    const playlistMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (playlistMatch) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`;

    // Return as-is and let fetch fail gracefully
    return input;
  },

  /**
   * Parse a YouTube Atom feed XML into item objects.
   */
  parseXML(xmlDoc, feedConfig) {
    const entries = xmlDoc.querySelectorAll('entry');
    const items = [];

    // Serialize to string for regex fallback (yt: namespace not queryable)
    const xmlStr = new XMLSerializer().serializeToString(xmlDoc);

    for (const entry of entries) {
      // Extract videoId: try querySelector variations, then regex on serialized XML
      let videoId = entry.querySelector('videoId')?.textContent || '';
      if (!videoId) {
        // yt:videoId uses namespace prefix — grab from the entry's serialized XML
        const entryStr = new XMLSerializer().serializeToString(entry);
        const m = entryStr.match(/videoId[^>]*>([A-Za-z0-9_-]{6,})</);
        if (m) videoId = m[1];
      }
      if (!videoId) {
        // Fall back to extracting from the <id> element: "yt:video:VIDEO_ID"
        const idText = entry.querySelector('id')?.textContent || '';
        videoId = idText.replace('yt:video:', '').trim();
      }
      // Last resort: extract from a watch URL in the entry
      if (!videoId || videoId.includes(':')) {
        const watchMatch = xmlStr.match(/watch\?v=([A-Za-z0-9_-]{6,})/);
        if (watchMatch) videoId = watchMatch[1];
      }

      const title = entry.querySelector('title')?.textContent || 'Untitled';
      const published = entry.querySelector('published')?.textContent || '';
      const updated = entry.querySelector('updated')?.textContent || published;
      const channelName = xmlDoc.querySelector('channel > title, feed > author > name, feed > title')?.textContent || feedConfig.name;

      // Description: try media:group > media:description, then summary
      const entryStr2 = new XMLSerializer().serializeToString(entry);
      const descMatch = entryStr2.match(/description[^>]*>([\s\S]*?)<\/[^:]*description>/);
      const description = entry.querySelector('summary')?.textContent || (descMatch ? descMatch[1] : '') || '';

      // YouTube media thumbnail — try querySelector, then regex
      let thumbnail = entry.querySelector('thumbnail')?.getAttribute('url') || '';
      if (!thumbnail) {
        const thumbMatch = entryStr2.match(/thumbnail[^>]+url=["']([^"']+)["']/);
        if (thumbMatch) thumbnail = thumbMatch[1];
      }
      // Always fall back to standard YouTube thumbnail URL
      if (!thumbnail && videoId) thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

      items.push({
        id: `yt_${videoId}`,
        type: 'youtube',
        feedId: feedConfig.id,
        feedName: feedConfig.name || channelName,
        videoId,
        title,
        description: stripHTML(description).slice(0, 300),
        thumbnail,
        link: `https://www.youtube.com/watch?v=${videoId}`,
        date: new Date(published || updated),
        dateStr: published || updated,
        read: false
      });
    }

    return items;
  },

  /**
   * Render a compact card for the article list.
   */
  renderCard(item, isActive, onClick) {
    const card = document.createElement('div');
    card.className = `yt-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="yt-thumbnail-wrap">
        <img class="yt-thumbnail" src="${escHTML(item.thumbnail)}" alt="" loading="lazy"
             onerror="this.style.display='none'">
        <div class="yt-play-icon">
          <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      <div class="yt-info">
        <div class="yt-channel">${escHTML(item.feedName)}</div>
        <div class="yt-title">${escHTML(item.title)}</div>
        <div class="yt-date">${formatRelativeDate(item.date)}</div>
      </div>
    `;

    card.addEventListener('click', () => onClick(item));
    return card;
  },

  /**
   * Render the full reader view — embedded YouTube player.
   */
  renderReader(item) {
    const el = document.createElement('div');

    el.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge" style="background:rgba(255,0,0,0.1);color:#cc0000;">
            ${escHTML(item.feedName)}
          </span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
        <h1 class="reader-title">${escHTML(item.title)}</h1>
      </div>
      <div class="yt-embed-wrap">
        <iframe
          src="https://www.youtube.com/embed/${escHTML(item.videoId)}?rel=0&modestbranding=1"
          allowfullscreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          title="${escHTML(item.title)}"
        ></iframe>
      </div>
      ${item.description ? `<div class="reader-body"><p>${escHTML(item.description)}</p></div>` : ''}
    `;

    return el;
  }
});

// ── Utilities (shared with app.js via global scope) ──────────
function stripHTML(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function escHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRelativeDate(date) {
  if (!date || isNaN(date)) return '';
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
  if (!date || isNaN(date)) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
