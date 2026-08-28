// background.js — StealthAI v1.0.7

const LICENSE_SERVER = "https://stealthai-license.vercel.app/api/validate";
const QUERY_SERVER   = "https://stealthai-license.vercel.app/api/query";

const PROMPT = (
  "You are an answer extractor. Rules (NEVER break them):\n" +
  "1. Reply with the answer ONLY. Maximum 8 words. Absolutely no exceptions.\n" +
  "2. No explanation, no steps, no working, no preamble, no punctuation at end.\n" +
  "3. Math: bare number or expression only. e.g. '42' or 'x=3' or '3/4'\n" +
  "4. Multiple choice: single letter only. e.g. 'B'\n" +
  "5. True/False: single word only. 'True' or 'False'\n" +
  "6. Fill-in-blank: the missing word(s) only.\n" +
  "7. Plain text only. No markdown, no LaTeX, no asterisks, no quotes."
);

// -- HOTKEYS ------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  const url = tab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") ||
      url.startsWith("about:")    || url.startsWith("edge://")) return;

  if (command === "activate") await injectAndSend(tab.id, "TOGGLE");
  if (command === "prompt")   await injectAndSend(tab.id, "SHOW_PROMPT");
});

async function injectAndSend(tabId, messageType) {
  // Read storage BEFORE injecting so there is no callback race
  const res = await chrome.storage.local.get(["camouflage", "keybind_capture", "keybind_prompt"]);

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (e) { return; }

  // Give the listener time to register
  await new Promise(r => setTimeout(r, 100));

  chrome.tabs.sendMessage(tabId, {
    type:           messageType,
    camo:           res.camouflage === true,
    keybindCapture: res.keybind_capture || null,
    keybindPrompt:  res.keybind_prompt  || null
  }, () => { void chrome.runtime.lastError; });
}

// -- LICENSE ------------------------------------------------------------------
async function validateKey(key) {
  try {
    const resp = await fetch(LICENSE_SERVER, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ key: key.trim().toUpperCase() })
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { valid: false, message: "Server error — check your connection." }; }
    return { valid: data.valid === true, message: data.message || "" };
  } catch (e) {
    return { valid: false, message: "Could not reach server — check your connection." };
  }
}

// -- MESSAGE HANDLER ----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "VALIDATE_KEY") {
    validateKey(msg.key).then((result) => {
      if (result.valid) {
        chrome.storage.local.set({
          license_key:   msg.key.trim().toUpperCase(),
          license_valid: true
        });
      }
      sendResponse(result);
    });
    return true;
  }

  if (msg.type === "QUERY_AI") {
    chrome.storage.local.get(["license_key", "camouflage"], async (res) => {
      const licenseKey = res.license_key || "";
      if (!licenseKey) {
        sendResponse({ answer: "No license key — open the extension popup to activate.", mode: "standard" });
        return;
      }
      try {
        const resp = await fetch(QUERY_SERVER, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            imageBase64:    msg.imageBase64,
            licenseKey,
            promptOverride: PROMPT,
          })
        });
        const data   = await resp.json();
        const answer = data.answer || data.error || "No response";
        sendResponse({ answer, mode: "standard", camo: res.camouflage === true });
      } catch (e) {
        sendResponse({ answer: "Error: " + e.message, mode: "standard" });
      }
    });
    return true;
  }

  if (msg.type === "QUERY_TEXT") {
    chrome.storage.local.get(["license_key", "camouflage"], async (res) => {
      const licenseKey = res.license_key || "";
      if (!licenseKey) {
        sendResponse({ answer: "No license key — open the extension popup to activate." });
        return;
      }
      try {
        const resp = await fetch(QUERY_SERVER, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            textQuery: msg.text,
            licenseKey
          })
        });
        const data   = await resp.json();
        const answer = data.answer || data.error || "No response";
        sendResponse({ answer, camo: res.camouflage === true });
      } catch (e) {
        sendResponse({ answer: "Error: " + e.message });
      }
    });
    return true;
  }

  if (msg.type === "GET_LICENSE") {
    chrome.storage.local.get(["license_key", "license_valid"], (res) => {
      sendResponse({ valid: res.license_valid || false, key: res.license_key || "" });
    });
    return true;
  }

  if (msg.type === "CLEAR_LICENSE") {
    chrome.storage.local.remove(["license_key", "license_valid"]);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CAPTURE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ dataUrl });
    });
    return true;
  }

});
