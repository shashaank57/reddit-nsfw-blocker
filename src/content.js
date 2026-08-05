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

    initBlocker();
  });

  // Listen for storage changes in real time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled !== undefined) {
      settings.enabled = changes.enabled.newValue;
      if (!settings.enabled) {
        removeOverlay();
        unfilterFeedPosts();
        pageBlocked = false;
      } else {
        onURLChange();
        scanPage();
      }
    }
    if (changes.strictMode !== undefined) {
      settings.strictMode = changes.strictMode.newValue;
      if (!settings.strictMode) {
        unfilterFeedPosts();
      } else if (settings.enabled) {
        filterFeedPosts();
      }
    }
    if (changes.blockedSubreddits !== undefined) {
      settings.blockedSubreddits = changes.blockedSubreddits.newValue;
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

  function extractUsername(pathname) {
    const match = pathname.match(/\/(?:user|u)\/([a-zA-Z0-9_-]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  const SFW_WHITELIST_SUBS = ['nofap', 'pornfree', 'semenretention', 'selfimprovement', 'addiction'];

  function isSFWWhitelistedSub() {
    const sub = extractSubredditName(window.location.pathname);
    return sub && SFW_WHITELIST_SUBS.includes(sub.toLowerCase());
  }

  function checkURLAndAPI() {
    if (!settings.enabled) return;
    const pathname = window.location.pathname.toLowerCase();

    // A. Check custom blocked subreddits/users from user settings
    if (settings.blockedSubreddits && settings.blockedSubreddits.length > 0) {
      for (const sub of settings.blockedSubreddits) {
        const cleanedSub = sub.trim().toLowerCase().replace(/^(r\/|u\/|\/u\/|\/r\/)/, '');
        if (cleanedSub && (pathname.includes(`/r/${cleanedSub}`) || pathname.includes(`/user/${cleanedSub}`) || pathname.includes(`/u/${cleanedSub}`))) {
          triggerPageBlock(`Subreddit or User 'u/${cleanedSub}' is on your custom blocklist.`);
          return;
        }
      }
    }

    // B. Check User Profile 18+ status via background service worker
    const currentUser = extractUsername(pathname);
    if (currentUser) {
      chrome.runtime.sendMessage(
        { action: 'checkUserNSFW', username: currentUser },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.isNSFW) {
            triggerPageBlock(`User Profile 'u/${currentUser}' is an 18+ adult profile.`);
          }
        }
      );
    }

    // C. Check Reddit Subreddit official API via background service worker
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

  function getNSFWBlockReason(pathname) {
    const user = extractUsername(pathname);
    if (user) {
      return `User Profile 'u/${user}' is an 18+ adult profile.`;
    }
    const sub = extractSubredditName(pathname);
    if (sub) {
      return `Subreddit 'r/${sub}' is an 18+ NSFW subreddit.`;
    }
    return 'NSFW Subreddit or User Profile detected (18+ content).';
  }

  function scanPage() {
    if (pageBlocked || !settings.enabled) return;

    const pathname = window.location.pathname.toLowerCase();

    // A. Check Meta Tags in <head> for adult page indicator
    const nsfwMeta = document.querySelector(
      'meta[name="is-nsfw"], meta[property="og:rating"][content="adult"]'
    );
    if (nsfwMeta) {
      const content = (nsfwMeta.getAttribute('content') || '').toLowerCase();
      if (content === 'true' || content === '1' || content === 'adult') {
        triggerPageBlock(getNSFWBlockReason(pathname));
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
        triggerPageBlock(getNSFWBlockReason(pathname));
        return;
      }
    }

    // C. Check Subreddit & User Profile Level NSFW & Over18 Selectors
    const pageNSFWSelectors = [
      'shreddit-app[over18]',
      'shreddit-app[is-nsfw]',
      'shreddit-app[is-nsfw="true"]',
      'shreddit-subreddit-header[nsfw]',
      'shreddit-subreddit-header[is-nsfw]',
      'shreddit-subreddit-header[is-nsfw="true"]',
      'shreddit-profile-header[nsfw]',
      'shreddit-profile-header[is-nsfw]',
      'shreddit-profile-header[is-nsfw="true"]',
      'shreddit-profile-header[over18]',
      'button[data-testid="nsfw-profile-icon-button"]',
      'svg[data-testid="nsfw-profile-icon"]',
      'svg[aria-label="User has an NSFW profile"]',
      'svg[aria-label*="NSFW"]',
      '[data-testid="profile-main"] svg[icon-name="nsfw-fill"]',
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
      'p.nsfw-warning'
    ];

    const isSearchOrFeed = pathname === '/' || pathname.includes('/search') || pathname.includes('/r/all') || pathname.includes('/r/popular');
    const isUserProfile = pathname.startsWith('/user/') || pathname.startsWith('/u/');
    const isSinglePostPage = pathname.includes('/comments/') || pathname.includes('/post/');

    // Check if on an 18+ User Profile main feed (e.g. /user/username/)
    if (isUserProfile && !isSinglePostPage) {
      const userNSFWHeader = document.querySelector(
        'button[data-testid="nsfw-profile-icon-button"], svg[data-testid="nsfw-profile-icon"], svg[aria-label="User has an NSFW profile"], svg[aria-label*="NSFW"], shreddit-profile-header[is-nsfw="true"], shreddit-profile-header[nsfw]'
      );
      if (userNSFWHeader) {
        triggerPageBlock(getNSFWBlockReason(pathname));
        return;
      }
      if (settings.strictMode) {
        filterFeedPosts();
      }
      return;
    }

    // If on a main feed or search page, do not trigger full page block. Instead, filter individual search/feed posts.
    if (isSearchOrFeed) {
      if (settings.strictMode) {
        filterFeedPosts();
      }
      return;
    }

    // On single post pages (subreddit post threads or user profile comment threads)
    if (isSinglePostPage) {
      const isAdultNotice = document.querySelector(
        '#over18-notice, .over18-interstitial, form[action*="over18"], button[data-testid="over18-continue-button"], p.nsfw-warning, faceplate-modal[id*="over18"], .expando-gate--nsfw, .thing[data-nsfw="true"], .thing.over18'
      ) || (document.body && document.body.classList.contains('over18'));

      if (isAdultNotice) {
        triggerPageBlock(getNSFWBlockReason(pathname));
        return;
      }

      const subHeader = document.querySelector('shreddit-subreddit-header');
      if (subHeader && (subHeader.hasAttribute('is-nsfw') || subHeader.getAttribute('is-nsfw') === 'true' || subHeader.hasAttribute('nsfw'))) {
        triggerPageBlock(getNSFWBlockReason(pathname));
        return;
      }

      if (!settings.strictMode) {
        return;
      }
    }

    // Evaluate subreddit/user level selectors for full page block
    for (const selector of pageNSFWSelectors) {
      if (document.querySelector(selector)) {
        triggerPageBlock(getNSFWBlockReason(pathname));
        return;
      }
    }

    // Filter individual posts if Strict Mode is active
    if (settings.strictMode) {
      filterFeedPosts();
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
      '.thing[data-nsfw="true"]',
      '[data-nsfw="true"]',
      '.expando-gate--nsfw',
      '.nsfw-stamp',
      'span.nsfw-stamp',
      'span.nsfw'
    ];

    nsfwPostSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        // Target ONLY the individual post, community, or profile search result card unit, never the whole feed wrapper
        const postCard = el.closest(
          'shreddit-post, article, .thing.link, div[data-testid="post-container"], [data-testid="search-post-unit"], [data-testid="search-sdui-post"], [data-testid="search-community"], [data-testid="search-author"], search-telemetry-tracker[view-events^="search/view"], div[data-thingid^="t3_"], div[data-fullname^="t3_"]'
        );
        if (postCard && !postCard.classList.contains('rnb-hidden-post')) {
          // Guard: Ensure postCard is an individual unit item, never an outer main feed wrapper
          const tag = postCard.tagName.toUpperCase();
          if (tag === 'MAIN' || tag === 'BODY' || postCard.id === 'main-content' || postCard.id === 'siteTable' || postCard.classList.contains('shreddit-feed') || postCard.classList.contains('feed-container')) {
            return;
          }
          postCard.classList.add('rnb-hidden-post');

          // Handle divider lines (<hr> or .list-divider-line or Tailwind borders) to prevent stacked empty dividers
          const next = postCard.nextElementSibling;
          const prev = postCard.previousElementSibling;

          const isDividerElement = (el) => {
            if (!el) return false;
            const tag = el.tagName ? el.tagName.toUpperCase() : '';
            const cls = (el.className || '').toString();
            return (
              tag === 'HR' ||
              cls.includes('list-divider-line') ||
              cls.includes('border-b-neutral-border-weak') ||
              cls.includes('border-b-sm') ||
              cls.includes('divider')
            );
          };

          const isNextHR = isDividerElement(next);
          const isPrevHR = isDividerElement(prev);

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
    if (!settings.enabled) return;

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
      const logoUrl = chrome.runtime.getURL('icons-experimental/icon128.png');
      overlay = document.createElement('div');
      overlay.id = 'rnb-nsfw-block-overlay';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'rnb-icon-container';
      const logoImg = document.createElement('img');
      logoImg.src = logoUrl;
      logoImg.width = 72;
      logoImg.height = 72;
      logoImg.alt = 'Reddit NSFW Blocker Logo';
      iconContainer.appendChild(logoImg);
      overlay.appendChild(iconContainer);

      const h1 = document.createElement('h1');
      h1.textContent = 'Stay Focused • Content Blocked';
      overlay.appendChild(h1);

      const descP = document.createElement('p');
      descP.className = 'rnb-reason-desc';
      descP.textContent = lastBlockReason || '';
      overlay.appendChild(descP);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'rnb-btn-group';

      const homeLink = document.createElement('a');
      homeLink.href = 'https://www.reddit.com/';
      homeLink.className = 'rnb-btn rnb-btn-primary';
      
      const homeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      homeSvg.setAttribute('width', '18');
      homeSvg.setAttribute('height', '18');
      homeSvg.setAttribute('viewBox', '0 0 24 24');
      homeSvg.setAttribute('fill', 'none');
      homeSvg.setAttribute('stroke', 'currentColor');
      homeSvg.setAttribute('stroke-width', '2');
      homeSvg.setAttribute('stroke-linecap', 'round');
      homeSvg.setAttribute('stroke-linejoin', 'round');
      const homePath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      homePath1.setAttribute('d', 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
      const homePath2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      homePath2.setAttribute('points', '9 22 9 12 15 12 15 22');
      homeSvg.appendChild(homePath1);
      homeSvg.appendChild(homePath2);

      const homeText = document.createTextNode(' Return to Reddit Home');
      homeLink.appendChild(homeSvg);
      homeLink.appendChild(homeText);

      const kofiLink = document.createElement('a');
      kofiLink.href = 'https://ko-fi.com/shashaanksrivastava';
      kofiLink.target = '_blank';
      kofiLink.className = 'rnb-btn rnb-btn-support';

      const kofiSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      kofiSvg.setAttribute('width', '16');
      kofiSvg.setAttribute('height', '16');
      kofiSvg.setAttribute('viewBox', '0 0 24 24');
      kofiSvg.setAttribute('fill', 'currentColor');
      const kofiPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      kofiPath.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
      kofiSvg.appendChild(kofiPath);
      const kofiText = document.createTextNode(' Support Development 💖');
      kofiLink.appendChild(kofiSvg);
      kofiLink.appendChild(kofiText);

      const feedbackLink = document.createElement('a');
      feedbackLink.href = 'https://forms.gle/i22AGCbZydYm2rZB7';
      feedbackLink.target = '_blank';
      feedbackLink.className = 'rnb-btn rnb-btn-feedback';

      const feedbackSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      feedbackSvg.setAttribute('width', '16');
      feedbackSvg.setAttribute('height', '16');
      feedbackSvg.setAttribute('viewBox', '0 0 24 24');
      feedbackSvg.setAttribute('fill', 'none');
      feedbackSvg.setAttribute('stroke', 'currentColor');
      feedbackSvg.setAttribute('stroke-width', '2');
      feedbackSvg.setAttribute('stroke-linecap', 'round');
      feedbackSvg.setAttribute('stroke-linejoin', 'round');
      const feedbackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      feedbackPath.setAttribute('d', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
      feedbackSvg.appendChild(feedbackPath);
      const feedbackText = document.createTextNode(' Feature Requests & Bug Reports ↗');
      feedbackLink.appendChild(feedbackSvg);
      feedbackLink.appendChild(feedbackText);

      btnGroup.appendChild(homeLink);
      btnGroup.appendChild(kofiLink);
      btnGroup.appendChild(feedbackLink);
      overlay.appendChild(btnGroup);

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


