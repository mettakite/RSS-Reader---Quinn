/**
 * Extension Registry — plugin system for RSS Reader
 *
 * Extensions can register themselves here and get a tab in the feed list panel.
 * Each extension provides:
 *   - id: string
 *   - name: string
 *   - icon: emoji or SVG string
 *   - color: CSS color for accent
 *   - fetchItems(feed): Promise<Item[]>   — given a feed config, return items
 *   - renderCard(item): HTMLElement       — renders an item card in the list
 *   - renderReader(item): HTMLElement     — renders the full reader view
 */

const ExtensionRegistry = (() => {
  const extensions = new Map();

  function register(ext) {
    if (!ext.id || !ext.name) throw new Error('Extension must have id and name');
    extensions.set(ext.id, ext);
    console.log(`[Extensions] Registered: ${ext.name}`);
  }

  function get(id) { return extensions.get(id); }
  function getAll() { return Array.from(extensions.values()); }
  function has(id) { return extensions.has(id); }

  /**
   * Feed type → extension mapping.
   * A feed's `type` field determines which extension handles it.
   * Default type is 'rss'.
   */
  function getExtensionForFeed(feed) {
    const type = feed.type || 'rss';
    return extensions.get(type) || extensions.get('rss');
  }

  return { register, get, getAll, has, getExtensionForFeed };
})();

// ── Stub templates for future extensions ────────────────────

// These stubs make it easy to implement new extensions later.
// Each stub is fully wired into the registry system.

/*
 * HOW TO ADD A NEW EXTENSION:
 *
 * ExtensionRegistry.register({
 *   id: 'spotify',
 *   name: 'Spotify',
 *   icon: '🎵',
 *   color: '#1db954',
 *   feedPlaceholder: 'Spotify playlist URL or user profile',
 *   async fetchItems(feed) {
 *     // Use Spotify Web API or oEmbed
 *     return [];
 *   },
 *   renderCard(item) {
 *     const el = document.createElement('div');
 *     // ...
 *     return el;
 *   },
 *   renderReader(item) {
 *     const el = document.createElement('div');
 *     // ...
 *     return el;
 *   }
 * });
 *
 * AVAILABLE EXTENSION STUBS (ready to implement):
 *   - 'discord'    : Discord webhook messages (requires bot token)
 *   - 'spotify'    : Spotify recently played / playlist (requires OAuth)
 *   - 'apple_music': Apple Music RSS feeds (free, no auth needed!)
 *   - 'instagram'  : Instagram Basic Display API (requires OAuth)
 *   - 'tiktok'     : TikTok embed via oEmbed (limited)
 *   - 'mastodon'   : Mastodon public RSS (fully free)
 *   - 'github'     : GitHub release / commit RSS (fully free)
 *   - 'podcast'    : iTunes/RSS podcast feeds with audio player
 */
