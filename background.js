// background.js - Service Worker (plain, no ES modules)

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({ id: "saveSelection", title: "Save to KnowledgeKeeper", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "savePage", title: "Save this page", contexts: ["page"] });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveSelection") {
    chrome.tabs.sendMessage(tab.id, { type: "SAVE_SELECTION", text: info.selectionText, url: tab.url, title: tab.title });
  } else if (info.menuItemId === "savePage") {
    chrome.tabs.sendMessage(tab.id, { type: "SAVE_PAGE", url: tab.url, title: tab.title });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTENT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "EXTRACT_CONTENT" }, (response) => sendResponse(response));
      }
    });
    return true;
  }
  if (message.type === "GROQ_REQUEST") {
    fetchGroq(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.type === "FETCH_TRANSCRIPT") {
    fetchTranscript(message.transcriptUrl).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.type === "FETCH_YOUTUBE_PAGE") {
    fetchYoutubePage(message.videoId).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

function decodeEntities(str) {
  return str
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
}

async function fetchTranscript(url) {
  // Prefer JSON format — most reliable across all YouTube caption track types
  const jsonUrl = url.includes("fmt=") ? url : url + (url.includes("?") ? "&" : "?") + "fmt=json3";
  try {
    const jsonResp = await fetch(jsonUrl);
    if (jsonResp.ok) {
      const data = await jsonResp.json();
      if (data.events && data.events.length) {
        const transcript = data.events
          .filter(e => e.segs)
          .flatMap(e => e.segs.map(s => (s.utf8 || "").replace(/\n/g, " ")))
          .join(" ")
          .replace(/\s{2,}/g, " ")
          .trim();
        if (transcript) return { transcript };
      }
    }
  } catch (_) { /* fall through to XML */ }

  // Fallback: parse XML (two known tag formats)
  const resp = await fetch(url);
  const xml = await resp.text();

  // Format 1: <text start="…" dur="…">content</text>
  let matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  // Format 2: <p t="…" d="…">content</p>  (timedtext format 3)
  if (!matches.length) matches = [...xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)];

  if (!matches.length) throw new Error("No transcript text found. The video may not have captions in a supported format.");

  const transcript = matches
    .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, "")))
    .filter(Boolean)
    .join(" ");
  return { transcript };
}

async function fetchYoutubePage(videoId) {
  const resp = await fetch("https://www.youtube.com/watch?v=" + videoId, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  if (!resp.ok) throw new Error("Could not load YouTube page (status " + resp.status + ")");
  const html = await resp.text();

  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("Could not find video data on YouTube page.");

  // Walk bracket depth to extract the full JSON object
  let depth = 0, i = start + marker.length;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) break; }
  }
  const pr = JSON.parse(html.slice(start + marker.length, i + 1));

  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error("No captions available for this video.");
  const track = tracks.find(t => t.languageCode === "en") || tracks[0];
  return {
    transcriptUrl: track.baseUrl,
    title: pr.videoDetails?.title || "YouTube Video",
    lang: track.languageCode
  };
}

async function fetchGroq(payload) {
  const { apiKey, messages, systemPrompt } = payload;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt || "You are a helpful knowledge assistant." }, ...messages],
      temperature: 0.7, max_tokens: 1024
    })
  });
  if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || "Groq API error"); }
  const data = await resp.json();
  return { result: data.choices[0].message.content };
}
