---
name: hermes-chrome-revive
description: "Reload a dead Hermes Chrome extension without Master."
---

# Hermes Chrome self-revive

Use when `chrome` is missing, `chrome_extension_disconnected`, or MM2H/Property/any agent cannot drive real Chrome. **Do it yourself. Do not ask Master to click Connect, Reload, or Load unpacked.** He may be asleep.

Chrome `chrome://` pages cannot be driven by the `chrome` tool. Reloading the unpacked extension is: start the relay, then Reload the **Hermes Chrome** card on `chrome://extensions`.

## When to use

- `chrome` tool missing from the tool list
- `chrome(action="status")` / `tabs` fail
- Master said fill a site in his logged-in Chrome and the extension is dead

## Paths (this machine)

| What | Where |
|---|---|
| Git / canonical | `D:\Works\Prompt Expert\hermes-chrome` |
| Load unpacked | `D:\Works\Prompt Expert\hermes-chrome\extension` |
| Extension id | `ikgcdohngcpeepfiacppbepnbabbbhac` |
| Relay | `http://127.0.0.1:19882` |
| Token | `%LOCALAPPDATA%\hermes\chrome-control\token` |

## Procedure (do in order, stop when Chrome works)

1. **Relay**

```
terminal: hermes chrome start
```

2. **Do not trust status.** `extension_connected: false` often lies. Immediately:

```
chrome(action="tabs")
```

Real tabs → proceed with `new_tab` / `navigate` / `js`. Done.

3. **If `tabs` itself fails or `chrome` is not a tool** — plugin missing on this profile. Enable then continue (needs a new session to see the tool; still revive the extension now):

```
terminal: hermes plugins enable hermes-chrome --no-allow-tool-override
```

If “not installed”: copy the plugin folder then enable:

```
cp -R "D:/Works/Prompt Expert/hermes-chrome" "$HERMES_HOME/plugins/hermes-chrome"
hermes plugins enable hermes-chrome --no-allow-tool-override
```

(`$HERMES_HOME` is this profile, e.g. `%LOCALAPPDATA%\hermes\profiles\mm2h-specialist`.)

4. **Reload the unpacked extension with no human**

```
terminal: hermes chrome revive
```

That starts the relay, opens `chrome://extensions/?id=ikgcdohngcpeepfiacppbepnbabbbhac`, and UI-Automation-clicks **Reload** on the Hermes Chrome card. Does **not** kill Chrome.

If `hermes chrome revive` is an old CLI, run the script directly:

```
python "D:/Works/Prompt Expert/hermes-chrome/scripts/revive_extension.py"
```

5. Wait 2s, `chrome(action="tabs")` again. Real tabs → work.

6. **Last resort only** — `computer_use` capture Chrome, click **Reload** on the Hermes Chrome card. Never tell Master to do it. Never `taskkill chrome.exe` while he is using the machine.

## Do not

- Ask Master to Load unpacked / Connect / pin the icon (already done once).
- `chrome(action="navigate")` to `chrome://extensions` — restricted URL, fails closed.
- Reload the extension in the middle of a healthy `chrome` job (kills the service worker).
- Commit the token file.

## Verification

- `chrome(action="tabs")` returns at least one tab, **or**
- `hermes chrome revive` prints `ALIVE` or `REVIVED` / `CLICKED_RELOAD`.
