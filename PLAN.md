# AFRA chat plan

## In progress
- Shared pet "Home" (v17)
- Unread nudges: if a 1:1 message is still unread, remind the reader 15 min and 45 min after it arrived

## Pending: chat settings
Ordered roughly lightest first.

### Privacy
- [ ] Read receipts on/off, reciprocal like WhatsApp: turn yours off and you stop seeing theirs.
- [ ] Last seen and online: Everyone / My contacts / Nobody.
- [ ] Typing indicator on/off.
- [ ] Hide message text in notifications: show "New message" only. Useful for the lock screen and the watch.
- [ ] Chat lock: a per-chat passcode or Face ID (WebAuthn) to open a chat. Client side only; the server password rules are unchanged.
- [ ] Disappearing messages per chat: off, 24 hours, 7 days or 90 days.

### Notifications
- [ ] Quiet hours per person (e.g. 23:00 to 07:00). Notifications and nudges wait until morning.
- [ ] Unread nudge settings: on/off, choose the timings (15/45 by default), and never during quiet hours.
- [ ] "Thinking of you" tap: one button sends a soft vibration and a ♥ notification, with no message needed.
- [ ] Optional forward to Telegram, for watches that don't show web-app alerts (Huawei Health on iPhone).

### Remind us of each other
- [ ] Our dates: anniversary, birthdays and a "days together" counter, with gentle reminders the day before.
- [ ] Good morning / good night nudge: if we haven't said it by a set time, suggest a line from lines.js.
- [ ] A weekly "our week" card: photos, voice notes, streak and the pet's highlights.
- [ ] A mood/status line ("in the lab 🧪", "sleepy 😴") shown under the name.

### Comfort
- [ ] Enter to send on desktop (on/off).
- [ ] Media: auto-download on Wi-Fi only (data saver), and a default photo quality.
- [ ] Archive chats, alongside pin.
- [ ] Export my own chat (.zip) for each user, not just the admin.
- [ ] Per-chat notification tone and vibration pattern. Android/desktop only; iOS web push can't change them.

### Tech debt
- [ ] Sync pins, appearance and these settings across devices (server-side prefs instead of localStorage).
- [ ] Video note: letting go during the first camera-permission prompt drops the note silently. Show a hint instead.
- [ ] Earlier roadmap: live location, stickers, WebRTC calls, admin-granted privacy.
