(function () {
  let settings = {
    enabled: true,
    strictMode: false,
    blockedSubreddits: []
  };

  let pageBlocked = false;
  let lastBlockReason = '';
  let currentSubredditChecked = null;
  let lastCheckedPath = '';

  // Load settings from storage
  chrome.storage.local.get(['enabled', 'strictMode', 'blockedSubreddits'], (data) => {
    if (data.enabled !== undefined) settings.enabled = data.enabled;
    if (data.strictMode !== undefined) settings.strictMode = data.strictMode;
    if (data.blockedSubreddits !== undefined) settings.blockedSubreddits = data.blockedSubreddits;

    if (settings.enabled) {
      initBlocker();
    }
  });

  // Listen for storage changes in real time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled !== undefined) {
      settings.enabled = changes.enabled.newValue;
      if (!settings.enabled) {
        removeOverlay();
        unfilterFeedPosts();
        pageBlocked = false;
      }
    }
    if (changes.strictMode !== undefined) {
      settings.strictMode = changes.strictMode.newValue;
      if (!settings.strictMode) {
        unfilterFeedPosts();
      }
    }
    if (changes.blockedSubreddits !== undefined) {
      settings.blockedSubreddits = changes.blockedSubreddits.newValue;
    }

    if (settings.enabled && !pageBlocked) {
      scanPage();
    }
  });

  // Listen for background script SPA navigation notifications
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'urlChanged') {
      onURLChange();
    }
  });

  function initBlocker() {
    lastCheckedPath = window.location.pathname;

    // 1. Initial URL & API check
    onURLChange();

    // 2. Initial DOM scan immediately
    if (!pageBlocked) {
      scanPage();
    }

    // 3. Setup SPA Navigation Event Interceptors (pushState & replaceState & popstate)
    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      onURLChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      onURLChange();
    };

    window.addEventListener('popstate', onURLChange);

    // 4. Observe dynamic changes (Shreddit web components, infinite scroll, attribute updates, DOM wipes)
    const observer = new MutationObserver(() => {
      if (!settings.enabled) return;

      if (pageBlocked) {
        // Ensure overlay is never wiped out by Reddit's async rendering / DOM hydration
        ensureOverlayInDOM();
      } else {
        // Re-check URL if path changed dynamically without pushState
        if (normalizePath(window.location.pathname) !== normalizePath(lastCheckedPath)) {
          onURLChange();
        } else {
          scanPage();
        }
      }
    });

    const targetNode = document.documentElement || document.body;
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['nsfw', 'is-nsfw', 'over18', 'over-18', 'name', 'class', 'content', 'src']
      });
    }
  }

  let pageCountIncremented = false;

  function normalizePath(p) {
    return (p || '').toLowerCase().replace(/\/+$/, '');
  }

  function incrementCountOnce() {
    if (!pageCountIncremented) {
      pageCountIncremented = true;
      chrome.runtime.sendMessage({ action: 'incrementBlockCount' });
    }
  }

  function onURLChange() {
    const newPath = normalizePath(window.location.pathname);
    const oldPath = normalizePath(lastCheckedPath);

    if (newPath !== oldPath) {
      lastCheckedPath = window.location.pathname;
      pageCountIncremented = false;
      currentSubredditChecked = null;

      // Only remove overlay when actually navigating away to a different URL
      if (pageBlocked) {
        removeOverlay();
        pageBlocked = false;
      }
    }

    // Check user blocklist & query API for subreddit NSFW flag
    checkURLAndAPI();
  }

  function extractSubredditName(pathname) {
    const match = pathname.match(/\/r\/([a-zA-Z0-9_]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function checkURLAndAPI() {
    const pathname = window.location.pathname.toLowerCase();

    // A. Check custom blocked subreddits from user settings
    if (settings.blockedSubreddits && settings.blockedSubreddits.length > 0) {
      for (const sub of settings.blockedSubreddits) {
        const cleanedSub = sub.trim().toLowerCase().replace(/^r\//, '');
        if (cleanedSub && pathname.includes(`/r/${cleanedSub}`)) {
          triggerPageBlock(`Subreddit 'r/${cleanedSub}' is on your custom blocklist.`);
          return;
        }
      }
    }

    // B. Check Reddit Subreddit official API via background service worker
    const currentSub = extractSubredditName(pathname);
    if (currentSub && (!pageBlocked || currentSub !== currentSubredditChecked)) {
      currentSubredditChecked = currentSub;
      chrome.runtime.sendMessage(
        { action: 'checkSubredditNSFW', subreddit: currentSub },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.isNSFW) {
            triggerPageBlock(`Subreddit 'r/${currentSub}' is an 18+ NSFW subreddit.`);
          }
        }
      );
    }
  }

  function scanPage() {
    if (pageBlocked || !settings.enabled) return;

    // A. Check Meta Tags in <head>
    const nsfwMeta = document.querySelector(
      'meta[name="is-nsfw"], meta[property="og:rating"][content="adult"], meta[name="twitter:label1"][value="NSFW"]'
    );
    if (nsfwMeta) {
      const content = (nsfwMeta.getAttribute('content') || nsfwMeta.getAttribute('value') || '').toLowerCase();
      if (content === 'true' || content === '1' || content === 'adult' || content === 'nsfw') {
        triggerPageBlock('This page is marked as NSFW by Reddit.');
        return;
      }
    }

    // B. Check Modern Reddit (Shreddit) App & Subreddit Header Attributes
    const shredditApp = document.querySelector('shreddit-app');
    if (shredditApp) {
      if (
        shredditApp.hasAttribute('over18') ||
        shredditApp.hasAttribute('is-nsfw') ||
        shredditApp.getAttribute('is-nsfw') === 'true' ||
        shredditApp.getAttribute('over18') === 'true'
      ) {
        triggerPageBlock('NSFW Subreddit detected (18+ content).');
        return;
      }
    }

    // C. Check Exhaustive NSFW & Over18 Selectors across Shreddit and Old Reddit
    const pageNSFWSelectors = [
      'shreddit-app[over18]',
      'shreddit-app[is-nsfw]',
      'shreddit-app[is-nsfw="true"]',
      'shreddit-subreddit-header[nsfw]',
      'shreddit-subreddit-header[is-nsfw]',
      'shreddit-subreddit-header[is-nsfw="true"]',
      'shreddit-async-loader[name*="over18"]',
      'shreddit-async-loader[name*="nsfw"]',
      'shreddit-experience-tree[over18]',
      'faceplate-modal[id*="over18"]',
      'faceplate-tracker[data-nsfw="true"]',
      'button[data-testid="over18-continue-button"]',
      'body.over18',
      'body.over18-page',
      'body.nsfw',
      'body[class*="over18"]',
      'body[class*="nsfw"]',
      '#over18-notice',
      'form#over18-notice',
      'form[action*="over18"]',
      'input[name="over18"]',
      '.over18-button',
      '.over18-interstitial',
      '.reddit-infobar',
      '.nsfw-sr',
      '.side .nsfw-stamp',
      '.side .over18',
      '.interstitial.over18',
      'div.interstitial',
      'p.nsfw-warning',
      'a[href*="over18"]'
    ];

    const pathname = window.location.pathname.toLowerCase();
    const isSearchOrFeed = pathname === '/' || pathname.includes('/search') || pathname.includes('/r/all') || pathname.includes('/r/popular') || pathname.startsWith('/user/');

    // If on a feed or search page, do not trigger full page block. Instead, filter individual search/feed posts.
    if (isSearchOrFeed) {
      if (settings.strictMode) {
        filterFeedPosts();
      }
      return;
    }

    // If viewing a dedicated post or subreddit page (not a feed), check for dedicated post NSFW badges
    pageNSFWSelectors.push(
      'shreddit-post[nsfw]',
      'shreddit-post[is-nsfw]',
      'shreddit-post[over18]',
      'shreddit-post[is-nsfw="true"]',
      '.thing.over18',
      '.thing.nsfw',
      '.over18.link',
      '.title .nsfw-stamp',
      'p.title .nsfw-stamp',
      'span.nsfw-stamp',
      'span.nsfw'
    );

    for (const selector of pageNSFWSelectors) {
      if (document.querySelector(selector)) {
        triggerPageBlock('NSFW Subreddit or Post detected (18+ content).');
        return;
      }
    }

    // D. Check inside Web Components / Shadow DOM
    const webComponents = document.querySelectorAll('shreddit-app, shreddit-subreddit-header, shreddit-async-loader');
    for (const comp of webComponents) {
      if (comp.shadowRoot) {
        const shadowNSFW = comp.shadowRoot.querySelector('[is-nsfw="true"], [over18], [nsfw], #over18-notice');
        if (shadowNSFW) {
          triggerPageBlock('NSFW Subreddit detected inside component view.');
          return;
        }
      }
    }

    // E. Scan page script state for embedded "over18":true or "isNsfw":true (Only on specific subreddit / post pages)
    if (!isSearchOrFeed) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && (text.includes('"over18":true') || text.includes('"isNsfw":true') || text.includes('"isNSFW":true'))) {
          // Check if this script applies to a dedicated NSFW subreddit/post
          if (text.includes('"is_over18":true') || text.includes('"is_nsfw":true') || text.includes('"over18":true')) {
            triggerPageBlock('NSFW content detected in page metadata.');
            return;
          }
        }
      }
    }

    // F. Strict Mode / Feed & Search Result Post Filtering (Only when Strict Mode is enabled)
    if (settings.strictMode) {
      filterFeedPosts();
    }
  }

  function filterFeedPosts() {
    if (!settings.enabled || !settings.strictMode) return;
    const nsfwPostSelectors = [
      'shreddit-post[nsfw]',
      'shreddit-post[is-nsfw]',
      'shreddit-post[over18]',
      'shreddit-content-tags[nsfw]',
      '.text-category-nsfw',
      '[icon-name="nsfw-fill"]',
      '[data-testid="nsfw-subreddit-icon"]',
      'img[src*="avatar_over18.png"]',
      '[data-faceplate-tracking-context*=\'"nsfw":true\']',
      '.over18.link',
      '.thing.over18',
      '.thing.nsfw',
      '.nsfw-stamp',
      'span.nsfw-stamp',
      'span.nsfw'
    ];

    nsfwPostSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        // Target ONLY the individual post, community, or profile search result card unit, never the whole feed wrapper
        const postCard = el.closest(
          'shreddit-post, article, .thing, .link, div[data-testid="post-container"], [data-testid="search-post-unit"], [data-testid="search-sdui-post"], [data-testid="search-community"], [data-testid="search-author"], search-telemetry-tracker[view-events^="search/view"], div[data-thingid^="t3_"], div[data-fullname^="t3_"]'
        );
        if (postCard && !postCard.classList.contains('rnb-hidden-post')) {
          postCard.classList.add('rnb-hidden-post');

          // Handle divider lines (<hr> or .list-divider-line) to prevent double dividers or missing dividers
          const next = postCard.nextElementSibling;
          const prev = postCard.previousElementSibling;

          const isNextHR = next && (next.tagName === 'HR' || next.classList.contains('list-divider-line'));
          const isPrevHR = prev && (prev.tagName === 'HR' || prev.classList.contains('list-divider-line'));

          if (isNextHR && isPrevHR) {
            // Hide only one of the double HRs so exactly one HR remains between visible items
            next.classList.add('rnb-hidden-post');
          } else if (isNextHR) {
            const afterNext = next.nextElementSibling;
            if (!afterNext || afterNext.classList.contains('rnb-hidden-post')) {
              next.classList.add('rnb-hidden-post');
            }
          }

          incrementCountOnce();
        }
      });
    });
  }

  function unfilterFeedPosts() {
    document.querySelectorAll('.rnb-hidden-post').forEach((el) => {
      el.classList.remove('rnb-hidden-post');
    });
  }

  function triggerPageBlock(reason) {
    // Prefer specific subreddit reason over generic DOM scan reason
    const isSpecificReason = reason && (reason.includes("Subreddit 'r/") || reason.includes("blocklist"));
    const isCurrentSpecific = lastBlockReason && (lastBlockReason.includes("Subreddit 'r/") || lastBlockReason.includes("blocklist"));

    if (pageBlocked && isCurrentSpecific && !isSpecificReason) {
      return; // Keep the more specific reason
    }

    pageBlocked = true;
    if (reason && (isSpecificReason || !isCurrentSpecific)) {
      lastBlockReason = reason;
    }

    // Pause any media playing on page
    document.querySelectorAll('video, audio').forEach((media) => media.pause());

    // Enforce overlay and HTML block class
    ensureOverlayInDOM();

    // Notify background script to update badge count ONCE per page view
    incrementCountOnce();
  }

  function ensureOverlayInDOM() {
    if (!document.documentElement) return;

    // Apply class to html tag to trigger CSS display: none !important on all page children
    if (!document.documentElement.classList.contains('rnb-blocked')) {
      document.documentElement.classList.add('rnb-blocked');
    }
    if (document.body && !document.body.classList.contains('rnb-blocked')) {
      document.body.classList.add('rnb-blocked');
    }

    // Check if overlay element exists
    let overlay = document.getElementById('rnb-nsfw-block-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rnb-nsfw-block-overlay';
      overlay.innerHTML = `
        <div class="rnb-icon-container">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF4500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
          </svg>
        </div>
        <h1>Subreddit Restricted</h1>
        <p class="rnb-reason-desc"></p>
        <div class="rnb-btn-group">
          <a href="https://www.reddit.com/" class="rnb-btn rnb-btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            Return to Reddit Home
          </a>
          <a href="https://ko-fi.com/shashaanksrivastava" target="_blank" class="rnb-btn rnb-btn-support">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            Support Development 💖
          </a>
          <a href="https://forms.gle/i22AGCbZydYm2rZB7" target="_blank" class="rnb-btn rnb-btn-feedback">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            Feature Requests & Bug Reports ↗
          </a>
        </div>
      `;

      const reasonEl = overlay.querySelector('.rnb-reason-desc');
      if (reasonEl) {
        reasonEl.textContent = lastBlockReason || '';
      }

      // Always mount directly to documentElement root so body transform/containment never clips it
      if (overlay.parentNode !== document.documentElement) {
        document.documentElement.appendChild(overlay);
      }
    } else {
      if (overlay.parentNode !== document.documentElement) {
        document.documentElement.appendChild(overlay);
      }
      // Update text dynamically if reason upgraded to specific
      const descEl = overlay.querySelector('.rnb-reason-desc') || overlay.querySelector('p');
      if (descEl && descEl.textContent !== lastBlockReason) {
        descEl.textContent = lastBlockReason;
      }
    }
  }

  function removeOverlay() {
    const overlay = document.getElementById('rnb-nsfw-block-overlay');
    if (overlay) overlay.remove();

    if (document.documentElement) {
      document.documentElement.classList.remove('rnb-blocked');
    }
    if (document.body) {
      document.body.classList.remove('rnb-blocked');
      document.body.style.overflow = '';
    }
  }
})();


