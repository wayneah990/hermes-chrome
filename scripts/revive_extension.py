#!/usr/bin/env python3
"""Revive a dead Hermes Chrome unpacked extension without a human click.

Stdlib + Windows PowerShell UI Automation (built-in). Does not kill Chrome.

Exit 0 = relay up and extension pulling (or UI reload clicked).
Exit 1 = could not confirm; print next step.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOST = "127.0.0.1"
PORT = 19882
EXT_ID = "ikgcdohngcpeepfiacppbepnbabbbhac"
CHROME = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe"


def _state_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(local) / "hermes" / "chrome-control"


def _token() -> str:
    p = _state_dir() / "token"
    return p.read_text(encoding="utf-8").strip() if p.is_file() else ""


def _status() -> dict:
    req = urllib.request.Request(f"http://{HOST}:{PORT}/status")
    tok = _token()
    if tok:
        req.add_header("X-Hermes-Token", tok)
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e), "extension_connected": False}


def _alive(st: dict) -> bool:
    if st.get("extension_connected"):
        return True
    lp = st.get("last_pull_s")
    try:
        return lp is not None and float(lp) < 30
    except (TypeError, ValueError):
        return False


def _start_relay() -> None:
    try:
        from hermes_chrome.relay import start_relay  # type: ignore
        start_relay()
        return
    except Exception:
        pass
    # plugin import path
    here = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(here.parent))
    try:
        from relay import start_relay  # type: ignore
        start_relay()
        return
    except Exception:
        pass
    subprocess.run(["hermes", "chrome", "start"], check=False)


def _chrome_exe() -> Path | None:
    for p in (
        CHROME,
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ):
        if p and p.is_file():
            return p
    w = shutil.which("chrome") or shutil.which("chrome.exe")
    return Path(w) if w else None


def _open_extensions() -> None:
    exe = _chrome_exe()
    url = f"chrome://extensions/?id={EXT_ID}"
    if exe:
        subprocess.Popen([str(exe), url], close_fds=True)
    else:
        os.startfile(url)  # type: ignore[attr-defined]


_PS_RELOAD = r"""
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$chrome = $null
foreach ($w in $wins) {
  $n = $w.Current.Name
  if ($n -match 'Google Chrome' -or $n -match 'Extensions') { $chrome = $w; break }
}
if (-not $chrome) { Write-Output 'NO_CHROME_WINDOW'; exit 2 }
function Find-Named($el, $pat) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push($el)
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop()
    $nm = $cur.Current.Name
    if ($nm -and ($nm -match $pat)) { return $cur }
    $c = $walker.GetFirstChild($cur)
    while ($c) { $stack.Push($c); $c = $walker.GetNextSibling($c) }
  }
  return $null
}
$card = Find-Named $chrome 'Hermes Chrome'
if (-not $card) { Write-Output 'NO_HERMES_CARD'; exit 3 }
$btn = Find-Named $card '^Reload$'
if (-not $btn) { $btn = Find-Named $card 'Reload' }
if (-not $btn) { Write-Output 'NO_RELOAD_BUTTON'; exit 4 }
$inv = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$inv.Invoke()
Write-Output 'CLICKED_RELOAD'
"""


def _click_reload() -> str:
    r = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", _PS_RELOAD],
        capture_output=True,
        text=True,
        timeout=45,
    )
    out = (r.stdout or "").strip() or (r.stderr or "").strip()
    return out.splitlines()[-1] if out else f"PS_EXIT_{r.returncode}"


def main() -> int:
    print("hermes-chrome revive")
    _start_relay()
    time.sleep(0.8)
    st = _status()
    print("status", json.dumps({k: st.get(k) for k in ("ok", "extension_connected", "paired", "last_pull_s", "error")}))
    if _alive(st):
        print("ALIVE")
        return 0
    print("extension not pulling — opening chrome://extensions and clicking Reload")
    _open_extensions()
    time.sleep(2.5)
    result = _click_reload()
    print("ui", result)
    time.sleep(2.0)
    st2 = _status()
    print("status", json.dumps({k: st2.get(k) for k in ("ok", "extension_connected", "paired", "last_pull_s", "error")}))
    if _alive(st2) or result == "CLICKED_RELOAD":
        print("REVIVED")
        return 0
    print("STILL_DEAD — chrome(action='tabs') anyway; status lies. If tabs fail, computer_use the Reload button.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
