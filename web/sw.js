/* A.F.R.A ♥: works offline (app shell) and shows notifications with the sender's name and message.
   The notification text arrives encrypted for this phone (Web Push, RFC 8291); only this phone can read it. */
const CACHE = "afra-chat-v20";
const SHELL = ["./", "index.html", "app.css?v=20", "alive.css?v=20", "theme.css?v=20", "app.js?v=20", "lines.js?v=20", "templates.json", "manifest.webmanifest", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (/^\/(pets|vendor)\//.test(u.pathname)) {  // pet animations and the Lottie player: not in the shell, cached the first time Home needs them
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
// the sender's profile picture when they have one (Android and desktop show it; iPhone always shows the app icon)
const iconUrl = (u) => { try { return u ? new URL(u, self.location.origin).href : "icon-512.png"; } catch (err) { return "icon-512.png"; } };
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { }
  // always show one: iOS withdraws push from apps that receive a push silently
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "A.F.R.A ♥", {
      body: d.body || "💌 New message", icon: iconUrl(d.icon), badge: "icon-512.png",
      tag: d.tag || ("conv-" + (d.conv || 0)), renotify: true, data: { conv: d.conv || 0 } });
    if (self.navigator && self.navigator.setAppBadge && d.badge !== undefined) { try { await self.navigator.setAppBadge(d.badge); } catch (err) { } }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const conv = (e.notification.data || {}).conv;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    if (cs.length) { cs[0].postMessage({ open: conv }); return cs[0].focus(); }
    return self.clients.openWindow(conv ? "./#c=" + conv : "./");
  }));
});
