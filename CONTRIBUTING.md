# Contributing to Hermes Chrome

Thanks for wanting to help. This repo is **public**. Anyone can fork and open a Pull Request. **Nobody gets write access to `main` except the owner** — that is how we stay open without letting random people push straight to production.

## How to contribute

1. Fork the repository.
2. Clone your fork and create a branch: `git checkout -b fix/short-name`
3. Make a focused change (one concern per PR).
4. Test locally (see below).
5. Open a Pull Request against `main`. Describe **what** and **why**.

Issues are welcome: bugs, install failures, and feature ideas. Search existing issues first.

## Local test

```bash
# Relay
python relay.py
# then in another terminal
python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:19882/status').read().decode())"

# Plugin (after copying into ~/.hermes/plugins/hermes-chrome)
hermes plugins doctor .
hermes chrome status
```

Load the `extension/` folder unpacked in Chrome (Developer mode) and confirm `extension_connected` after opening the side panel.

## Rules

- Do not commit tokens, `ask.txt`, screenshots of real browsing, or API keys.
- Do not weaken the localhost + token gate without a design discussion.
- Keep the `chrome` tool driving the **user's real Chrome**. Do not route through a fresh Chromium profile.
- Match existing code style (stdlib Python, no extra runtime deps for the relay).

## Code of conduct

Be decent. Harassment or spam PRs will be closed. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
