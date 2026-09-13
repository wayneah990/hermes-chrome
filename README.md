# Hermes Chrome

Claude-in-Chrome for [Hermes Agent](https://github.com/NousResearch/hermes-agent): a Chrome MV3 extension plus a localhost relay so Hermes can **drive your real Google Chrome** (cookies, logins, open tabs) — not a fresh Chromium profile, and not `computer_use`.

**This is not an official Nous Research product.** It is a community plugin. Review the code before you load it.

```
Hermes (chat / Desktop / CLI)
        │  chrome tool  or  side-panel Ask
        ▼
  127.0.0.1:19882 relay  ← token on loopback only
        ▲
Chrome extension (chrome.debugger CDP)
        │
Your Chrome windows & tabs
```

## Features

- **`chrome` tool** — `status`, `tabs`, `navigate`, `snapshot` (refs `e1`…), `click`/`fill`/`type`/`key`, `screenshot`, `js`
- **Side panel chat** — type an instruction on the current tab (same idea as Claude in Chrome)
- **Shared thread** — Chrome side panel and Hermes session `hermes-chrome-panel` show the same questions and answers
- **Alt+H** — open the side panel (customize at `chrome://extensions/shortcuts`)
- Unsent draft survives closing the panel
- Gold pill on a tab while Hermes is driving it
- Drag **images or PDFs** onto the side panel (or paste / paperclip)
- Existing logins stay; orange **Hermes** tab group for agent tabs
- Copy icon on messages (ChatGPT-style)

## Requirements

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) installed and working
- Google Chrome (or Chromium) on Windows, macOS, or Linux
- Python 3.11+ (stdlib only for the relay — no pip extras)

## Install

```bash
git clone https://github.com/wayneah990/hermes-chrome.git
```

Copy (or symlink) the repo into Hermes plugins:

```bash
# Linux / macOS
cp -R hermes-chrome ~/.hermes/plugins/hermes-chrome

# Windows (PowerShell)
Copy-Item -Recurse hermes-chrome $env:LOCALAPPDATA\hermes\plugins\hermes-chrome
```

Enable and start:

```bash
hermes plugins enable hermes-chrome
hermes chrome install
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → the `extension/` folder inside this repo
4. Pin **Hermes Chrome** once. It connects when Chrome starts — no puzzle-icon click.

Toolbar icons are cached by Chrome. After an icon change, **Reload** the extension or fully quit Chrome.

## Use

**From any Hermes chat** (the `chrome` tool is native — not hidden behind tool_search):

```
chrome(action="status")
chrome(action="navigate", url="https://example.com")
chrome(action="snapshot", filter="interactive")
chrome(action="click", ref="e3")
```

URL-only jobs: `navigate` or `new_tab` and stop. Snapshot only when you will click or fill.

**From Chrome:** open the side panel (`Alt+H`) and type what you want done on this tab. Highlighted text on the page is sent as untrusted context.

You can keep using **another Chrome window** while Hermes works. Do not click inside the same tab it is driving.

## CLI

```
hermes chrome install   # print Load-unpacked path, mint token, start relay
hermes chrome start
hermes chrome status
hermes chrome stop
```

## Security

The extension uses Chrome's **debugger** API. The relay listens on **127.0.0.1:19882** with a local token. Read [SECURITY.md](SECURITY.md).

## Contributing

Public repo. **Fork + Pull Request** — see [CONTRIBUTING.md](CONTRIBUTING.md). Direct push to `main` is owner-only.

## License

[MIT](LICENSE)

The lady toolbar art is the Hermes Agent desktop icon from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT).
