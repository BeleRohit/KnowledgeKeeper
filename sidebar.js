// ═══════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════
const STORAGE_KEY = "kk_items";
const SETTINGS_KEY = "kk_settings";

function getAllItems() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveItemToStorage(item) {
  const items = getAllItems();
  item.id = item.id || ("kk_" + Date.now() + "_" + Math.random().toString(36).slice(2,7));
  item.timestamp = item.timestamp || Date.now();
  items.unshift(item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  return item;
}
function deleteItemFromStorage(id) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getAllItems().filter(i => i.id !== id)));
}
function updateItemInStorage(id, updates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getAllItems().map(i => i.id === id ? Object.assign({}, i, updates) : i)));
}
function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; }
}
function saveSettingsToStorage(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({}, getSettings(), s)));
}
function getStats() {
  const items = getAllItems();
  return { total: items.length, pages: items.filter(i=>i.type==="page").length, highlights: items.filter(i=>i.type==="highlight").length };
}

// ═══════════════════════════════════════════
// SEMANTIC SEARCH (TF-IDF)
// ═══════════════════════════════════════════
const STOPWORDS = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was","were","be","been","have","has","had","do","does","did","this","that","it","its","they","we","you","he","she","i","my","not","no","so","as"]);

function tokenize(text) {
  return (text||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w=>w.length>2&&!STOPWORDS.has(w));
}
function semanticSearch(query, items, topK) {
  if (!items.length) return [];
  topK = topK || 8;
  const docs = items.map(i => [i.title||"", i.text||"", i.note||"", i.summary||""].join(" "));
  const allDocs = docs.concat([query]);
  const N = allDocs.length;
  const df = {};
  const tfVecs = allDocs.map(doc => {
    const tokens = tokenize(doc);
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t]||0)+1; });
    const mx = Math.max(...Object.values(tf).concat([1]));
    Object.keys(tf).forEach(t => { tf[t] /= mx; });
    return tf;
  });
  tfVecs.forEach(tf => { Object.keys(tf).forEach(t => { df[t] = (df[t]||0)+1; }); });
  const tfidfVecs = tfVecs.map(tf => {
    const v = {};
    Object.keys(tf).forEach(t => { v[t] = tf[t] * Math.log((N+1)/(df[t]+1)); });
    return v;
  });
  const qv = tfidfVecs[tfidfVecs.length-1];
  return items.map((item,idx) => {
    const dv = tfidfVecs[idx];
    let dot=0, na=0, nb=0;
    Object.keys(qv).forEach(k => { dot += (qv[k]||0)*(dv[k]||0); na += qv[k]**2; });
    Object.values(dv).forEach(v => { nb += v**2; });
    const score = (Math.sqrt(na)*Math.sqrt(nb)) === 0 ? 0 : dot/(Math.sqrt(na)*Math.sqrt(nb));
    return { item, score };
  }).sort((a,b)=>b.score-a.score).slice(0,topK).filter(r=>r.score>0.01).map(r=>r.item);
}

// ═══════════════════════════════════════════
// GROQ API
// ═══════════════════════════════════════════
async function groqRequest(apiKey, messages, systemPrompt) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt||"You are a helpful knowledge assistant." }].concat(messages),
      temperature: 0.6, max_tokens: 1024
    })
  });
  if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || "Groq error"); }
  const data = await resp.json();
  return data.choices[0].message.content;
}

// ═══════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function timeAgo(ts) {
  const m = Math.floor((Date.now()-ts)/60000);
  if (m<1) return "just now"; if (m<60) return m+"m ago";
  const h = Math.floor(m/60); if (h<24) return h+"h ago";
  return Math.floor(h/24)+"d ago";
}
function tryDomain(url) {
  try { return new URL(url).hostname.replace("www.",""); } catch { return url||""; }
}
function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active:true, currentWindow:true }, tabs => resolve(tabs[0] || null));
  });
}
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({ target:{ tabId }, files:["content.js"] });
  await chrome.scripting.insertCSS({ target:{ tabId }, files:["content.css"] });
}
function getPageContent() {
  return new Promise(async (resolve) => {
    const tab = await getActiveTab();
    if (!tab) { resolve(null); return; }
    chrome.tabs.sendMessage(tab.id, { type:"EXTRACT_CONTENT" }, async (resp) => {
      if (chrome.runtime.lastError) {
        try {
          await injectContentScript(tab.id);
          chrome.tabs.sendMessage(tab.id, { type:"EXTRACT_CONTENT" }, (resp2) => {
            if (chrome.runtime.lastError) { resolve(null); return; }
            resolve(resp2);
          });
        } catch(e) { resolve(null); }
        return;
      }
      resolve(resp);
    });
  });
}
function sendToActiveTab(msg) {
  getActiveTab().then(tab => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, msg, async () => {
      if (chrome.runtime.lastError) {
        try {
          await injectContentScript(tab.id);
          chrome.tabs.sendMessage(tab.id, msg);
        } catch(e) {}
      }
    });
  });
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function renderItems(query) {
  query = query || "";
  const all = getAllItems();
  const items = query ? semanticSearch(query, all, 20) : all;
  const list = document.getElementById("itemsList");
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><p class="empty-title">'+(query?"No results":"Library empty")+'</p><p class="empty-sub">'+(query?"Nothing matched your search.":"Save pages, highlights, or notes to get started.")+'</p></div>';
    return;
  }
  const badgeCls = { page:"badge-page", highlight:"badge-highlight", note:"badge-note", keypoints:"badge-keypoints", youtube:"badge-youtube" };
  const badgeLbl = { page:"Page", highlight:"Highlight", note:"Note", keypoints:"Key Points", youtube:"YouTube" };
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "item-card";

    // Build text block — keypoints get a bullet list; others get plain preview
    let textBlock;
    if (item.type === "keypoints") {
      const points = (item.text || "").split("\n").filter(l => l.trim().startsWith("•"));
      const visible = points.slice(0, 4);
      const extra = points.length - visible.length;
      textBlock =
        '<ul class="card-keypoints">' +
          visible.map(p => '<li>' + escHtml(p.replace(/^•\s*/, "")) + '</li>').join("") +
          (extra > 0 ? '<li class="kp-more">+' + extra + ' more…</li>' : '') +
        '</ul>';
    } else {
      const textPreview = escHtml((item.text||item.note||"").slice(0,200));
      textBlock = '<div class="card-text'+(item.type==="highlight"?" highlight-text":"")+'"'+(item.type==="highlight"&&item.color?' style="border-color:'+item.color+'"':'')+'>'+textPreview+'</div>';
    }

    card.innerHTML =
      '<div class="card-actions">' +
        (item.type==="page" ? '<button class="card-action-btn" data-action="keypoints" data-id="'+item.id+'" title="Key points"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg></button>' : '') +
        '<button class="card-action-btn" data-action="note" data-id="'+item.id+'" title="Add note"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
        '<button class="card-action-btn del" data-action="delete" data-id="'+item.id+'" title="Delete"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' +
      '</div>' +
      '<div class="card-top">' +
        (item.favicon ? '<img class="card-favicon" src="'+escHtml(item.favicon)+'" onerror="this.style.display=\'none\'" />' : '') +
        '<span class="card-title">'+escHtml(item.title||"Untitled")+'</span>' +
        '<span class="card-type-badge '+(badgeCls[item.type]||"")+'">'+escHtml(badgeLbl[item.type]||item.type)+'</span>' +
      '</div>' +
      textBlock +
      (item.summary ? '<div class="card-summary">'+escHtml(item.summary)+'</div>' : '') +
      (item.outline ?
        '<button class="card-outline-toggle" data-id="'+item.id+'">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
          '<span>Show outline</span>' +
        '</button>' +
        '<div class="card-outline" id="outline-'+item.id+'">'+renderOutline(item.outline)+'</div>'
      : '') +
      (item.note ? '<div class="card-note">📝 '+escHtml(item.note)+'</div>' : '') +
      '<div class="card-meta"><span class="card-url">'+escHtml(tryDomain(item.url))+'</span><span class="card-time">'+timeAgo(item.timestamp)+'</span></div>';

    card.addEventListener("click", e => {
      if (e.target.closest(".card-action-btn")) return;
      if (e.target.closest(".card-outline-toggle")) return;
      if (e.target.closest(".card-outline")) return;
      if (item.url) chrome.tabs.create({ url: item.url });
    });

    const outlineToggle = card.querySelector(".card-outline-toggle");
    if (outlineToggle) {
      outlineToggle.addEventListener("click", e => {
        e.stopPropagation();
        const outlineDiv = document.getElementById("outline-" + item.id);
        const isOpen = outlineDiv.classList.toggle("open");
        outlineToggle.classList.toggle("open", isOpen);
        outlineToggle.querySelector("span").textContent = isOpen ? "Hide outline" : "Show outline";
      });
    }

    card.querySelectorAll(".card-action-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        const it = getAllItems().find(x => x.id === id);
        if (action==="delete") { deleteItemFromStorage(id); renderItems(document.getElementById("searchInput").value.trim()); updateStats(); showToast("Deleted"); }
        if (action==="note" && it) openNoteModal(id, it);
        if (action==="keypoints" && it) showKeypoints(id, it);
      });
    });
    list.appendChild(card);
  });
}

function updateStats() {
  const s = getStats();
  document.getElementById("statTotal").textContent = s.total;
  document.getElementById("statPages").textContent = s.pages;
  document.getElementById("statHighlights").textContent = s.highlights;
}

// ═══════════════════════════════════════════
// NOTE MODAL
// ═══════════════════════════════════════════
let currentNoteId = null;
function openNoteModal(id, item) {
  currentNoteId = id;
  document.getElementById("noteModalTitle").textContent = "Edit Note";
  document.getElementById("noteText").value = item.note || "";
  document.getElementById("noteModal").classList.remove("hidden");
  document.getElementById("noteText").focus();
}
function saveNote() {
  const text = document.getElementById("noteText").value.trim();
  if (!text) return;
  if (currentNoteId) {
    updateItemInStorage(currentNoteId, { note: text });
    renderItems(document.getElementById("searchInput").value.trim());
  } else {
    getPageContent().then(page => {
      saveItemToStorage({ type:"note", note:text, text:text, title:page?.title||"Note", url:page?.url||"", favicon:page?.favicon||"" });
      renderItems(); updateStats();
    });
  }
  document.getElementById("noteModal").classList.add("hidden");
  showToast("Note saved ✓");
}

// ═══════════════════════════════════════════
// KEY POINTS (inline outline on card)
// ═══════════════════════════════════════════
async function showKeypoints(id, item) {
  const { apiKey } = getSettings();
  if (!apiKey) { showToast("Add Groq API key in Settings first"); return; }

  // Show spinner on the card button while fetching
  const btn = document.querySelector(`.card-action-btn[data-action="keypoints"][data-id="${id}"]`);
  if (btn) {
    btn.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>';
    btn.disabled = true;
  }

  try {
    const outline = await groqRequest(
      apiKey,
      [{ role:"user", content:
        "Create a structured outline for the following page.\n" +
        "Use 2-4 sections with a heading (## Heading) and 2-4 bullet points each (• point).\n\n" +
        "Title: " + item.title + "\n\n" + (item.text||item.summary||"").slice(0, 5000)
      }],
      "Return only the outline. Format: ## Section Heading on its own line, then • bullet points. No intro or conclusion text."
    );
    updateItemInStorage(id, { outline });
    renderItems(document.getElementById("searchInput").value.trim());
    showToast("Outline saved ✓");
  } catch(e) {
    showToast("Error: " + e.message);
    // Restore button if render didn't happen
    if (btn) {
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>';
      btn.disabled = false;
    }
  }
}

function renderOutline(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  let html = "";
  let heading = "";
  let points = [];

  function flushSection() {
    if (!heading && !points.length) return;
    html += '<div class="outline-section">';
    if (heading) html += '<div class="outline-heading">' + escHtml(heading) + '</div>';
    if (points.length) html += '<ul class="outline-points">' + points.map(p => '<li>' + escHtml(p) + '</li>').join("") + '</ul>';
    html += '</div>';
    heading = ""; points = [];
  }

  lines.forEach(line => {
    if (line.startsWith("##")) {
      flushSection();
      heading = line.replace(/^#+\s*/, "");
    } else if (line.startsWith("•") || line.startsWith("-")) {
      points.push(line.replace(/^[•\-]\s*/, ""));
    }
  });
  flushSection();
  return html || '<p style="color:var(--text3);font-size:11px;padding:2px 0">No outline data.</p>';
}

// ═══════════════════════════════════════════
// YOUTUBE NOTES
// ═══════════════════════════════════════════
function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0];
  } catch {}
  return null;
}

function setYtStatus(msg) {
  const el = document.getElementById("ytStatus");
  if (!msg) { el.style.display = "none"; return; }
  el.style.display = "flex";
  el.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:1.5px;flex-shrink:0"></span>' + escHtml(msg);
}

async function generateYoutubeNotes(videoUrl) {
  const { apiKey } = getSettings();
  if (!apiKey) { showToast("Add Groq API key in Settings first"); return; }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) { showToast("Invalid YouTube URL"); return; }

  const btn = document.getElementById("ytModalGenerate");
  btn.disabled = true;

  try {
    setYtStatus("Extracting transcript…");
    let transcript, title, itemUrl = videoUrl;

    const tab = await getActiveTab();
    const tabVideoId = tab?.url ? extractVideoId(tab.url) : null;

    if (tabVideoId === videoId) {
      // On the YouTube tab — content script fetches transcript with session cookies
      const res = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_YOUTUBE_TRANSCRIPT" }, r => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(r || { error: "No response from content script" });
        });
      });
      if (res && !res.error) { transcript = res.transcript; title = res.title; itemUrl = res.url; }
    }

    if (!transcript) {
      // Fallback (paste URL path): background fetches the YouTube page to get caption URL,
      // then fetches the transcript XML — works for most public videos
      setYtStatus("Fetching page data…");
      const pageRes = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "FETCH_YOUTUBE_PAGE", videoId }, r => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(r || { error: "No response" });
        });
      });
      if (pageRes?.error) throw new Error(pageRes.error);
      title = title || pageRes.title;
      itemUrl = "https://www.youtube.com/watch?v=" + videoId;

      setYtStatus("Fetching transcript…");
      const transcriptRes = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "FETCH_TRANSCRIPT", transcriptUrl: pageRes.transcriptUrl }, r => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(r || { error: "No response" });
        });
      });
      if (transcriptRes?.error) throw new Error(transcriptRes.error);
      transcript = transcriptRes.transcript;
    }

    // Step 3: Generate structured notes via Groq
    setYtStatus("Generating notes…");
    const notes = await groqRequest(
      apiKey,
      [{ role: "user", content:
        "Generate comprehensive structured notes for this YouTube video.\n\n" +
        "Title: " + title + "\n\n" +
        "Transcript:\n" + transcript.slice(0, 6000)
      }],
      "Return structured notes in this exact format:\n\n" +
      "## Overview\n" +
      "2-3 sentences summarizing the video.\n\n" +
      "## Key Concepts\n" +
      "• concept with brief explanation\n\n" +
      "## Detailed Notes\n" +
      "### Subtopic Title\n" +
      "• point\n\n" +
      "## Key Takeaways\n" +
      "• actionable or memorable point\n\n" +
      "Be thorough but concise. Use bullet points. No filler text."
    );

    // Extract Overview section as the card summary
    const overviewMatch = notes.match(/##\s*Overview\s*\n([\s\S]*?)(?=\n##|$)/i);
    const summary = overviewMatch ? overviewMatch[1].replace(/^•\s*/gm, "").trim() : notes.slice(0, 300);

    saveItemToStorage({
      type: "youtube",
      title,
      url: itemUrl,
      favicon: "https://www.youtube.com/favicon.ico",
      text: transcript.slice(0, 8000),
      summary,
      outline: notes
    });

    renderItems(); updateStats();
    document.getElementById("ytModal").classList.add("hidden");
    showToast("YouTube notes saved ✓");
    document.querySelector('[data-tab="library"]').click();

  } catch(e) {
    setYtStatus("");
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
    setYtStatus("");
  }
}

// ═══════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════
async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const query = input.value.trim();
  if (!query) return;
  const { apiKey } = getSettings();
  if (!apiKey) { appendChatMsg("system-msg","Please add your Groq API key in Settings first."); return; }
  input.value = "";
  appendChatMsg("user", query);
  const relevant = semanticSearch(query, getAllItems(), 5);
  const context = relevant.slice(0,5).map((it,i)=>
    "["+(i+1)+"] "+it.title+"\n"+(it.text||it.summary||"").slice(0,600)
  ).join("\n\n---\n\n");
  const aiMsg = appendChatMsg("assistant", "⏳ Thinking…");
  try {
    const answer = await groqRequest(apiKey,
      [{ role:"user", content:'Answer this: "'+query+'"\n\nContext:\n'+context }],
      "You are a personal knowledge assistant. Answer based on context provided. If the answer isn't in the context, say so."
    );
    aiMsg.textContent = answer;
  } catch(e) {
    aiMsg.textContent = "Error: "+e.message;
    aiMsg.style.color = "var(--red)";
  }
  document.getElementById("chatMessages").scrollTop = 99999;
}
function appendChatMsg(cls, text) {
  const msgs = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "chat-msg "+cls;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function applyTheme(isLight) {
  document.body.classList.toggle("light", isLight);
  document.getElementById("themeIconSun").style.display  = isLight ? "none"  : "";
  document.getElementById("themeIconMoon").style.display = isLight ? ""      : "none";
}

document.addEventListener("DOMContentLoaded", () => {
  renderItems();
  updateStats();

  const { apiKey, lightMode } = getSettings();
  if (apiKey) document.getElementById("apiKeyInput").value = apiKey;
  applyTheme(!!lightMode);

  // Theme toggle
  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const isLight = !document.body.classList.contains("light");
    applyTheme(isLight);
    saveSettingsToStorage({ lightMode: isLight });
  });

  // Tab switching
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const name = tab.dataset.tab;
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      document.getElementById(name+"Panel").classList.add("active");
      document.getElementById("libraryToolbar").style.display = name==="library" ? "flex" : "none";
      document.querySelector(".search-wrap").style.display = name==="settings" ? "none" : "block";
    });
  });

  // Settings btn → jump to settings tab
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.querySelector('[data-tab="settings"]').click();
  });

  // Search
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderItems(e.target.value.trim()), 250);
  });

  // Save page
  document.getElementById("savePageBtn").addEventListener("click", async () => {
    const btn = document.getElementById("savePageBtn");
    btn.textContent = "Saving…"; btn.disabled = true;
    try {
      const page = await getPageContent();
      if (!page) { showToast("Can't save this page (try a regular website)"); return; }
      const item = saveItemToStorage({ type:"page", text:page.text, title:page.title, url:page.url, favicon:page.favicon });
      const { apiKey } = getSettings();
      if (apiKey) {
        try {
          const summary = await groqRequest(apiKey,
            [{ role:"user", content:"Summarize in 3-4 sentences:\n\nTitle: "+page.title+"\n\n"+page.text.slice(0,4000) }],
            "Return only the summary, no preamble."
          );
          updateItemInStorage(item.id, { summary });
        } catch(e) { console.warn("Summary failed", e); }
      }
      renderItems(); updateStats();
      showToast("Page saved ✓");
    } catch(e) { showToast("Error: "+e.message); }
    finally { btn.textContent = "Save Page"; btn.disabled = false; }
  });

  // Highlight toggle
  let hlMode = false;
  document.getElementById("highlightToggleBtn").addEventListener("click", () => {
    hlMode = !hlMode;
    document.getElementById("highlightToggleBtn").classList.toggle("hl-active", hlMode);
    sendToActiveTab({ type:"TOGGLE_HIGHLIGHT_MODE", enabled: hlMode });
  });

  // Color picker
  document.getElementById("colorSwatch").addEventListener("click", () => document.getElementById("colorPicker").click());
  document.getElementById("colorPicker").addEventListener("input", e => {
    document.getElementById("colorSwatch").style.background = e.target.value;
    sendToActiveTab({ type:"SET_HIGHLIGHT_COLOR", color: e.target.value });
  });

  // Add note
  document.getElementById("addNoteBtn").addEventListener("click", () => {
    currentNoteId = null;
    document.getElementById("noteModalTitle").textContent = "Add Note";
    document.getElementById("noteText").value = "";
    document.getElementById("noteModal").classList.remove("hidden");
    document.getElementById("noteText").focus();
  });

  // Note modal
  document.getElementById("noteCancel").addEventListener("click", () => document.getElementById("noteModal").classList.add("hidden"));
  document.getElementById("noteSave").addEventListener("click", saveNote);
  document.getElementById("noteText").addEventListener("keydown", e => { if (e.key==="Enter"&&e.ctrlKey) saveNote(); });

  // YouTube Notes button — pre-fill URL if already on a YouTube video tab
  document.getElementById("youtubeNotesBtn").addEventListener("click", async () => {
    const tab = await getActiveTab();
    const ytUrl = tab?.url && extractVideoId(tab.url) ? tab.url : "";
    document.getElementById("ytUrlInput").value = ytUrl;
    setYtStatus("");
    document.getElementById("ytModalGenerate").disabled = false;
    document.getElementById("ytModal").classList.remove("hidden");
    if (!ytUrl) document.getElementById("ytUrlInput").focus();
  });

  // YouTube modal handlers
  document.getElementById("ytModalCancel").addEventListener("click", () => {
    document.getElementById("ytModal").classList.add("hidden");
    setYtStatus("");
  });
  document.getElementById("ytModalGenerate").addEventListener("click", () => {
    const url = document.getElementById("ytUrlInput").value.trim();
    if (!url) { showToast("Please enter a YouTube URL"); return; }
    generateYoutubeNotes(url);
  });
  document.getElementById("ytUrlInput").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("ytModalGenerate").click();
  });

  // Settings save
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    saveSettingsToStorage({ apiKey: document.getElementById("apiKeyInput").value.trim() });
    showToast("Settings saved ✓"); updateStats();
  });

  // Clear all
  document.getElementById("clearAllBtn").addEventListener("click", () => {
    if (confirm("Delete ALL saved items?")) {
      localStorage.removeItem(STORAGE_KEY);
      renderItems(); updateStats(); showToast("Cleared");
    }
  });

  // AI Chat
  document.getElementById("sendBtn").addEventListener("click", sendChatMessage);
  document.getElementById("chatInput").addEventListener("keydown", e => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
  document.querySelectorAll(".quick-prompt").forEach(btn => {
    btn.addEventListener("click", () => { document.getElementById("chatInput").value = btn.dataset.prompt; sendChatMessage(); });
  });

  // Listen for content script saves
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type==="SIDEBAR_ADD_ITEM") { saveItemToStorage(msg.item); renderItems(); updateStats(); }
  });
});
