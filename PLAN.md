# AFRA chat plan

## Done
- v17 shared pet, v18 unread nudges and touch UX, v19 tabs, pet room game and admin broadcast.

## In progress
- v20: full-screen profile photos, and private nicknames for each other ("Dana calls you Sayang 💕").
- v21: auto-update (the app refreshes itself after every deploy, no force restart), and a floating "jump to newest" button in chats with an unread count.
- v22: daily question for two, mood check-in, our dates and countdown, on this day.
- v23: time capsule letters, couple games that earn pet coins, shared bucket list with album.

## Pending: closer together, and more fun
### Every day
- [ ] Daily question for two: one question a day ("What made you smile today?"). Your answer stays hidden until both have answered, then both are revealed. Builds a streak and an archive of answers. The pet asks it.
- [ ] Mood check-in: tap a mood each day (😊 😴 😣 🥰 ...) with an optional word. The other sees it on the chat header, and the pet notices ("Raina's had a rough day, send her something nice?").
- [ ] "Thinking of you" tap: one button, a soft buzz and a ♥ on their screen with no words needed. A counter shows how many today.
- [ ] Morning / night ritual: "Good morning" and "Good night" cards with a photo of the sky, the weather where each of you is, and a line from lines.js.

### Memories
- [ ] Our dates: anniversary, birthdays, first date and a days-together counter, with a gentle reminder the day before and a small celebration screen on the day.
- [ ] On this day: "1 year ago today you sent…", resurfacing old photos and messages from the same date.
- [ ] Shared album: a Memories tab of all photos and videos from the chat by month, with favourites and a slideshow.
- [ ] Time capsule letter: write a letter now that unlocks on a chosen date (anniversary, graduation, next year).
- [ ] Monthly "our month" recap card: messages sent, photos, longest call, top emoji, pet milestones and streaks. Shareable as an image.

### Together, apart
- [ ] Distance and time: where each of you is (city level, opt-in), the kilometres apart, both local times and a countdown to the next meeting ("Next time together: 12 days").
- [ ] Watch / listen together: share a YouTube or Spotify link and both press play together with a synced countdown.
- [ ] Live location while travelling (from the roadmap), with "arrived safely" auto-messages.
- [ ] Voice and video calls (WebRTC, from the roadmap).

### Play
- [ ] Mini games in chat: tic-tac-toe, "who's more likely to", this-or-that, 20 questions, a couple's quiz ("How well do you know me?"), and draw-and-guess. Wins earn pet coins.
- [ ] Shared bucket list: places to go, food to try and things to do together. Tick them off with a photo and they go into the album.
- [ ] Date-night spinner: a wheel of date ideas (stay-in or go-out, budget filter), and the pet suggests one on weekends.
- [ ] Love coupons: make redeemable coupons for each other ("one free massage", "I'll cook tonight") that the other can redeem with a tap.
- [ ] Doodle together: a shared live canvas, with the drawing sent as a sticker.

### Care
- [ ] Wishlist: gift ideas each of you saves privately about the other ("she likes this"), with a reminder before birthdays.
- [ ] Gratitude jar: drop a little note of thanks any time. The jar fills up, and once a week the pet reads one out.
- [ ] Gentle "we should talk" mode: a calm way to ask for a serious conversation, with a calm-down timer and prompts to keep it kind.

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
