// content.js — StealthAI v1.0.7

// Re-injection safe: always remove old listener before registering fresh one.
if (window.__stealthai_listener) {
  chrome.runtime.onMessage.removeListener(window.__stealthai_listener);
  window.__stealthai_listener = null;
}
if (window.__stealthai_keydown) {
  document.removeEventListener("keydown", window.__stealthai_keydown);
  window.__stealthai_keydown = null;
}

let state         = "idle";
let overlay       = null;
let answerBox     = null;
let loadingBox    = null;
let selectionRect = null;
let promptBox     = null;
let currentCamo   = false;
let startX = 0, startY = 0, endX = 0, endY = 0;

// Custom keybinds (loaded from storage on inject, updated on each TOGGLE/SHOW_PROMPT)
let keybindCapture = null;
let keybindPrompt  = null;

chrome.storage.local.get(["keybind_capture", "keybind_prompt", "camouflage"], (res) => {
  keybindCapture = res.keybind_capture || null;
  keybindPrompt  = res.keybind_prompt  || null;
  currentCamo    = res.camouflage === true;
});

// -- CUSTOM KEYBIND LISTENER --------------------------------------------------
function matchBind(e, bind) {
  if (!bind) return false;
  return (
    e.ctrlKey  === !!bind.ctrl  &&
    e.shiftKey === !!bind.shift &&
    e.altKey   === !!bind.alt   &&
    e.key.toUpperCase() === bind.key.toUpperCase()
  );
}

window.__stealthai_keydown = function(e) {
  // Only act on custom binds — manifest commands handled by background.js
  if (keybindCapture && matchBind(e, keybindCapture)) {
    e.preventDefault();
    doToggle(currentCamo);
  } else if (keybindPrompt && matchBind(e, keybindPrompt)) {
    e.preventDefault();
    doShowPrompt(currentCamo);
  } else if (e.key === "Escape") {
    if (state === "showing" || state === "loading") dismissAll();
    if (promptBox) dismissPrompt();
  }
};
document.addEventListener("keydown", window.__stealthai_keydown);

// -- MESSAGE LISTENER ---------------------------------------------------------
window.__stealthai_listener = function(msg, sender, sendResponse) {
  if (msg.type === "TOGGLE") {
    // Update keybinds/camo from message payload
    if (msg.keybindCapture !== undefined) keybindCapture = msg.keybindCapture;
    if (msg.keybindPrompt  !== undefined) keybindPrompt  = msg.keybindPrompt;
    if (msg.camo           !== undefined) currentCamo    = msg.camo;
    try { doToggle(currentCamo); } catch(e) {}
    return false;
  }
  if (msg.type === "SHOW_PROMPT") {
    if (msg.camo !== undefined) currentCamo = msg.camo;
    try { doShowPrompt(currentCamo); } catch(e) {}
    return false;
  }
  return false;
};
chrome.runtime.onMessage.addListener(window.__stealthai_listener);

// -- TOGGLE (capture flow) ----------------------------------------------------
function doToggle(camo) {
  if (promptBox) dismissPrompt();
  dismissAll();
  startSelector(camo);
}

// -- SELECTOR -----------------------------------------------------------------
function startSelector(camo) {
  currentCamo = !!camo;
  state = "selecting";
  startX = startY = endX = endY = 0;

  overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", top: "0", left: "0",
    width: "100vw", height: "100vh",
    zIndex: "2147483647", cursor: "crosshair",
    background: "transparent", userSelect: "none"
  });

  selectionRect = document.createElement("div");
  if (currentCamo) {
    Object.assign(selectionRect.style, {
      position: "fixed", display: "none", zIndex: "2147483647",
      pointerEvents: "none",
      border: "1px solid rgba(120,120,120,0.5)",
      background: "rgba(80,80,80,0.07)"
    });
  } else {
    Object.assign(selectionRect.style, {
      position: "fixed", display: "none", zIndex: "2147483647",
      pointerEvents: "none",
      border: "1px solid rgba(167,139,250,0.9)",
      outline: "1px solid rgba(76,29,149,0.5)",
      background: "rgba(124,58,237,0.12)",
      boxShadow: "0 0 0 1px rgba(124,58,237,0.2) inset"
    });
  }

  document.body.appendChild(overlay);
  document.body.appendChild(selectionRect);

  overlay.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup",   onMouseUp);
  document.addEventListener("keydown",   onEscDuringSel, { once: true });
}

function onEscDuringSel(e) { if (e.key === "Escape") dismissAll(); }

function onMouseDown(e) {
  e.preventDefault();
  startX = e.clientX; startY = e.clientY;
  selectionRect.style.display = "block";
}

function onMouseMove(e) {
  if (state !== "selecting" || !startX) return;
  endX = e.clientX; endY = e.clientY;
  const x = Math.min(startX, endX), y = Math.min(startY, endY);
  Object.assign(selectionRect.style, {
    left: x + "px", top: y + "px",
    width:  Math.abs(endX - startX) + "px",
    height: Math.abs(endY - startY) + "px"
  });
}

function onMouseUp(e) {
  if (state !== "selecting") return;
  endX = e.clientX; endY = e.clientY;
  if (Math.abs(endX - startX) < 20 || Math.abs(endY - startY) < 20) {
    dismissAll(); return; // min 20x20px
  }
  captureAndQuery();
}

// -- CAPTURE ------------------------------------------------------------------
async function captureAndQuery() {
  if (overlay)       { overlay.remove();       overlay       = null; }
  if (selectionRect) { selectionRect.remove();  selectionRect = null; }
  state = "loading";

  const x1 = Math.min(startX, endX), y1 = Math.min(startY, endY);
  const x2 = Math.max(startX, endX), y2 = Math.max(startY, endY);
  showLoading(x1, y2);

  let imageBase64;
  try {
    imageBase64 = await captureTab();
    imageBase64 = await cropImage(imageBase64, x1, y1, x2 - x1, y2 - y1);
  } catch (e) {
    hideLoading(); state = "idle"; return;
  }

  chrome.runtime.sendMessage({ type: "QUERY_AI", imageBase64, x: x1, y: y2 }, (resp) => {
    hideLoading();
    if (!resp || chrome.runtime.lastError) {
      showInlineError("Connection error. Try again.");
      state = "idle"; return;
    }
    showAnswer(resp.answer, x1, y1, x2, y2, resp.camo === true);
    state = "showing";
  });
}

// -- CUSTOM PROMPT BOX --------------------------------------------------------
function doShowPrompt(camo) {
  if (promptBox) { dismissPrompt(); return; }
  if (state !== "idle") dismissAll();
  currentCamo = !!camo;
  state = "prompt";

  if (currentCamo) {
    // ── CAMO PROMPT: small inline box, no backdrop, blends into page ──────────
    // Sits in bottom-left, looks like a browser UI element, no dimming
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position:      "fixed",
      bottom:        "24px",
      left:          "24px",
      zIndex:        "2147483647",
      pointerEvents: "all"
    });

    const input = document.createElement("input");
    // Sample local bg so it blends in
    const bg = sampleBgColor(0, window.innerHeight - 40, 200, window.innerHeight);
    const lum = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
    const txtR = lum > 0.5 ? Math.round(bg.r * 0.4) : Math.round(bg.r + (255-bg.r)*0.75);
    const txtG = lum > 0.5 ? Math.round(bg.g * 0.4) : Math.round(bg.g + (255-bg.g)*0.75);
    const txtB = lum > 0.5 ? Math.round(bg.b * 0.4) : Math.round(bg.b + (255-bg.b)*0.75);

    Object.assign(input.style, {
      width:         "160px",
      background:    `rgba(${bg.r},${bg.g},${bg.b},0.85)`,
      border:        `1px solid rgba(${txtR},${txtG},${txtB},0.2)`,
      borderRadius:  "4px",
      color:         `rgba(${txtR},${txtG},${txtB},0.7)`,
      fontFamily:    "system-ui, sans-serif",
      fontSize:      "11px",
      padding:       "4px 8px",
      outline:       "none",
      boxSizing:     "border-box",
      backdropFilter:"blur(2px)",
      caretColor:    `rgba(${txtR},${txtG},${txtB},0.5)`
    });
    input.placeholder = "type prompt...";
    input.spellcheck = false;
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    promptBox = wrap;

    setTimeout(() => input.focus(), 20);

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { dismissPrompt(); return; }
      if (e.key === "Enter" && input.value.trim()) {
        const text = input.value.trim();
        dismissPrompt();
        submitTextQuery(text);
      }
    });

  } else {
    // ── NORMAL PROMPT: centred box with backdrop ───────────────────────────────
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed", inset: "0",
      zIndex: "2147483646",
      background: "rgba(0,0,0,0.35)",
      pointerEvents: "all"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "2147483647",
      background: "#0a0a0f",
      border: "1px solid #2d1f5e",
      borderRadius: "10px",
      padding: "18px 20px",
      width: "420px",
      maxWidth: "90vw",
      boxShadow: "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(124,58,237,0.2)",
      pointerEvents: "all"
    });

    const label = document.createElement("div");
    Object.assign(label.style, {
      fontSize: "11px", fontWeight: "600",
      color: "#6d28d9", letterSpacing: "0.8px",
      textTransform: "uppercase", marginBottom: "10px",
      fontFamily: "system-ui, sans-serif"
    });
    label.textContent = "Custom Prompt";

    const input = document.createElement("input");
    Object.assign(input.style, {
      width: "100%", background: "#12101f",
      border: "1px solid #2d1f5e", borderRadius: "6px",
      color: "#e9d5ff", fontFamily: "system-ui, sans-serif",
      fontSize: "13px", padding: "10px 12px",
      outline: "none", boxSizing: "border-box"
    });
    input.placeholder = "Ask anything...";
    input.spellcheck = false;

    const hint = document.createElement("div");
    Object.assign(hint.style, {
      fontSize: "10px", color: "#3d2f6e",
      marginTop: "8px", fontFamily: "system-ui, sans-serif"
    });
    hint.textContent = "Enter to submit  ·  Esc to close";

    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(hint);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    promptBox = backdrop;

    setTimeout(() => input.focus(), 30);

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { dismissPrompt(); return; }
      if (e.key === "Enter" && input.value.trim()) {
        const text = input.value.trim();
        dismissPrompt();
        submitTextQuery(text);
      }
    });

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) dismissPrompt();
    });
  }
}

function dismissPrompt() {
  if (promptBox) { promptBox.remove(); promptBox = null; }
  if (state === "prompt") state = "idle";
}

function submitTextQuery(text) {
  state = "loading";
  const cx = window.innerWidth  / 2 - 100;
  const cy = window.innerHeight / 2;
  showLoading(cx, cy);

  chrome.runtime.sendMessage({ type: "QUERY_TEXT", text }, (resp) => {
    hideLoading();
    if (!resp || chrome.runtime.lastError) {
      showInlineError("Connection error. Try again.");
      state = "idle"; return;
    }
    // Show answer centred on screen for text queries
    const w = 300;
    showAnswer(resp.answer, cx, cy - 40, cx + w, cy, resp.camo === true);
    state = "showing";
  });
}

// -- DISMISS ------------------------------------------------------------------
function dismissAll() {
  if (overlay)       { overlay.remove();       overlay       = null; }
  if (loadingBox)    { loadingBox.remove();     loadingBox    = null; }
  if (answerBox)     { answerBox.remove();      answerBox     = null; }
  if (selectionRect) { selectionRect.remove();  selectionRect = null; }
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup",   onMouseUp);
  state = "idle";
}

// -- CAPTURE TAB --------------------------------------------------------------
function captureTab() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, (resp) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (resp?.dataUrl) resolve(resp.dataUrl.split(",")[1]);
      else reject(new Error("No capture"));
    });
  });
}

// -- CROP ---------------------------------------------------------------------
function cropImage(base64, x, y, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.getContext("2d").drawImage(img, x*dpr, y*dpr, w*dpr, h*dpr, 0, 0, w*dpr, h*dpr);
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = reject;
    img.src = "data:image/png;base64," + base64;
  });
}

// -- SAMPLE BG ----------------------------------------------------------------
function sampleBgColor(x1, y1, x2, y2) {
  try {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    let el = document.elementFromPoint(cx, cy);
    let bg = el ? window.getComputedStyle(el).backgroundColor : "";
    while (el && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
      el = el.parentElement;
      if (el) bg = window.getComputedStyle(el).backgroundColor;
    }
    if (bg && bg !== "rgba(0, 0, 0, 0)") {
      const m = bg.match(/\d+/g);
      if (m) return { r: +m[0], g: +m[1], b: +m[2] };
    }
  } catch(e) {}
  return { r: 255, g: 255, b: 255 };
}

// -- LOADING ------------------------------------------------------------------
function showLoading(x1, y2) {
  loadingBox = document.createElement("div");
  if (currentCamo) {
    Object.assign(loadingBox.style, {
      position: "fixed", left: x1 + "px", top: (y2 + 4) + "px",
      background: "transparent", color: "rgba(150,150,150,0.4)",
      fontFamily: "system-ui, sans-serif", fontSize: "11px",
      fontStyle: "italic", padding: "3px 6px",
      zIndex: "2147483647", userSelect: "none", pointerEvents: "none"
    });
  } else {
    Object.assign(loadingBox.style, {
      position: "fixed", left: x1 + "px", top: (y2 + 6) + "px",
      background: "#0a0a0f", borderLeft: "3px solid #7c3aed",
      color: "#8b5cf6", fontFamily: "system-ui, sans-serif",
      fontSize: "12px", fontStyle: "italic", padding: "6px 12px",
      zIndex: "2147483647", userSelect: "none", pointerEvents: "none",
      borderRadius: "0 4px 4px 0", boxShadow: "0 2px 12px rgba(124,58,237,0.25)"
    });
  }
  loadingBox.textContent = currentCamo ? "." : "thinking";
  document.body.appendChild(loadingBox);
  let dots = 0;
  loadingBox._interval = setInterval(() => {
    dots = (dots + 1) % 4;
    if (loadingBox) loadingBox.textContent = currentCamo
      ? ".".repeat(dots + 1)
      : "thinking" + ".".repeat(dots);
  }, 350);
}

function hideLoading() {
  if (loadingBox) { clearInterval(loadingBox._interval); loadingBox.remove(); loadingBox = null; }
}

// -- ANSWER BOX ---------------------------------------------------------------
function showAnswer(text, x1, y1, x2, y2, camo) {
  if (answerBox) { answerBox.remove(); answerBox = null; }

  answerBox = document.createElement("div");

  if (camo) {
    const bg  = sampleBgColor(x1, y1, x2, y2);
    const lum = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
    const mix = (c) => lum > 0.5 ? Math.round(c * 0.45) : Math.round(c + (255 - c) * 0.75);
    Object.assign(answerBox.style, {
      position: "fixed", left: x1 + "px", top: (y2 + 2) + "px",
      background: `rgb(${bg.r},${bg.g},${bg.b})`,
      color: `rgb(${mix(bg.r)},${mix(bg.g)},${mix(bg.b)})`,
      fontFamily: "system-ui, sans-serif", fontSize: "13px",
      lineHeight: "1.5", padding: "4px 10px",
      zIndex: "2147483647", maxWidth: "420px",
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      pointerEvents: "none", userSelect: "none", borderRadius: "3px"
    });
  } else {
    const accent = document.createElement("div");
    Object.assign(accent.style, {
      position: "absolute", left: "0", top: "0", bottom: "0",
      width: "3px", background: "linear-gradient(180deg,#7c3aed,#4c1d95)"
    });
    answerBox.appendChild(accent);
    Object.assign(answerBox.style, {
      position: "fixed", left: x1 + "px", top: (y2 + 6) + "px",
      background: "#0a0a0f", color: "#e9d5ff",
      fontFamily: "system-ui, sans-serif", fontSize: "13px",
      lineHeight: "1.5", padding: "8px 14px 8px 16px",
      zIndex: "2147483647", maxWidth: "420px",
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      pointerEvents: "none", userSelect: "none",
      borderRadius: "0 6px 6px 0",
      boxShadow: "0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.2)",
      overflow: "hidden"
    });
  }

  const txt = document.createElement("span");
  txt.textContent = text;
  answerBox.appendChild(txt);
  document.body.appendChild(answerBox);

  requestAnimationFrame(() => {
    if (!answerBox) return;
    const rect = answerBox.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  answerBox.style.left = Math.max(0, window.innerWidth  - rect.width  - 8) + "px";
    if (rect.bottom > window.innerHeight) answerBox.style.top  = Math.max(0, y1 - rect.height  - 8) + "px";
  });
}

function showInlineError(msg) {
  showAnswer("! " + msg, 16, 0, 200, 40, false);
}
