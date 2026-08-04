# 🛡️ Reddit NSFW Blocker (Chrome & Firefox Browser Extension)

A powerful, fast, and privacy-focused browser extension designed to block NSFW subreddits, adult content, and 18+ posts on Reddit. Fully compatible with **Google Chrome**, **Mozilla Firefox**, **Brave**, **Microsoft Edge**, and **Opera**.

---

## ✨ Features

- 🚫 **Multi-Layered NSFW Detection:** Combines URL matching, HTML `<head>` metadata scanning, Reddit Web Components (`shreddit-post[nsfw]`, `shreddit-content-tags[nsfw]`), and Old Reddit DOM elements (`.over18`).
- ⚡ **Zero-Flash Protection:** Injects CSS at `document_start` so adult content never flashes on screen before JavaScript loads.
- 🎛️ **Custom Blocklist:** Manually block specific subreddits or keywords (e.g. `r/nsfw_example`).
- 👁️ **Feed Filter (Strict Mode):** Automatically hides or blurs individual NSFW posts while browsing safe feeds (`/r/all`, `/r/popular`, or search results).
- 📊 **Block Statistics Counter:** Tracks how many NSFW subreddits/posts have been blocked.
- 🎨 **Modern Dark Mode UI:** Beautiful Glassmorphism popup dashboard.

---

## 🚀 Installation Guide

### 🌐 Google Chrome / Brave / Edge / Opera

1. Open your browser and navigate to: `chrome://extensions/`
2. Enable **Developer mode** (toggle switch in the top right corner).
3. Click **Load unpacked**.
4. Select the directory: `C:\Users\Shashaank\Documents\reddit-nsfw-blocker`
5. The extension is now installed and active! Pin it to your toolbar for easy access.

---

### 🦊 Mozilla Firefox

1. Open Firefox and navigate to: `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file inside `C:\Users\Shashaank\Documents\reddit-nsfw-blocker`.
4. The extension is now active on Firefox!

---

## 📁 Workspace Project Structure

```
reddit-nsfw-blocker/
├── manifest.json         # Manifest V3 configuration (Chrome & Firefox compatible)
├── background.js        # Background service worker & badge count manager
├── content.js           # Multi-layered detection engine (URL, Meta, DOM observer)
├── content.css          # Instant zero-flash CSS overlay & post blurring
├── blocked.html         # Custom blocked page screen
├── popup/
│   ├── popup.html       # Popup UI markup
│   ├── popup.css        # Dark mode popup styles
│   └── popup.js         # Settings & blocklist controller
├── icons/               # Extension icons
└── README.md            # Setup and usage guide
```

---

## 💡 How It Works Under the Hood

1. **Pre-Render Scan:** Before the page body renders, the extension inspects the `<head>` meta tags (`is-nsfw`, `og:rating`) and URL paths.
2. **DOM Component Observer:** Uses a high-performance `MutationObserver` to watch for Reddit web components like `<shreddit-post nsfw="">` and `<shreddit-content-tags nsfw="">`.
3. **Instant Overlay:** When an NSFW subreddit is detected, the extension pauses playing media and overlays a clean, customizable restricted access screen.
