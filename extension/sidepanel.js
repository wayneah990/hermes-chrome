const RELAY = "http://127.0.0.1:19882";
const $ = (id) => document.getElementById(id);
let token = "";
let busy = false;
let sending = false;
let lastJobId = "";
let lastSig = "";
let pendingUser = "";

function setState(text, cls) {
  $("state").textContent = text;
  $("dot").className = "dot" + (cls ? " " + cls : "");
}

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

function addMsg(role, text) {
  const bubble = document.createElement("div");
  bubble.className = "msg " + role;
  bubble.textContent = text;
  const chat = role === "me" || String(role).startsWith("bot");
  if (!chat) {
    $("log").appendChild(bubble);
    return bubble;
  }
  const row = document.createElement("div");
  row.className = "row " + (role === "me" ? "me" : "bot");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy";
  btn.title = "Copy";
  btn.setAttribute("aria-label", "Copy");
  btn.innerHTML = COPY_ICON;
  btn.addEventListener("click", async () => {
    const t = bubble.textContent || "";
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.innerHTML = CHECK_ICON;
    btn.title = "Copied";
    setTimeout(() => { btn.innerHTML = COPY_ICON; btn.title = "Copy"; }, 1200);
  });
  row.appendChild(bubble);
  row.appendChild(btn);
  $("log").appendChild(row);
  return bubble;
}

function thinkingLabel(job) {
  const started = Number(job && job.started) || 0;
  const sec = started ? Math.max(0, Math.floor(Date.now() / 1000 - started)) : 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `Hermes is working on this page… ${m}m ${s}s` : `Hermes is working on this page… ${s}s`;
}

function renderMessages(messages, job) {
  const list = Array.isArray(messages) ? messages : [];
  const running = job && job.status === "running";
  const last = list.length ? list[list.length - 1] : null;
  const showPending = !!(pendingUser && (!last || last.role !== "user" || last.text !== pendingUser));
  const sig = JSON.stringify({
    n: list.length,
    lastId: last ? last.id : 0,
    lastText: last ? last.text : "",
    st: job && job.status,
    pending: showPending ? pendingUser : "",
    tick: running ? Math.floor(Date.now() / 1000) : 0,
  });
  if (sig === lastSig) return;
  lastSig = sig;
  const log = $("log");
  const stick = log.scrollHeight - log.scrollTop < log.clientHeight + 48;
  log.innerHTML = "";
  addMsg("sys", "Same thread as Hermes chat “hermes-chrome-panel”. Every question and answer shows here and there.");
  for (const m of list) {
    addMsg(m.role === "user" ? "me" : "bot", m.text);
  }
  if (showPending) addMsg("me", pendingUser);
  if (running) addMsg("bot busy", thinkingLabel(job));
  if (stick) log.scrollTop = log.scrollHeight;
}

async function headers() {
  const h = { "Content-Type": "application/json" };
  if (token) h["X-Hermes-Token"] = token;
  return h;
}

async function pair() {
  const stored = await chrome.storage.local.get(["token"]);
  const hdr = { "Content-Type": "application/json" };
  if (stored.token) hdr["X-Hermes-Token"] = stored.token;
  const r = await fetch(RELAY + "/pair", { method: "POST", headers: hdr, body: "{}" });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || "pair failed");
  token = data.token;
  await chrome.storage.local.set({ token, paired: true });
  await chrome.runtime.sendMessage({ type: "hermes-start" });
}

async function ping() {
  try {
    const r = await fetch(RELAY + "/status");
    const data = await r.json();
    if (data.extension_connected) setState("connected — type below", "on");
    else if (data.ok) setState("relay up", "warn");
    else setState("relay issue", "");
  } catch (e) {
    setState("relay not running", "");
  }
}

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const t = tabs && tabs[0];
  if (!t) return {};
  let selection = "";
  try {
    const inj = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: () => (window.getSelection && window.getSelection().toString()) || "",
    });
    selection = ((inj && inj[0] && inj[0].result) || "").trim().slice(0, 1500);
  } catch (_) {}
  return { tab_id: t.id, url: t.url || "", title: t.title || "", selection };
}

async function tick() {
  if (!token) return;
  try {
    const r = await fetch(RELAY + "/ask", { headers: await headers() });
    const data = await r.json();
    const msgs = data.messages || [];
    const job = data.job || {};
    renderMessages(msgs, job);
    if (pendingUser && msgs.some((m) => m.role === "user" && (m.text === pendingUser || m.text.startsWith(pendingUser)))) {
      pendingUser = "";
    }
    const running = job.status === "running" || sending;
    busy = running;
    $("send").disabled = running;
  } catch (e) {
    /* relay briefly down — keep last paint */
  }
}

let pendingFiles = [];

function okFile(f) {
  if (!f) return false;
  const name = (f.name || "").toLowerCase();
  const type = (f.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type === "application/pdf" || name.endsWith(".pdf")) return true;
  return false;
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  if (!pendingFiles.length) {
    box.classList.remove("show");
    return;
  }
  box.classList.add("show");
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const span = document.createElement("span");
    span.textContent = f.name;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "Remove";
    x.onclick = () => { pendingFiles.splice(i, 1); renderChips(); };
    chip.appendChild(span);
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

async function takeFiles(list) {
  const incoming = Array.from(list || []).filter(okFile);
  if (!incoming.length) return;
  pendingFiles = pendingFiles.concat(incoming).slice(0, 6);
  renderChips();
}

async function send() {
  const text = $("input").value.trim();
  if ((!text && !pendingFiles.length) || busy || sending) return;
  sending = true;
  busy = true;
  pendingUser = text || "Please use the attached file(s).";
  lastSig = "";
  $("send").disabled = true;
  $("input").value = "";
  chrome.storage.local.set({ composerDraft: "" });
  const queued = pendingFiles.slice();
  pendingFiles = [];
  renderChips();
  try {
    if (!token) await pair();
    const files = queued.length ? await uploadPendingQueued(queued) : [];
    const tab = await currentTab();
    const r = await fetch(RELAY + "/ask", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ text, files, ...tab }),
    });
    const data = await r.json();
    if (!data.ok) {
      pendingUser = "";
      sending = false;
      busy = false;
      $("send").disabled = false;
      pendingFiles = queued.concat(pendingFiles);
      renderChips();
      addMsg("bot", data.error === "busy"
        ? "Hermes is still working on the last request."
        : (data.error || "ask failed"));
      return;
    }
    lastJobId = data.id;
    sending = false;
    await tick();
  } catch (e) {
    pendingUser = "";
    sending = false;
    busy = false;
    $("send").disabled = false;
    pendingFiles = queued.concat(pendingFiles);
    renderChips();
    addMsg("bot", String(e));
  }
  $("input").focus();
}

async function uploadPendingQueued(queued) {
  const out = [];
  for (const f of queued) {
    const data = await fileToB64(f);
    const r = await fetch(RELAY + "/upload", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ name: f.name, mime: f.type, data }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.message || j.error || "upload failed");
    out.push({ path: j.path, name: j.name, kind: j.kind });
  }
  return out;
}

$("send").onclick = send;
$("attach").onclick = () => $("file").click();
$("file").addEventListener("change", () => {
  takeFiles($("file").files);
  $("file").value = "";
});
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$("input").addEventListener("input", () => {
  chrome.storage.local.set({ composerDraft: $("input").value });
});
$("input").addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) {
    const ok = Array.from(items).filter(okFile);
    if (ok.length) {
      e.preventDefault();
      takeFiles(ok);
    }
  }
});

let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth += 1;
  document.body.classList.add("drag");
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("drag");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag");
  takeFiles(e.dataTransfer && e.dataTransfer.files);
});

addMsg("sys", "Same thread as Hermes chat “hermes-chrome-panel”. Alt+H opens this panel. Drop image or PDF here.");
pair().then(async () => {
  ping();
  tick();
  const stored = await chrome.storage.local.get(["composerDraft"]);
  if (stored.composerDraft && !$("input").value) {
    $("input").value = stored.composerDraft;
  }
}).catch((e) => {
  setState("connect failed", "");
  addMsg("sys", String(e));
});
setInterval(ping, 4000);
setInterval(tick, 400);
