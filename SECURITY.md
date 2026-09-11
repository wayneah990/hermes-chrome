# Security Policy

## What this software can do

Hermes Chrome is a Chrome extension with `debugger`, `tabs`, `scripting`, and `<all_urls>` permissions. It can read pages, click, type, run JavaScript, and take screenshots **in the browser profile where it is installed**. Treat it like giving an agent the keys to that Chrome.

## Trust model

- The relay binds **127.0.0.1 only**.
- Agent and extension share a token under the Hermes home (`chrome-control/token`).
- Do not expose port 19882 to the LAN or internet.
- Do not load unpacked extensions from untrusted zips.

## Reporting a vulnerability

Open a **private** report if you can (GitHub Security Advisories on this repo). If that is not enabled yet, open an issue titled `SECURITY:` without exploit details and ask for a contact path.

Please do **not** file a public issue with a working exploit against other users' browsers.

## Known limits

- The MV3 service worker can nap; the relay queues commands briefly.
- `chrome://` and Web Store pages cannot be automated.
- This is **not** an official Nous Research product. Review the code before installing.
