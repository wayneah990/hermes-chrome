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


def register(ctx) -> None:
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
