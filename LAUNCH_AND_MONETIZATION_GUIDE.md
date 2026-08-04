# 🚀 Launch & Monetization Guide for Reddit NSFW Blocker

This guide walks you through **publishing your extension** on the Chrome Web Store & Firefox Add-ons, and setting up **donations, one-time payments, or monthly subscriptions**.

---

## 🛍️ 1. How to Launch / Publish the Extension

### 🌐 A. Chrome Web Store (Google Chrome, Brave, Edge, Opera)
1. **Create Developer Account**:
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
   - Pay the $5 one-time registration fee.
2. **Package your Extension**:
   - Zip all extension files (`manifest.json`, `background.js`, `content.js`, `content.css`, `blocked.html`, `popup/`, `icons/`, `package.json`).
   - *Exclusion*: Do not include `.git`, `tests/`, or `.vscode`.
3. **Upload & Store Listing**:
   - Click **Add new item** and upload your `.zip`.
   - Fill in Store Listing:
     - **Title**: Reddit NSFW Blocker
     - **Description**: Fast, privacy-focused extension to block adult subreddits, 18+ posts, and search results.
     - **Category**: Productivity / Accessibility
     - **Screenshots**: Take 1280x800 screenshots of the popup and blocked screen overlay.
4. **Submit for Review**:
   - Review typically takes 1–3 business days.

---

### 🦊 B. Mozilla Firefox Add-ons (AMO)
1. **Create Developer Account**:
   - Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/) (100% Free).
2. **Upload Package**:
   - Select **Submit a New Add-on** and upload your `.zip` (with `manifest.json`).
3. **Review**:
   - Firefox automated review completes in under 24 hours.

---

## 💰 2. Monetization Models for Browser Extensions

Because Google retired Chrome Web Store Payments in 2020, extension developers use external payment providers. Here are the **3 best monetization strategies**:

---

### 💖 Model 1: Donation / Tip-Jar (Free + Voluntary Support) — *Easiest & Store-Compliant*
Allow users to support you voluntarily via **Ko-fi**, **Buy Me a Coffee**, **GitHub Sponsors**, or **Patreon**.

- **Setup**:
  1. Create an account at [Ko-fi.com](https://ko-fi.com/) or [BuyMeACoffee.com](https://buymeacoffee.com/).
  2. Copy your page URL (e.g. `https://ko-fi.com/yourname`).
  3. In `popup/popup.html`, update the `href` on `<a id="donate-btn">` to point to your page!
- **Pros**: 100% compliant with all Web Store policies, simple setup, builds user goodwill.

---

### 💳 Model 2: ExtensionPay (Stripe-Powered Monthly Subscriptions) — *Recommended for SaaS*
[ExtensionPay](https://extensionpay.com/) is a lightweight, open-source library that connects your extension to **Stripe Subscriptions**.

- **Pricing Ideas**:
  - **Free Tier**: Block adult subreddits & explicit posts.
  - **Pro Subscription**: $1.99/month or $14.99/year for Strict Mode Feed Filtering & Unlimited Custom Blocklists.
- **How it works**:
  1. Register at [ExtensionPay.com](https://extensionpay.com/).
  2. Add `ExtPay.js` to your `background.js` and `popup.js`.
  3. When a user clicks "Upgrade to Pro", `extpay.openPaymentPage()` opens a secure Stripe checkout window.
  4. Your extension unlocks Pro features automatically upon payment verification!

---

### 🍋 Model 3: LemonSqueezy / Paddle (Lifetime Key Licensing)
If you want to offer a one-time purchase (e.g. $9.99 Lifetime Access):
1. Create a product on [LemonSqueezy.com](https://www.lemonsqueezy.com/).
2. When a user buys a key, they enter their License Key into the extension popup to unlock Pro features.

---

## 📋 Launch Checklist
- [x] Run `npm test` to pass all regression unit tests.
- [x] Ensure PNG icons (`icon16.png`, `icon48.png`, `icon128.png`) are in `icons/`.
- [ ] Create Ko-fi or Stripe/ExtensionPay account.
- [ ] Update donation URL in `popup/popup.html`.
- [ ] Zip project directory and upload to Chrome Developer Dashboard!
