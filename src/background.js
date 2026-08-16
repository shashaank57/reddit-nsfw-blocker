// In-memory cache for subreddit NSFW status ({ [subName]: boolean })
const subCache = new Map();

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['enabled', 'strictMode', 'blockedSubreddits', 'blockedCount'], (res) => {
    const defaults = {
      enabled: res.enabled !== undefined ? res.enabled : true,
      strictMode: res.strictMode !== undefined ? res.strictMode : false, // Blur/hide individual NSFW posts in feeds
      blockedSubreddits: res.blockedSubreddits || [], // User custom blocked subreddits
      blockedCount: res.blockedCount || 0
    };
    chrome.storage.local.set(defaults);
  });
});

// Listen for tab updates (SPA navigation / tab state change)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    if (tab.url && tab.url.includes('reddit.com')) {
      chrome.tabs.sendMessage(tabId, { action: 'urlChanged', url: tab.url }).catch(() => {
        // Tab may not have content script injected yet
      });
    }
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'incrementBlockCount') {
    chrome.storage.local.get(['blockedCount'], (data) => {
      const newCount = (data.blockedCount || 0) + 1;
      chrome.storage.local.set({ blockedCount: newCount });
      
      // Update action badge text if tab is available
      if (sender.tab && sender.tab.id) {
        chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'BLOCKED' });
        chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#E53E3E' });
      }
    });
    return true;
  }

  if (message.action === 'checkSubredditNSFW') {
    const sub = (message.subreddit || '').toLowerCase();
    if (!sub) {
      sendResponse({ isNSFW: false });
      return true;
    }

    if (subCache.has(sub)) {
      sendResponse({ isNSFW: subCache.get(sub) });
      return true;
    }

    // Query Reddit API endpoint for absolute source of truth
    fetch(`https://www.reddit.com/r/${sub}/about.json`, {
      headers: { 'Accept': 'application/json, text/plain, */*' }
    })
      .then(async (res) => {
        // If Reddit explicitly redirects to an adult/over18 warning page
        if (res.redirected || (res.url && res.url.includes('over18'))) {
          subCache.set(sub, true);
          sendResponse({ isNSFW: true });
          return;
        }

        if (!res.ok) {
          // Unauthenticated fetch blocked by Reddit (e.g. 403/429) -> let DOM selectors verify
          subCache.set(sub, false);
          sendResponse({ isNSFW: false });
          return;
        }

        const data = await res.json();
        const isNSFW = Boolean(
          data?.data?.over18 ||
          data?.data?.over_18 ||
          data?.data?.whitelist_status === 'promo_adult_nsfw'
        );

        subCache.set(sub, isNSFW);
        sendResponse({ isNSFW });
      })
      .catch((err) => {
        sendResponse({ isNSFW: false, error: err.message });
      });

    return true; // Keep channel open for async response
  }

  if (message.action === 'checkUserNSFW') {
    const user = (message.username || '').toLowerCase();
    if (!user) {
      sendResponse({ isNSFW: false });
      return true;
    }

    if (subCache.has(`u_${user}`)) {
      sendResponse({ isNSFW: subCache.get(`u_${user}`) });
      return true;
    }

    fetch(`https://www.reddit.com/user/${user}/about.json`, {
      headers: { 'Accept': 'application/json, text/plain, */*' }
    })
      .then(async (res) => {
        if (res.status === 403 || res.status === 401 || res.redirected || (res.url && res.url.includes('over18'))) {
          subCache.set(`u_${user}`, true);
          sendResponse({ isNSFW: true });
          return;
        }

        if (!res.ok) {
          subCache.set(`u_${user}`, false);
          sendResponse({ isNSFW: false });
          return;
        }

        const data = await res.json();
        const isNSFW = Boolean(
          data?.data?.over_18 ||
          data?.data?.is_nsfw ||
          data?.data?.subreddit?.over_18
        );

        subCache.set(`u_${user}`, isNSFW);
        sendResponse({ isNSFW });
      })
      .catch((err) => {
        sendResponse({ isNSFW: false, error: err.message });
      });

    return true;
  }
});

