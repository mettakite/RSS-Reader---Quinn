/**
 * Threads Extension — follow any public Threads profile
 *
 * Uses RSSHub (rsshub.app) to convert Threads profiles to RSS — no API key needed.
 *
 * Supported URL patterns (paste any of these):
 *   Profile:  https://www.threads.net/@zuck
 *   Handle:   @zuck  or  zuck
 *
 * Feed config shape:
 *   { type: 'threads', name: 'Profile Name', url: '<rsshub feed url>' }
 */

ExtensionRegistry.register({
  id: 'threads',
  name: 'Threads',
  icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.skateboard-.skateboard-.skateboard-.skateboard-.skateboard-.78-.865-.8-1.049-.808-1.049-.808l.006-.04c.018-.002.037-.004.056-.006 1.504-.106 3.187.604 4.123 1.975.734 1.081 1.123 2.505 1.158 4.232.03 1.468-.268 2.769-.877 3.835-.706 1.236-1.746 2.131-3.092 2.663-1.186.472-2.566.71-4.11.71h-.006zm.857-9.768c-.29-.008-.586-.005-.883.014-1.05.064-1.88.354-2.42.84-.455.395-.682.916-.655 1.508.054.98.701 1.65 1.776 1.715.158.009.315.014.47.014.947 0 1.707-.305 2.258-.904.693-.753 1.025-1.92 1.004-3.486-.512-.124-1.047-.191-1.55-.201z"/></svg>`,
  color: '#000000',
  feedPlaceholder: 'https://www.threads.net/@zuck  or  @username',

  /**
   * Convert any Threads URL or handle to its RSSHub feed URL.
   */
  resolveUrl(input) {
    input = input.trim();

    // Already an RSSHub URL
    if (input.includes('rsshub.app/threads')) return input;

    // threads.net profile URL
    const threadMatch = input.match(/threads\.net\/@([A-Za-z0-9_.]+)/);
    if (threadMatch) {
      return `https://rsshub.app/threads/user/${threadMatch[1]}`;
    }

    // @handle format
    if (input.startsWith('@')) {
      const username = input.slice(1).split('/')[0];
      return `https://rsshub.app/threads/user/${username}`;
    }

    // Bare username (no dots, no slashes, looks like a handle)
    if (/^[A-Za-z0-9_.]{1,30}$/.test(input)) {
      return `https://rsshub.app/threads/user/${input}`;
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

      // Extract images from description HTML
      let thumbnail = '';
      const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];

      // Clean text for snippet
      const snippet = description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
      const id = `threads_${btoa(guid).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;

      // Use description as title if title is empty or just the username
      const displayTitle = title && !title.match(/^@/) ? title : snippet.slice(0, 80) || 'Post';

      items.push({
        id,
        type: 'threads',
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
   * Compact card — post-style layout like a social feed.
   */
  renderCard(item, isActive, onClick) {
    const card = document.createElement('div');
    card.className = `threads-card${isActive ? ' active' : ''}${item.read ? '' : ' unread'}`;
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="threads-card-inner">
        <div class="threads-meta">
          <span class="threads-handle">${escHTML(item.feedName)}</span>
          <span class="threads-dot">·</span>
          <span class="threads-date">${formatRelativeDate(item.date)}</span>
        </div>
        <div class="threads-text">${escHTML(item.snippet || item.title)}</div>
        ${item.thumbnail ? `<img class="threads-img" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
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
    el.innerHTML = `
      <div class="reader-header">
        <div class="reader-source-line">
          <span class="reader-source-badge" style="background:rgba(0,0,0,0.06);color:#000;">
            ${escHTML(item.feedName)}
          </span>
          <span class="reader-date">${formatDate(item.date)}</span>
        </div>
        <h1 class="reader-title" style="font-size:1.1rem;font-weight:500;">${escHTML(item.title)}</h1>
      </div>
      <div class="reader-body">
        ${item.body || `<p>${escHTML(item.snippet)}</p>`}
        ${item.thumbnail ? `<img src="${escHTML(item.thumbnail)}" alt="" style="max-width:100%;border-radius:12px;margin-top:16px;">` : ''}
        ${item.link ? `
          <div style="margin-top:28px;text-align:center;">
            <a href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:8px;background:#000;color:#fff;padding:10px 22px;border-radius:24px;text-decoration:none;font-weight:600;font-size:14px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.78-.865-.8-1.049-.808-1.049-.808l.006-.04c.018-.002.037-.004.056-.006 1.504-.106 3.187.604 4.123 1.975.734 1.081 1.123 2.505 1.158 4.232.03 1.468-.268 2.769-.877 3.835-.706 1.236-1.746 2.131-3.092 2.663-1.186.472-2.566.71-4.11.71h-.006zm.857-9.768c-.29-.008-.586-.005-.883.014-1.05.064-1.88.354-2.42.84-.455.395-.682.916-.655 1.508.054.98.701 1.65 1.776 1.715.158.009.315.014.47.014.947 0 1.707-.305 2.258-.904.693-.753 1.025-1.92 1.004-3.486-.512-.124-1.047-.191-1.55-.201z"/></svg>
              View on Threads
            </a>
          </div>` : ''}
      </div>
    `;
    return el;
  }
});
