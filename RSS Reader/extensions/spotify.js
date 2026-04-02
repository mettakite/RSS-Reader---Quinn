/**
 * Spotify Extension — subscribe to any public Spotify playlist or user's public playlists
 *
 * Uses RSSHub (rsshub.app) to convert Spotify content to RSS — no API key needed.
 *
 * Supported URL patterns (paste any of these):
 *   Playlist:  https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   User:      https://open.spotify.com/user/spotify
 *   Album:     https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy
 *   Artist:    https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02
 *
 * Feed config shape:
 *   { type: 'spotify', name: 'Playlist Name', url: '<rsshub feed url>' }
 */

ExtensionRegistry.register({
  id: 'spotify',
  name: 'Spotify',
  icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  color: '#1db954',
  feedPlaceholder: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',

  /**
   * Convert any Spotify URL to its RSSHub feed URL.
   * Accepts playlist, album, artist, or user profile URLs.
   */
  resolveUrl(input) {
    input = input.trim();

    // Already an RSSHub URL
    if (input.includes('rsshub.app/spotify')) return input;

    // Extract Spotify entity type and ID from open.spotify.com URLs
    const spotifyMatch = input.match(/open\.spotify\.com\/(playlist|album|artist|user)\/([A-Za-z0-9]+)/);
    if (spotifyMatch) {
      const [, entityType, entityId] = spotifyMatch;
      switch (entityType) {
        case 'playlist': return `https://rsshub.app/spotify/playlist/${entityId}`;
        case 'album':    return `https://rsshub.app/spotify/album/${entityId}`;
        case 'artist':   return `https://rsshub.app/spotify/artist_album/${entityId}`;
        case 'user':     return `https://rsshub.app/spotify/user/${entityId}`;
      }
    }

    // Bare ID — assume playlist
    if (/^[A-Za-z0-9]{22}$/.test(input)) {
      return `https://rsshub.app/spotify/playlist/${input}`;
    }

    return input;
  },

  /**
   * Parse an RSS feed from RSSHub into track/album item objects.
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

      // Extract thumbnail from description HTML or enclosure
      let thumbnail = '';
      const enclosure = entry.querySelector('enclosure');
      if (enclosure && enclosure.getAttribute('type')?.startsWith('image')) {
        thumbnail = enclosure.getAttribute('url') || '';
      }
      if (!thumbnail) {
        const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) thumbnail = imgMatch[1];
      }

      // Strip HTML from description for snippet
      const snippet = description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

      const id = `spotify_${btoa(guid).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;

      items.push({
        id,
        type: 'spotify',
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
    card.className = `spotify-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="spotify-card-inner">
        ${item.thumbnail
          ? `<img class="spotify-thumb" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="spotify-thumb-placeholder"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style="color:#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg></div>`
        }
        <div class="spotify-info">
          <div class="spotify-feed-name">${escHTML(item.feedName)}</div>
          <div class="spotify-title">${escHTML(item.title)}</div>
          ${item.snippet ? `<div class="spotify-snippet">${escHTML(item.snippet.slice(0, 80))}</div>` : ''}
          <div class="spotify-date">${formatRelativeDate(item.date)}</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => onClick(item));
    return card;
  },

  /**
   * Full reader view — links out to Spotify.
   */
  renderReader(item) {
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge" style="background:rgba(29,185,84,0.12);color:#1db954;">
            ${escHTML(item.feedName)}
          </span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
        <h1 class="reader-title">${escHTML(item.title)}</h1>
      </div>
      ${item.thumbnail ? `<img class="reader-hero" src="${escHTML(item.thumbnail)}" alt="" style="max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:24px;">` : ''}
      <div class="reader-body">
        ${item.body || `<p>${escHTML(item.snippet)}</p>`}
        ${item.link ? `
          <div style="margin-top:28px;text-align:center;">
            <a href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:8px;background:#1db954;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600;font-size:15px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              Open in Spotify
            </a>
          </div>` : ''}
      </div>
    `;
    return el;
  }
});
