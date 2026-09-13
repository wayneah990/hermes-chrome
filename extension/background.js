/* Hermes Chrome service worker — CDP controller + localhost relay poller. */

const RELAY = "http://127.0.0.1:19882";
const attached = new Set();
let polling = false;
let lastTabId = null;

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (_) {}
  chrome.alarms.create("hermes-keep", { periodInMinutes: 0.5 });
  await ensureOffscreen();
  startPoll();
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("hermes-keep", { periodInMinutes: 0.5 });
  await ensureOffscreen();
  startPoll();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "hermes-keep") {
    ensureOffscreen();
    startPoll();
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "hermes-start") startPoll();
});
chrome.debugger.onDetach.addListener((src) => {
  if (src && src.tabId) {
    attached.delete(src.tabId);
    unmarkDriven(src.tabId);
  }
});
if (chrome.windows && chrome.windows.onCreated) {
  chrome.windows.onCreated.addListener(() => {
    ensureOffscreen();
    startPoll();
  });
}

ensureOffscreen();
startPoll();

async function ensureOffscreen() {
  if (!chrome.offscreen) return;
  try {
    const ctxs = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (ctxs && ctxs.length) return;
  } catch (_) {}
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_SCRAPING"],
      justification: "Keep Hermes Chrome connected to the localhost relay",
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/already exists/i.test(msg)) return;
  }
}

async function getToken() {
  const s = await chrome.storage.local.get(["token"]);
  return s.token || "";
}

async function startPoll() {
  if (polling) return;
  polling = true;
  loop().finally(() => {
    polling = false;
  });
}

async function loop() {
  for (;;) {
    try {
      let token = await getToken();
      if (!token) {
        const r = await fetch(RELAY + "/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await r.json();
        if (data.ok && data.token) {
          token = data.token;
          await chrome.storage.local.set({ token, paired: true });
        }
      }
      if (!token) {
        await sleep(2000);
        continue;
      }
      const r = await fetch(RELAY + "/pull?wait=8", {
        headers: { "X-Hermes-Token": token },
      });
      if (r.status === 204) continue;
      if (r.status === 401) {
        await chrome.storage.local.remove(["token"]);
        continue;
      }
      if (!r.ok) {
        await sleep(1500);
        continue;
      }
      const cmd = await r.json();
      let result;
      try {
        result = await execute(cmd);
      } catch (e) {
        result = { ok: false, error: String(e && e.message ? e.message : e) };
      }
      result.id = cmd.id;
      await fetch(RELAY + "/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hermes-Token": token,
        },
        body: JSON.stringify(result),
      });
    } catch (_) {
      await sleep(2000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function execute(cmd) {
  const action = cmd.action;
  switch (action) {
    case "tabs":
      return listTabs();
    case "new_tab":
      return newTab(cmd.url || "about:blank");
    case "close_tab":
      return closeTab(await resolveTab(cmd.tab_id));
    case "switch_tab":
      return switchTab(await resolveTab(cmd.tab_id, { required: true }));
    case "navigate":
      return navigate(await resolveTab(cmd.tab_id), cmd.url);
    case "back":
      return historyGo(await resolveTab(cmd.tab_id), "back");
    case "forward":
      return historyGo(await resolveTab(cmd.tab_id), "forward");
    case "reload":
      return reloadTab(await resolveTab(cmd.tab_id));
    case "snapshot":
      return snapshot(await resolveTab(cmd.tab_id), cmd.filter || "interactive");
    case "click":
      return click(await resolveTab(cmd.tab_id), cmd, 1, "left");
    case "dblclick":
      return click(await resolveTab(cmd.tab_id), cmd, 2, "left");
    case "right_click":
      return click(await resolveTab(cmd.tab_id), cmd, 1, "right");
    case "hover":
      return hover(await resolveTab(cmd.tab_id), cmd);
    case "fill":
      return fill(await resolveTab(cmd.tab_id), cmd.ref, cmd.value);
    case "type":
      return typeText(await resolveTab(cmd.tab_id), cmd.text || "");
    case "key":
      return pressKey(await resolveTab(cmd.tab_id), cmd.keys || cmd.text || "");
    case "scroll":
      return scroll(await resolveTab(cmd.tab_id), cmd);
    case "screenshot":
      return screenshot(await resolveTab(cmd.tab_id));
    case "js":
      return evalJs(await resolveTab(cmd.tab_id), cmd.code || cmd.text || "");
    case "text":
      return pageText(await resolveTab(cmd.tab_id));
    case "wait":
      return waitFor(cmd.seconds || 1, cmd.tab_id);
    case "find":
      return findEl(await resolveTab(cmd.tab_id), cmd.query || cmd.text || "");
    default:
      return { ok: false, error: "unknown_action", action };
  }
}

async function resolveTab(tabId, { required } = {}) {
  if (tabId != null && tabId !== "") {
    const id = Number(tabId);
    lastTabId = id;
    await chrome.storage.local.set({ lastTabId: id });
    return id;
  }
  if (lastTabId != null) {
    try {
      await chrome.tabs.get(lastTabId);
      return lastTabId;
    } catch (_) {
      lastTabId = null;
    }
  }
  const stored = await chrome.storage.local.get(["lastTabId"]);
  if (stored.lastTabId) {
    try {
      await chrome.tabs.get(stored.lastTabId);
      lastTabId = stored.lastTabId;
      return lastTabId;
    } catch (_) {}
  }
  if (required) throw new Error("tab_id required");
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) {
    const all = await chrome.tabs.query({});
    if (!all.length) throw new Error("no tabs open");
    lastTabId = all[0].id;
    return lastTabId;
  }
  lastTabId = active.id;
  return lastTabId;
}

function isRestricted(url) {
  if (!url) return true;
  return /^(chrome|edge|about|chrome-extension|devtools):/i.test(url)
    || url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com");
}

async function tabInfo(tabId) {
  const t = await chrome.tabs.get(tabId);
  return { tab_id: t.id, url: t.url, title: t.title, status: t.status, windowId: t.windowId };
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    ok: true,
    last_tab_id: lastTabId,
    tabs: tabs.map((t) => ({
      tab_id: t.id,
      title: t.title,
      url: t.url,
      active: t.active,
      grouped: t.groupId > -1,
      status: t.status,
    })),
  };
}

async function markHermes(tabId) {
  try {
    const existing = await chrome.tabGroups.query({ title: "Hermes" });
    if (existing.length) {
      await chrome.tabs.group({ tabIds: tabId, groupId: existing[0].id });
    } else {
      const gid = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(gid, { title: "Hermes", color: "orange" });
    }
  } catch (_) {}
}

async function newTab(url) {
  const u = normalizeUrl(url);
  const tab = await chrome.tabs.create({ url: u, active: true });
  lastTabId = tab.id;
  await chrome.storage.local.set({ lastTabId });
  await markHermes(tab.id);
  await waitComplete(tab.id, 20000);
  return { ok: true, ...(await tabInfo(tab.id)) };
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  if (lastTabId === tabId) lastTabId = null;
  return { ok: true, closed: tabId };
}

async function switchTab(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.windows.update(t.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  lastTabId = tabId;
  await chrome.storage.local.set({ lastTabId });
  return { ok: true, ...(await tabInfo(tabId)) };
}

function normalizeUrl(url) {
  if (!url) return "about:blank";
  const s = String(url).trim();
  if (s === "back" || s === "forward" || s === "reload") return s;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  return "https://" + s;
}

async function navigate(tabId, url) {
  const u = normalizeUrl(url);
  if (u === "back") return historyGo(tabId, "back");
  if (u === "forward") return historyGo(tabId, "forward");
  if (u === "reload") return reloadTab(tabId);
  await chrome.tabs.update(tabId, { url: u, active: true });
  lastTabId = tabId;
  await markHermes(tabId);
  await waitComplete(tabId, 25000);
  return { ok: true, ...(await tabInfo(tabId)) };
}

async function historyGo(tabId, dir) {
  if (dir === "back") await chrome.tabs.goBack(tabId);
  else await chrome.tabs.goForward(tabId);
  await waitComplete(tabId, 15000);
  return { ok: true, ...(await tabInfo(tabId)) };
}

async function reloadTab(tabId) {
  await chrome.tabs.reload(tabId);
  await waitComplete(tabId, 20000);
  return { ok: true, ...(await tabInfo(tabId)) };
}

async function waitComplete(tabId, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === "complete") {
        await sleep(150);
        return;
      }
    } catch (_) {
      return;
    }
    await sleep(150);
  }
}

async function waitFor(seconds, tabId) {
  const s = Math.max(0, Math.min(30, Number(seconds) || 1));
  await sleep(s * 1000);
  if (tabId) {
    try {
      await waitComplete(Number(tabId), 5000);
      return { ok: true, waited: s, ...(await tabInfo(Number(tabId))) };
    } catch (_) {}
  }
  return { ok: true, waited: s };
}

async function attachDbg(tabId) {
  if (attached.has(tabId)) return;
  const t = await chrome.tabs.get(tabId);
  if (isRestricted(t.url)) throw new Error("restricted_url: " + t.url);
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
  markDriven(tabId);
}

function markDriven(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (document.getElementById("hermes-chrome-driven")) return;
      const el = document.createElement("div");
      el.id = "hermes-chrome-driven";
      el.textContent = "Hermes is driving this tab";
      el.setAttribute("style", "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#c9a227;color:#121216;font:12px/1.2 ui-sans-serif,system-ui,sans-serif;font-weight:650;padding:6px 14px;border-radius:999px;pointer-events:none;opacity:.92;box-shadow:0 2px 10px #0006");
      document.documentElement.appendChild(el);
    },
  }).catch(() => {});
}

function unmarkDriven(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const el = document.getElementById("hermes-chrome-driven");
      if (el) el.remove();
    },
  }).catch(() => {});
}

async function cdp(tabId, method, params) {
  await attachDbg(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params || {});
}

/* Runs in the PAGE. Must be self-contained. */
function snapshotInPage(filter) {
  const interactiveTags = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const interactiveRoles = new Set([
    "button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio",
    "menuitem", "tab", "switch", "slider", "option", "treeitem",
  ]);
  let n = 0;
  const lines = [];
  const seen = new Set();

  function roleOf(el) {
    const explicit = (el.getAttribute("role") || "").toLowerCase();
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "submit" || t === "button") return "button";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return tag.toLowerCase();
  }

  function nameOf(el) {
    const al = el.getAttribute("aria-label");
    if (al) return al.trim();
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return (lab.innerText || lab.textContent || "").trim();
    }
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const t = labelled.split(/\s+/).map((id) => {
        const n = document.getElementById(id);
        return n ? (n.innerText || n.textContent || "") : "";
      }).join(" ").trim();
      if (t) return t;
    }
    if (el.placeholder) return String(el.placeholder).trim();
    if (el.title) return String(el.title).trim();
    if (el.alt) return String(el.alt).trim();
    const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return txt.slice(0, 80);
  }

  function visible(el) {
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }

  function isInteractive(el) {
    if (el.disabled) return false;
    if (interactiveTags.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (interactiveRoles.has(role)) return true;
    if (el.onclick || el.getAttribute("onclick")) return true;
    if (el.tabIndex >= 0 && el.tagName !== "BODY" && el.tagName !== "HTML") return true;
    return false;
  }

  function walk(el, depth) {
    if (!el || el.nodeType !== 1 || depth > 20 || n > 400) return;
    if (el.closest && el.closest("script,style,noscript,svg")) return;
    const wantAll = filter === "all";
    const inter = isInteractive(el);
    if ((wantAll || inter) && visible(el) && !seen.has(el)) {
      seen.add(el);
      n += 1;
      const ref = "e" + n;
      el.setAttribute("data-hermes-ref", ref);
      const r = el.getBoundingClientRect();
      const role = roleOf(el);
      const name = nameOf(el).replace(/"/g, "'");
      let extra = "";
      if (el.tagName === "A" && el.href) extra += ` href="${el.getAttribute("href")}"`;
      if (el.tagName === "INPUT") extra += ` type="${el.type || "text"}"`;
      if (el.placeholder) extra += ` placeholder="${String(el.placeholder).slice(0, 40)}"`;
      if (el.value && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        extra += ` value="${String(el.value).slice(0, 40).replace(/"/g, "'")}"`;
      }
      if (el.checked) extra += " checked";
      const indent = "  ".repeat(Math.min(depth, 8));
      lines.push(`${indent}${ref} ${role} "${name}" @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}${extra}`);
      if (el.tagName === "SELECT") {
        for (const opt of el.options) {
          const mark = opt.selected ? " (selected)" : "";
          lines.push(`${indent}  option "${(opt.text || "").slice(0, 60)}" value="${opt.value}"${mark}`);
        }
      }
    }
    for (const child of el.children) walk(child, depth + 1);
  }

  walk(document.body, 0);
  return {
    ok: true,
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    count: n,
    tree: lines.join("\n"),
  };
}

function refBoxInPage(ref) {
  const el = document.querySelector(`[data-hermes-ref="${ref}"]`);
  if (!el) return { ok: false, error: "unknown_ref", ref };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    width: r.width,
    height: r.height,
    tag: el.tagName,
  };
}

function fillInPage(ref, value) {
  const el = document.querySelector(`[data-hermes-ref="${ref}"]`);
  if (!el) return { ok: false, error: "unknown_ref", ref };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  el.focus();
  const tag = el.tagName;
  const type = (el.type || "").toLowerCase();
  if (tag === "SELECT") {
    const want = String(value);
    let matched = false;
    for (const opt of el.options) {
      if (opt.value === want || opt.text === want) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) el.value = want;
  } else if (type === "checkbox" || type === "radio") {
    const on = /^(1|true|yes|on)$/i.test(String(value));
    el.checked = on;
  } else {
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, String(value));
    else el.value = String(value);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, ref, tag, type, value: el.value };
}

async function runInPage(tabId, func, args) {
  const t = await chrome.tabs.get(tabId);
  if (isRestricted(t.url)) throw new Error("restricted_url: " + t.url);
  const [inj] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args: args || [],
  });
  return inj && inj.result;
}

async function snapshot(tabId, filter) {
  const result = await runInPage(tabId, snapshotInPage, [filter]);
  const info = await tabInfo(tabId);
  return { ok: true, ...info, ...result };
}

async function pointFrom(tabId, cmd) {
  if (cmd.ref) {
    const box = await runInPage(tabId, refBoxInPage, [String(cmd.ref)]);
    if (!box || !box.ok) throw new Error((box && box.error) || "unknown_ref");
    return { x: box.x, y: box.y, ref: cmd.ref };
  }
  if (Array.isArray(cmd.coordinate) && cmd.coordinate.length >= 2) {
    return { x: Number(cmd.coordinate[0]), y: Number(cmd.coordinate[1]) };
  }
  throw new Error("ref or coordinate required");
}

async function click(tabId, cmd, clickCount, button) {
  const p = await pointFrom(tabId, cmd);
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await sleep(40);
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed", x: p.x, y: p.y, button, clickCount,
  });
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x: p.x, y: p.y, button, clickCount,
  });
  await sleep(120);
  return { ok: true, action: "click", button, clickCount, ...p, ...(await tabInfo(tabId)) };
}

async function hover(tabId, cmd) {
  const p = await pointFrom(tabId, cmd);
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  return { ok: true, action: "hover", ...p };
}

async function fill(tabId, ref, value) {
  if (!ref) throw new Error("ref required for fill");
  const result = await runInPage(tabId, fillInPage, [String(ref), value == null ? "" : String(value)]);
  return { ok: !!(result && result.ok), ...result };
}

async function typeText(tabId, text) {
  await attachDbg(tabId);
  await cdp(tabId, "Input.insertText", { text: String(text) });
  return { ok: true, typed: String(text).length };
}

const KEY_MAP = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
  up: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
};

async function pressKey(tabId, keys) {
  const parts = String(keys).split("+").map((s) => s.trim()).filter(Boolean);
  let mods = { alt: false, ctrl: false, meta: false, shift: false };
  let main = "Enter";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "ctrl" || low === "control") mods.ctrl = true;
    else if (low === "alt") mods.alt = true;
    else if (low === "shift") mods.shift = true;
    else if (low === "meta" || low === "cmd" || low === "win" || low === "command") mods.meta = true;
    else main = p;
  }
  const mapped = KEY_MAP[main.toLowerCase()] || {
    key: main.length === 1 ? main : main,
    code: main.length === 1 ? "Key" + main.toUpperCase() : main,
    windowsVirtualKeyCode: main.length === 1 ? main.toUpperCase().charCodeAt(0) : 0,
  };
  const bits = (mods.alt ? 1 : 0) + (mods.ctrl ? 2 : 0) + (mods.meta ? 4 : 0) + (mods.shift ? 8 : 0);
  const payload = {
    modifiers: bits,
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.windowsVirtualKeyCode,
    nativeVirtualKeyCode: mapped.windowsVirtualKeyCode,
  };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...payload });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  return { ok: true, keys };
}

async function scroll(tabId, cmd) {
  const dir = (cmd.direction || "down").toLowerCase();
  const amount = Math.max(1, Math.min(20, Number(cmd.amount) || 3));
  let x = 400, y = 300;
  if (cmd.ref || cmd.coordinate) {
    const p = await pointFrom(tabId, cmd);
    x = p.x; y = p.y;
  } else {
    const info = await runInPage(tabId, () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    if (info) { x = info.x; y = info.y; }
  }
  const delta = amount * 100;
  let deltaX = 0, deltaY = 0;
  if (dir === "down") deltaY = delta;
  else if (dir === "up") deltaY = -delta;
  else if (dir === "right") deltaX = delta;
  else if (dir === "left") deltaX = -delta;
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel", x, y, deltaX, deltaY,
  });
  return { ok: true, direction: dir, amount };
}

async function screenshot(tabId) {
  let dataUrl = "";
  let method = "captureVisibleTab";
  try {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(150);
    dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    if (!dataUrl) throw new Error("empty_capture");
  } catch (e) {
    method = "cdp_Page.captureScreenshot";
    await attachDbg(tabId);
    try { await cdp(tabId, "Page.enable", {}); } catch (_) {}
    let shot = null;
    try {
      shot = await cdp(tabId, "Page.captureScreenshot", { format: "png", fromSurface: true });
    } catch (_) {
      shot = await cdp(tabId, "Page.captureScreenshot", { format: "png" });
    }
    if (!shot || !shot.data) {
      throw new Error("screenshot_failed: " + String(e && e.message ? e.message : e));
    }
    dataUrl = "data:image/png;base64," + shot.data;
  }
  const token = await getToken();
  const r = await fetch(RELAY + "/screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hermes-Token": token },
    body: JSON.stringify({ png_base64: dataUrl }),
  });
  const saved = await r.json();
  return { ok: !!saved.ok, path: saved.path, bytes: saved.bytes, method, ...(await tabInfo(tabId)) };
}

async function evalJs(tabId, code) {
  const result = await runInPage(tabId, (src) => {
    const value = eval(src); // eslint-disable-line no-eval
    try {
      return { ok: true, value: JSON.parse(JSON.stringify(value)) };
    } catch (_) {
      return { ok: true, value: String(value) };
    }
  }, [String(code)]);
  return result || { ok: false, error: "no_result" };
}

async function pageText(tabId) {
  const result = await runInPage(tabId, () => {
    const sels = ["article", "main", "[role=main]", ".content", "#content", "body"];
    let best = "";
    let src = "body";
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const t = (el.innerText || "").trim();
      if (t.length > best.length) { best = t; src = s; }
    }
    return { ok: true, title: document.title, url: location.href, source: src, text: best.slice(0, 50000) };
  });
  return result || { ok: false, error: "no_result" };
}

async function findEl(tabId, query) {
  const snap = await snapshot(tabId, "interactive");
  const q = String(query).toLowerCase();
  const lines = (snap.tree || "").split("\n").filter((ln) => ln.toLowerCase().includes(q));
  return {
    ok: true,
    query,
    matches: lines.slice(0, 20),
    count: lines.length,
    tab_id: tabId,
    url: snap.url,
    title: snap.title,
    hint: lines.length ? "click/fill using the ref (eN) on the left of each line" : "no matches — try snapshot filter=all",
  };
}
