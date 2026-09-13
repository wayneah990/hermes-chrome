/* Keeps the MV3 service worker awake and the relay poller running
   without requiring a toolbar-icon click. */
const RELAY = "http://127.0.0.1:19882";

async function beat() {
  try {
    await chrome.runtime.sendMessage({ type: "hermes-start" });
  } catch (_) {}
  try {
    await fetch(RELAY + "/status", { cache: "no-store" });
  } catch (_) {}
}

beat();
setInterval(beat, 10000);
