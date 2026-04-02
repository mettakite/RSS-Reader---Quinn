/**
 * Instagram Extension — follow any public Instagram profile
 *
 * Uses RSSHub (rsshub.app) to convert public Instagram profiles to RSS — no API key needed.
 *
 * Supported URL patterns (paste any of these):
 *   Profile:  https://www.instagram.com/natgeo/
 *   Handle:   @natgeo  or  natgeo
 *   Tagged:   https://www.instagram.com/explore/tags/photography/
 *
 * Feed config shape:
 *   { type: 'instagram', name: 'Profile Name', url: '<rsshub feed url>' }
 *
 * Note: Instagram aggressively blocks scrapers. RSSHub works on a best-effort basis.
 * If a feed fails, try deploying your own RSSHub instance for better reliability.
 */

ExtensionRegistry.register({
  id: 'instagram',
  name: 'Instagram',
  icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,
  color: '#e1306c',
  feedPlaceholder: 'https://www.instagram.com/natgeo/  or  @username',

  /**
   * Convert any Instagram URL or handle to its RSSHub feed URL.
   */
  resolveUrl(input) {
    input = input.trim();

    // Already an RSSHub URL
    if (input.includes('rsshub.app/instagram')) return input;

    // Explore/hashtag URL
    const tagMatch = input.match(/instagram\.com\/explore\/tags\/([A-Za-z0-9_]+)/);
    if (tagMatch) {
      return `https://rsshub.app/instagram/tag/${tagMatch[1]}`;
    }

    // instagram.com profile URL
    const profileMatch = input.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?$/);
    if (profileMatch && profileMatch[1] !== 'explore') {
      return `https://rsshub.app/instagram/user/${profileMatch[1]}`;
    }

    // @handle
    if (input.startsWith('@')) {
      const username = input.slice(1).split('/')[0];
      return `https://rsshub.app/instagram/user/${username}`;
    }

    // #hashtag
    if (input.startsWith('#')) {
      const tag = input.slice(1);
      return `https://rsshub.app/instagram/tag/${tag}`;
    }

    // Bare username
    if (/^[A-Za-z0-9_.]{1,30}$/.test(input)) {
      return `https://rsshub.app/instagram/user/${input}`;
    }

    return input;
  },

  /**
   * Parse an RSS feed from RSSHub into post objects.
   */
  parseXML(xmlDoc, feedConfig) {
    const items = [];
    const channel = xmlDoc.querySelector('channel');
    if (!channel) return items;

    const feedTitle = channel.querySelector('title')?.textContent || feedConfig.name;
    const entries = channel.querySelectorAll('item');

    for (const entry of entries) {
      const title = entry.querySelector('title')?.textContent || '';
      const link = entry.querySelector('link')?.textContent || '';
      const description = entry.querySelector('description')?.textContent || '';
      const pubDate = entry.querySelector('pubDate')?.textContent || '';
      const guid = entry.querySelector('guid')?.textContent || link;

      // Extract the first image from the description HTML
      let thumbnail = '';
      const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];

      // Also check media:content or enclosure
      const entryStr = new XMLSerializer().serializeToString(entry);
      if (!thumbnail) {
        const mediaMatch = entryStr.match(/media:content[^>]+url=["']([^"']+)["']/i);
        if (mediaMatch) thumbnail = mediaMatch[1];
      }
      if (!thumbnail) {
        const enclosureMatch = entryStr.match(/enclosure[^>]+url=["']([^"']+)["']/i);
        if (enclosureMatch) thumbnail = enclosureMatch[1];
      }

      // Clean text for snippet — Instagram descriptions are the actual post caption
      const snippet = description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
      const id = `ig_${btoa(guid).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
      const displayTitle = snippet.slice(0, 80) || title || 'Post';

      items.push({
        id,
        type: 'instagram',
        feedId: feedConfig.id,
        feedName: feedConfig.name || feedTitle,
        title: displayTitle,
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
   * Compact card — photo-forward layout.
   */
  renderCard(item, isActive, onClick) {
    const card = document.createElement('div');
    card.className = `ig-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
    card.dataset.id = item.id;

    // Instagram is photo-heavy — show a big thumbnail if available
    card.innerHTML = `
      ${item.thumbnail
        ? `<div class="ig-photo-wrap"><img class="ig-photo" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.closest('.ig-photo-wrap').remove()"></div>`
        : ''}
      <div class="ig-card-body">
        <div class="ig-meta">
          <span class="ig-handle">${escHTML(item.feedName)}</span>
          <span class="ig-dot">·</span>
          <span class="ig-date">${formatRelativeDate(item.date)}</span>
        </div>
        <div class="ig-caption">${escHTML(item.snippet || item.title)}</div>
      </div>
    `;

    card.addEventListener('click', () => onClick(item));
    return card;
  },

  /**
   * Full reader view.
   */
  renderReader(item) {
    const el = document.createElement('div');
    const gradient = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)';
    el.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge" style="background:rgba(225,48,108,0.1);color:#e1306c;">
            ${escHTML(item.feedName)}
          </span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
      </div>
      ${item.thumbnail ? `
        <div style="text-align:center;margin-bottom:20px;">
          <img src="${escHTML(item.thumbnail)}" alt="" style="max-width:100%;border-radius:12px;max-height:500px;object-fit:contain;">
        </div>` : ''}
      <div class="reader-body">
        ${item.body ? item.body : (item.snippet ? `<p>${escHTML(item.snippet)}</p>` : '')}
        ${item.link ? `
          <div style="margin-top:28px;text-align:center;">
            <a href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:8px;background:${gradient};color:#fff;padding:10px 22px;border-radius:24px;text-decoration:none;font-weight:600;font-size:14px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
              View on Instagram
            </a>
          </div>` : ''}
      </div>
    `;
    return el;
  }
});
