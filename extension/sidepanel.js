const RELAY = "http://127.0.0.1:19882";
const $ = (id) => document.getElementById(id);
let token = "";
let busy = false;
let lastJobId = "";

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
    $("log").scrollTop = $("log").scrollHeight;
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
  $("log").scrollTop = $("log").scrollHeight;
  return bubble;
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
  return t ? { tab_id: t.id, url: t.url || "", title: t.title || "" } : {};
}

async function send() {
  const text = $("input").value.trim();
  if (!text || busy) return;
  busy = true;
  $("send").disabled = true;
  $("input").value = "";
  addMsg("me", text);
  const thinking = addMsg("bot busy", "Hermes is working on this page…");
  try {
    if (!token) await pair();
    const tab = await currentTab();
    const r = await fetch(RELAY + "/ask", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ text, ...tab }),
    });
    const data = await r.json();
    if (!data.ok) {
      thinking.className = "msg bot";
      thinking.textContent = data.error === "busy"
        ? "Hermes is still working on the last request."
        : (data.error || "ask failed");
      busy = false;
      $("send").disabled = false;
      return;
    }
    lastJobId = data.id;
    await waitJob(thinking);
  } catch (e) {
    thinking.className = "msg bot";
    thinking.textContent = String(e);
  }
  busy = false;
  $("send").disabled = false;
  $("input").focus();
}

async function waitJob(el) {
  for (let i = 0; i < 900; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(RELAY + "/ask", { headers: await headers() });
    const data = await r.json();
    const job = data.job || {};
    if (job.id && lastJobId && job.id !== lastJobId) continue;
    if (job.status === "running") {
      const m = Math.floor((i + 1) / 60);
      const s = (i + 1) % 60;
      el.textContent = m ? `Hermes is working on this page… ${m}m ${s}s` : `Hermes is working on this page… ${s}s`;
      continue;
    }
    el.className = "msg bot";
    if (job.status === "done") {
      el.textContent = cleanReply(job.reply) || "(no text)";
    } else {
      el.textContent = (job.error || "failed") + (job.reply ? "\n\n" + cleanReply(job.reply) : "");
    }
    return;
  }
  el.className = "msg bot";
  el.textContent = "Still waiting after 15 minutes — Hermes may still be running. Don't type Continue; open the panel later or send the task again.";
}

function cleanReply(text) {
  if (!text) return "";
  return String(text)
    .split("\n")
    .filter((ln) => {
      const t = ln.trim();
      if (!t) return true;
      if (/^Warning: Unknown toolsets/i.test(t)) return false;
      if (/Reached maximum iterations/i.test(t)) return false;
      if (/^session_id:/i.test(t)) return false;
      if (/^\[tool\]/.test(t)) return false;
      if (/tool_choice was set/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

$("send").onclick = send;
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

addMsg("sys", "Claude-in-Chrome for Hermes. Type an instruction for this tab.");
pair().then(ping).catch((e) => {
  setState("connect failed", "");
  addMsg("sys", String(e));
});
setInterval(ping, 4000);
