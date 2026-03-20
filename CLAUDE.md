# KnowledgeKeeper — Claude Code Context

## What This Project Is

KnowledgeKeeper is a **personal Chrome extension** (for the owner's use only, not published to the Web Store) that acts as an AI-powered knowledge manager. Think of it as a lightweight SaveDay/Raindrop alternative where everything stays local on the user's machine and AI is powered by Groq's free API.

The core idea: as you browse, you can save pages, highlight text, annotate content, and later ask an AI questions about everything you've collected — all from a sidebar panel inside Chrome.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Extension platform | Chrome MV3 (Manifest V3) | Required for modern Chrome extensions |
| UI | Vanilla HTML/CSS/JS (no framework) | No build step needed, loads fast in sidebar |
| AI model | `llama-3.3-70b-versatile` via Groq API | Free, fast, high quality |
| Search | TF-IDF cosine similarity (local, in JS) | No external calls, works offline |
| Storage | `localStorage` in sidebar context | Simplest persistence, fully private |
| Fonts | Syne (headings) + DM Sans (body) via Google Fonts | Design choice made earlier |

---

## File Structure

```
knowledgekeeper/
├── CLAUDE.md           ← you are here
├── manifest.json       ← Chrome MV3 config
├── background.js       ← Service worker: handles icon click, context menus, Groq proxy
├── content.js          ← Injected into every page: highlighting, text extraction, toasts
├── content.css         ← Styles for highlights injected into pages
├── sidebar.html        ← Entire sidebar UI + all JS inlined (storage, search, groq, UI logic)
├── README.md           ← End-user install instructions
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Why everything is inlined in `sidebar.html`

Chrome MV3 service workers don't support `"type": "module"`, and sidebar pages can't easily import from sibling JS files without a bundler. To avoid introducing a build pipeline (webpack/vite/etc.), all JS logic — storage, TF-IDF search, Groq API calls, and UI — is written as plain `<script>` tags inside `sidebar.html`. This is intentional. If a build system is introduced later, this should be refactored into separate modules.

---

## Key Architecture Decisions

### Message Passing Flow
```
sidebar.html  ←→  background.js  ←→  content.js (on active tab)
```
- Sidebar talks to content script via `chrome.tabs.sendMessage`
- Content script sends saved items back via `chrome.runtime.sendMessage({ type: "SIDEBAR_ADD_ITEM" })`
- Background proxies Groq API calls (sidebar can't hit external APIs directly in some contexts)

### Storage Design
All items stored in `localStorage` under two keys:
- `kk_items` — array of saved items, newest first
- `kk_settings` — object with `{ apiKey: "gsk_..." }`

Item schema:
```js
{
  id: "kk_1234567_abc12",   // unique ID
  type: "page" | "highlight" | "note",
  title: string,
  url: string,
  text: string,             // main content / selected text
  note: string,             // user annotation (optional)
  summary: string,          // AI-generated summary (optional, pages only)
  favicon: string,          // favicon URL
  color: string,            // highlight color hex (highlights only)
  timestamp: number         // Date.now()
}
```

### Groq API
Called directly from `sidebar.html` JS (fetch to `https://api.groq.com/openai/v1/chat/completions`). The API key is stored in localStorage and sent in the Authorization header. Used for:
1. **Auto-summarize** when saving a page (3-4 sentence summary)
2. **Key points** extraction (5 bullet points on demand)
3. **AI Chat** — semantic search finds relevant items, sends as context to Groq

### Semantic Search
TF-IDF vectorizer + cosine similarity, implemented from scratch in ~50 lines of JS. No external library. Searches across `title + text + note + summary` fields of all saved items. Runs entirely in the browser.

---

## Known Issues / Bugs Fixed So Far

1. **`"type": "module"` in manifest background** — caused service worker to fail with status 15. Removed.
2. **Missing `"contextMenus"` permission** — caused `chrome.contextMenus` to be undefined. Added to manifest.
3. **Nested zip folder** — first zip had `knowledgekeeper/knowledgekeeper/` nesting. Fixed by zipping from flat staging dir.
4. **`setPanelBehavior` missing** — sidebar wouldn't open on icon click without calling `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on install and startup.
5. **ES module imports in sidebar** — sidebar originally used `import/export` across separate files which broke without a bundler. Inlined everything into `sidebar.html`.

---

## Features Implemented

- [x] Save current page with AI summary
- [x] Web text highlighter (toggle mode, custom color)
- [x] Sticky notes on saved items
- [x] Standalone notes for current page
- [x] AI-powered key points extraction
- [x] AI Chat with context from saved items
- [x] Semantic search (TF-IDF, local)
- [x] Context menu: "Save to KnowledgeKeeper" on selection/page
- [x] Dark UI sidebar (Syne + DM Sans, accent green #c8f55a)
- [x] Stats (total, pages, highlights)
- [x] Delete items, clear all data

## Features NOT Yet Implemented

- [ ] Re-applying stored highlights visually when revisiting a page
- [ ] Export / import of saved items (JSON backup)
- [ ] Filtering by type (pages / highlights / notes)
- [ ] Tagging / collections
- [ ] Highlight color legend in sidebar
- [ ] Keyboard shortcut to open sidebar

---

## How to Load the Extension (Dev Mode)

1. Open `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** → select this folder (the one containing `manifest.json`)
4. After any code change: click the **↺ refresh** icon on the extension card
5. For sidebar changes: close and reopen the sidebar

## After Making Changes

- **background.js changes**: go to `chrome://extensions/` and click refresh on the extension
- **sidebar.html / content.js changes**: just close and reopen the sidebar / reload the page
- **manifest.json changes**: always requires a full reload of the extension

---

## Groq API Notes

- Base URL: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.3-70b-versatile`
- Auth: `Authorization: Bearer <apiKey>` header
- Get a free key at: https://console.groq.com
- The API key is entered by the user in the Settings tab and stored in localStorage

---

## Design System

```css
--bg: #0c0c0e          /* page background */
--surface: #141416     /* card background */
--surface2: #1c1c1f    /* input/button bg */
--surface3: #242428    /* hover states */
--border: #2a2a2f      /* borders */
--text: #f0f0f0        /* primary text */
--text2: #999          /* secondary text */
--text3: #666          /* muted/placeholder */
--accent: #c8f55a      /* lime green — primary accent */
--red: #ff5c5c         /* destructive actions */
--yellow: #FFE066      /* default highlight color */
--blue: #60a5fa        /* page badge color */
```