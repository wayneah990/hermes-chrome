"""Localhost command relay between Hermes and the Chrome extension.

Stdlib only. Threaded HTTP server bound to 127.0.0.1:19882.

  GET  /status              relay + extension health
  POST /pair                first-time extension handshake, returns token
  GET  /pull?wait=20        extension long-poll; 200 command | 204 empty
  POST /result              extension posts command result
  POST /cmd                 agent sends a command and blocks for the result
  POST /screenshot          extension uploads a PNG (base64) → saved on D:
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 19882
VERSION = "1.0.0"
DEFAULT_CMD_TIMEOUT = 60.0
PULL_MAX_WAIT = 12.0
EXTENSION_STALE_S = 25.0

_lock = threading.RLock()
_cmd_ready = threading.Event()
_pending_cmd: Optional[Dict[str, Any]] = None
_results: Dict[str, Dict[str, Any]] = {}
_result_events: Dict[str, threading.Event] = {}
_last_pull = 0.0
_paired = False
_server: Optional[ThreadingHTTPServer] = None
_thread: Optional[threading.Thread] = None
_ask_lock = threading.Lock()
_ask_job: Dict[str, Any] = {
    "status": "idle",
    "id": "",
    "prompt": "",
    "reply": "",
    "log": "",
    "error": "",
    "started": 0.0,
}


def state_dir() -> Path:
    """Fleet-wide, not per-profile: one Chrome extension serves every Hermes."""
    local = os.environ.get("LOCALAPPDATA") or str(Path.home())
    p = Path(local) / "hermes" / "chrome-control"
    p.mkdir(parents=True, exist_ok=True)
    return p


def screenshot_dir() -> Path:
    p = state_dir() / "screenshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def token_path() -> Path:
    return state_dir() / "token"


def get_or_create_token() -> str:
    path = token_path()
    if path.is_file():
        val = path.read_text(encoding="utf-8").strip()
        if val:
            return val
    token = secrets.token_urlsafe(24)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


def extension_connected() -> bool:
    with _lock:
        if _last_pull <= 0:
            return False
        return (time.time() - _last_pull) < EXTENSION_STALE_S


def status_payload() -> Dict[str, Any]:
    with _lock:
        last = _last_pull
        pending = _pending_cmd is not None
        paired = _paired
    return {
        "ok": True,
        "version": VERSION,
        "host": HOST,
        "port": PORT,
        "paired": paired,
        "extension_connected": extension_connected(),
        "last_pull_s": None if last <= 0 else round(time.time() - last, 2),
        "pending": pending,
        "token_file": str(token_path()),
    }


def submit_command(payload: Dict[str, Any], timeout: float = DEFAULT_CMD_TIMEOUT) -> Dict[str, Any]:
    """Called by the Hermes tool. Blocks until the extension replies."""
    cmd_id = uuid.uuid4().hex
    cmd = {"id": cmd_id, **payload}
    event = threading.Event()
    with _lock:
        global _pending_cmd
        if _pending_cmd is not None:
            return {
                "ok": False,
                "error": "busy",
                "message": "A Chrome command is already in flight. Retry.",
            }
        _pending_cmd = cmd
        _result_events[cmd_id] = event
        _cmd_ready.set()

    wait_for = timeout if extension_connected() else min(timeout, 15.0)
    ok = event.wait(timeout=wait_for)
    with _lock:
        _cmd_ready.clear()
        if _pending_cmd and _pending_cmd.get("id") == cmd_id:
            _pending_cmd = None
        result = _results.pop(cmd_id, None)
        _result_events.pop(cmd_id, None)

    if not ok or result is None:
        return {
            "ok": False,
            "error": "chrome_extension_disconnected" if not extension_connected() else "timeout",
            "message": (
                "Hermes Chrome extension did not answer. "
                "On chrome://extensions click Reload on Hermes Chrome, "
                "or open the Hermes icon and press Connect."
            ),
            "command_id": cmd_id,
            "status": status_payload(),
        }
    return result


def ask_snapshot() -> Dict[str, Any]:
    with _ask_lock:
        return dict(_ask_job)


def _hermes_bin() -> str:
    found = shutil.which("hermes")
    if found:
        return found
    local = os.environ.get("LOCALAPPDATA") or ""
    candidate = Path(local) / "hermes" / "hermes-agent" / "venv" / "Scripts" / "hermes.exe"
    if candidate.is_file():
        return str(candidate)
    raise FileNotFoundError("hermes executable not found on PATH")


def _run_ask(job_id: str, prompt: str) -> None:
    prompt_file = state_dir() / "ask.txt"
    prompt_file.write_text(prompt, encoding="utf-8")
    try:
        env = os.environ.copy()
        local = os.environ.get("LOCALAPPDATA") or str(Path.home())
        if not env.get("HERMES_HOME"):
            default = Path(local) / "hermes"
            if default.is_dir():
                env["HERMES_HOME"] = str(default)
        hermes = _hermes_bin()
        cmd = [
            hermes,
            "chat",
            "--query-file",
            str(prompt_file),
            "-c",
            "hermes-chrome-panel",
            "--create-if-missing",
            "-Q",
            "--source",
            "chrome",
            "--max-turns",
            "300",
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=900,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        reply = (proc.stdout or "").strip()
        err = (proc.stderr or "").strip()
        with _ask_lock:
            if _ask_job.get("id") != job_id:
                return
            _ask_job["status"] = "done" if proc.returncode == 0 else "error"
            _ask_job["reply"] = reply
            _ask_job["log"] = err[-4000:]
            _ask_job["error"] = "" if proc.returncode == 0 else f"hermes exit {proc.returncode}"
    except Exception as exc:
        with _ask_lock:
            if _ask_job.get("id") != job_id:
                return
            _ask_job["status"] = "error"
            _ask_job["error"] = str(exc)


def start_ask(text: str, *, url: str = "", title: str = "", tab_id: Any = None) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty"}
    with _ask_lock:
        if _ask_job.get("status") == "running":
            return {"ok": False, "error": "busy", "job": dict(_ask_job)}
        job_id = uuid.uuid4().hex[:10]
        prompt = (
            "You are Hermes talking through the Hermes Chrome side panel "
            "(Claude-in-Chrome equivalent). The user is in Google Chrome.\n"
            f"Current tab title: {title or '(unknown)'}\n"
            f"Current tab url: {url or '(unknown)'}\n"
            f"Current tab_id: {tab_id if tab_id is not None else '(use chrome tabs/snapshot)'}\n\n"
            "Drive THIS Chrome with the chrome tool. Do not use computer_use or browser_exec. "
            "Workflow: chrome(action=\"snapshot\") then click/fill by ref. "
            "Answer in the same language the user used.\n\n"
            f"The user said:\n{text}\n"
        )
        _ask_job.update(
            {
                "status": "running",
                "id": job_id,
                "prompt": text,
                "reply": "",
                "log": "",
                "error": "",
                "started": time.time(),
            }
        )
    threading.Thread(target=_run_ask, args=(job_id, prompt), name="hermes-chrome-ask", daemon=True).start()
    return {"ok": True, "id": job_id, "status": "running"}


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        return

    def _origin_ok(self) -> str:
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://") or origin.startswith("http://127.0.0.1"):
            return origin
        return ""

    def _send(self, code: int, body: Any = None, content_type: str = "application/json") -> None:
        raw = b""
        if body is not None and code != 204:
            if isinstance(body, (bytes, bytearray)):
                raw = bytes(body)
            elif content_type == "application/json":
                raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
            else:
                raw = str(body).encode("utf-8")
        self.send_response(code)
        origin = self._origin_ok()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Hermes-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        if code != 204:
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def _token_ok(self, incoming: Optional[str] = None) -> bool:
        expected = get_or_create_token()
        got = incoming if incoming is not None else self.headers.get("X-Hermes-Token", "")
        if not got:
            q = parse_qs(urlparse(self.path).query)
            got = (q.get("token") or [""])[0]
        return bool(got) and secrets.compare_digest(str(got), expected)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        if path == "/status":
            self._send(200, status_payload())
            return

        if path == "/ask":
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            self._send(200, {"ok": True, "job": ask_snapshot()})
            return

        if path == "/pull":
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            with _lock:
                global _last_pull
                _last_pull = time.time()
            wait = min(PULL_MAX_WAIT, max(0.0, float((qs.get("wait") or ["20"])[0] or 20)))
            end = time.time() + wait
            while True:
                with _lock:
                    global _pending_cmd
                    if _pending_cmd is not None:
                        cmd = _pending_cmd
                        _pending_cmd = None
                        _cmd_ready.clear()
                        _last_pull = time.time()
                        self._send(200, cmd)
                        return
                remaining = end - time.time()
                if remaining <= 0:
                    break
                _cmd_ready.wait(timeout=min(0.5, remaining))
            with _lock:
                _last_pull = time.time()
            self._send(204)
            return

        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        body = self._read_json()

        if path == "/pair":
            token = get_or_create_token()
            incoming = self.headers.get("X-Hermes-Token", "") or body.get("token", "")
            with _lock:
                global _paired, _last_pull
                if _paired and incoming and not secrets.compare_digest(str(incoming), token):
                    self._send(401, {"ok": False, "error": "already_paired"})
                    return
                _paired = True
                _last_pull = time.time()
            self._send(200, {"ok": True, "token": token, "port": PORT, "version": VERSION})
            return

        if path == "/result":
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            cmd_id = str(body.get("id") or "")
            if not cmd_id:
                self._send(400, {"ok": False, "error": "missing_id"})
                return
            with _lock:
                _results[cmd_id] = body
                ev = _result_events.get(cmd_id)
            if ev:
                ev.set()
            self._send(200, {"ok": True})
            return

        if path == "/screenshot":
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            b64 = body.get("png_base64") or ""
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            try:
                raw = base64.b64decode(b64)
            except Exception:
                self._send(400, {"ok": False, "error": "bad_png"})
                return
            name = f"chrome_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.png"
            dest = screenshot_dir() / name
            dest.write_bytes(raw)
            self._send(200, {"ok": True, "path": str(dest), "bytes": len(raw)})
            return

        if path == "/cmd":
            # Agent is local; token required so random localhost clients cannot drive Chrome.
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            timeout = float(body.pop("timeout", DEFAULT_CMD_TIMEOUT) or DEFAULT_CMD_TIMEOUT)
            result = submit_command(body, timeout=timeout)
            self._send(200, result)
            return

        if path == "/ask":
            if not self._token_ok():
                self._send(401, {"ok": False, "error": "bad_token"})
                return
            result = start_ask(
                str(body.get("text") or ""),
                url=str(body.get("url") or ""),
                title=str(body.get("title") or ""),
                tab_id=body.get("tab_id"),
            )
            self._send(200 if result.get("ok") else 409, result)
            return

        self._send(404, {"ok": False, "error": "not_found"})


def is_our_relay() -> bool:
    import urllib.error
    import urllib.request

    try:
        req = urllib.request.Request(f"http://{HOST}:{PORT}/status", method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return bool(data.get("ok")) and data.get("version")
    except Exception:
        return False


def start_relay(*, daemon: bool = True) -> str:
    """Start the relay in this process, or attach to one already bound on PORT."""
    global _server, _thread
    if _server is not None:
        return "already-running"
    if is_our_relay():
        return "attached-existing"
    get_or_create_token()
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), _Handler)
    except OSError as exc:
        if is_our_relay():
            return "attached-existing"
        raise RuntimeError(f"Cannot bind {HOST}:{PORT}: {exc}") from exc
    _server = httpd
    t = threading.Thread(target=httpd.serve_forever, name="hermes-chrome-relay", daemon=daemon)
    _thread = t
    t.start()
    return "started"


def stop_relay() -> None:
    global _server, _thread
    if _server is not None:
        try:
            _server.shutdown()
        except Exception:
            pass
        _server = None
        _thread = None


if __name__ == "__main__":
    print(f"Hermes Chrome relay on http://{HOST}:{PORT}")
    print(f"token: {get_or_create_token()}")
    start_relay(daemon=False)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        stop_relay()
