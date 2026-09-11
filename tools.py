"""Hermes tool: drive the user's real Chrome via the Hermes Chrome extension."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .relay import (
    HOST,
    PORT,
    DEFAULT_CMD_TIMEOUT,
    get_or_create_token,
    start_relay,
    status_payload,
    submit_command,
)

TOOL_NAME = "chrome"

CHROME_SCHEMA: Dict[str, Any] = {
    "name": TOOL_NAME,
    "description": (
        "Drive the user's REAL Google Chrome (Claude-in-Chrome equivalent). "
        "Uses the Hermes Chrome extension over CDP — existing cookies/logins, "
        "no computer_use, no focus steal, no separate Chromium profile. "
        "ALWAYS prefer this over computer_use / browser_exec for any web task "
        "once the extension is connected. "
        "Workflow: status → tabs → navigate → snapshot (interactive refs e1, e2…) "
        "→ click/fill/type by ref → screenshot to verify. "
        "If the tool returns chrome_extension_disconnected, tell the user to Load "
        "unpacked the extension folder (hermes chrome install) and click Connect."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "status",
                    "tabs",
                    "new_tab",
                    "close_tab",
                    "switch_tab",
                    "navigate",
                    "back",
                    "forward",
                    "reload",
                    "snapshot",
                    "click",
                    "dblclick",
                    "right_click",
                    "hover",
                    "fill",
                    "type",
                    "key",
                    "scroll",
                    "screenshot",
                    "js",
                    "text",
                    "wait",
                    "find",
                ],
                "description": (
                    "status=relay+extension health; "
                    "tabs=list open tabs; new_tab/close_tab/switch_tab; "
                    "navigate to url; back/forward/reload; "
                    "snapshot=a11y tree with refs (use filter=interactive); "
                    "click/dblclick/right_click/hover by ref or coordinate; "
                    "fill=set form value by ref (React-safe); type=keystrokes; "
                    "key=chord like ctrl+a or Enter; scroll; screenshot=PNG path; "
                    "js=run JS in page; text=visible page text; wait=seconds; "
                    "find=match snapshot entries by query."
                ),
            },
            "tab_id": {
                "type": "integer",
                "description": "Chrome tab id. Omit to use the last Hermes-controlled tab (or the active tab).",
            },
            "url": {
                "type": "string",
                "description": "For navigate / new_tab. https:// is prepended if missing. back/forward also accepted as url for navigate.",
            },
            "ref": {
                "type": "string",
                "description": "Element ref from snapshot/find, e.g. e12. Preferred over coordinates.",
            },
            "coordinate": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 2,
                "maxItems": 2,
                "description": "Viewport CSS-pixel [x,y] fallback when no ref.",
            },
            "text": {
                "type": "string",
                "description": "Text to type (action=type) or JS source (action=js) or find query alias.",
            },
            "value": {
                "type": "string",
                "description": "Value for fill (input/textarea/select/checkbox true|false).",
            },
            "keys": {
                "type": "string",
                "description": "Key chord for action=key, e.g. Enter, Tab, ctrl+a, ctrl+Enter, Escape.",
            },
            "direction": {
                "type": "string",
                "enum": ["up", "down", "left", "right"],
                "description": "Scroll direction (default down).",
            },
            "amount": {
                "type": "integer",
                "description": "Scroll ticks 1-20 (default 3). Each tick ≈ 100px.",
            },
            "filter": {
                "type": "string",
                "enum": ["interactive", "all"],
                "description": "snapshot filter. interactive (default) = buttons/links/inputs. all = denser tree.",
            },
            "query": {
                "type": "string",
                "description": "Natural-language or substring query for action=find.",
            },
            "seconds": {
                "type": "number",
                "description": "Wait duration 0-30 (action=wait).",
            },
            "code": {
                "type": "string",
                "description": "JavaScript to eval in the page (action=js). Must return JSON-serializable data.",
            },
        },
        "required": ["action"],
    },
}


def _http_cmd(payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    """Talk to the relay over HTTP so this works even if the relay is in another process."""
    token = get_or_create_token()
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        f"http://{HOST}:{PORT}/cmd",
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Hermes-Token": token,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout + 5) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw)
    except HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
            return json.loads(body)
        except Exception:
            return {"ok": False, "error": f"http_{exc.code}", "message": str(exc)}
    except URLError as exc:
        return {
            "ok": False,
            "error": "relay_unreachable",
            "message": f"Relay not reachable on {HOST}:{PORT}: {exc.reason}",
        }
    except Exception as exc:
        return {"ok": False, "error": "relay_error", "message": str(exc)}


def handle_chrome(params: Dict[str, Any], **kwargs: Any) -> str:
    del kwargs
    action = str(params.get("action") or "").strip().lower()
    if not action:
        return json.dumps({"ok": False, "error": "action is required"})

    try:
        start_relay()
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": "relay_start_failed",
                "message": str(exc),
                "status": status_payload(),
            }
        )

    if action == "status":
        return json.dumps(status_payload())

    payload: Dict[str, Any] = {"action": action}
    for key in (
        "tab_id",
        "url",
        "ref",
        "coordinate",
        "text",
        "value",
        "keys",
        "direction",
        "amount",
        "filter",
        "query",
        "seconds",
        "code",
    ):
        if key in params and params[key] is not None:
            payload[key] = params[key]

    timeout = 90.0 if action == "screenshot" else DEFAULT_CMD_TIMEOUT
    # In-process shortcut (same Python) — falls back to HTTP for other processes.
    try:
        from . import relay as relay_mod

        if relay_mod._server is not None:  # type: ignore[attr-defined]
            result = submit_command(payload, timeout=timeout)
            return json.dumps(result, ensure_ascii=False)
    except Exception:
        pass

    result = _http_cmd({**payload, "timeout": timeout}, timeout=timeout)
    return json.dumps(result, ensure_ascii=False)


def check_chrome_available() -> bool:
    # Always expose the tool so the model can call status and get install steps.
    return True


def register_tools(ctx) -> None:
    ctx.register_tool(
        name=TOOL_NAME,
        toolset="hermes_chrome",
        schema=CHROME_SCHEMA,
        handler=handle_chrome,
        check_fn=check_chrome_available,
        emoji="🌐",
    )
