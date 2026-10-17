# A.F.R.A ♥ chat

A private chat for two, as an iPhone (and Android) Home Screen app with real push notifications. No App Store, no
accounts, no third-party chat service: it runs on your own server, and every message is end-to-end encrypted, so even
the server can't read them.

- Text and emoji, 200+ ready-made love and encouragement notes in English and Indonesian (💌, with "Surprise me")
- Photos, files and voice notes; replies, reactions (double-tap for ❤️), edit, delete, search
- "typing…", online status, read ticks (✓ sent, ✓✓ read), unread badge on the app icon
- Push notifications on iPhone (iOS 16.4+, app added to the Home Screen) and Android
- Also built into [A.F.R.A](https://github.com/farmansyah/afra) on the computers (the ♥ → Messages), which keeps a
  backup copy of every message in the shared library folder

## Use it on an iPhone
1. Open the chat's address (e.g. `https://13-222-66-73.sslip.io`) in **Safari**. The partner link from
   A.F.R.A (⋯ → *Add your iPhone*) fills in the pairing code for you.
2. Tap **Share** ⬆ → **Add to Home Screen**, then open **A.F.R.A ♥** from its new icon.
3. Enter the pairing code and your name, tap **Join ♥**, then **Turn on** notifications.

Both of you use the same pairing code on every phone and computer. It is the key to your chat: keep it between you.

## Run the server
Any small Ubuntu/Debian VPS works (the relay uses about 50 MB of memory). It runs next to other services.
```bash
git clone https://github.com/farmansyah/afra-chat.git && cd afra-chat
sudo bash deploy/install.sh 203-0-113-5.sslip.io     # your domain, or <your-ip-with-dashes>.sslip.io
```
Open ports **80 and 443** in the cloud firewall (Lightsail: *Networking → IPv4 Firewall*). Caddy gets the HTTPS
certificate by itself. Update later with `bash deploy/update.sh`. Docker instead: see `docker/`.

## How it works
| Part | What it does |
|---|---|
| `web/` | The app (one HTML page, `chat.js`, a service worker for offline use and push, `templates.json` for the notes) |
| `relay/relay.py` | FastAPI: a WebSocket per device for live delivery and catch-up, encrypted attachments, Web Push |
| `deploy/` | Install/update on Ubuntu: a systemd service (memory-capped) behind Caddy |

**Encryption:** the pairing code goes through PBKDF2-SHA256 (200,000 rounds) to derive a room id, an access token and
an AES-256-GCM key. Messages, attachments and "typing…" are encrypted on the device; the relay stores only scrambled
data (deleted after 60 days) and sends push notifications without any message content.

© 2026 danafarmansyah. All rights reserved. Crafted with ♥.
