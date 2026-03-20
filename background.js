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
});

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
