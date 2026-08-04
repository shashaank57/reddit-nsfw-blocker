document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleStrict = document.getElementById('toggle-strict');
  const statusDesc = document.getElementById('status-desc');
  const subredditInput = document.getElementById('subreddit-input');
  const addBtn = document.getElementById('add-btn');
  const subTagsContainer = document.getElementById('sub-tags');
  const blockCountEl = document.getElementById('block-count');
  const resetStatsBtn = document.getElementById('reset-stats-btn');

  let blockedSubreddits = [];

  let savedStrictMode = false;

  // Load stored settings
  chrome.storage.local.get(['enabled', 'strictMode', 'blockedSubreddits', 'blockedCount'], (data) => {
    const isEnabled = data.enabled !== undefined ? data.enabled : true;
    savedStrictMode = data.strictMode !== undefined ? data.strictMode : false;
    blockedSubreddits = data.blockedSubreddits || [];
    const count = data.blockedCount || 0;

    toggleEnabled.checked = isEnabled;
    toggleStrict.disabled = !isEnabled;
    toggleStrict.checked = isEnabled ? savedStrictMode : false;
    blockCountEl.textContent = count;
    updateStatusText(isEnabled);
    renderTags();
  });

  // Listen for storage changes in real time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blockedCount) {
      blockCountEl.textContent = changes.blockedCount.newValue || 0;
    }
  });

  // Toggle Master Enable
  toggleEnabled.addEventListener('change', () => {
    const enabled = toggleEnabled.checked;
    toggleStrict.disabled = !enabled;
    toggleStrict.checked = enabled ? savedStrictMode : false;
    chrome.storage.local.set({ enabled });
    updateStatusText(enabled);
  });

  // Toggle Strict Mode
  toggleStrict.addEventListener('change', () => {
    savedStrictMode = toggleStrict.checked;
    chrome.storage.local.set({ strictMode: savedStrictMode });
  });

  // Add Subreddit
  addBtn.addEventListener('click', addSubreddit);
  subredditInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSubreddit();
  });

  function addSubreddit() {
    let value = subredditInput.value.trim().toLowerCase();
    if (!value) return;

    // Clean prefix if user typed r/ or /r/
    value = value.replace(/^(\/)?r\//, '');

    if (value && !blockedSubreddits.includes(value)) {
      blockedSubreddits.push(value);
      chrome.storage.local.set({ blockedSubreddits }, () => {
        subredditInput.value = '';
        renderTags();
      });
    }
  }

  // Render Subreddit Tags
  function renderTags() {
    subTagsContainer.innerHTML = '';
    if (blockedSubreddits.length === 0) {
      subTagsContainer.innerHTML = '<span style="font-size: 11px; color: #8b949e;">No custom subreddits added</span>';
      return;
    }

    blockedSubreddits.forEach((sub, index) => {
      const tag = document.createElement('div');
      tag.className = 'tag';

      const textSpan = document.createElement('span');
      textSpan.textContent = `r/${sub}`;
      tag.appendChild(textSpan);

      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('data-index', index);
      removeBtn.textContent = ' ×';
      tag.appendChild(removeBtn);

      subTagsContainer.appendChild(tag);
    });

    // Attach remove listeners
    document.querySelectorAll('.remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        blockedSubreddits.splice(idx, 1);
        chrome.storage.local.set({ blockedSubreddits }, () => {
          renderTags();
        });
      });
    });
  }

  function updateStatusText(enabled) {
    statusDesc.textContent = enabled ? 'Protection is active' : 'Protection is paused';
    statusDesc.style.color = enabled ? '#3fb950' : '#8b949e';
  }

  // Reset Block Count
  resetStatsBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedCount: 0 }, () => {
      blockCountEl.textContent = '0';
    });
  });

  // Intercept all external link clicks to reliably open in new browser tabs
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="http"]');
    if (link) {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (url) {
        chrome.tabs.create({ url });
      }
    }
  });
});
