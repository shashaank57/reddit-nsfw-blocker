const puppeteer = require('puppeteer');
const path = require('path');
const assert = require('assert');

console.log('🚀 Starting Real Browser E2E Extension Test Suite...\n');

const EXTENSION_PATH = path.resolve(__dirname, '../src');

async function runBrowserTests() {
  let passed = 0;
  let failed = 0;

  console.log(`📦 Loading Extension from: ${EXTENSION_PATH}`);

  const browser = await puppeteer.launch({
    headless: false, // Chrome extensions are only fully supported when headless is false
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  async function runTestCase(name, testFn) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    try {
      await testFn(page);
      console.log(`  ✅ PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}\n`);
      failed++;
    } finally {
      await page.close().catch(() => {});
    }
  }

  try {
    // ==========================================
    // 1. USER PROFILES: SFW vs NSFW
    // ==========================================
    console.log('\n🧪 Suite 1: User Profiles (Positive & Negative)');
    
    await runTestCase('NEGATIVE: Allows clean SFW user profile (u/HurrySea3895)', async (p) => {
      await p.goto('https://www.reddit.com/user/HurrySea3895/', { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1500));
      const overlay = await p.$('#rnb-nsfw-block-overlay');
      assert.strictEqual(overlay, null, 'Overlay should NOT be present on SFW user profile');
    });

    await runTestCase('POSITIVE: Blocks verified 18+ adult user profile (u/Lehm1234)', async (p) => {
      await p.goto('https://www.reddit.com/user/Lehm1234/', { waitUntil: 'networkidle2', timeout: 20000 });
      await p.waitForSelector('#rnb-nsfw-block-overlay', { timeout: 8000 });
      const isBlockedClass = await p.evaluate(() => document.documentElement.classList.contains('rnb-blocked'));
      assert.strictEqual(isBlockedClass, true, 'html.rnb-blocked must be applied on 18+ user profile');
    });

    // ==========================================
    // 2. INDIVIDUAL POSTS: SFW vs NSFW
    // ==========================================
    console.log('\n🧪 Suite 2: Individual Posts in SFW Subreddits (Positive & Negative)');

    await runTestCase('NEGATIVE: Allows clean SFW post in r/programming', async (p) => {
      await p.goto('https://www.reddit.com/r/programming/', { waitUntil: 'networkidle2', timeout: 20000 });
      // Get first post link
      const firstPostLink = await p.$eval('a[href*="/comments/"]', (el) => el.href).catch(() => null);
      if (firstPostLink) {
        await p.goto(firstPostLink, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise((r) => setTimeout(r, 1500));
        const overlay = await p.$('#rnb-nsfw-block-overlay');
        assert.strictEqual(overlay, null, 'Overlay should NOT be present on clean SFW post');
      }
    });

    await runTestCase('POSITIVE: Blocks individual NSFW post in safe sub (r/PublicFreakout/comments/fors3n/nsfw/)', async (p) => {
      await p.goto('https://www.reddit.com/r/PublicFreakout/comments/fors3n/nsfw/', { waitUntil: 'networkidle2', timeout: 20000 });
      await p.waitForSelector('#rnb-nsfw-block-overlay', { timeout: 8000 });
      const isBlockedClass = await p.evaluate(() => document.documentElement.classList.contains('rnb-blocked'));
      assert.strictEqual(isBlockedClass, true, 'html.rnb-blocked must be applied on NSFW post');
    });

    // ==========================================
    // 3. SUBREDDITS (Modern Reddit): SFW vs NSFW
    // ==========================================
    console.log('\n🧪 Suite 3: Modern Subreddits (Positive & Negative)');

    await runTestCase('NEGATIVE: Allows clean SFW subreddit (r/programming)', async (p) => {
      await p.goto('https://www.reddit.com/r/programming/', { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1500));
      const overlay = await p.$('#rnb-nsfw-block-overlay');
      assert.strictEqual(overlay, null, 'Overlay should NOT be present on r/programming');
    });

    await runTestCase('POSITIVE: Blocks dedicated 18+ subreddit (r/HeatAddiction)', async (p) => {
      await p.goto('https://www.reddit.com/r/HeatAddiction/', { waitUntil: 'networkidle2', timeout: 20000 });
      await p.waitForSelector('#rnb-nsfw-block-overlay', { timeout: 8000 });
      const isBlockedClass = await p.evaluate(() => document.documentElement.classList.contains('rnb-blocked'));
      assert.strictEqual(isBlockedClass, true, 'html.rnb-blocked must be applied on 18+ subreddit');
    });

    // ==========================================
    // 4. OLD REDDIT: SFW vs NSFW
    // ==========================================
    console.log('\n🧪 Suite 4: Old Reddit (Positive & Negative)');

    await runTestCase('NEGATIVE: Allows clean SFW subreddit on old.reddit.com (r/programming)', async (p) => {
      await p.goto('https://old.reddit.com/r/programming/', { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1500));
      const overlay = await p.$('#rnb-nsfw-block-overlay');
      assert.strictEqual(overlay, null, 'Overlay should NOT be present on old.reddit.com/r/programming');
    });

    await runTestCase('POSITIVE: Blocks 18+ adult subreddit on old.reddit.com (r/HeatAddiction)', async (p) => {
      await p.goto('https://old.reddit.com/r/HeatAddiction/', { waitUntil: 'networkidle2', timeout: 20000 });
      await p.waitForSelector('#rnb-nsfw-block-overlay', { timeout: 8000 });
      const isBlockedClass = await p.evaluate(() => document.documentElement.classList.contains('rnb-blocked'));
      assert.strictEqual(isBlockedClass, true, 'html.rnb-blocked must be applied on old.reddit.com/r/HeatAddiction');
    });

    // ==========================================
    // 5. SEARCH & FEED FILTERING: Standard vs Strict
    // ==========================================
    console.log('\n🧪 Suite 5: Search & Feed Filtering (Strict Mode)');

    await runTestCase('POSITIVE: Hides NSFW cards in search results when Strict Mode is enabled', async (p) => {
      await p.goto('https://www.reddit.com/search/?q=nsfw', { waitUntil: 'networkidle2', timeout: 20000 });
      
      // Enable Strict Mode
      await p.evaluate(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ strictMode: true });
        }
      });
      await new Promise((r) => setTimeout(r, 2000));

      const visibleNsfwTags = await p.$$eval('shreddit-content-tags[nsfw]', (els) => {
        return els.filter(el => {
          const card = el.closest('shreddit-post, article, div[data-testid="post-container"], [data-testid="search-post-unit"]');
          return card && !card.classList.contains('rnb-hidden-post') && getComputedStyle(card).display !== 'none';
        }).length;
      });

      assert.strictEqual(visibleNsfwTags, 0, 'No unhidden NSFW cards should remain visible in Strict Mode');
    });

  } finally {
    await browser.close();
  }

  console.log('\n========================================');
  console.log(`📊 Browser E2E Results: ${passed} Passed, ${failed} Failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBrowserTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
