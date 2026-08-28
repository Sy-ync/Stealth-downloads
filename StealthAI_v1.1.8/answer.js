// answer.js -- stream-proof floating answer window

const params = new URLSearchParams(window.location.search);
const text   = params.get("text") || "";

document.getElementById("box").textContent = text;

// No click-to-close: clicking the popup would cause fullscreen games to
// register a focus loss and exit fullscreen. Close with the hotkey instead
// (second Ctrl+Shift+Z press removes the window from background.js).

// No auto-close timeout: let the user decide when to dismiss via hotkey.
