// content.js - Content Script

let isHighlightMode = false;
let highlightColor = "#FFE066";

// Listen for messages from background/sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_HIGHLIGHT_MODE") {
    isHighlightMode = message.enabled;
    document.body.style.cursor = isHighlightMode ? "crosshair" : "";
    showToast(isHighlightMode ? "Highlight mode ON — select text" : "Highlight mode OFF");
  }

  if (message.type === "SET_HIGHLIGHT_COLOR") {
    highlightColor = message.color;
  }

  if (message.type === "EXTRACT_CONTENT") {
    const content = extractPageContent();
    sendResponse(content);
    return true;
  }

  if (message.type === "SAVE_SELECTION") {
    saveItem({
      type: "highlight",
      text: message.text,
      url: message.url,
      title: message.title,
      color: highlightColor,
      timestamp: Date.now()
    });
    showToast("Saved to KnowledgeKeeper ✓");
  }

  if (message.type === "SAVE_PAGE") {
    const content = extractPageContent();
    saveItem({
      type: "page",
      text: content.text,
      url: message.url,
      title: message.title,
      favicon: getFavicon(),
      timestamp: Date.now()
    });
    showToast("Page saved to KnowledgeKeeper ✓");
  }

  if (message.type === "APPLY_STORED_HIGHLIGHTS") {
    applyStoredHighlights(message.highlights);
  }

  if (message.type === "EXTRACT_YOUTUBE_TRANSCRIPT") {
    // Fetch transcript HERE in the content script context so YouTube session
    // cookies are included — background service worker requests lack them.
    (async () => {
      try {
        const pr = window.ytInitialPlayerResponse;
        if (!pr) { sendResponse({ error: "No video data found. Make sure the video is fully loaded." }); return; }
        const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks?.length) { sendResponse({ error: "No captions available for this video." }); return; }

        const track = tracks.find(t => t.languageCode === "en") || tracks[0];
        const baseUrl = track.baseUrl;
        let transcript = "";

        // Try JSON format first (fmt=json3)
        try {
          const sep = baseUrl.includes("?") ? "&" : "?";
          const jsonResp = await fetch(baseUrl + sep + "fmt=json3");
          const data = await jsonResp.json();
          if (data.events?.length) {
            transcript = data.events
              .filter(e => e.segs)
              .flatMap(e => e.segs.map(s => (s.utf8 || "").replace(/\n/g, " ")))
              .join(" ")
              .replace(/\s{2,}/g, " ")
              .trim();
          }
        } catch(_) {}

        // XML fallback
        if (!transcript) {
          const xmlResp = await fetch(baseUrl);
          const xml = await xmlResp.text();
          const decode = s => s.replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"');
          let matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
          if (!matches.length) matches = [...xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)];
          transcript = matches.map(m => decode(m[1].replace(/<[^>]+>/g,"")).replace(/\n/g," ").trim()).filter(Boolean).join(" ");
        }

        if (!transcript) { sendResponse({ error: "Could not extract transcript text from captions." }); return; }

        sendResponse({
          transcript,
          title: pr.videoDetails?.title || document.title,
          videoId: pr.videoDetails?.videoId || "",
          url: location.href
        });
      } catch(e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

// Text selection handler for highlight mode
document.addEventListener("mouseup", () => {
  if (!isHighlightMode) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const selectedText = selection.toString().trim();
  if (selectedText.length < 3) return;

  highlightSelection(selection, selectedText);
  selection.removeAllRanges();
});

function highlightSelection(selection, text) {
  try {
    const range = selection.getRangeAt(0);
    const mark = document.createElement("mark");
    mark.className = "kk-highlight";
    mark.style.backgroundColor = highlightColor;
    mark.style.borderRadius = "2px";
    mark.style.padding = "1px 0";
    mark.dataset.kkId = Date.now().toString();

    range.surroundContents(mark);

    const item = {
      type: "highlight",
      text: text,
      url: location.href,
      title: document.title,
      color: highlightColor,
      timestamp: Date.now(),
      id: mark.dataset.kkId
    };

    saveItem(item);
    showToast("Highlighted & saved ✓");
  } catch (e) {
    // Complex range (cross-element) — just save text without DOM mark
    const item = {
      type: "highlight",
      text: text,
      url: location.href,
      title: document.title,
      color: highlightColor,
      timestamp: Date.now(),
      id: Date.now().toString()
    };
    saveItem(item);
    showToast("Saved (complex selection) ✓");
  }
}

function extractPageContent() {
  const article = document.querySelector("article") || document.body;
  const cloned = article.cloneNode(true);

  // Remove scripts, styles, navs
  ["script", "style", "nav", "footer", "header", "aside", "iframe"].forEach(tag => {
    cloned.querySelectorAll(tag).forEach(el => el.remove());
  });

  const text = cloned.innerText.replace(/\s+/g, " ").trim().slice(0, 8000);
  return {
    text,
    title: document.title,
    url: location.href,
    favicon: getFavicon(),
    metaDescription: document.querySelector('meta[name="description"]')?.content || ""
  };
}

function getFavicon() {
  const link = document.querySelector('link[rel~="icon"]');
  return link?.href || `${location.origin}/favicon.ico`;
}

function applyStoredHighlights(highlights) {
  // Re-apply visual highlights if on a matching page
  highlights
    .filter(h => h.url === location.href && h.type === "highlight")
    .forEach(h => {
      // Soft re-highlight via text search
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.includes(h.text.slice(0, 40))) {
          // Already highlighted, skip
          if (node.parentElement.classList.contains("kk-highlight")) continue;
          break;
        }
      }
    });
}

function saveItem(item) {
  chrome.runtime.sendMessage({ type: "SIDEBAR_ADD_ITEM", item });
}

function showToast(message) {
  const existing = document.getElementById("kk-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "kk-toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
    background: #0f0f0f; color: #fff; font-family: 'DM Sans', sans-serif;
    font-size: 13px; padding: 10px 16px; border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3); pointer-events: none;
    animation: kkSlideIn 0.2s ease; letter-spacing: 0.01em;
  `;

  const style = document.createElement("style");
  style.textContent = `@keyframes kkSlideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// Notify sidebar when page loads (to load relevant highlights)
window.addEventListener("load", () => {
  chrome.runtime.sendMessage({ type: "PAGE_LOADED", url: location.href, title: document.title });
});
