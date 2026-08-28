// popup.js — StealthAI v1.0.7

const activateView   = document.getElementById("activate-view");
const activatedView  = document.getElementById("activated-view");
const keyInput       = document.getElementById("key-input");
const activateBtn    = document.getElementById("activate-btn");
const statusEl       = document.getElementById("status");
const keyDisplay     = document.getElementById("key-display");
const clearBtn       = document.getElementById("clear-btn");
const camoToggle     = document.getElementById("camo-toggle");
const bindCapture      = document.getElementById("bind-capture");
const bindPrompt       = document.getElementById("bind-prompt");
const bindCaptureClr   = document.getElementById("bind-capture-clear");
const bindPromptClr    = document.getElementById("bind-prompt-clear");
const displayCapture   = document.getElementById("display-capture");
const displayPrompt    = document.getElementById("display-prompt");

// -- VERSION CHECK ------------------------------------------------------------
const VERSION_SERVER = "https://stealthai-license.vercel.app/api/version";
const INSTALLED_VER  = chrome.runtime.getManifest().version;

const updateBanner   = document.getElementById("update-banner");
const updateVersion  = document.getElementById("update-version");
const updateChangelog= document.getElementById("update-changelog");
const updateBtn      = document.getElementById("update-btn");

function compareVersions(a, b) {
  // Returns true if b > a (b is newer)
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (nb > na) return true;
    if (nb < na) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const resp = await fetch(VERSION_SERVER + "?v=" + Date.now());
    if (!resp.ok) return;
    let data;
    try { data = await resp.json(); } catch(e) { return; }
    if (!data?.version) return;
    if (compareVersions(INSTALLED_VER, data.version)) {
      updateVersion.textContent   = "v" + INSTALLED_VER + " → v" + data.version;
      updateChangelog.textContent = data.changelog || "A new version is available.";
      updateBanner.classList.add("visible");
    }
  } catch(e) { /* network unavailable */ }
}

updateBtn.addEventListener("click", () => {
  // Open the purchase/forum thread where they get updates
  chrome.tabs.create({ url: "https://whop.com" });
});

// -- LOAD SETTINGS ------------------------------------------------------------
chrome.runtime.sendMessage({ type: "GET_LICENSE" }, (res) => {
  if (res?.valid) {
    showActivated(res.key);
    checkForUpdate(); // run after view is visible so banner shows
  }
});

chrome.storage.local.get(["camouflage", "keybind_capture", "keybind_prompt"], (res) => {
  camoToggle.checked = res.camouflage === true;
  if (res.keybind_capture) renderBind(bindCapture, displayCapture, res.keybind_capture);
  if (res.keybind_prompt)  renderBind(bindPrompt,  displayPrompt,  res.keybind_prompt);
});

// -- KEYBIND RECORDER ---------------------------------------------------------
function bindLabel(bind) {
  if (!bind) return "Default";
  const parts = [];
  if (bind.ctrl)  parts.push("Ctrl");
  if (bind.shift) parts.push("Shift");
  if (bind.alt)   parts.push("Alt");
  parts.push(bind.key.toUpperCase());
  return parts.join("+");
}

function renderBind(el, displayEl, bind) {
  el.textContent = bind ? bindLabel(bind) : "Default";
  if (displayEl && bind) {
    const parts = bindLabel(bind).split("+");
    displayEl.innerHTML = parts.map((p, i) =>
      `<span class="kbd">${p}</span>${i < parts.length - 1 ? '<span class="kbd-sep">+</span>' : ''}`
    ).join("");
  } else if (displayEl) {
    // Restore default display
    const id = displayEl.id;
    if (id === "display-capture") {
      displayEl.innerHTML = '<span class="kbd">Ctrl</span><span class="kbd-sep">+</span><span class="kbd">Shift</span><span class="kbd-sep">+</span><span class="kbd">Z</span>';
    } else {
      displayEl.innerHTML = '<span class="kbd">Ctrl</span><span class="kbd-sep">+</span><span class="kbd">Shift</span><span class="kbd-sep">+</span><span class="kbd">A</span>';
    }
  }
}

// Track which element is currently recording globally
let activeRecorder = null;

function bindMatches(a, b) {
  if (!a || !b) return false;
  return a.ctrl  === b.ctrl  && a.shift === b.shift &&
         a.alt   === b.alt   && a.key.toUpperCase() === b.key.toUpperCase();
}

// Global keydown: catches key presses even when div loses focus
document.addEventListener("keydown", (e) => {
  if (!activeRecorder) return;
  if (["Control","Shift","Alt","Meta"].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();

  const { el, displayEl, storageKey, otherKey, otherEl, otherDisplayEl } = activeRecorder;
  activeRecorder = null;
  el.classList.remove("recording");

  const bind = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key };

  // Clear the OTHER keybind if it conflicts with this one
  chrome.storage.local.get([otherKey], (res) => {
    const other = res[otherKey];
    if (bindMatches(bind, other)) {
      chrome.storage.local.remove(otherKey);
      renderBind(otherEl, otherDisplayEl, null);
    }
    chrome.storage.local.set({ [storageKey]: bind });
    renderBind(el, displayEl, bind);
  });
}, true);

function setupKeybindRecorder(el, displayEl, storageKey, otherKey, otherEl, otherDisplayEl) {
  el.addEventListener("click", () => {
    // Cancel any other active recorder first
    if (activeRecorder && activeRecorder.el !== el) {
      activeRecorder.el.classList.remove("recording");
      chrome.storage.local.get([activeRecorder.storageKey], (res) => {
        renderBind(activeRecorder.el, activeRecorder.displayEl, res[activeRecorder.storageKey] || null);
      });
    }
    activeRecorder = { el, displayEl, storageKey, otherKey, otherEl, otherDisplayEl };
    el.classList.add("recording");
    el.textContent = "Press key combo...";
  });

  // Clicking elsewhere cancels recording
  document.addEventListener("mousedown", (e) => {
    if (activeRecorder?.el === el && e.target !== el) {
      activeRecorder = null;
      el.classList.remove("recording");
      chrome.storage.local.get([storageKey], (res) => {
        renderBind(el, displayEl, res[storageKey] || null);
      });
    }
  });
}

setupKeybindRecorder(bindCapture, displayCapture, "keybind_capture", "keybind_prompt", bindPrompt, displayPrompt);
setupKeybindRecorder(bindPrompt,  displayPrompt,  "keybind_prompt",  "keybind_capture", bindCapture, displayCapture);

bindCaptureClr.addEventListener("click", () => {
  chrome.storage.local.remove("keybind_capture");
  renderBind(bindCapture, displayCapture, null);
});
bindPromptClr.addEventListener("click", () => {
  chrome.storage.local.remove("keybind_prompt");
  renderBind(bindPrompt, displayPrompt, null);
});

// -- CAMOUFLAGE ---------------------------------------------------------------
camoToggle.addEventListener("change", () => {
  chrome.storage.local.set({ camouflage: camoToggle.checked });
});

// -- ACTIVATE -----------------------------------------------------------------
activateBtn.addEventListener("click", tryActivate);
keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryActivate(); });

function tryActivate() {
  const key = keyInput.value.trim();
  if (!key) { setStatus("Enter your license key.", "invalid"); return; }
  setStatus("Validating...", "pending");
  activateBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "VALIDATE_KEY", key }, (res) => {
    activateBtn.disabled = false;
    if (res?.valid) { showActivated(key.toUpperCase()); }
    else { setStatus("Invalid key: " + (res?.message || "unknown error"), "invalid"); }
  });
}

// -- CLEAR --------------------------------------------------------------------
clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_LICENSE" }, () => {
    activatedView.style.display = "none";
    activateView.style.display  = "block";
    keyInput.value = "";
    setStatus("", "");
  });
});

// -- HELPERS ------------------------------------------------------------------
function showActivated(key) {
  activateView.style.display  = "none";
  activatedView.style.display = "block";
  keyDisplay.textContent = key;
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = "status " + type;
}
