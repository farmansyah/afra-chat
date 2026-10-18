/* A.F.R.A ♥: works offline (app shell) and shows notifications with the sender's name and message.
   The notification text arrives encrypted for this phone (Web Push, RFC 8291); only this phone can read it. */
const CACHE = "afra-chat-v25";
const SHELL = ["./", "index.html", "app.css?v=25", "alive.css?v=25", "theme.css?v=25", "app.js?v=25", "lines.js?v=25", "cards.js?v=25", "templates.json", "manifest.webmanifest", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (/^\/(pets|vendor)\//.test(u.pathname)) {  // pet animations and the Lottie player: not in the shell, cached the first time Home needs them
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
    return;
  }
  const shellPage = e.request.mode === "navigate" || u.pathname === "/" || u.pathname.endsWith("/index.html");
  if (shellPage) {  // the page itself: network first so a new deploy shows at once, the cached copy only when offline
    e.respondWith(fetch(e.request, { cache: "no-store" }).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); } return r; })
      .catch(() => caches.match("index.html").then((r) => r || caches.match("./"))));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
self.addEventListener("message", (e) => { if (e.data && e.data.type === "skipWaiting") self.skipWaiting(); });
// the sender's profile picture when they have one (Android and desktop show it; iPhone always shows the app icon)
const iconUrl = (u) => { try { return u ? new URL(u, self.location.origin).href : "icon-512.png"; } catch (err) { return "icon-512.png"; } };
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { }
  // always show one: iOS withdraws push from apps that receive a push silently
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "A.F.R.A ♥", {
      body: d.body || "💌 New message", icon: iconUrl(d.icon), badge: "icon-512.png",
      tag: d.tag || ("conv-" + (d.conv || 0)), renotify: true, vibrate: Array.isArray(d.vibrate) ? d.vibrate : undefined,
      data: { conv: d.conv || 0, touch: d.touch || 0, us: d.us || 0 } });
    if (self.navigator && self.navigator.setAppBadge && d.badge !== undefined) { try { await self.navigator.setAppBadge(d.badge); } catch (err) { } }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const conv = (e.notification.data || {}).conv, touch = (e.notification.data || {}).touch, us = (e.notification.data || {}).us;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    if (cs.length) { cs[0].postMessage({ open: conv, touch: touch || 0, us: us || 0 }); return cs[0].focus(); }
    return self.clients.openWindow(us ? "./#us=" + us : touch ? "./#touch=" + touch : conv ? "./#c=" + conv : "./");
  }));
});
