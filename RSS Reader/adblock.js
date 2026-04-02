/**
 * AdBlock Engine — uBlock-style content filtering
 * Parses EasyList-format filter rules and applies them to URLs and DOM elements.
 */

const AdBlock = (() => {
  // ── State ───────────────────────────────────────────────────
  let enabled = true;
  let blockedCount = 0;

  // Compiled rule sets
  const networkRules = [];       // { regex, isException, domains, originDomains }
  const cosmeticRules = new Map(); // domain → [selectors]
  const genericCosmeticSelectors = [];

  // ── Bundled Filter Rules (EasyList subset + extras) ─────────
  // Format: standard uBlock/EasyList filter syntax
  const BUNDLED_FILTERS = `
! === Network Filters ===
! Ad servers & tracking
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||adnxs.com^
||advertising.com^
||ads.yahoo.com^
||ads.twitter.com^
||ads.linkedin.com^
||facebook.com/tr^
||connect.facebook.net/en_US/fbevents.js
||amazon-adsystem.com^
||media.net^
||outbrain.com^
||taboola.com^
||revcontent.com^
||mgid.com^
||zergnet.com^
||sharethrough.com^
||33across.com^
||pubmatic.com^
||rubiconproject.com^
||openx.net^
||casalemedia.com^
||criteo.com^
||criteo.net^
||adroll.com^
||moatads.com^
||scorecardresearch.com^
||quantserve.com^
||chartbeat.com^
||newrelic.com^
||hotjar.com^
||fullstory.com^
||loggly.com^
! Common ad paths
/ads.js
/ad.js
/advertisement.js
/analytics.js$script
/tracking.js$script
/pixel.js$script
/banner-ads/
/ad-banner/
/adserver/
/doubleclick/
/adsense/
! === Cosmetic Filters ===
##.ad
##.ads
##.advertisement
##.advertisements
##.ad-banner
##.ad-container
##.ad-wrapper
##.ad-slot
##.ad-unit
##.ad-block
##.adsbygoogle
##.google-ad
##.google-ads
##.dfp-ad
##.dfp-slot
##[id^="google_ads"]
##[id^="ad_"]
##[class^="ad_"]
##[id*="advertisement"]
##[class*="advertisement"]
##.sidebar-ad
##.banner-ad
##.leaderboard-ad
##.sticky-ad
##.interstitial-ad
##.promoted-post
##.promoted-content
##.sponsored-content
##.native-ad
##[data-ad-unit]
##[data-ad-slot]
##.widget-ads
##.ad-footer
##.ad-header
##[class*="outbrain"]
##[class*="taboola"]
##[id*="taboola"]
##[id*="outbrain"]
`.trim();

  // ── Parser ──────────────────────────────────────────────────

  function parseFilters(filterText) {
    const lines = filterText.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      // Cosmetic rules: ##selector or domain##selector
      if (line.includes('##')) {
        const [domainPart, selector] = line.split('##', 2);
        if (domainPart === '') {
          // Generic cosmetic
          genericCosmeticSelectors.push(selector.trim());
        } else {
          // Domain-specific cosmetic
          const domains = domainPart.split(',').map(d => d.trim()).filter(Boolean);
          for (const domain of domains) {
            if (!cosmeticRules.has(domain)) cosmeticRules.set(domain, []);
            cosmeticRules.get(domain).push(selector.trim());
          }
        }
        continue;
      }

      // Network rules
      parseNetworkRule(line);
    }
  }

  function parseNetworkRule(rule) {
    let isException = false;
    let pattern = rule;

    // Exception rules
    if (pattern.startsWith('@@')) {
      isException = true;
      pattern = pattern.slice(2);
    }

    // Extract options after $
    let options = {};
    const dollarIdx = pattern.lastIndexOf('$');
    if (dollarIdx > 0 && !pattern.endsWith('$')) {
      const optStr = pattern.slice(dollarIdx + 1);
      pattern = pattern.slice(0, dollarIdx);
      for (const opt of optStr.split(',')) {
        const [key, val] = opt.split('=');
        options[key.replace('~', '!')] = val || true;
      }
    }

    // Convert filter pattern to regex
    let regexStr = pattern
      .replace(/[.+?^{}()|[\]\\]/g, '\\$&') // escape special regex chars (not * or |)
      .replace(/\*/g, '.*')                  // * → wildcard
      .replace(/\^/g, '(?:[^a-zA-Z0-9.%-]|$)') // ^ → separator
      .replace(/^\|\|/, '(?:https?:\\/\\/(?:[^/]+\\.)?)')  // || → domain anchor
      .replace(/^\|/, '^')                   // | at start → start anchor
      .replace(/\|$/, '$');                  // | at end → end anchor

    try {
      networkRules.push({
        regex: new RegExp(regexStr, 'i'),
        isException,
        options
      });
    } catch (e) {
      // Invalid regex, skip
    }
  }

  // ── Core API ────────────────────────────────────────────────

  function init() {
    parseFilters(BUNDLED_FILTERS);
    const savedEnabled = localStorage.getItem('adblock_enabled');
    if (savedEnabled !== null) enabled = savedEnabled === 'true';
    const savedCount = parseInt(localStorage.getItem('adblock_count') || '0', 10);
    blockedCount = savedCount;
    console.log(`[AdBlock] Loaded ${networkRules.length} network rules, ${genericCosmeticSelectors.length} cosmetic selectors`);
  }

  function isUrlBlocked(url) {
    if (!enabled) return false;
    if (!url) return false;

    let blocked = false;
    let exception = false;

    for (const rule of networkRules) {
      if (rule.regex.test(url)) {
        if (rule.isException) exception = true;
        else blocked = true;
      }
    }

    if (exception) return false;

    if (blocked) {
      blockedCount++;
      try { localStorage.setItem('adblock_count', String(blockedCount)); } catch(e) {}
      return true;
    }
    return false;
  }

  /**
   * Sanitize HTML content — strips ad elements, removes tracking pixels,
   * scrubs tracking query params from links, and cleans inline scripts.
   */
  function sanitizeHTML(html, sourceUrl) {
    if (!enabled || !html) return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Apply generic cosmetic filters
    for (const selector of genericCosmeticSelectors) {
      try {
        doc.querySelectorAll(selector).forEach(el => {
          blockedCount++;
          el.remove();
        });
      } catch(e) {}
    }

    // Remove elements with ad-like attributes
    const adPatterns = [
      '[id*="ad_"]', '[id*="ads_"]', '[id*="advertisement"]', '[id*="google_ad"]',
      '[class*="advertisement"]', '[class*="adsbygoogle"]',
      'iframe[src*="doubleclick"]', 'iframe[src*="ads"]', 'iframe[src*="googlead"]',
      'script[src*="ads"]', 'script[src*="analytics"]', 'script[src*="tracking"]',
      'script[src*="pixel"]', 'script[src*="beacon"]',
      'img[width="1"][height="1"]', 'img[src*="pixel"]', 'img[src*="tracking"]',
      'img[src*="beacon"]'
    ];

    for (const pattern of adPatterns) {
      try {
        doc.querySelectorAll(pattern).forEach(el => {
          blockedCount++;
          el.remove();
        });
      } catch(e) {}
    }

    // Scrub tracking params from all links
    const trackingParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_eid', 'ref', 'referrer',
      '_ga', 'yclid', 'wickedid', 'twclid'
    ]);

    doc.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.href, sourceUrl);
        let cleaned = false;
        for (const param of trackingParams) {
          if (url.searchParams.has(param)) {
            url.searchParams.delete(param);
            cleaned = true;
          }
        }
        if (cleaned) a.href = url.toString();

        // Block ad network links
        if (isUrlBlocked(a.href)) {
          a.removeAttribute('href');
          a.style.cursor = 'default';
        }
      } catch(e) {}
    });

    // Remove tracking pixels in images
    doc.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('src') || '';
      if (isUrlBlocked(src)) {
        img.remove();
        return;
      }
    });

    // Remove inline scripts
    doc.querySelectorAll('script').forEach(s => s.remove());
    doc.querySelectorAll('style').forEach(s => s.remove());
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(l => l.remove());

    return doc.body ? doc.body.innerHTML : html;
  }

  /**
   * Filter an RSS feed's items — remove items from blocked domains.
   */
  function filterFeedItems(items) {
    if (!enabled) return items;
    return items.filter(item => {
      if (item.link && isUrlBlocked(item.link)) return false;
      return true;
    });
  }

  function setEnabled(val) {
    enabled = val;
    try { localStorage.setItem('adblock_enabled', String(val)); } catch(e) {}
  }

  function isEnabled() { return enabled; }
  function getBlockedCount() { return blockedCount; }
  function resetCount() {
    blockedCount = 0;
    try { localStorage.setItem('adblock_count', '0'); } catch(e) {}
  }

  // ── Load custom filters from string ─────────────────────────
  function addCustomFilters(filterText) {
    parseFilters(filterText);
    console.log(`[AdBlock] Added custom filters. Total network rules: ${networkRules.length}`);
  }

  return { init, isUrlBlocked, sanitizeHTML, filterFeedItems, setEnabled, isEnabled, getBlockedCount, resetCount, addCustomFilters };
})();
