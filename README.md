# KnowledgeKeeper Chrome Extension

A personal AI-powered knowledge manager using Groq's `llama-3.3-70b-versatile` model. Everything stays local — no accounts, no cloud sync.

## Features

| Feature | Description |
|---|---|
| **Save Pages** | Bookmark any webpage with an auto-generated AI summary |
| **Web Highlighter** | Highlight text on any page, saved with color coding |
| **Sticky Notes** | Add notes to saved items or write standalone notes for any page |
| **Get Key Points** | Extract and save 5–7 AI-generated bullet points from the current page |
| **AI Chat** | Ask questions about your saved knowledge using Groq LLM |
| **Semantic Search** | TF-IDF local search — works fully offline, no API needed |
| **Dark / Light Mode** | Toggle between dark and light themes; preference is saved automatically |
| **Context Menu** | Right-click any page or selection → "Save to KnowledgeKeeper" |

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `knowledgekeeper_v2/` folder
5. The extension icon will appear in your toolbar — pin it for easy access

## Setup

1. Click the KnowledgeKeeper icon → sidebar opens
2. Go to the **Settings** tab
3. Paste your **Groq API Key** (free at [console.groq.com](https://console.groq.com))
4. Click **Save Settings**

> AI features (summaries, key points, chat) require the API key. Search and notes work without it.

## Usage

### Save a Page
- Click **Save Page** in the sidebar toolbar
- Page content is extracted and summarized automatically (requires API key)

### Get Key Points
- Click **Key Points** in the sidebar toolbar
- The extension reads the current page and saves 5–7 concise bullet points to your library
- Saved as a distinct **Key Points** card (purple badge) — viewable anytime

### Highlight Text
- Click **Highlight** to toggle highlight mode on the current page
- Select any text — it saves automatically with your chosen color
- Click the color swatch next to the button to change highlight color

### Add Notes
- Click **Note** to write a standalone note attached to the current page
- Or hover any saved item → click the ✏️ icon to annotate it
- Press `Ctrl + Enter` inside the note modal to save quickly

### AI Chat
- Switch to the **AI Chat** tab
- Ask anything, e.g. *"What were the key ideas from articles I saved this week?"*
- Uses semantic search to find the most relevant saved items as context
- Quick-prompt chips available for common queries

### Semantic Search
- Type in the search bar at the top — results are ranked by TF-IDF relevance
- Works entirely offline, no API key needed

### Dark / Light Mode
- Click the **sun / moon icon** in the top-right header to toggle themes
- Preference is saved and restored automatically each time you open the sidebar

### Context Menu
- Right-click anywhere on a page → **Save to KnowledgeKeeper** to save the full page
- Right-click selected text → **Save to KnowledgeKeeper** to save the selection as a highlight

## File Structure

```
knowledgekeeper_v2/
├── manifest.json       # Chrome MV3 extension config
├── background.js       # Service worker: icon click, context menus, Groq API proxy
├── content.js          # Injected into pages: highlighting, text extraction, toasts
├── content.css         # Styles for highlights injected into pages
├── sidebar.html        # Sidebar UI (HTML + CSS only)
├── sidebar.js          # All sidebar logic: storage, search, Groq, UI, theming
├── README.md
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Privacy & Data

- All saved items are stored in **localStorage** — private to your browser profile
- No data leaves your machine except Groq API calls (page text is sent for AI features)
- Your Groq API key is stored in localStorage — this extension is for personal use only
- Use **Clear All Data** in Settings to wipe everything

## After Making Changes (Dev)

| Changed file | Action needed |
|---|---|
| `manifest.json` | Full extension reload at `chrome://extensions/` |
| `background.js` | Extension reload at `chrome://extensions/` |
| `sidebar.html` / `sidebar.js` | Close and reopen the sidebar |
| `content.js` / `content.css` | Reload the target page |
