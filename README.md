# A.F.R.A ♥ chat

A small private social chat on your own server, installable on iPhone and Android from the browser (no App Store),
with real push notifications.

- **Accounts:** everyone chooses a username, a display name, a password and a profile photo. Stay logged in on each
  device; log in on more devices (phone, laptop) with the same account.
- **Invite only:** the admin makes invite codes (single use, optionally "make them an admin too"). Signing up with a
  code also starts the chat with whoever invited you.
- **Chats:** type someone's @username and talk right away, with no request to accept. One chat per person, plus
  **Notes to self**. All chats are saved on the server, and each device keeps an offline copy.
- **Messages:** text and emoji, 💌 115 ready-made messages in 12 categories (check-ins, encouragement, study, plans, love…, plus "Surprise me"),
  photos, files, voice notes, replies, reactions (double-tap for ❤️), edit, delete for everyone, search, "typing…",
  online/last seen, read ticks (✓ sent, ✓✓ read), unread badges (also on the app icon).
- **Notifications** show the sender's name and the message, and open that chat when tapped. They are encrypted for
  the receiving phone (Web Push, RFC 8291), so Apple's and Google's push services can't read them.
- **Admin:** people (see who's online, switch an account off, make admin, password-reset codes) and invites.

## On an iPhone (iOS 16.4+)
1. Open the invite link you received (or the chat's address) in **Safari**.
2. Tap **Share** ⬆ → **Add to Home Screen**, then open **A.F.R.A ♥** from its icon.
3. Create your account (the invite code is filled in from the link), then tap **Turn on** for notifications.

## Run the server
Any small Ubuntu/Debian VPS (it uses about 60 MB of memory) next to anything else:
```bash
git clone https://github.com/farmansyah/afra-chat.git && cd afra-chat
sudo bash deploy/install.sh 203-0-113-5.sslip.io     # your domain, or <your-ip-with-dashes>.sslip.io
```
It prints the **first admin invite code**. Open ports 80 and 443 in the cloud firewall (Lightsail: *Networking →
IPv4 Firewall*); Caddy gets the HTTPS certificate by itself. Update later with `bash deploy/update.sh`.
More invite codes from the command line: `.venv/bin/python server/server.py invite [--admin] [note]` (run in the
project folder with `CHAT_DATA=data`). Docker instead: see `docker/`.

## How it works
| Part | What |
|---|---|
| `server/server.py` | FastAPI + SQLite: accounts (Base64-encoded passwords, sessions), chats, files, one WebSocket per device for live updates, Web Push with VAPID and encrypted payloads, admin, daily database backups (14 kept) |
| `web/` | The app: `app.js` (one file, no build step), `sw.js` (offline + notifications), `templates.json` (the love notes) |
| `deploy/` | Install/update on Ubuntu: a memory-capped systemd service behind Caddy |

Messages are stored on your server (like WhatsApp Web or Telegram's cloud chats): that's what makes usernames,
several devices per person, the admin and readable notifications possible. Everything travels over HTTPS, the
database stays on your server, and backups live in `data/backups`.

© 2026 danafarmansyah. All rights reserved. Crafted with ♥.
