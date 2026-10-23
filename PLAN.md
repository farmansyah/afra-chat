# AFRA chat plan

## Done
- v17 shared pet, v18 unread nudges and touch UX, v19 tabs, pet room game and admin broadcast.
- v20 profile photo viewer and nicknames. v21 auto-update, jump-to-newest, pet thought bubbles, AI usage monitor and pet AI switch.
- v22 daily question for two, mood check-in, our dates and countdown, on this day.
- v23 Touches Phase 0 and 1: the Us screen, actions, buzz words, touch storms and the admin storm test. The pet chat keeps the pet and the owners apart (the pet's face on its lines, owners' names on theirs).
- v24 Live touch, plus:
  - Pinned bubbles (several per chat).
  - A photo editor (pinch zoom, crop, rotate) for every photo picker.
  - The partner is told about a new nickname.
- v25 Question cards: 8 decks that unlock with time together, guess mode, and a Spicier deck both must switch on.
- v26 Time capsule letters: write now, open on a chosen date, sealed on the server until then. Up to 4 photos, "both of us" letters, drafts.
- v27 Play: tic-tac-toe, this or that, who's more likely, couple's quiz, 20 questions, draw and guess. +2 coins each per game, +1 to the winner, 20 a day each.
- v28 Shared bucket list (tick off with up to 6 photos, +3 coins once per item) and the Memories album (chat photos and videos, bucket photos, opened letters; shared favourites, slideshow). Home tab tiles.
- v29 Chat settings: read receipts, last seen and typing (each reciprocal), hidden notification text and sender, quiet hours with your own time zone (pushes arrive silently, nudges skipped, touches can still come through), nudge on/off and timings, Enter to send on desktop, archive chats (long-press or swipe).
- v30 Blank or stuck chats fixed: video players are kept when the chat redraws (iPhone was re-downloading every video note on each message), every request times out after 20 s with a retry button, the app opens from cache on a weak signal or during a deploy, and phone errors go to the server journal as `client error` lines. The date night, jar, wishlist and recap work parked on branch v30-pending becomes v32.
- v31 Cards: 204 new questions (634 in all), a Would you rather deck, and Together on one phone: draw, read it out, Next or swipe, Back, turns alternate, no repeats until a deck runs out (remembered on the phone), a Mix deck and a do-it-together deck ("here": true in cards.js, hidden from the two-phone game).

## Next
1. Tune the storm size and spacing from the storm test on your phones.

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

### Phase 2: live touch (v24)
When both of you have the Us screen open at the same time, it becomes one shared, live space instead of "send and receive later".
- **Seeing each other there:** the header says "Raina is here 💞" and her blob wakes up (eyes open, leans towards yours). When she leaves, it settles back to sleep. Under the hood: the Us screen tells the server "I'm here" over the existing WebSocket, and the server tells the other phone.
- **Live taps:** every tap, hold and drum shows on her screen within a fraction of a second. Her blob squishes where you pressed, the action plays (hug, kiss…) and Android phones vibrate with each tap. Taps travel over the WebSocket, roughly 20 small events a second at most, so there is no lag and no server load.
- **No storm while live:** if she's watching live, your taps are not turned into a notification storm (she's already feeling them). The chat chip still records "💋 ×47 · live".
- **Fingers:** both touching at once shows each other's fingertips as soft glowing dots on the blobs.
- **In sync:** touching the same spot, or tapping the same action within a second of each other, makes the blobs hug with a heart burst and "in sync 💞". It counts towards achievements later.
- **Heartbeat:** hold your finger still for 2 seconds to send a steady pulse. Her blob, and her phone on Android, beat with it, and if she holds too, both blobs beat together.
- **Inviting her in:** if she isn't there, a "Come to Us 🫶" button sends one gentle notification that opens straight into the Us screen.
- **Honest limits:** iPhones can't vibrate from a web page, so on iPhone "live" is visual (squish, shake, hearts) plus the normal buzz from notifications when the app is closed. Taps stop when either screen locks; the storm takes over again.

### Phase 3: habits and fun
- Tap your own blob to set your mood (joins the v22 mood check-in). It changes your blob's face and colour.
- A closeness meter that actually means something: it fills with touches, answers and messages today, and the blobs sit closer as it fills.
- Achievements: "Mood 3 days in a row", "50 kisses", "In sync 10 times", "Touched every day for a week". Pet coins and Jamaluddin reacting ("Raina sent 40 hugs while you slept 🥹").
- More actions (massage, warm cheeks, forehead kiss, back scratch, feed, fist bump) and a secret knock you record together.
- Monthly "you touched each other 1,284 times" recap.

## Question cards (v25)
A card game for getting to know each other better. Play it in the Us screen or the chat, together live or one card at a time.

### How it plays
- A deck of cards fans out. One of you draws a card and it flips over with a question ("What's a smell that reminds you of home?").
- The one who drew answers first (text, voice note or photo), then the card passes to the other. Answers stay hidden until both have answered, like the daily question.
- Some cards are "you ask, I answer" and some are "both answer". Skip is always allowed, free, and the card goes back in the deck.
- When both are on the screen, the flip, the answers appearing and the "your turn" happen live (same live channel as Phase 2).
- Every answered card is kept in a "Cards we've played" archive by deck, so you can look back at what you both said.

### Decks that unlock with time together
The deck depends on how long you've been together, read from "Our dates" (v22, the together date). If it isn't set, the app asks once.
- **Just started (0–3 months): Getting to know you.** Light and fun: favourites, childhood, habits, little opinions. "Mountains or beach?", "What's your comfort food?"
- **3–12 months: Going deeper.** Families, friends, what you value, small fears, what made you who you are.
- **1–2 years: Us.** Memories you share, what you love about each other, how you handle hard days, little things the other does.
- **2+ years: The long run.** Dreams, plans, money, home, kids or not, growing old, what you want to keep the same.
- **Always open:** Silly (would-you-rather, hot takes), Spicy-but-sweet (romantic, optional, hidden behind a switch) and Memory lane (uses your real chat history: "What were we talking about 1 year ago today?").
- Earlier decks stay open. New decks unlock with a small celebration on the day ("You've been together 1 year. A new deck unlocked 💌").

### Where the questions come from
- A hand-written bank of about 400 questions in English, natural and not cringe, tagged by deck and level, shipped with the app like lines.js. No AI needed.
- With the pet AI switch on, Jamaluddin can add a fresh follow-up card based on your answers ("You both said the beach. Where would your dream beach trip be?"). Same AI switch and usage monitor as the pet.

### Fun on top
- Draw streaks and pet coins for each card both of you answer.
- "Guess my answer" mode: you answer for her, she answers for herself, and you get a point if you're close (she judges with a 👍 or 👎).
- Jamaluddin sometimes brings a card into the chat in the evening ("Card time? 🃏").

## Pending: closer together, and more fun
### Every day
- [x] Daily question for two: one question a day ("What made you smile today?"). Your answer stays hidden until both have answered, then both are revealed. Builds a streak and an archive of answers. The pet asks it.
- [x] Mood check-in: tap a mood each day (😊 😴 😣 🥰 ...) with an optional word. The other sees it on the chat header, and the pet notices ("Raina's had a rough day, send her something nice?").
- [x] "Thinking of you" tap: one button, a soft buzz and a ♥ on their screen with no words needed. A counter shows how many today.
- [ ] Morning / night ritual: "Good morning" and "Good night" cards with a photo of the sky, the weather where each of you is, and a line from lines.js.

### Memories
- [x] Our dates: anniversary, birthdays, first date and a days-together counter, with a gentle reminder the day before and a small celebration screen on the day.
- [x] On this day: "1 year ago today you sent…", resurfacing old photos and messages from the same date.
- [x] Shared album: a Memories tab of all photos and videos from the chat by month, with favourites and a slideshow.
- [x] Time capsule letter: write a letter now that unlocks on a chosen date (anniversary, graduation, next year).
- [ ] Monthly "our month" recap card: messages sent, photos, longest call, top emoji, pet milestones and streaks. Shareable as an image.

### Together, apart
- [ ] Distance and time: where each of you is (city level, opt-in), the kilometres apart, both local times and a countdown to the next meeting ("Next time together: 12 days").
- [ ] Watch / listen together: share a YouTube or Spotify link and both press play together with a synced countdown.
- [ ] Live location while travelling (from the roadmap), with "arrived safely" auto-messages.
- [ ] Voice and video calls (WebRTC, from the roadmap).

### Play
- [x] Mini games in chat: tic-tac-toe, "who's more likely to", this-or-that, 20 questions, a couple's quiz ("How well do you know me?"), and draw-and-guess. Wins earn pet coins.
- [x] Shared bucket list: places to go, food to try and things to do together. Tick them off with a photo and they go into the album.
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
- [x] Read receipts on/off, reciprocal like WhatsApp: turn yours off and you stop seeing theirs.
- [x] Last seen and online: Everyone / My contacts / Nobody.
- [x] Typing indicator on/off.
- [x] Hide message text in notifications: show "New message" only. Useful for the lock screen and the watch.
- [ ] Chat lock: a per-chat passcode or Face ID (WebAuthn) to open a chat. Client side only; the server password rules are unchanged.
- [ ] Disappearing messages per chat: off, 24 hours, 7 days or 90 days.

### Notifications
- [x] Quiet hours per person (e.g. 23:00 to 07:00). Notifications and nudges wait until morning.
- [x] Unread nudge settings: on/off, choose the timings (15/45 by default), and never during quiet hours.
- [x] "Thinking of you" tap: one button sends a soft vibration and a ♥ notification, with no message needed.
- [ ] Optional forward to Telegram, for watches that don't show web-app alerts (Huawei Health on iPhone).

### Remind us of each other
- [x] Our dates: anniversary, birthdays and a "days together" counter, with gentle reminders the day before.
- [ ] Good morning / good night nudge: if we haven't said it by a set time, suggest a line from lines.js.
- [ ] A weekly "our week" card: photos, voice notes, streak and the pet's highlights.
- [ ] A mood/status line ("in the lab 🧪", "sleepy 😴") shown under the name.

### Comfort
- [x] Enter to send on desktop (on/off).
- [ ] Media: auto-download on Wi-Fi only (data saver), and a default photo quality.
- [x] Archive chats, alongside pin.
- [ ] Export my own chat (.zip) for each user, not just the admin.
- [ ] Per-chat notification tone and vibration pattern. Android/desktop only; iOS web push can't change them.

### Tech debt
- [ ] Album thumbnails: the album loads full-size photos. All files on the server total 2.2 MB today and photos are already shrunk on the phone before upload, so this waits until the album gets heavy (it needs Pillow on the server).
- [x] File links: decided to leave as is. Each file id is 128 random bits, and an id only reaches people who are in that chat. Checking membership on every photo load would touch avatars, wallpapers, the pet, letters and bucket photos for no real gain.
- [ ] Sync pins, appearance and these settings across devices (server-side prefs instead of localStorage).
- [ ] Video note: letting go during the first camera-permission prompt drops the note silently. Show a hint instead.
- [ ] Earlier roadmap: live location, stickers, WebRTC calls, admin-granted privacy.
