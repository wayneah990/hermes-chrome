"""hermes-chrome plugin — Claude-in-Chrome equivalent for Hermes Agent.

Registers a `chrome` tool that drives the user's real Google Chrome through
the bundled MV3 extension (CDP via chrome.debugger) over a localhost relay.
Does not use computer_use.
"""

from __future__ import annotations

from pathlib import Path

from .cli import chrome_command, register_cli
from .relay import start_relay
from .tools import CHROME_SCHEMA, check_chrome_available, handle_chrome, register_tools as _register_tools

_PLUGIN_DIR = Path(__file__).resolve().parent
_SKILL_DIR = _PLUGIN_DIR / "skills" / "hermes-chrome"


def _pin_chrome_always_visible() -> None:
    """Keep `chrome` in the native tools array — never hide it behind tool_search.

    Hermes defers non-core plugin tools. Desktop agents then miss `chrome`
    until /new. Pin the toolset as a direct surface (same class as desktop_ui)
    and name it in core so every new session sees the native tool.
    """
    try:
        from tools import tool_search

        cur = set(getattr(tool_search, "_DIRECT_SURFACE_TOOLSETS", ()) or ())
        cur.add("hermes_chrome")
        tool_search._DIRECT_SURFACE_TOOLSETS = frozenset(cur)
    except Exception:
        pass
    try:
        import toolsets as _ts

        core = getattr(_ts, "_HERMES_CORE_TOOLS", None)
        if isinstance(core, list) and "chrome" not in core:
            core.append("chrome")
    except Exception:
        pass
    try:
        from tui_gateway import server as _gui

        orig = getattr(_gui, "_gui_surface_toolsets", None)
        if callable(orig) and not getattr(_gui, "_hermes_chrome_surface_wrapped", False):

            def _wrapped(platform: str):
                surfaces = orig(platform)
                try:
                    surfaces.add("hermes_chrome")
                except Exception:
                    return set(surfaces) | {"hermes_chrome"}
                return surfaces

            _gui._gui_surface_toolsets = _wrapped
            _gui._hermes_chrome_surface_wrapped = True
    except Exception:
        pass


def register(ctx) -> None:
    _pin_chrome_always_visible()
    _register_tools(ctx)

    ctx.register_cli_command(
        name="chrome",
        help="Hermes Chrome — drive real Google Chrome (Claude-in-Chrome equivalent)",
        setup_fn=register_cli,
        handler_fn=chrome_command,
        description=(
            "Install/start the localhost relay and print Load-unpacked steps "
            "for the Hermes Chrome extension. See: hermes chrome install"
        ),
    )

    skill_md = _SKILL_DIR / "SKILL.md"
    if skill_md.is_file():
        try:
            ctx.register_skill("hermes-chrome", str(_SKILL_DIR))
        except Exception:
            pass

    try:
        start_relay()
    except Exception:
        pass
