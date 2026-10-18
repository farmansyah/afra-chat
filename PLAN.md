# AFRA chat plan

## Done
- v17 shared pet, v18 unread nudges and touch UX, v19 tabs, pet room game and admin broadcast.
- v20 profile photo viewer and nicknames. v21 auto-update, jump-to-newest, pet thought bubbles, AI usage monitor and pet AI switch.

## In progress
- v22: daily question for two, mood check-in, our dates and countdown, on this day.
- v23: time capsule letters, couple games that earn pet coins, shared bucket list with album.

## Touches (Obimy + tap ME), the long game
What we take from each:
- **Obimy:** you and your partner are two squishy characters. Tap them to pick an action (hug, kiss, hold hands, tickle, wish luck, massage, fist bump, playful punch, throw tomatoes…). Each action is a short animation of the two characters with matching vibration, and the other gets "Dana kissed you". Tap yourself to set your mood. Achievements ("mood 3 days in a row", "send 50 senses"). A closeness meter.
- **Obimy's weak spots, which we avoid:** the animation jumps to a separate screen, it is slow, the closeness meter does nothing, and personalisation sits behind a paywall. Ours plays in place, is instant, and everything is free.
- **tap ME:** one tap = an instant buzz on their phone. Preset words (Thinking of you, Love you, Miss you, Call me, Good morning, Goodnight, On my way, Hungry?). "Send one back". Spam as much as you miss them, each tap with a small pop sound.

### What the web can and can't do (honest limits)
- iPhone web apps can't set vibration patterns or shake the lock screen. Each notification buzzes once with the normal iPhone buzz, so a storm of 30 notifications is 30 buzzes. That is the "earthquake".
- Android and desktop Chrome can do custom vibration patterns while the app is open.
- Touch pressure: newer iPhones report no force. Strength is estimated from hold time, tap speed and fingertip size, with real force where the phone has it.
- Home-screen widgets aren't possible for web apps. A pinned "Touch" shortcut on the app icon (long-press menu) is possible on Android.
- Apple may hold back or group very fast pushes, so Phase 0 measures this on your real phones first.

### Phase 0: spike on your phones (small)
- Admin test button: send yourself 10, 20 and 40 notifications at 150, 300 and 600 ms apart. Count how many arrive and buzz on the iPhones and the Huawei watch.
- Check the iOS 18 "switch" haptic trick inside the home-screen app.
- The result sets the storm size and spacing.

### Phase 1: "Us" space and the storm
- **Us screen:** a new space (from the 🫶 in the chat header, and on Home) with two soft, squishy glass blobs wearing your profile photos, breathing gently. They wobble when touched and lean towards each other when both of you are online.
- **Actions:** tap her blob to open the action ring: hug 🫂, kiss 💋, hold hands 🤝, poke 👉, tickle 🤭, stroke 🤲, heartbeat 💓, wish luck 🍀, and pranks (tomatoes 🍅, pillow 🪶, playful punch 👊). Each one plays in place: the blobs jump together and squish, hearts or emoji burst out (Noto animated emoji), with a matching vibration on Android.
- **Buzz bar (tap ME):** a row of word chips under the blobs (Thinking of you, Love you, Miss you, Call me, Good morning, Goodnight, On my way, Hungry?). One tap = one buzz with that word.
- **Force and spam:** hold or drum on her blob instead of tapping once. Hold longer and drum faster = stronger, and the blob squishes harder under your finger. Every extra tap adds to the storm, with a "×12" counter climbing above her head.
- **Storm:** 1.5 s after you stop, the server turns it into N pushes (N grows with taps and strength, capped by Phase 0), spaced to your rhythm. Each push has your photo and nickname, stacks rather than replaces, and escalates: "kissed you" → "kissed you again" → "won't stop kissing you 💋" → "×30 kisses!!".
- **Receiving in the app:** the screen shakes with the strength (earthquake for big storms), your blob flies in and does the action to theirs, the phone vibrates on Android, and a counter shows "Dana sent you 47 kisses". Opening the app from a storm notification replays it.
- **In the chat:** a compact chip ("💋 ×47 · strong") with "Send one back".
- **Receiver settings:** Touch storms Full / Gentle (one notification) / Off, quiet hours (night touches replay in the morning), and watch mode (only the first buzz).
- **Safety:** pairs only, server rate limit (e.g. 3 storms a minute and 200 pushes an hour).

### Phase 2: live touch
- When you're both on the Us screen, every tap arrives instantly: you see and feel each other's taps live.
- Both touching at once shows each other's fingers. Touching the same spot makes the blobs hug with a heart burst ("in sync 💞").
- Heartbeat: hold your finger to send a steady pulse that their blob and phone beat with.

### Phase 3: habits and fun
- Tap your own blob to set your mood (joins the v22 mood check-in). It changes your blob's face and colour.
- A closeness meter that actually means something: it fills with touches, answers and messages today, and the blobs sit closer as it fills.
- Achievements: "Mood 3 days in a row", "50 kisses", "In sync 10 times", "Touched every day for a week". Pet coins and Jamaluddin reacting ("Raina sent 40 hugs while you slept 🥹").
- More actions (massage, warm cheeks, forehead kiss, back scratch, feed, fist bump) and a secret knock you record together.
- Monthly "you touched each other 1,284 times" recap.

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
