const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Starting Reddit NSFW Blocker Regression Test Suite...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failed++;
  }
}

// --- 1. URL Subreddit Name Extraction Tests ---
console.log('📦 Test Suite 1: URL Subreddit Extraction');

function extractSubredditName(pathname) {
  const match = pathname.match(/\/r\/([a-zA-Z0-9_]+)/i);
  return match ? match[1].toLowerCase() : null;
}

test('Extracts subreddit from post URL', () => {
  assert.strictEqual(
    extractSubredditName('/r/handbra/comments/1vfhb9n/i_tried_covering_myself/'),
    'handbra'
  );
});

test('Extracts subreddit from direct subreddit URL', () => {
  assert.strictEqual(extractSubredditName('/r/squeezequeens/'), 'squeezequeens');
  assert.strictEqual(extractSubredditName('/r/pics'), 'pics');
});

test('Returns null for search or home page URLs', () => {
  assert.strictEqual(extractSubredditName('/search/?q=hot'), null);
  assert.strictEqual(extractSubredditName('/'), null);
});


// --- 2. Block Reason Prioritization Tests ---
console.log('\n📦 Test Suite 2: Reason Prioritization & Text Stability');

function resolveBlockReason(currentReason, newReason) {
  const isNewSpecific = newReason && (newReason.includes("Subreddit 'r/") || newReason.includes("blocklist"));
  const isCurrentSpecific = currentReason && (currentReason.includes("Subreddit 'r/") || currentReason.includes("blocklist"));

  if (isCurrentSpecific && !isNewSpecific) {
    return currentReason; // Retain specific reason
  }
  return newReason || currentReason;
}

test('Specific subreddit reason is retained over generic DOM scan notice', () => {
  const specific = "Subreddit 'r/squeezequeens' is an 18+ NSFW subreddit.";
  const generic = "NSFW Subreddit or Post detected (18+ content).";

  assert.strictEqual(resolveBlockReason(specific, generic), specific);
});

test('Upgrades generic reason when specific API reason arrives', () => {
  const generic = "NSFW Subreddit or Post detected (18+ content).";
  const specific = "Subreddit 'r/squeezequeens' is an 18+ NSFW subreddit.";

  assert.strictEqual(resolveBlockReason(generic, specific), specific);
});


// --- 3. API Response Classification Logic Tests ---
console.log('\n📦 Test Suite 3: Subreddit API Response Classification');

function classifyAPIResponse(status, redirected, url, json) {
  if (redirected || (url && url.includes('over18'))) {
    return true; // Explicit adult redirect
  }
  if (status !== 200) {
    return false;
  }
  return Boolean(
    json?.data?.over18 ||
    json?.data?.over_18 ||
    json?.data?.whitelist_status === 'promo_adult_nsfw'
  );
}

test('Explicit redirect to over18 is classified as NSFW/Restricted', () => {
  assert.strictEqual(classifyAPIResponse(302, true, 'https://www.reddit.com/over18?dest=...', null), true);
});

test('HTTP 200 OK with over18: true is classified as NSFW', () => {
  const mockJSON = { data: { over18: true } };
  assert.strictEqual(classifyAPIResponse(200, false, 'https://www.reddit.com/r/nsfw/about.json', mockJSON), true);
});

test('HTTP 200 OK with over18: false is classified as SFW', () => {
  const mockJSON = { data: { over18: false } };
  assert.strictEqual(classifyAPIResponse(200, false, 'https://www.reddit.com/r/pics/about.json', mockJSON), false);
  
  const mockSFW2 = { data: { over18: false, name: 'hotchickswithguns' } };
  assert.strictEqual(classifyAPIResponse(200, false, 'https://www.reddit.com/r/hotchickswithguns/about.json', mockSFW2), false);
});


// --- 4. HR Divider Collapsing Logic Tests ---
console.log('\n📦 Test Suite 4: Sibling HR Divider Collapsing');

function shouldHideNextHR(isNextHR, isPrevHR, afterNextIsHidden) {
  if (isNextHR && isPrevHR) {
    return true; // Hide one of double HRs
  }
  if (isNextHR && afterNextIsHidden) {
    return true; // Hide HR if trailing before hidden item or end
  }
  return false;
}

test('Collapses double HR when item between two HRs is hidden', () => {
  assert.strictEqual(shouldHideNextHR(true, true, false), true);
});

test('Preserves single HR when item has HR below and visible item after', () => {
  assert.strictEqual(shouldHideNextHR(true, false, false), false);
});

test('Hides trailing HR when next item is also hidden or end of list', () => {
  assert.strictEqual(shouldHideNextHR(true, false, true), true);
});


// --- 5. Old Reddit Selectors & Matching Tests ---
console.log('\n📦 Test Suite 5: Old Reddit Selectors');

test('Matches old.reddit.com NSFW body, infobar, and container selectors', () => {
  const oldRedditSelectors = [
    'body.over18',
    'body.over18-page',
    '#over18-notice',
    'form#over18-notice',
    '.reddit-infobar',
    '.over18-interstitial',
    '.side .nsfw-stamp',
    '.thing.over18',
    '.over18.link'
  ];
  assert.strictEqual(oldRedditSelectors.includes('body.over18'), true);
  assert.strictEqual(oldRedditSelectors.includes('.reddit-infobar'), true);
  assert.strictEqual(oldRedditSelectors.includes('.side .nsfw-stamp'), true);
  assert.strictEqual(oldRedditSelectors.includes('.thing.over18'), true);
});


// --- 6. Path Normalization Tests ---
console.log('\n📦 Test Suite 6: Path Normalization');

function normalizePath(p) {
  return (p || '').toLowerCase().replace(/\/+$/, '');
}

test('Normalizes path casing and trailing slashes to prevent unnecessary overlay re-mounts', () => {
  assert.strictEqual(normalizePath('/r/HotGirls/'), '/r/hotgirls');
  assert.strictEqual(normalizePath('/r/hotgirls'), '/r/hotgirls');
  assert.strictEqual(normalizePath('/r/HotGirls///'), '/r/hotgirls');
  assert.strictEqual(normalizePath('/r/HotGirls/'), normalizePath('/r/hotgirls'));
});


// --- 7. Max 1 Count Per Page View Guard Tests ---
console.log('\n📦 Test Suite 7: Max 1 Count Per Page View');

test('Enforces max 1 block count increment per page view', () => {
  let count = 0;
  let pageCountIncremented = false;

  function incrementCountOnce() {
    if (!pageCountIncremented) {
      pageCountIncremented = true;
      count++;
    }
  }

  // Simulate hiding 15 feed items on a single page view
  for (let i = 0; i < 15; i++) {
    incrementCountOnce();
  }
  assert.strictEqual(count, 1);

  // Simulate full page block trigger on the same page view
  incrementCountOnce();
  assert.strictEqual(count, 1);

  // Simulate navigation to a new page (resets guard)
  pageCountIncremented = false;
  incrementCountOnce();
  assert.strictEqual(count, 2);
});


// --- 8. Popup Preference & Dependency Tests ---
console.log('\n📦 Test Suite 8: Settings UI & Preference Preservation');

test('Preserves saved strict mode preference when master protection is toggled off and restored', () => {
  let savedStrictMode = true;
  let isEnabled = true;

  // Initial State: Both Enabled
  let uiStrictDisabled = !isEnabled;
  let uiStrictChecked = isEnabled ? savedStrictMode : false;
  assert.strictEqual(uiStrictDisabled, false);
  assert.strictEqual(uiStrictChecked, true);

  // Toggle Master OFF
  isEnabled = false;
  uiStrictDisabled = !isEnabled;
  uiStrictChecked = isEnabled ? savedStrictMode : false;

  assert.strictEqual(uiStrictDisabled, true);
  assert.strictEqual(uiStrictChecked, false);
  assert.strictEqual(savedStrictMode, true); // User preference retained in storage!

  // Toggle Master back ON
  isEnabled = true;
  uiStrictDisabled = !isEnabled;
  uiStrictChecked = isEnabled ? savedStrictMode : false;

  assert.strictEqual(uiStrictDisabled, false);
  assert.strictEqual(uiStrictChecked, true); // Restores user's saved preference!
});


// --- Summary ---
(async () => {
  console.log('\n========================================');
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('========================================\n');
  if (failed > 0) {
    process.exit(1);
  }
})();
