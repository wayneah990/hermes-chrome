---
name: hermes-chrome
description: Drive real Chrome via the Hermes Chrome extension. Prefer over computer_use.
version: 1.0.0
---

# Hermes Chrome

Claude-in-Chrome for Hermes. The `chrome` tool talks to the **user's real Google Chrome** (cookies, logins, tabs) through a MV3 extension + localhost relay. Do **not** use `computer_use` or `browser_exec` for web tasks when this tool is connected.

## When to Use

- Any website work in the user's already-open Chrome
- Sites that need an existing login
- Form fill, scrape, click, screenshot, JS in-page

Don't use for: native desktop apps (that's `computer_use`).

## Prerequisites

Relay auto-starts when the plugin loads. If `chrome(action="status")` says `extension_connected: false`:

1. Chrome → `chrome://extensions` → Developer mode ON
2. Load unpacked → this repo's `extension/` folder (`hermes chrome install` prints the path)
3. Click the Hermes icon → Connect
4. Retry `status`

CLI: `hermes chrome install` / `hermes chrome status`

## Procedure

1. `chrome(action="status")` — require `extension_connected: true`
2. `chrome(action="tabs")` — pick a `tab_id` (or omit to use active / last Hermes tab)
3. `chrome(action="navigate", url="https://...")` for a new page, or `new_tab`
4. `chrome(action="snapshot", filter="interactive")` — each line starts with a ref `e12`
5. Act by **ref**, not pixels: `click` / `fill` / `hover`
6. `chrome(action="screenshot")` to verify. PNG path is in the tool result.
7. Deliver the PNG with `MEDIA:<path>` if the chat surface supports it.

## Actions

| action | need | notes |
|---|---|---|
| status / tabs | — | health + tab list |
| new_tab / close_tab / switch_tab | url / tab_id | new tabs land in an orange **Hermes** group |
| navigate / back / forward / reload | url or tab_id | `https://` prepended if missing |
| snapshot | filter=interactive\|all | refs `e1`… persist until next snapshot |
| find | query | substring match on the interactive snapshot |
| click / dblclick / right_click / hover | ref or coordinate | CDP mouse, not OS cursor |
| fill | ref + value | React-safe native setter + input/change |
| type | text | `Input.insertText` into focused field |
| key | keys | `Enter`, `Tab`, `ctrl+a`, `Escape` |
| scroll | direction, amount | default down × 3 |
| screenshot | — | PNG on D: |
| js | code | `eval` in page MAIN world; JSON-serializable return |
| text | — | article/main/body innerText |
| wait | seconds | 0–30 |

## Pitfalls

- Chrome shows "Hermes Chrome started debugging this browser" — expected (same as Claude).
- `chrome://`, Web Store, and PDF viewer are restricted — navigate to https first.
- Snapshot refs die after a full navigation; snapshot again.
- Prefer `fill` over `type` for form fields (React).
- If two Hermes processes race the relay, the first binder wins; others attach to it.
- Never fall back to `computer_use` just because a widget is picky — try `js` or `click` by ref first.

## Verification

`chrome(action="status")` returns `extension_connected: true` and a subsequent `snapshot` lists `e1`… refs.
