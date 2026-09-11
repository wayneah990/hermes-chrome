"""CLI: hermes chrome install | start | stop | status | open."""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path

from .relay import (
    HOST,
    PORT,
    get_or_create_token,
    is_our_relay,
    start_relay,
    status_payload,
    stop_relay,
)

EXTENSION_DIR = Path(__file__).resolve().parent / "extension"


def register_cli(subparser: argparse.ArgumentParser) -> None:
    subs = subparser.add_subparsers(dest="chrome_command")
    subs.add_parser("install", help="Print Load-unpacked steps, mint token, start relay")
    subs.add_parser("start", help="Start the localhost relay")
    subs.add_parser("stop", help="Stop the in-process relay (other processes keep theirs)")
    subs.add_parser("status", help="Relay + extension connection")
    subs.add_parser("open", help="Open chrome://extensions in the default browser")


def _print_install() -> int:
    ext = EXTENSION_DIR
    token = get_or_create_token()
    started = start_relay()
    print("Hermes Chrome — Claude-in-Chrome for Hermes")
    print()
    print(f"  Relay:  http://{HOST}:{PORT}  ({started})")
    print(f"  Token:  {token}")
    print(f"  Ext:    {ext}")
    print()
    print("In Google Chrome:")
    print("  1. Open chrome://extensions")
    print("  2. Turn on Developer mode (top right)")
    print("  3. Load unpacked  →  select the Ext folder above")
    print("  4. Pin 'Hermes Chrome', click it, press Connect")
    print()
    print("Then in any Hermes chat: chrome(action=\"status\") then navigate/snapshot/click.")
    return 0


def chrome_command(args: argparse.Namespace) -> int:
    cmd = getattr(args, "chrome_command", None) or "status"
    if cmd == "install":
        return _print_install()
    if cmd == "start":
        print(start_relay())
        print(json.dumps(status_payload(), indent=2))
        return 0
    if cmd == "stop":
        stop_relay()
        print("stopped")
        return 0
    if cmd == "open":
        webbrowser.open("chrome://extensions")
        print("Opened chrome://extensions (if the OS allowed it).")
        print("Otherwise paste chrome://extensions into Chrome yourself.")
        return 0
    # status
    if not is_our_relay():
        try:
            start_relay()
        except Exception as exc:
            print(f"relay not running: {exc}", file=sys.stderr)
            return 1
    print(json.dumps(status_payload(), indent=2))
    return 0
