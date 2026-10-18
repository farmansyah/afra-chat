/* A.F.R.A ♥ chat: a small private social chat. iPhone Home Screen app (with notifications), and in any browser.
   Accounts with usernames and profile photos, one chat per person plus "Notes to self", admin invites.
   (c) 2026 danafarmansyah. All rights reserved. Crafted with love. */
(() => {
  "use strict";
  const APP_V = 23;  // must match afra-chat-vNN in sw.js: the server compares it with /api/version to know when this copy is old
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const now = () => Date.now() / 1000;
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const store = { get(k, d) { try { const v = localStorage.getItem("afra_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
                  set(k, v) { try { localStorage.setItem("afra_" + k, JSON.stringify(v)); } catch { } }, del(k) { try { localStorage.removeItem("afra_" + k); } catch { } } };
  const DEVICE = store.get("device") || (store.set("device", "d" + rid().slice(0, 10)), store.get("device"));
  const TAB = DEVICE + "." + rid().slice(0, 5);  // each open copy (a tab, the copy inside A.F.R.A) has its own connection
  // ---- Appearance (per device): text size, font, accent colour. Saved as store "look" = { size, font, accent }
  const LOOK_SIZES = [["small", "Small", .9], ["normal", "Normal", 1], ["large", "Large", 1.15], ["xl", "Extra large", 1.3]];
  const LOOK_FONTS = [["system", "System", ""], ["rounded", "Rounded", 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif'], ["serif", "Serif", 'Georgia, "Times New Roman", serif'], ["mono", "Mono", 'ui-monospace, "SF Mono", Menlo, Consolas, monospace']];
  const LOOK_ACCENTS = ["", "#ff3b5c", "#7c5cff", "#34c759", "#ff9500", "#0a84ff"];   // "" = the app's own accent
  const LOOK_DEFAULT = { size: "normal", font: "system", accent: "" };
  function applyLook(l) {
    l = { ...LOOK_DEFAULT, ...(l || {}) };
    const st = document.documentElement.style, k = (LOOK_SIZES.find((x) => x[0] === l.size) || LOOK_SIZES[1])[2], f = (LOOK_FONTS.find((x) => x[0] === l.font) || LOOK_FONTS[0])[2];
    st.setProperty("--fs", k + "em"); st.setProperty("--fsk", String(k));
    f ? st.setProperty("--lookfont", f) : st.removeProperty("--lookfont");
    const a = LOOK_ACCENTS.includes(l.accent) ? l.accent : "";
    if (!a) { ["--accent", "--accent-press", "--mine", "--mine-ink", "--on-accent"].forEach((p) => st.removeProperty(p)); return; }
    const n = parseInt(a.slice(1), 16), lin = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const lum = .2126 * lin(n >> 16) + .7152 * lin((n >> 8) & 255) + .0722 * lin(n & 255), ink = lum > .4 ? "#000000" : "#ffffff";
    st.setProperty("--accent", a); st.setProperty("--accent-press", a); st.setProperty("--mine", a); st.setProperty("--mine-ink", ink); st.setProperty("--on-accent", ink);
  }
  applyLook(store.get("look"));
  function lookSheet() { const s = sheet(`<h3>Appearance</h3>${lookHTML()}`); lookBind(s); }
  // ---- small delights: soft sounds (made on the fly, no files), emoji bursts, a big heart, a greeting
  let AC = null;
  function sound(kind) {
    if (!store.get("sound", true)) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
      const [f1, f2, len] = kind === "send" ? [520, 880, .12] : kind === "recv" ? [880, 660, .18] : [700, 1050, .08];
      o.type = "sine"; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + len);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + len + .08);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + len + .1);
    } catch { }
  }
  function burstAt(el, emoji, n = 7) {
    if (!el) return; const r = el.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const b = document.createElement("div"); b.className = "burst"; b.textContent = emoji;
      b.style.left = r.left + r.width / 2 - 13 + "px"; b.style.top = r.top + r.height / 2 - 13 + "px";
      b.style.setProperty("--dx", (Math.random() * 120 - 60) + "px"); b.style.setProperty("--dy", (-60 - Math.random() * 90) + "px");
      b.style.setProperty("--rot", (Math.random() * 60 - 30) + "deg"); b.style.animationDelay = i * 30 + "ms";
      document.body.appendChild(b); setTimeout(() => b.remove(), 1300);
    }
  }
  function bigHeart(x, y) { const h = document.createElement("div"); h.className = "bigheart"; h.textContent = "❤️"; h.style.left = x + "px"; h.style.top = y + "px"; document.body.appendChild(h); setTimeout(() => h.remove(), 900); }
  function greeting() {
    const h = new Date().getHours(), n = (S.me && (S.me.name || "").split(" ")[0]) || "";
    const g = h < 5 ? ["Still up", "🌙"] : h < 11 ? ["Good morning", "☀️"] : h < 15 ? ["Good afternoon", "🌤"] : h < 19 ? ["Good evening", "🌇"] : ["Good night", "🌙"];
    return `${g[0]}${n ? ", " + esc(n) : ""} ${g[1]}`;
  }
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }

  // ---- the heart: every so often it taps out "RAINA DANA" in Morse code; tap it for little love notes (same as in A.F.R.A)
  const HB = (() => {
    const MORSE = { R: ".-.", A: ".-", I: "..", N: "-.", D: "-.." }, UNIT = 150, ramp = 35, glow = "drop-shadow(0 0 6px rgba(229,72,77,.85))";
    let t = 0; const beats = [];
    "RAINA DANA".split(" ").forEach((word, wi) => {
      if (wi) t += 4 * UNIT;
      word.split("").forEach((ch) => { MORSE[ch].split("").forEach((sym) => { const on = (sym === "." ? 1 : 3) * UNIT; beats.push([t, t + on]); t += on + UNIT; }); t += 2 * UNIT; });
    });
    const kf = [{ offset: 0, transform: "scale(1)", filter: "none" }];
    beats.forEach((b) => {
      kf.push({ offset: b[0] / t, transform: "scale(1)", filter: "none" }, { offset: (b[0] + ramp) / t, transform: "scale(1.42)", filter: glow },
        { offset: (b[1] - ramp) / t, transform: "scale(1.42)", filter: glow }, { offset: b[1] / t, transform: "scale(1)", filter: "none" });
    });
    kf.push({ offset: 1, transform: "scale(1)", filter: "none" });
    return { kf, total: t };
  })();
  function heartbeat() { $$(".dedi-heart").forEach((h) => { if (h.animate) h.animate(HB.kf, { duration: HB.total, easing: "linear" }); }); }
  if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    const next = (first) => {
      const seen = !!store.get("heartseen"), min = first ? 15 : seen ? 240 : 60, max = first ? 45 : seen ? 480 : 180;
      setTimeout(() => { if (document.visibilityState === "visible") heartbeat(); next(false); }, (min + Math.random() * (max - min)) * 1000);
    };
    next(true);
  }
  function heartNotes() {
    const N = window.AFRA_NOTES; if (!N || !N.notes || !N.notes.length) return;
    store.set("heartseen", 1);
    const last = store.get("notelast", ""), list = [...N.notes].sort(() => Math.random() - .5);
    if (list.length > 1 && list[0] === last) list.push(list.shift());
    store.set("notelast", list[0]);
    const o = document.createElement("div"); o.className = "hn";
    o.innerHTML = `<div class="hn-bg" data-x></div><div class="hn-box">
      <button class="hn-close" data-x aria-label="Close">✕</button>
      <div class="hn-head"><img src="icon-512.png" alt=""><h2>${esc(N.title || "A little note")}</h2></div>
      <div class="hn-track">${list.map((t, i) => `<article class="hn-card ${i ? "" : "on"}"><p>${esc(t)}</p><div class="sig">${esc(N.signature || "")}</div></article>`).join("")}</div>
      <div class="hn-foot"><button class="hn-nav" data-n="-1" aria-label="Previous">‹</button><span data-c>1 / ${list.length}</span><button class="hn-nav" data-n="1" aria-label="Next">›</button></div>
      <small class="hn-tip">Swipe for another note ♥</small></div>`;
    document.body.appendChild(o);
    const tr = $(".hn-track", o), cards = $$(".hn-card", o), cnt = $("[data-c]", o);
    const idx = () => Math.max(0, Math.min(cards.length - 1, Math.round(tr.scrollLeft / (cards[0].offsetWidth + 12))));
    const go = (i) => tr.scrollTo({ left: Math.max(0, Math.min(cards.length - 1, i)) * (cards[0].offsetWidth + 12), behavior: "smooth" });
    tr.addEventListener("scroll", () => { const i = idx(); cnt.textContent = `${i + 1} / ${cards.length}`; cards.forEach((c, k) => c.classList.toggle("on", k === i)); }, { passive: true });
    $$("[data-n]", o).forEach((b) => b.onclick = () => go(idx() + +b.dataset.n));
    const close = () => { if (o.classList.contains("closing")) return; document.removeEventListener("keydown", key); o.classList.add("closing"); setTimeout(() => o.remove(), 200); };
    layer(o, close);
    const key = (e) => { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") go(idx() + 1); else if (e.key === "ArrowLeft") go(idx() - 1); };
    document.addEventListener("keydown", key);
    $$("[data-x]", o).forEach((b) => b.onclick = close);
    burstAt($(".hn-head img", o), "❤️", 5);
  }

  // ------------------------------------------------------------------ bridge to A.F.R.A
  // When A.F.R.A shows this chat (♥ → Messages), the two pages talk directly: unread count, new-message previews and
  // "share in chat". No API key: the login in this chat is the permission, and only an A.F.R.A running on this computer
  // or home network (localhost, *.localhost, 192.168.x.x, 10.x, 172.16–31.x) is answered.
  const EMBED = window.parent !== window;
  const PARENT = EMBED ? ((location.ancestorOrigins && location.ancestorOrigins[0]) || (document.referrer ? new URL(document.referrer).origin : "")) : "";
  const trusted = (o) => { try { const h = new URL(o).hostname; return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost") || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h); } catch { return false; } };
  const BRIDGE = EMBED && trusted(PARENT);
  let SHOWN = !EMBED;  // inside A.F.R.A the chat may be loaded but hidden: then it must not mark messages as read
  const isVisible = () => document.visibilityState === "visible" && SHOWN;
  const toAfra = (msg) => { if (BRIDGE) parent.postMessage({ source: "afra-chat", ...msg }, PARENT); };
  window.addEventListener("message", async (e) => {
    if (!BRIDGE || e.origin !== PARENT || !e.data || e.data.source !== "afra") return;
    const d = e.data;
    if (d.type === "shown") { SHOWN = !!d.v; sendVis(); if (SHOWN && S.cur && conv(S.cur) && conv(S.cur).unread) markRead(S.cur); }
    else if ((d.type === "compose" || d.type === "open") && S.me) {
      let cid = S.cur;
      if (d.username) { try { const c = await api("/api/convs", { body: { username: d.username } }); addConv(c); cid = c.id; } catch (x) { toast(x.message); } }
      if (!cid) { const recent = S.convs.find((c) => c.kind === "direct") || S.convs[0]; cid = recent && recent.id; }
      if (!cid) return;
      if (cid !== S.cur) await openConv(cid);
      if (d.type === "compose" && d.text) { const t = $("#txt"); if (t) { t.value = (t.value.trim() ? t.value.trim() + "\n" : "") + d.text; window.growComposer && window.growComposer(); t.focus(); toast("Ready to send: check it and tap ➤"); } }
    } else if (d.type === "hello") toAfra({ type: "ready", me: S.me ? { username: S.me.username, name: S.me.name } : null, unread: S.convs.reduce((a, c) => a + (c.unread || 0), 0) });
  });

  // ------------------------------------------------------------------ server
  let TOKEN = store.get("token", "");
  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: {} };
    if (TOKEN) init.headers.authorization = "Bearer " + TOKEN;
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers["content-type"] = "application/json"; }
    const r = await fetch(path, init);
    if (r.status === 401 && TOKEN && !opts.noLogout) { logout(true); throw new Error("Please log in again"); }
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail; } catch { } throw new Error(m || "Something went wrong"); }
    return r.json();
  }
  const fileUrl = (id) => `/api/files/${id}?t=${encodeURIComponent(TOKEN)}`;

  // ------------------------------------------------------------------ state
  const S = { me: null, convs: [], msgs: {}, cur: null, view: "list", typing: {}, filter: "", search: "", reply: null, edit: null, older: {}, seen: {}, stars: new Set(), nicks: {}, nickFor: {} };
  const app = $("#app");
  const REACTIONS = ["❤️", "🥰", "😂", "😮", "😢", "🙏", "👍", "🔥"];
  const EMOJIS = "❤️ 🥰 😘 😍 🤗 😊 😁 😂 🥹 😭 😢 🥺 😴 🤔 😮 😎 🙈 🙏 👍 👏 💪 🎉 ✨ 🔥 💯 🌹 🌸 🌙 ☀️ ☕ 🍜 🍦 📚 ✍️ 🎓 💌 💖 💕 💞 💗 🤍 💛 💙 🫶 👀 😅 🙃 😌".split(" ");
  const COLORS = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#978365"];
  const conv = (id) => S.convs.find((c) => c.id === id);
  const other = (c) => (c && c.members && c.members[0]) || null;
  const title = (c) => !c ? "" : c.kind === "self" ? "Notes to self" : c.kind === "bot" ? "Assistant" : c.kind === "pet" ? (c.pet ? c.pet.name : "Home") : (other(c) ? dn(other(c)) : "Chat");
  const userById = (id) => id === S.me.id ? S.me : S.convs.flatMap((c) => c.members).find((u) => u.id === id);
  // nicknames: what I call someone is private to me; dn() is the name I see everywhere
  const dn = (u) => !u ? "" : (S.nicks[u.id] || u.name || "@" + (u.username || ""));
  const mtext = (m) => {  // Home captions are stored with the real first name; show my nickname for them instead
    const n = m.kind === "petact" && m.sender !== S.me.id && S.nicks[m.sender], u = n && userById(m.sender), f = u && (u.name || u.username || "").split(" ")[0];
    return f && m.text.startsWith(f) ? n + m.text.slice(f.length) : m.text;
  };

  function avatar(u, cls = "", self = false) {
    if (self) return `<div class="av ${cls}" style="background:var(--field)">📝</div>`;
    if (!u) return `<div class="av ${cls}">?</div>`;
    if (u.bot === 2) { const pe = (petOf(conv(S.cur)) || {}).emoji; return `<div class="av pet-av ${cls}">${pe || "🐾"}</div>`; }
    if (u.bot) return `<div class="av bot ${cls}">✨</div>`;
    const ini = (u.name || u.username || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const col = COLORS[(u.id || 0) % COLORS.length];
    return `<div class="av ${cls}" data-av="${u.id}" style="background:${col}">${u.avatar ? `<img src="${fileUrl(u.avatar)}" alt="">` : esc(ini)}</div>`;
  }
  const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function shortTime(t) {
    const d = new Date(t * 1000), today = new Date();
    if (d.toDateString() === today.toDateString()) return fmtTime(t);
    if (now() - t < 6 * 86400) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  function dayLabel(t) {
    const d = new Date(t * 1000), today = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }
  function lastSeen(u) {
    if (!u) return "";
    if (u.online) return "online";
    if (!u.last_seen) return "";
    const m = Math.round((now() - u.last_seen) / 60);
    return "last seen " + (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : shortTime(u.last_seen));
  }
  const onlyEmoji = (s) => s && s.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(s);
  const sizeTxt = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const KIND_LABEL = { image: "📷 Photo", voice: "🎤 Voice note", video: "🎥 Video", videonote: "📹 Video note", sticker: "💟 Sticker", location: "📍 Location" };
  const preview = (m) => !m ? "" : m.deleted ? "Message deleted" : m.text ? ({ image: "📷 ", video: "🎥 " }[m.kind] || "") + mtext(m)
    : m.kind === "file" ? "📎 " + ((m.attachment || {}).name || "File") : KIND_LABEL[m.kind] || "";

  // ------------------------------------------------------------------ offline copy (shows your chats instantly, also without internet)
  const cacheSave = () => { store.set("cache", { me: S.me, convs: S.convs, msgs: Object.fromEntries(Object.entries(S.msgs).map(([k, v]) => [k, v.slice(-120)])) }); };
  const cacheLoad = () => { const c = store.get("cache"); if (c && c.me && S.me && c.me.id === S.me.id) { S.convs = c.convs || []; S.msgs = c.msgs || {}; } };
  const OUTBOX = { get: () => store.get("outbox", []), set: (v) => store.set("outbox", v) };

  // ------------------------------------------------------------------ live connection
  let WS = null, wsBackoff = 1000, lastSync = store.get("lastsync", 0);
  function connect() {
    if (!TOKEN) return;
    const ws = WS = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/ws?token=${encodeURIComponent(TOKEN)}&device=${TAB}`);
    ws.onopen = async () => { wsBackoff = 1000; setLive(true); sendVis(); await resync(); flushOutbox(); };
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));
    ws.onclose = (e) => {
      setLive(false);
      if (e.code === 4401) return logout(true);
      if (WS === ws) setTimeout(connect, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 30000);
    };
  }
  setInterval(() => { if (WS && WS.readyState === 1) WS.send('{"t":"ping"}'); }, 25000);
  const sendVis = () => { if (WS && WS.readyState === 1) WS.send(JSON.stringify({ t: "vis", v: isVisible() })); };
  let LIVE = false, LOADED = false;
  function setLive(v) { LIVE = v; drawHeader(); drawList(); }

  async function resync() {
    try {
      S.me = await api("/api/me"); pwGate();
      try { const nk = await api("/api/nicknames"); S.nicks = nk.my_nicks || {}; S.nickFor = nk.nicks_for_me || {}; } catch { }
      S.convs = await api("/api/convs");
      try { S.stars = new Set((await api("/api/stars")).map((m) => m.id)); } catch { }
      const since = lastSync ? lastSync - 5 : 0, t0 = now();
      for (const c of S.convs) {
        if (!S.msgs[c.id] || !since) { await loadConv(c.id); continue; }
        if ((c.last_at || 0) > since || c.unread) {
          const r = await api(`/api/convs/${c.id}/messages?since=${since}`);
          r.messages.forEach((m) => upsert(m));
        }
      }
      lastSync = t0; store.set("lastsync", t0); LOADED = true;
      cacheSave(); drawAll();
    } catch (e) { console.warn(e); }
  }
  async function loadConv(cid) {
    const r = await api(`/api/convs/${cid}/messages?limit=80`);
    S.msgs[cid] = r.messages; S.older[cid] = r.messages.length >= 80;
    const i = S.convs.findIndex((c) => c.id === cid); if (i >= 0) S.convs[i] = r.conv;
  }
  function upsert(m) {
    const list = S.msgs[m.conv_id] || (S.msgs[m.conv_id] = []);
    const i = list.findIndex((x) => x.id === m.id || (x.pending && x.client_id === m.client_id));
    if (i >= 0) list[i] = m; else { list.push(m); list.sort((a, b) => (a.created - b.created) || ((a.id || 0) - (b.id || 0))); }
  }

  function onEvent(e) {
    if (e.t === "hello" || e.t === "update") { if (e.t === "update" || (e.version && String(e.version) !== String(APP_V))) checkUpdate(true); return; }
    if (e.t === "touch") { onTouchEvent(e); return; }
    if (e.t === "msg" || e.t === "upd") {
      upsert(e.msg);
      const c = conv(e.msg.conv_id);
      if (!c) { resync(); return; }
      if (e.t === "msg") {
        c.last = e.msg; c.last_at = e.msg.created;
        if (c.kind === "pet" && e.msg.kind === "text" && e.msg.text && (userById(e.msg.sender) || {}).bot === 2) petThink(c.id, e.msg.text);
        if (e.msg.sender !== S.me.id) {
          delete S.typing[c.id];
          if (S.cur === c.id && isVisible()) markRead(c.id); else c.unread = (c.unread || 0) + 1;
          if (!isVisible() && e.msg.kind !== "touch") toAfra({ type: "message", conv: c.id, from: title(c), text: preview(e.msg) });
          if (e.msg.kind !== "touch" && isVisible() && (S.cur === c.id || !isMuted(c))) { sound(S.cur === c.id ? "recv" : "ping"); if (S.cur !== c.id) inAppNotice(c, e.msg); }
        }
        S.convs.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
      } else if (c.last && c.last.id === e.msg.id) c.last = e.msg;
      cacheSave(); drawList(e.t === "msg" && e.msg.sender !== S.me.id ? c.id : 0); if (S.cur === e.msg.conv_id) drawChat();
    } else if (e.t === "read") {
      const c = conv(e.conv); if (!c) return;
      if (e.user !== S.me.id) { c.other_read = Math.max(c.other_read || 0, e.at); if (S.cur === c.id) drawChat(); }
      else { c.unread = 0; drawList(); badge(); }
    } else if (e.t === "typing") {
      S.typing[e.conv] = now() + 5; drawList(); if (S.cur === e.conv) drawHeader();
    } else if (e.t === "presence") {
      S.convs.forEach((c) => c.members.forEach((u) => { if (u.id === e.user) { u.online = e.online; u.last_seen = e.at; } }));
      drawList(); drawHeader();
    } else if (e.t === "nick" || e.t === "nickfor") {
      const map = e.t === "nick" ? S.nicks : S.nickFor, id = e.t === "nick" ? e.other : e.user;
      if (e.nick) map[id] = e.nick; else delete map[id];
      drawAll(); refreshInfo();
    } else if (e.t === "profile") {
      S.convs.forEach((c) => c.members.forEach((u, i) => { if (u.id === e.user.id) c.members[i] = { ...u, ...e.user }; }));
      drawAll();
    } else if (e.t === "conv") {
      const i = S.convs.findIndex((c) => c.id === e.conv.id); if (i >= 0) S.convs[i] = e.conv; else S.convs.unshift(e.conv);
      if (S.cur === e.conv.id) applyStyle();
      if (e.styled && e.by !== S.me.id && S.cur === e.conv.id) toast(`${dn(userById(e.by)) || "They"} changed the chat theme`);
      cacheSave(); drawList();    } else if (e.t === "pet") {
      onPetEvent(e);
    } else if (e.t === "mood") {
      applyMood(e.user, e.mood);
    } else if (e.t === "home") {
      onHomeEvent(e);
    } else if (e.t === "conv_gone") {  // the admin deleted the other person's account
      S.convs = S.convs.filter((c) => c.id !== e.conv); delete S.msgs[e.conv];
      if (S.cur === e.conv) { S.cur = null; setView("list"); history.replaceState(null, "", location.pathname); }
      cacheSave(); drawList(); badge();
    }
  }
  function inAppNotice(c, m) {  // a banner slides down from the top; tap to open, swipe up (or wait) to dismiss
    $$(".banner-in").forEach((x) => x.remove());
    const b = document.createElement("div"); b.className = "banner-in";
    const pu = petOf(c) && m.sender !== petOf(c).bot && m.sender !== S.me.id && userById(m.sender);  // in the pet chat: the pet's face, and the owner's name on their own lines
    b.innerHTML = `${cav(c, "sm")}<div class="mid"><b>${esc(title(c))}</b><small>${pu ? esc(dn(pu).split(" ")[0]) + ": " : ""}${esc(preview(m))}</small></div>`;
    const close = () => { b.classList.add("out"); setTimeout(() => b.remove(), 260); };
    b.onclick = () => { close(); openConv(c.id); };
    let y0 = 0; b.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    b.addEventListener("touchmove", (e) => { if (e.touches[0].clientY - y0 < -20) close(); }, { passive: true });
    document.body.appendChild(b); setTimeout(close, 4200);
  }
  function badge() {
    const n = S.convs.reduce((a, c) => a + (c.unread || 0), 0);
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { });
    document.title = (n ? `(${n}) ` : "") + "A.F.R.A ♥";
    toAfra({ type: "unread", count: n }); tabBadges();
  }
  let readTimer = null;
  function markRead(cid) {
    const c = conv(cid); if (c) c.unread = 0; badge();
    clearTimeout(readTimer); readTimer = setTimeout(() => api(`/api/convs/${cid}/read`, { body: {} }).catch(() => { }), 300);
  }

  // ------------------------------------------------------------------ sending (queued while offline)
  async function send(fields) {
    const cid = S.cur, m = { id: 0, conv_id: cid, sender: S.me.id, client_id: rid(), kind: "text", text: "", reply_to: null, attachment: null,
      reactions: {}, created: now(), edited: 0, deleted: false, pending: true, ...fields };
    upsert(m); OUTBOX.set([...OUTBOX.get(), m]); drawChat(); scrollEnd(true); sound("send");
    const c = conv(cid); if (c) { c.last = m; c.last_at = m.created; S.convs.sort((a, b) => (b.last_at || 0) - (a.last_at || 0)); drawList(); }
    flushOutbox();
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !navigator.onLine) return; flushing = true;
    try {
      for (const m of OUTBOX.get()) {
        const saved = await api(`/api/convs/${m.conv_id}/messages`, { body: { client_id: m.client_id, kind: m.kind, text: m.text, reply_to: m.reply_to, attachment: m.attachment } });
        upsert(saved); OUTBOX.set(OUTBOX.get().filter((x) => x.client_id !== m.client_id));
      }
    } catch (e) { if (!/fetch|network/i.test(e.message)) { toast("Couldn't send: " + e.message); } }
    flushing = false; cacheSave(); if (S.cur) drawChat();
  }
  addEventListener("online", flushOutbox);

  // ------------------------------------------------------------------ screens
  function shell() {
    app.innerHTML = `
      <section class="pane-list"><div class="lscroll">
        <div class="top"><div id="meAv" style="cursor:pointer"></div><h1>Chats<small class="greet" id="greet"></small></h1>
          <button class="icon dedi-heart" id="bHeart" title="A little note" aria-label="A little note">♥</button><button class="icon" id="bAdmin" title="Admin" hidden>🛡</button></div>
        <div id="banner"></div>
        <div class="list-tools"><input type="search" id="lq" placeholder="Search chats"></div>
        <div class="convs" id="convs"></div></div>
        <button class="fab" id="bNew" title="New chat" aria-label="New chat"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z"/><path d="M12 8v7M8.5 11.5h7"/></svg></button>
      </section>
      <section class="pane-chat" id="chatPane"></section>`;
    $("#bNew").onclick = newChat; $("#bHeart").onclick = heartNotes; $("#bAdmin").onclick = adminPage; $("#meAv").onclick = () => setTab("settings");
    $("#lq").oninput = (e) => { S.filter = e.target.value.trim().toLowerCase(); drawList(); };
    setView(S.view); drawAll(); drawBanner(); mountTabs(); celebrateCheck();
  }
  function setView(v) { if (S.view !== v) { app.classList.remove("slide"); void app.offsetWidth; app.classList.add("slide"); } S.view = v; app.dataset.view = v; if (v === "list" && S.tab === "home" && H.drawn) homeDraw(); syncAnim(); }
  function drawAll() { if (!$("#convs")) return; $("#greet").innerHTML = greeting(); $("#meAv").innerHTML = avatar(S.me, "sm"); $("#bAdmin").hidden = !S.me.is_admin; drawList(); drawChatPane(); badge(); }

  // Pinned chats (up to 3). There is no per-user settings store on the server, so this is saved on this device.
  const pinList = () => (store.get("pins", []) || []).filter((id) => S.convs.some((c) => c.id === id));
  function bindPin(d) {  // long-press (touch) or right-click (mouse) on a chat
    let t = 0, x = 0, y = 0;
    const open = () => { d._lp = 1; setTimeout(() => { d._lp = 0; }, 700); pinSheet(+d.dataset.c); };
    d.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!d._lp) open(); });
    d.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") return; x = e.clientX; y = e.clientY; clearTimeout(t); t = setTimeout(() => { t = 0; if (navigator.vibrate) navigator.vibrate(12); open(); }, 480); });
    d.addEventListener("pointermove", (e) => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 9) { clearTimeout(t); t = 0; } });
    ["pointerup", "pointercancel", "pointerleave"].forEach((n) => d.addEventListener(n, () => { clearTimeout(t); t = 0; }));
  }
  function pinSheet(cid) {
    const c = conv(cid); if (!c) return;
    const pins = pinList(), on = pins.includes(cid);
    const s = sheet(`<h3>${esc(title(c))}</h3><div class="menu"><button data-p>${on ? "📌 Unpin chat" : "📌 Pin chat"}</button></div>`);
    $("[data-p]", s).onclick = () => {
      s.remove();
      if (!on && pins.length >= 3) return toast("You can pin up to 3 chats");
      store.set("pins", on ? pins.filter((x) => x !== cid) : [...pins, cid]); drawList(); toast(on ? "Unpinned" : "Pinned to the top");
    };
  }

  function drawList(bumpId) {
    const el = $("#convs"); if (!el) return;
    const before = {}; $$(".conv", el).forEach((d) => { before[d.dataset.c] = d.getBoundingClientRect().top; });
    if (!S.convs.length && !LOADED) { el.innerHTML = [1, 2, 3, 4].map(() => `<div class="skeleton"><i style="width:44px;height:44px;border-radius:50%"></i><span style="flex:1"><i style="width:45%;height:13px;margin-bottom:8px"></i><i style="width:75%;height:11px"></i></span></div>`).join(""); return; }
    const t = now();
    const pins = pinList(), items = S.convs.filter((c) => !S.filter || title(c).toLowerCase().includes(S.filter) || (other(c) && other(c).username.includes(S.filter)));
    const rank = (id) => { const i = pins.indexOf(id); return i < 0 ? 99 : i; };
    items.sort((x, y) => rank(x.id) - rank(y.id));  // pinned chats first (the sort keeps everything else in order)
    el.innerHTML = items.map((c) => {
      const u = other(c), typing = (S.typing[c.id] || 0) > t;
      const last = c.kind === "pet" && c.pet ? petSub(c) : c.last ? (c.last.sender === S.me.id && c.kind !== "self" ? "You: " : "") + preview(c.last) : c.kind === "self" ? "Keep notes, links and photos for yourself" : c.kind === "bot" ? "Reminders, notes, lists, questions" : "Say hi 👋";
      return `<div class="conv ${S.cur === c.id ? "on" : ""} ${c.kind === "pet" && c.pet && c.pet.needs_care ? "needs" : ""}" data-c="${c.id}">
        <div class="av-wrap ${u && u.online && !u.bot && c.kind !== "pet" ? "on" : ""}">${cav(c)}</div>
        <div class="mid"><div class="row1"><b>${esc(title(c))}</b>${pins.includes(c.id) ? `<i class="pin" title="Pinned">📌</i>` : ""}<small>${c.last ? shortTime(c.last.created) : ""}</small></div>
          <div class="row2"><span class="${typing ? "typing" : ""}">${typing ? "typing…" : esc(last)}</span>${isMuted(c) ? `<i class="muted">🔕</i>` : ""}${c.unread ? `<span class="badge ${isMuted(c) ? "quiet" : ""}">${c.unread}</span>` : ""}</div></div></div>`;
    }).join("") || `<div class="empty">No chats yet.<br><small>Tap 💬 at the bottom right to start one.</small></div>`;
    $$(".conv", el).forEach((d) => {
      d.onclick = () => { if (d._lp) { d._lp = 0; return; } openConv(+d.dataset.c); };
      bindPin(d);
      const was = before[d.dataset.c], top = d.getBoundingClientRect().top;
      if (was !== undefined && Math.abs(was - top) > 2 && d.animate) d.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
      if (+d.dataset.c === bumpId) d.classList.add("bump");
    });
  }

  async function openConv(cid) {
    S.cur = cid; S.reply = S.edit = null; S.search = ""; setView("chat");
    chatEnter(cid);
    drawList(); drawChatPane(true);
    if (!S.msgs[cid]) { try { await loadConv(cid); } catch (e) { toast(e.message); } drawChat(); scrollEnd(true); }
    const c = conv(cid); if (c && c.unread) markRead(cid);
  }

  let dockRO = null;  // one observer for the composer, re-pointed on each redraw
  function drawChatPane(focus) {
    const pane = $("#chatPane"); if (!pane) return;
    const c = conv(S.cur);
    if (!c) { pane.innerHTML = `<div class="blank"><div><div style="font-size:48px">💌</div>Choose a chat, or tap 💬 to start one.</div></div>`; return; }
    pane.innerHTML = `
      <div class="top"><button class="icon back" id="bBack">‹</button><div id="chatAv"></div>
        <div class="who"><b id="chatName"></b><small id="chatStat"></small></div>
        <button class="icon dedi-heart" id="bHeartC" title="A little note" aria-label="A little note">♥</button>${c.kind === "direct" ? '<button class="icon" id="bUs" title="Touch" aria-label="Touch">🫶</button>' : ""}<button class="icon" id="bSearch" title="Search">🔍</button></div>
      <div class="searchbar" id="sbar" hidden><input type="search" id="sq" placeholder="Search in this chat"><button class="cbtn" id="sclose">✕</button></div>
      <div class="home" id="home" hidden></div>
      <div class="log" id="log"></div>
      <button class="jump" id="bJump" aria-label="Jump to newest message" tabindex="-1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><b class="jbadge"></b></button>
      <div class="dock" id="dock">
        <div class="typing-line" id="typing"></div>
        <div id="replybar"></div>
        <div class="quick" id="quick"></div>
        <div class="compose" id="compose">
          <button class="cbtn plus" id="battach" title="Attach" aria-label="Attach"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
          <div class="pill"><textarea id="txt" rows="1" placeholder="Message"></textarea><button class="cbtn" id="bemoji" title="Emoji">😊</button></div>
          <div class="rcap"><button class="cbtn cam" id="bcam" title="Tap for a photo or video, hold for a video note" aria-label="Camera"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.7A1.5 1.5 0 0 1 10.5 3.5h3a1.5 1.5 0 0 1 1.2.8L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/></svg></button>
          <button class="cbtn send" id="bsend" title="Send">🎤</button></div>
          <input type="file" id="bcamfile" accept="image/*,video/*" capture hidden>
        </div>
      </div>`;
    $("#bBack").onclick = () => { if (NAV.chat && NAV.depth === NAV.chat) history.back(); else { NAV.chat = 0; leaveChat(); navSync(); } };
    const bus = $("#bUs"); if (bus) bus.onclick = () => usOpen(c.id);
    $("#bSearch").onclick = () => { $("#sbar").hidden = false; $("#sq").focus(); };
    $("#bHeartC").onclick = heartNotes;
    $("#sclose").onclick = () => { $("#sbar").hidden = true; S.search = ""; drawChat(); };
    $("#sq").oninput = (e) => { S.search = e.target.value.trim().toLowerCase(); drawChat(); };
    const txt = $("#txt");
    const grow = () => {
      txt.style.height = "auto"; txt.style.height = Math.min(txt.scrollHeight, 140) + "px";
      const typed = !!(txt.value.trim() || S.edit), b = $("#bsend");
      $("#compose").classList.toggle("typed", typed);
      if (b.dataset.mode !== (typed ? "send" : "mic")) { b.dataset.mode = typed ? "send" : "mic"; b.textContent = typed ? "➤" : "🎤"; b.classList.remove("swap"); void b.offsetWidth; b.classList.add("swap"); }
      $("#quick").classList.toggle("hide", typed);
    };
    let lastTyping = 0;
    txt.oninput = () => { grow(); if (txt.value && now() - lastTyping > 3 && c.kind !== "self" && c.kind !== "bot") { lastTyping = now(); api(`/api/convs/${c.id}/typing`, { body: {} }).catch(() => { }); } };
    txt.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); sendText(); } if (e.key === "Escape") { S.reply = S.edit = null; drawReply(); } };
    $("#bsend").onclick = () => (txt.value.trim() || S.edit) ? sendText() : toggleVoice();
    $("#battach").onclick = attachMenu;
    $(".top .who", pane).onclick = infoPage; $("#chatAv").onclick = infoPage;
    $("#bemoji").onclick = openEmoji; bindCamera();
    const dock = $("#dock"), logEl = $("#log");  // the glass bar floats over the chat: keep the last message clear of it
    if (window.ResizeObserver) (dockRO && dockRO.disconnect(), dockRO = new ResizeObserver(() => { const near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 160; logEl.style.paddingBottom = (dock.offsetHeight + 6) + "px"; pane.style.setProperty("--dockh", dock.offsetHeight + "px"); if (near) logEl.scrollTop = logEl.scrollHeight; })).observe(dock);
    pane.style.setProperty("--dockh", dock.offsetHeight + "px");
    jumpBind(pane, logEl);
    window.growComposer = grow; grow(); drawQuick();
    pane.classList.toggle("is-pet", c.kind === "pet");
    applyStyle(); drawHeader(); drawHome(); drawChat(); scrollEnd(true);
    if (vrev) { const v = vrev; if (v.cid === S.cur) voiceReview(v.file, v.secs); else voiceDiscard(); }
    if (focus && !matchMedia("(pointer: coarse)").matches) txt.focus();
  }

  function bindCamera() {  // tap: take a photo or video. Hold: a round video note (slide up to lock, left to cancel, let go to send)
    const b = $("#bcam"), f = $("#bcamfile"); if (!b) return;
    f.onchange = (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) mediaPreview(fs); };
    let timer = 0, held = false, ctl = null, sx = 0, sy = 0, pid = null;
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("pointerdown", (e) => {
      if (e.button) return; sx = e.clientX; sy = e.clientY; pid = e.pointerId; ctl = null;
      try { b.setPointerCapture(pid); } catch { }
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0; held = true; ctl = { dx: 0, dy: 0, up: false, abort: false }; b.classList.add("hold");
        if (navigator.vibrate) navigator.vibrate(15);
        recordVideoNote({ hold: true, ctl });
      }, 300);
    });
    b.addEventListener("pointermove", (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) { clearTimeout(timer); timer = 0; }
      if (ctl) { ctl.dx = e.clientX - sx; ctl.dy = e.clientY - sy; if (ctl.onmove) ctl.onmove(); }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return; clearTimeout(timer); timer = 0; b.classList.remove("hold");
      if (ctl) { const c = ctl; ctl = null; c.up = true; c.abort = e.type === "pointercancel"; if (c.onup) c.onup(); setTimeout(() => { held = false; }, 400); }
    };
    b.addEventListener("pointerup", end); b.addEventListener("pointercancel", end);
    b.addEventListener("click", () => { if (held) return; b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); f.click(); });
  }

  async function drawQuick() {  // one tap sends: a heart, a hug, a few love notes (new ones each time), surprise
    const el = $("#quick"); if (!el) return;
    const ck = (conv(S.cur) || {}).kind;
    if (ck === "bot" || ck === "pet") {
      const pn = ck === "pet" ? (petOf(conv(S.cur)) || {}).name || "buddy" : "";
      const ex = ck === "pet" ? [["💬 Hi " + pn, "Hi " + pn + "! How are you?"], ["⏰ Remind us", "Remind us both to take a walk in 30 minutes"], ["🛒 Our list", "Add milk to our shopping list"], ["📋 What's on?", "What's on our lists and reminders?"]]
        : [["⏰ Remind me", "Remind me in 10 minutes to stretch"], ["🛒 Shopping list", "Add milk to my shopping list"],
        ["📋 My lists", "What's on my lists?"], ["📅 My reminders", "What are my reminders?"]];
      el.innerHTML = ex.map(([l], i) => `<button data-x="${i}">${esc(l)}</button>`).join("");
      $$("[data-x]", el).forEach((b) => b.onclick = () => { b.classList.add("sent"); setTimeout(() => b.classList.remove("sent"), 400); send({ text: ex[+b.dataset.x][1] }); });
      return;
    }
    const tpl = await loadTemplates();
    const pickChips = () => {  // a fresh mix: a couple from templates.json plus lines from lines.js, no repeats
      const tp = tplPool(tpl.categories || []).filter(([, t]) => t.length <= 46), lines = [...(window.AFRA_LINES || [])];
      const out = [], seen = new Set(), add = (t) => { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } };
      for (let n = 0; n < 2 && tp.length; n++) add(tp.splice(pickWeighted(tp), 1)[0][1]);
      while (out.length < 5 && lines.length) add(lines.splice(Math.floor(Math.random() * lines.length), 1)[0]);
      while (out.length < 5 && tp.length) add(tp.splice(pickWeighted(tp), 1)[0][1]);
      return out.sort(() => Math.random() - .5);
    };
    let chips = [];
    const paint = (anim) => {
      chips = ["❤️", ...pickChips()];
      el.classList.remove("rolling"); el.classList.toggle("shuf", !!anim);
      el.innerHTML = chips.map((t, i) => `<button data-q="${i}" style="--i:${i}" class="${t.length <= 3 ? "emo" : ""}">${esc(t)}</button>` + (i === 0 ? `<button data-q="dice" class="dice ${anim ? "settle" : ""}" title="Shuffle the suggestions" aria-label="Shuffle the suggestions">🎲</button>` : "")).join("") + `<button data-q="more" title="More messages">💌 More</button>`;
      $$("[data-q]", el).forEach((b) => b.onclick = () => {
        if (b.dataset.q === "more") return openTemplates();
        if (b.dataset.q === "dice") {
          if (el.classList.contains("rolling")) return;
          if (navigator.vibrate) navigator.vibrate(10);
          b.classList.add("roll"); el.classList.add("rolling"); setTimeout(() => paint(true), 480); return;
        }
        b.classList.add("sent"); setTimeout(() => b.classList.remove("sent"), 400);
        const t = chips[+b.dataset.q];
        send({ text: t, reply_to: S.reply ? S.reply.id : null }); S.reply = null; drawReply();
        if (t.length > 3) setTimeout(() => $("#quick") === el && paint(true), 500);  // fresh suggestions
      });
    };
    paint(false);
  }

  function drawHeader() {
    const c = conv(S.cur); if (!c || !$("#chatName")) return;
    const u = other(c), typing = (S.typing[c.id] || 0) > now();
    $("#chatAv").innerHTML = `<div class="av-wrap ${u && u.online && !u.bot && c.kind !== "pet" ? "on" : ""}">${cav(c, "sm")}</div>`;
    $("#chatName").textContent = title(c);
    const st = $("#chatStat");
    st.textContent = !LIVE ? "connecting…" : c.kind === "self" ? "only you can see this" : typing ? "typing…" : c.kind === "bot" ? "personal assistant" : c.kind === "pet" ? "Home · you & " + (S.nicks[u && u.id] || ((u && u.name) || "them").split(" ")[0]) : [c.kind === "direct" ? moodTxt(moodNow(c.mood)) : "", lastSeen(u), u ? "@" + u.username : ""].filter(Boolean).join("  ·  ");
    st.className = typing || (u && u.online) ? "live" : "";
    const tl = $("#typing");
    if (typing && !tl.firstChild) { tl.innerHTML = `<div class="typing-bub" title="${esc(title(c))} is typing"><i></i><i></i><i></i></div>`; scrollEnd(); }
    else if (!typing && tl.firstChild) tl.innerHTML = "";
  }
  setInterval(() => { drawHeader(); const t = now(); if (Object.values(S.typing).some((x) => x < t && x > t - 2)) drawList(); }, 2000);

  // ---- jump to newest: shows when you have scrolled well up; new messages that arrive meanwhile are counted on it
  const JUMP = { n: 0, last: 0, raf: 0, el: null, log: null };
  const jumpFar = (log) => log.scrollHeight - log.scrollTop - log.clientHeight > Math.min(300, log.clientHeight);
  function jumpUpdate() {
    const b = JUMP.el, log = JUMP.log; if (!b || !log || !log.isConnected) return;
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 140) JUMP.n = 0;
    const show = jumpFar(log), badge = b.querySelector(".jbadge");
    b.classList.toggle("show", show); b.tabIndex = show ? 0 : -1;
    badge.textContent = JUMP.n > 99 ? "99+" : JUMP.n; badge.classList.toggle("on", JUMP.n > 0);
  }
  function jumpBind(pane, log) {
    JUMP.n = 0; JUMP.last = 0; JUMP.el = $("#bJump", pane); JUMP.log = log;
    log.addEventListener("scroll", () => { if (!JUMP.raf) JUMP.raf = requestAnimationFrame(() => { JUMP.raf = 0; jumpUpdate(); }); }, { passive: true });
    JUMP.el.onclick = () => {
      navigator.vibrate && navigator.vibrate(8);
      JUMP.n = 0; log.scrollTo({ top: log.scrollHeight, behavior: "smooth" }); jumpUpdate();
    };
  }
  function scrollEnd(force) { const log = $("#log"); if (log && (force || log.scrollHeight - log.scrollTop - log.clientHeight < 140)) log.scrollTop = log.scrollHeight; }

  function bubbleBody(m, list) {
    if (m.deleted) return `<div class="txt">This message was deleted</div>`;
    if (m.kind === "petinvite") return petInviteCard(m, conv(m.conv_id) || {});
    const a = m.attachment;
    let html = "";
    if (m.reply_to) {
      const q = list.find((x) => x.id === m.reply_to);
      const who = q ? (q.sender === S.me.id ? "You" : dn(userById(q.sender))) : "";
      html += `<div class="quote" data-goto="${m.reply_to}"><b>${esc(who)}</b> ${esc(q ? preview(q) : "Earlier message").slice(0, 120)}</div>`;
    }
    if (a && a.id) {
      if (m.kind === "image") html += `<img class="photo" src="${fileUrl(a.id)}" alt="${esc(a.name)}" loading="lazy" data-full="${fileUrl(a.id)}">`;
      else if (m.kind === "voice") html += `<audio controls preload="none" src="${fileUrl(a.id)}"></audio>`;
      else if (m.kind === "video") html += `<div class="vid" data-v${a.w ? ` style="aspect-ratio:${Math.max(.6, Math.min(1.8, a.w / a.h))}"` : ""}>${a.poster ? `<img src="${fileUrl(a.poster)}" alt="" loading="lazy">` : `<video src="${fileUrl(a.id)}#t=0.1" preload="metadata" muted playsinline></video>`}<span class="vid-play">▶</span><span class="vid-len">🎥 ${a.dur ? fmtDur(a.dur) : ""}</span></div>`;
      else if (m.kind === "videonote") html += `<div class="vnote" data-vn><video src="${fileUrl(a.id)}#t=0.1"${a.poster ? ` poster="${fileUrl(a.poster)}"` : ""} playsinline preload="metadata"></video><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg><span class="vn-play">▶${a.dur ? " " + fmtDur(a.dur) : ""}</span></div>`;
      else html += `<a class="file" href="${fileUrl(a.id)}" target="_blank" download="${esc(a.name)}"><span style="font-size:28px">📄</span><span><b>${esc(a.name)}</b><small>${sizeTxt(a.size || 0)}</small></span></a>`;
    } else if (a && a.local) html += `<div class="txt">⏳ ${esc(a.name)}</div>`;
    if (m.text) html += `<div class="txt ${onlyEmoji(m.text) ? "big" : ""}">${esc(mtext(m))}</div>`;
    return html;
  }

  function drawChat() {
    const log = $("#log"), c = conv(S.cur); if (!log || !c) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    const list = S.msgs[c.id] || [];
    const shown = S.search ? list.filter((m) => (m.text || "").toLowerCase().includes(S.search) || (m.attachment && (m.attachment.name || "").toLowerCase().includes(S.search))) : list;
    let html = S.older[c.id] && !S.search ? `<button class="older" id="bOlder">Show earlier messages</button>` : "", lastDay = "";
    const seen = S.seen[c.id], fresh = new Set();
    let prevSender = 0;
    for (const m of shown) {
      const day = dayLabel(m.created);
      if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
      const mine = m.sender === S.me.id;
      const read = c.kind !== "self" && (c.other_read || 0) >= m.created;
      const ticks = mine && !m.deleted && c.kind !== "self" ? `<span class="ticks ${read ? "read" : ""}">${m.pending ? "🕓" : read ? "✓✓" : "✓"}</span>` : (m.pending ? "🕓" : "");
      const key = m.client_id || m.id; fresh.add(key);
      const pop = seen && !seen.has(key) ? "pop" : "";
      const pbot = (petOf(c) || {}).bot, ps = c.kind === "pet" && !m.deleted && m.kind === "text" && (m.sender === pbot || (userById(m.sender) || {}).bot === 2);
      const who = c.kind === "pet" && !mine && !ps && !m.deleted && m.kind !== "petact" && m.kind !== "petinvite" && m.sender !== pbot && prevSender !== m.sender ? userById(m.sender) : null;  // owners keep their name, never the pet's look
      prevSender = m.kind === "petact" ? 0 : m.sender;  // the pet speaking: a thought cloud instead of a normal bubble
      if (pop && !atBottom && !S.search && !mine && !m.deleted && m.created >= JUMP.last) JUMP.n++;
      if (m.kind === "touch" && !m.deleted) { html += touchChip(m, pop); continue; }
      html += `<div class="msg ${mine ? "mine" : ""} ${m.pending ? "pending" : ""} ${pop} ${m.kind === "petact" ? "petact" : m.kind === "petinvite" ? "petcard" : ""} ${ps ? "petsay" : ""}" data-id="${m.id || ""}" data-cid="${esc(m.client_id || "")}">
        ${ps ? `<span class="psav" aria-hidden="true">${esc((petOf(c) || {}).emoji || "🐾")}</span>` : ""}${who ? `<div class="msg-who">${esc(dn(who).split(" ")[0])}</div>` : ""}<div class="bub ${m.deleted ? "deleted" : ""} ${!m.deleted && (m.kind === "videonote" || m.kind === "sticker") ? "bare" : ""}">${bubbleBody(m, list)}</div>
        ${rxPill(m)}
        <div class="meta">${S.stars.has(m.id) ? "⭐ " : ""}${m.edited && !m.deleted ? "edited · " : ""}${fmtTime(m.created)} ${ticks}</div></div>`;
    }
    if (list.length) JUMP.last = Math.max(JUMP.last, list[list.length - 1].created || 0);
    log.innerHTML = html + (list.length ? "" : `<div class="empty">${c.kind === "self" ? "Your private notes: only you can see this chat." : c.kind === "bot" ? "Ask me anything, or tell me what to remember ✨" : c.kind === "pet" ? "Say hello 🐾" : `Say hi to ${esc(title(c))} 👋<br><small>💌 has ready-made messages.</small>`}</div>`);
    const older = $("#bOlder"); if (older) older.onclick = loadOlder;
    $$("img.photo", log).forEach((img) => img.onclick = (e) => { e.stopPropagation(); const m = list.find((x) => x.id === +img.closest(".msg").dataset.id); if (m) viewMedia(m, list); });
    $$("[data-v]", log).forEach((el) => el.onclick = (e) => { e.stopPropagation(); const m = list.find((x) => x.id === +el.closest(".msg").dataset.id); if (m) viewMedia(m, list); });
    bindVideoNotes(log); bindPetCards(log); bindTouchChips(log);
    $$("[data-rxs]", log).forEach((b) => b.onclick = (e) => { e.stopPropagation(); navigator.vibrate && navigator.vibrate(5); rxSheet(+b.dataset.rxs); });
    $$("[data-goto]", log).forEach((q) => q.onclick = (e) => {
      e.stopPropagation(); const t = $(`.msg[data-id="${q.dataset.goto}"]`); if (!t) return;
      t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1400);
    });
    $$(".msg", log).forEach(bindPress);
    S.seen[c.id] = fresh;
    if (atBottom) log.scrollTo({ top: log.scrollHeight, behavior: seen ? "smooth" : "auto" });
    jumpUpdate();
    drawHeader();
  }
  async function loadOlder() {
    const c = conv(S.cur), list = S.msgs[c.id] || [], first = list.find((m) => m.id);
    const log = $("#log"), h = log.scrollHeight;
    const r = await api(`/api/convs/${c.id}/messages?before=${first ? first.id : 0}&limit=80`);
    S.msgs[c.id] = [...r.messages, ...list.filter((m) => !r.messages.some((x) => x.id === m.id))];
    S.older[c.id] = r.messages.length >= 80; drawChat(); log.scrollTop = log.scrollHeight - h;
  }

  function bindPress(el) {  // long-press (phone) or right-click (computer): menu. Double-tap: ❤️
    let timer = null, lastTap = 0, x0 = 0, y0 = 0, dx = 0;
    const id = +el.dataset.id; if (!id) return;
    el.addEventListener("touchstart", (e) => {
      if (e.target.closest(".reacts") || EDGE.on) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; el.style.transition = "none";
      timer = setTimeout(() => { timer = null; navigator.vibrate && navigator.vibrate(10); msgMenu(id); }, 450);
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {  // swipe right to reply
      if (EDGE.on) { clearTimeout(timer); timer = null; return; }
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (Math.abs(mx) > 6 || Math.abs(my) > 6) { clearTimeout(timer); timer = null; }
      if (mx > 0 && Math.abs(my) < 30) { dx = Math.min(mx, 90); el.style.transform = `translateX(${dx}px)`; el.classList.toggle("swipe-ready", dx > 60); }
    }, { passive: true });
    el.addEventListener("touchend", () => {
      if (timer) clearTimeout(timer);
      el.style.transition = "transform .2s ease"; el.style.transform = ""; el.classList.remove("swipe-ready");
      if (dx > 60) { const m = findMsg(id); if (m && !m.deleted) { navigator.vibrate && navigator.vibrate(8); S.reply = m; S.edit = null; drawReply(); $("#txt").focus(); } }
      dx = 0;
    });
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); msgMenu(id); });
    el.addEventListener("click", (e) => {
      if (e.target.closest("a,audio,img,video,.quote,.reacts,[data-vn],[data-v]")) return;
      const t = Date.now(); if (t - lastTap < 320) { bigHeart(e.clientX, e.clientY); if ((findMsg(id) || {}).reactions?.[S.me.id] !== "❤️") react(id, "❤️"); lastTap = 0; } else lastTap = t;
    });
  }
  const findMsg = (id) => (S.msgs[S.cur] || []).find((m) => m.id === id);

  // ------------------------------------------------------------------ chat themes: background and bubbles (for both of you, or just for me)
  const BUBBLES = [  // id, name, my bubble, my text, (their bubble, their text)
    ["default", "Classic", "#3797f0", "#fff"],
    ["love", "Love", "linear-gradient(135deg,#ff6b9a,#ff2d55)", "#fff"],
    ["candy", "Cotton candy", "linear-gradient(135deg,#7aa7ff,#ff8fd1)", "#fff"],
    ["sunset", "Sunset", "linear-gradient(135deg,#ffa53c,#ff4f81)", "#fff"],
    ["ocean", "Ocean", "linear-gradient(135deg,#00c6c2,#2f6bff)", "#fff"],
    ["aurora", "Aurora", "linear-gradient(135deg,#2fd98f,#0f9bd7)", "#fff"],
    ["grape", "Grape", "linear-gradient(135deg,#a259ff,#6a3df0)", "#fff"],
    ["berry", "Berry", "linear-gradient(135deg,#d6246e,#8e2de2)", "#fff"],
    ["gold", "Gold", "linear-gradient(135deg,#f7d774,#d4a017)", "#2b1d00"],
    ["peach", "Peach", "#ffcfb0", "#4a2a12", "#fff1e8", "#4a2a12"],
    ["butter", "Butter", "#ffe27a", "#3d3000", "#fff8d6", "#3d3000"],
    ["matcha", "Matcha", "#b5e3a1", "#1d3b12", "#eef8e8", "#1d3b12"],
    ["lilac", "Lilac", "#d8c6ff", "#2e1a5c", "#f3eeff", "#2e1a5c"],
    ["mono", "Mono", "var(--ink)", "var(--bg)"],
  ];
  const pat = (svg, fill, base, size = 48) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/FILL/g, fill))}") 0 0/${size}px ${size}px repeat, ${base}`;
  const HEART = "<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><path d='M14 20s-6-3.7-6-7.5A3.2 3.2 0 0 1 14 10.6a3.2 3.2 0 0 1 6 1.9C20 16.3 14 20 14 20zM38 44s-6-3.7-6-7.5a3.2 3.2 0 0 1 6-1.9 3.2 3.2 0 0 1 6 1.9C44 40.3 38 44 38 44z' fill='FILL'/></svg>";
  const DOTS = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='6' cy='6' r='2' fill='FILL'/><circle cx='18' cy='18' r='2' fill='FILL'/></svg>";
  const STARS = "<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><path d='M15 6l1.6 4.4L21 12l-4.4 1.6L15 18l-1.6-4.4L9 12l4.4-1.6zM45 36l1.2 3.3 3.3 1.2-3.3 1.2L45 45l-1.2-3.3-3.3-1.2 3.3-1.2zM44 10l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM14 44l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' fill='FILL'/></svg>";
  const GRID = "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M28 0H0v28' fill='none' stroke='FILL' stroke-width='1'/></svg>";
  const BGS = [  // id, name, light mode, dark mode (empty = same), is it dark [light, dark]
    ["none", "Plain", "", "", [false, false]],
    ["blush", "Blush", "#fde2e4", "#2a1519", [false, true]], ["sky", "Sky", "#dcefff", "#0f1d2c", [false, true]],
    ["mint", "Mint", "#dff5e8", "#0f2219", [false, true]], ["sand", "Sand", "#f4ecdf", "#221d15", [false, true]],
    ["lilac", "Lilac", "#ece4ff", "#1b1530", [false, true]],
    ["g-love", "Love", "linear-gradient(160deg,#ffe0ec,#ffb3cf 60%,#ff8ab4)", "linear-gradient(160deg,#2a0f1c,#4a1531 60%,#6b1d45)", [false, true]],
    ["g-sunset", "Sunset", "linear-gradient(160deg,#ffd9b8,#ffa8bd 55%,#cfa6ff)", "linear-gradient(160deg,#3a1d2b,#4b2140 55%,#2c2152)", [false, true]],
    ["g-ocean", "Ocean", "linear-gradient(160deg,#c4efff,#8cc4ff 60%,#7d95f0)", "linear-gradient(160deg,#071a2b,#0d3157 60%,#1c2f6e)", [false, true]],
    ["g-aurora", "Aurora", "linear-gradient(160deg,#0b1d3a,#1f6f78 55%,#3ddc97)", "", [true, true]],
    ["g-dusk", "Dusk", "linear-gradient(160deg,#2b1055,#7597de)", "", [true, true]],
    ["g-peach", "Peach", "linear-gradient(160deg,#fff1e6,#ffd6c2)", "linear-gradient(160deg,#2a1c14,#3b2418)", [false, true]],
    ["p-hearts", "Hearts", pat(HEART, "#ff9fbf", "#fff2f6"), pat(HEART, "#5a2038", "#1a0d13"), [false, true]],
    ["p-dots", "Dots", pat(DOTS, "#c9d3e6", "#f7f9fc", 24), pat(DOTS, "#26304a", "#0b0f18", 24), [false, true]],
    ["p-stars", "Stars", pat(STARS, "#f0c64a", "#fffaf0", 60), pat(STARS, "#b9a560", "#0c1024", 60), [false, true]],
    ["p-grid", "Paper", pat(GRID, "#e3e8f0", "#ffffff", 28), pat(GRID, "#1c2230", "#0a0c12", 28), [false, true]],
  ];
  const darkMode = () => matchMedia("(prefers-color-scheme: dark)").matches;
  const hasKeys = (o) => !!o && Object.keys(o).length > 0;
  const chatStyle = (c) => (c && hasKeys(c.my_style) ? c.my_style : (c && c.style) || {});
  function isDark(hex) {
    const m = /#([0-9a-f]{6})/i.exec(hex || ""); if (!m) return false;
    const n = parseInt(m[1], 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
  }
  const inkFor = (hex) => isDark(hex) ? "#ffffff" : "#111111";
  function bgCss(st) {  // [css background, is it dark?]
    const b = st.bg || "";
    if (b.startsWith("photo:")) { if (store.get("photobg", true) === false) return ["", false]; const d = (st.dim ?? 25) / 100; return [`linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${fileUrl(b.slice(6))}") center/cover no-repeat`, d >= 0.2]; }
    if (b === "custom") { const a = st.bg1 || "#ffd1dc", z = st.bg2 || a; return [`linear-gradient(160deg,${a},${z})`, isDark(a) && isDark(z)]; }
    const p = BGS.find((x) => x[0] === b); if (!p || !p[2]) return ["", false];
    const dm = darkMode() && !!p[3]; return [dm ? p[3] : p[2], p[4][darkMode() ? 1 : 0]];
  }
  function bubbleVars(st) {
    if (st.bubble === "custom") { const m = st.mine || "#ff6b9a"; return { mine: m, mineInk: inkFor(m), theirs: st.theirs || "", theirsInk: st.theirs ? inkFor(st.theirs) : "" }; }
    const p = BUBBLES.find((x) => x[0] === st.bubble);
    return !p || p[0] === "default" ? null : { mine: p[2], mineInk: p[3], theirs: p[4] || "", theirsInk: p[5] || "" };
  }
  function paintStyle(el, log, st) {
    const [bg, dark] = bgCss(st);
    log.style.background = bg; log.classList.toggle("styled", !!bg); log.classList.toggle("on-dark", !!bg && dark);
    const v = bubbleVars(st);
    ["--mine-bg", "--mine-ink", "--theirs", "--theirs-ink"].forEach((k) => el.style.removeProperty(k));
    el.classList.toggle("themed", !!v);
    if (v) {
      el.style.setProperty("--mine-bg", v.mine); el.style.setProperty("--mine-ink", v.mineInk);
      if (v.theirs) { el.style.setProperty("--theirs", v.theirs); el.style.setProperty("--theirs-ink", v.theirsInk); }
    }
  }
  function applyStyle() { const c = conv(S.cur), pane = $("#chatPane"), log = $("#log"); if (c && pane && log) paintStyle(pane, log, chatStyle(c)); }
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyStyle); } catch { }

  const photoSwitch = () => `<label class="swrow"><span><b>Photo backgrounds</b><small>Turn off to use the plain background on this device (nice on a computer)</small></span><input type="checkbox" class="swtog" id="tphotobg" ${store.get("photobg", true) === false ? "" : "checked"}></label>`;
  function wallpaperPreview(blob, d) {  // full-screen look at a photo before it becomes the chat background
    return new Promise((res) => {
      const url = URL.createObjectURL(blob); let dim = d.dim ?? 25;
      const o = document.createElement("div"); o.className = "wpv";
      o.innerHTML = `<div class="wpv-bg" style="background-image:url('${url}')"></div><div class="wpv-dim"></div>
        <div class="wpv-top"><button class="wpv-b" data-c>Cancel</button><b>Wallpaper preview</b><span></span></div>
        <div class="log wpv-log">
          <div class="msg"><div class="bub"><div class="txt">Hey you 👋 how does this look?</div></div></div>
          <div class="msg mine"><div class="bub"><div class="txt">I love it ♥</div></div><div class="meta">${fmtTime(now())} <span class="ticks read">✓✓</span></div></div>
          <div class="msg"><div class="bub"><div class="txt">Then it's yours.</div></div></div>
        </div>
        <div class="wpv-bot"><label>Darken <input type="range" min="0" max="70" value="${dim}"></label>
          <div class="wpv-btns"><button class="sbtn" data-c>Cancel</button><button class="big-btn" data-ok>Set wallpaper</button></div></div>`;
      document.body.appendChild(o);
      const log = $(".wpv-log", o), dm = $(".wpv-dim", o);
      paintStyle(o, log, { bg: "none", bubble: d.bubble, mine: d.mine, theirs: d.theirs });
      log.classList.add("styled");
      const paint = () => { dm.style.opacity = dim / 100; log.classList.toggle("on-dark", dim >= 20); };
      paint();
      let fin = false;
      const done = (v) => { if (fin) return; fin = true; document.removeEventListener("keydown", key); o.classList.add("closing"); setTimeout(() => { o.remove(); URL.revokeObjectURL(url); }, 180); res(v); };
      layer(o, () => done(null));
      const key = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", key);
      $("input", o).oninput = (e) => { dim = +e.target.value; paint(); };
      $$("[data-c]", o).forEach((b) => b.onclick = () => done(null));
      $("[data-ok]", o).onclick = () => done({ dim });
    });
  }
  function themeSheet() {
    const c = conv(S.cur); if (!c) return;
    const shared = c.kind !== "self", mineOwn = hasKeys(c.my_style);
    let scope = mineOwn ? "me" : "both", tab = "bg", d = { ...chatStyle(c) };
    const isPhoto = () => String(d.bg || "").startsWith("photo:");
    const s = sheet(`<h3>Chat theme</h3>
      <div class="tprev" id="tprev"><div class="log" id="tlog">
        <div class="msg"><div class="bub"><div class="txt">Hey you 👋</div></div></div>
        <div class="msg mine"><div class="bub"><div class="txt">Hi! I like this one</div></div><div class="meta">${fmtTime(now())} <span class="ticks read">✓✓</span></div></div>
      </div></div>
      <div class="seg" id="ttabs"><button data-t="bg">Background</button><button data-t="bub">Bubbles</button></div>
      <div id="tbody"></div>
      ${shared ? `<h4>Who sees it</h4><div class="seg" id="tscope"><button data-s="both">Both of us</button><button data-s="me">Just me</button></div>` : ""}
      <button class="big-btn" id="tsave" style="margin-top:14px">Apply</button>
      <div class="row" style="justify-content:center;margin-top:8px"><button class="sbtn" id="treset">Default look</button>
        ${shared && mineOwn ? `<button class="sbtn" id="tfollow">Use the shared theme</button>` : ""}</div>
      <input type="file" id="tphoto" accept="image/*" hidden>`);
    const preview = () => paintStyle($("#tprev", s), $("#tlog", s), d);
    const draw = () => {
      $$("#ttabs button", s).forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
      $$("#tscope button", s).forEach((b) => b.classList.toggle("on", b.dataset.s === scope));
      const body = $("#tbody", s);
      if (tab === "bg") {
        const cur = isPhoto() ? "photo" : (d.bg || "none");
        body.innerHTML = photoSwitch() + `<div class="swatches">${BGS.map(([id, name]) => `<button class="sw ${cur === id ? "on" : ""}" data-bg="${id}"><i style="background:${esc(bgCss({ bg: id })[0] || "var(--bg)")}"></i><span>${name}</span></button>`).join("")}
          <button class="sw ${cur === "photo" ? "on" : ""}" data-bg="photo"><i style="${isPhoto() ? `background:${esc(bgCss(d)[0])}` : ""}">📷</i><span>Your photo</span></button>
          <button class="sw ${cur === "custom" ? "on" : ""}" data-bg="custom"><i style="background:${esc(bgCss({ bg: "custom", bg1: d.bg1 || "#ffd1dc", bg2: d.bg2 || "#c3b1ff" })[0])}"></i><span>Custom</span></button></div>
          ${cur === "custom" ? `<div class="row colors"><label>Top <input type="color" id="tbg1" value="${d.bg1 || "#ffd1dc"}"></label><label>Bottom <input type="color" id="tbg2" value="${d.bg2 || "#c3b1ff"}"></label></div>` : ""}
          ${cur === "photo" ? `<label class="row colors">Darken <input type="range" id="tdim" min="0" max="70" value="${d.dim ?? 25}" style="flex:1"></label>` : ""}`;
      } else {
        const cur = d.bubble || "default";
        body.innerHTML = `<div class="swatches">${BUBBLES.map(([id, name, bg, ink]) => `<button class="sw ${cur === id ? "on" : ""}" data-bub="${id}"><i class="bubsw" style="background:${bg};color:${ink}">Aa</i><span>${name}</span></button>`).join("")}
          <button class="sw ${cur === "custom" ? "on" : ""}" data-bub="custom"><i class="bubsw" style="background:${d.mine || "#ff6b9a"};color:${inkFor(d.mine || "#ff6b9a")}">🎨</i><span>Custom</span></button></div>
          ${cur === "custom" ? `<div class="row colors"><label>Mine <input type="color" id="tmine" value="${d.mine || "#ff6b9a"}"></label><label>Theirs <input type="color" id="ttheirs" value="${d.theirs || (darkMode() ? "#262626" : "#efefef")}"></label></div>` : ""}`;
      }
      $$("[data-bg]", body).forEach((b) => b.onclick = () => {
        const v = b.dataset.bg;
        if (v === "photo") return $("#tphoto", s).click();
        d.bg = v; if (v === "custom") { d.bg1 = d.bg1 || "#ffd1dc"; d.bg2 = d.bg2 || "#c3b1ff"; } draw();
      });
      const ps = $("#tphotobg", body); if (ps) ps.onchange = () => { store.set("photobg", ps.checked); draw(); applyStyle(); };
      $$("[data-bub]", body).forEach((b) => b.onclick = () => { d.bubble = b.dataset.bub; if (d.bubble === "custom") d.mine = d.mine || "#ff6b9a"; draw(); });
      const live = (id, key, redraw) => { const el = $("#" + id, body); if (el) { el.oninput = () => { d[key] = key === "dim" ? +el.value : el.value; preview(); }; if (redraw) el.onchange = draw; } };
      live("tbg1", "bg1", true); live("tbg2", "bg2", true); live("tdim", "dim"); live("tmine", "mine", true); live("ttheirs", "theirs", true);
      preview();
    };
    $$("#ttabs button", s).forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
    $$("#tscope button", s).forEach((b) => b.onclick = () => { scope = b.dataset.s; draw(); });
    $("#tphoto", s).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try {
        const img = await shrinkImage(f, 1600), pick = await wallpaperPreview(img, d); if (!pick) return;
        toast("Uploading…"); const fd = new FormData(); fd.append("file", img, img.name);
        const att = await api("/api/files", { body: fd }); d.bg = "photo:" + att.id; d.dim = pick.dim; store.set("photobg", true); draw();
      } catch (x) { toast(x.message); }
    };
    const save = async (style, sc) => {
      try {
        const v = await api(`/api/convs/${c.id}/style`, { method: "PUT", body: { scope: sc, style } });
        const i = S.convs.findIndex((x) => x.id === c.id); if (i >= 0) S.convs[i] = v;
        cacheSave(); applyStyle(); s.remove();
        toast(!shared ? "Theme saved" : sc === "me" ? (hasKeys(style) ? "Theme set just for you" : "Back to the shared theme") : "Theme set for both of you");
      } catch (x) { toast(x.message); }
    };
    $("#tsave", s).onclick = () => {
      const st = { bg: isPhoto() ? d.bg : (d.bg || "none"), bubble: d.bubble || "default" };
      if (st.bg === "custom") { st.bg1 = d.bg1; st.bg2 = d.bg2; }
      if (isPhoto()) st.dim = d.dim ?? 25;
      if (st.bubble === "custom") { st.mine = d.mine; if (d.theirs) st.theirs = d.theirs; }
      save(st, shared ? scope : "both");
    };
    $("#treset", s).onclick = () => { d = {}; draw(); };
    const fol = $("#tfollow", s); if (fol) fol.onclick = () => save({}, "me");
    draw();
  }

  // ------------------------------------------------------------------ photo cropper (profile photo): drag to move, pinch / slider / wheel to zoom
  function cropImage(file, out = 512) {
    return new Promise(async (resolve) => {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) { toast("That photo can't be opened"); return resolve(null); }
      const s = sheet(`<h3>Move and scale</h3>
        <div class="crop" id="crop"><canvas id="ccan"></canvas><div class="crop-ring"></div></div>
        <div class="row colors"><span>➖</span><input type="range" id="czoom" min="100" max="400" value="100" style="flex:1"><span>➕</span></div>
        <div class="row" style="margin-top:12px"><button class="big-btn ghost" id="ccancel" style="flex:1">Cancel</button><button class="big-btn" id="cdone" style="flex:1">Done</button></div>`);
      const box = $("#crop", s), can = $("#ccan", s), ctx = can.getContext("2d");
      const D = box.clientWidth || 300, dpr = window.devicePixelRatio || 1;
      can.width = can.height = Math.round(D * dpr); can.style.width = can.style.height = D + "px";
      const base = Math.max(D / bmp.width, D / bmp.height);  // smallest scale that still fills the circle
      let z = 1, x = 0, y = 0;  // zoom, and offset of the photo's centre from the box centre (css px)
      const clamp = () => {
        const w = bmp.width * base * z, h = bmp.height * base * z;
        x = Math.max(-(w - D) / 2, Math.min((w - D) / 2, x)); y = Math.max(-(h - D) / 2, Math.min((h - D) / 2, y));
      };
      const paint = () => {
        clamp(); const k = base * z * dpr;
        ctx.clearRect(0, 0, can.width, can.height);
        ctx.drawImage(bmp, (can.width - bmp.width * k) / 2 + x * dpr, (can.height - bmp.height * k) / 2 + y * dpr, bmp.width * k, bmp.height * k);
      };
      const zoomTo = (nz) => { const r = Math.max(1, Math.min(4, nz)) / z; x *= r; y *= r; z *= r; $("#czoom", s).value = Math.round(z * 100); paint(); };
      const pts = new Map(); let last = null;
      box.onpointerdown = (e) => { box.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = null; };
      box.onpointermove = (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 1) { x += e.clientX - prev[0]; y += e.clientY - prev[1]; paint(); }
        else { const [a, b] = [...pts.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]); if (last) zoomTo(z * dist / last); last = dist; }
      };
      box.onpointerup = box.onpointercancel = (e) => { pts.delete(e.pointerId); last = null; };
      box.onwheel = (e) => { e.preventDefault(); zoomTo(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
      $("#czoom", s).oninput = (e) => zoomTo(+e.target.value / 100);
      const finish = (v) => { s.remove(); resolve(v); };
      $("#ccancel", s).onclick = () => finish(null);
      s.onclick = (e) => { if (e.target === s) finish(null); };
      $("#cdone", s).onclick = () => {
        clamp(); const o = document.createElement("canvas"); o.width = o.height = out;
        const k = base * z * out / D;
        o.getContext("2d").drawImage(bmp, (out - bmp.width * k) / 2 + x * out / D, (out - bmp.height * k) / 2 + y * out / D, bmp.width * k, bmp.height * k);
        o.toBlob((b) => finish(b ? new File([b], "avatar.jpg", { type: "image/jpeg" }) : null), "image/jpeg", 0.9);
      };
      paint();
    });
  }

  // ------------------------------------------------------------------ media: attach menu, captions, videos, round video notes
  function attachMenu() {
    const s = sheet(`<div class="attach">
      <label><i style="background:#7c5cff">🖼</i>Photos &amp; videos<input type="file" id="aMedia" accept="image/*,video/*" multiple hidden></label>
      <label><i style="background:#ff3b5c">📸</i>Camera<input type="file" id="aCam" accept="image/*,video/*" capture="environment" hidden></label>
      <button id="aNote"><i style="background:#ff9500">⭕</i>Video note</button>
      <button id="aLetter"><i style="background:#e5484d">💌</i>Love notes</button>
      <label><i style="background:#0a84ff">📄</i>Document<input type="file" id="aDoc" multiple hidden></label>
      ${(conv(S.cur) || {}).kind === "direct" && !(other(conv(S.cur)) || {}).bot ? `<button id="aPet"><i style="background:#f59e0b">🐾</i>Share a pet</button>` : ""}
      ${(conv(S.cur) || {}).kind === "bot" ? `<button id="aWhere"><i style="background:#34c759">📍</i>Share where I am</button>` : ""}
    </div>`);
    const take = (e, doc) => { const fs = [...e.target.files]; e.target.value = ""; s.remove(); if (!fs.length) return; doc ? fs.forEach((f) => sendFile(f, "file")) : mediaPreview(fs); };
    $("#aMedia", s).onchange = (e) => take(e); $("#aCam", s).onchange = (e) => take(e); $("#aDoc", s).onchange = (e) => take(e, true);
    $("#aNote", s).onclick = () => { s.remove(); recordVideoNote(); };
    $("#aLetter", s).onclick = () => { s.remove(); openTemplates(); };
    if ($("#aPet", s)) $("#aPet", s).onclick = () => { s.remove(); sharePet(); };
    if ($("#aWhere", s)) $("#aWhere", s).onclick = () => { s.remove(); shareWhere(); };
  }
  function mediaPreview(files) {  // full-screen look before sending: play it, add a caption, remove what you don't want
    files = files.filter(isMedia).slice(0, 10);
    if (!files.length) return toast("Choose photos or videos");
    const items = files.map((f) => ({ f, url: URL.createObjectURL(f) })); let cur = 0, gone = false;
    const ov = document.createElement("div"); ov.className = "mpv";
    ov.innerHTML = `<div class="mpv-top"><button class="mpv-b" data-c>Cancel</button><b id="mpvN"></b><span></span></div>
      <div class="mpv-stage" id="mpvS"></div><div class="mpv-strip" id="mpvT"></div>
      <div class="mpv-bar"><textarea class="mpv-cap" id="mpvC" rows="1" placeholder="Add a caption…"></textarea><button class="mpv-send" data-s title="Send" aria-label="Send">➤</button></div>`;
    document.body.appendChild(ov);
    const stage = $("#mpvS", ov), strip = $("#mpvT", ov), cap = $("#mpvC", ov), isV = (it) => it.f.type.startsWith("video/");
    const close = () => {
      if (gone) return; gone = true; document.removeEventListener("keydown", key);
      $$("video", ov).forEach((v) => v.pause()); items.forEach((it) => URL.revokeObjectURL(it.url)); ov.classList.add("closing"); setTimeout(() => ov.remove(), 180);
    };
    const key = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", key); layer(ov, close);
    const paint = () => {
      cur = Math.min(cur, items.length - 1); const it = items[cur];
      stage.innerHTML = isV(it) ? `<video src="${it.url}" controls playsinline></video>` : `<img src="${it.url}" alt="">`;
      $("#mpvN", ov).textContent = items.length > 1 ? `${cur + 1} / ${items.length}` : isV(it) ? "Video" : "Photo";
      strip.innerHTML = items.map((x, i) => `<div class="mpv-th ${i === cur ? "on" : ""}" data-i="${i}">${isV(x) ? `<video src="${x.url}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${x.url}" alt="">`}${items.length > 1 ? `<button class="mpv-x" data-x="${i}" aria-label="Remove">✕</button>` : ""}</div>`).join("")
        + (items.length < 10 ? `<label class="mpv-add" title="Add more">＋<input type="file" accept="image/*,video/*" multiple hidden></label>` : "");
      $$("[data-i]", strip).forEach((d) => d.onclick = (e) => { if (e.target.closest("[data-x]")) return; cur = +d.dataset.i; paint(); });
      $$("[data-x]", strip).forEach((b) => b.onclick = () => { URL.revokeObjectURL(items[+b.dataset.x].url); items.splice(+b.dataset.x, 1); if (!items.length) return close(); paint(); });
      const add = $(".mpv-add input", strip);
      if (add) add.onchange = (e) => { [...e.target.files].filter(isMedia).slice(0, 10 - items.length).forEach((f) => items.push({ f, url: URL.createObjectURL(f) })); cur = items.length - 1; paint(); };
    };
    const go = async () => {
      const text = cap.value.trim(), list = items.map((it) => it.f); close();
      for (let i = 0; i < list.length; i++) await sendFile(list[i], null, i === 0 ? text : "");
    };
    $("[data-s]", ov).onclick = go; $("[data-c]", ov).onclick = close;
    cap.oninput = () => { cap.style.height = "auto"; cap.style.height = Math.min(cap.scrollHeight, 120) + "px"; };
    cap.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); go(); } };
    paint();
  }
  function videoInfo(file) {  // size, length and a poster frame for a video (best effort: some phones say no)
    return new Promise((res) => {
      const v = document.createElement("video"), url = URL.createObjectURL(file); let done = false;
      const fin = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); res(r); };
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = () => { v.currentTime = isFinite(v.duration) ? Math.min(0.1, v.duration / 2) : 0.1; };
      v.onseeked = () => {
        try {
          const k = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement("canvas");
          c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          c.toBlob((b) => fin({ w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? Math.round(v.duration) : 0, poster: b }), "image/jpeg", 0.8);
        } catch { fin({}); }
      };
      v.onerror = () => fin({}); setTimeout(() => fin({}), 5000);
      v.src = url; v.load();
    });
  }
  function upload(f, onPct) {  // like api("/api/files") but shows how far a big video got
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open("POST", "/api/files"); x.setRequestHeader("authorization", "Bearer " + TOKEN);
      x.upload.onprogress = (e) => e.lengthComputable && onPct && onPct(Math.round(e.loaded * 100 / e.total));
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { } x.status < 300 ? res(d) : rej(new Error(d.detail || "Upload failed")); };
      x.onerror = () => rej(new Error("No connection"));
      const fd = new FormData(); fd.append("file", f, f.name); x.send(fd);
    });
  }
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function videoNoteReview(file, secs) {  // the round clip loops; retake, throw away or send
    const url = URL.createObjectURL(file), ov = document.createElement("div"); ov.className = "vrec vrw"; let gone = false;
    ov.innerHTML = `<div class="vrec-circle"><video src="${url}" autoplay loop muted playsinline></video></div>
      <div class="vrec-time">${fmtDur(secs)} · tap the clip for sound</div>
      <div class="vrec-btns"><button data-r title="Retake" aria-label="Retake">⟲</button><button data-d title="Discard" aria-label="Discard">🗑</button><button class="rsend" data-s title="Send" aria-label="Send">➤</button></div>`;
    document.body.appendChild(ov);
    const vid = $("video", ov), close = () => { if (gone) return; gone = true; vid.pause(); URL.revokeObjectURL(url); ov.remove(); };
    layer(ov, close);
    $(".vrec-circle", ov).onclick = () => { vid.muted = !vid.muted; $(".vrec-time", ov).textContent = `${fmtDur(secs)} · ${vid.muted ? "tap the clip for sound" : "sound on"}`; };
    $("[data-d]", ov).onclick = close;
    $("[data-r]", ov).onclick = () => { close(); recordVideoNote(); };
    $("[data-s]", ov).onclick = () => { close(); sendFile(file, "videonote", "", { dur: Math.round(secs) }); };
  }

  let vrec = null;
  async function recordVideoNote(opts = {}) {  // round selfie video, up to 60 s, like Telegram / WhatsApp video notes
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast(isIOS && !standalone ? "Video notes work in the Home Screen app" : "This browser can't record video");
    if (vrec) return;
    let facing = "user", stream = null, rec = null, chunks = [], started = 0, tick = null, cancelled = false, locked = false;
    const hold = !!opts.hold, ctl = opts.ctl;
    const ov = document.createElement("div"); ov.className = "vrec" + (hold ? " hold" : "");
    ov.innerHTML = `<div class="vrec-circle"><video autoplay playsinline muted></video><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg></div>
      <div class="vrec-time">${hold ? "Starting…" : "Tap ● to record"}</div>
      <div class="vrec-hint"><span class="lk">⌃<br>Slide up to lock</span><span class="cn">‹ Slide left to cancel</span></div>
      <div class="vrec-btns"><button id="vX" title="Cancel">✕</button><button id="vGo" class="go" title="Record"></button><button id="vFlip" title="Flip camera">⟲</button></div>`;
    document.body.appendChild(ov); vrec = ov;
    const vid = $("video", ov), ring = $("circle", ov), time = $(".vrec-time", ov), go = $("#vGo", ov);
    const open = async () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
      vid.srcObject = stream; vid.classList.toggle("mirror", facing === "user");
    };
    const close = () => { clearInterval(tick); if (stream) stream.getTracks().forEach((t) => t.stop()); ov.remove(); vrec = null; };
    try { await open(); } catch { close(); return toast("Camera not allowed"); }
    $("#vX", ov).onclick = () => { cancelled = true; if (rec && rec.state !== "inactive") rec.stop(); else close(); };
    $("#vFlip", ov).onclick = async () => { if (rec) return; facing = facing === "user" ? "environment" : "user"; try { await open(); } catch { toast("No other camera"); } };
    const startRec = () => {
      const type = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 1_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const secs = (Date.now() - started) / 1000, mime = (rec.mimeType || "video/mp4").split(";")[0]; close();
        if (cancelled) return;
        if (secs < 1) return toast(hold ? "Hold a little longer to record" : "Tap ●, talk, then tap ■ to review");
        const vf = new File([new Blob(chunks, { type: mime })], `videonote.${mime.includes("mp4") ? "mp4" : "webm"}`, { type: mime });
        if (hold && !locked) sendFile(vf, "videonote", "", { dur: Math.round(secs) });  // let go = send
        else videoNoteReview(vf, secs);
      };
      rec.start(250); started = Date.now(); ov.classList.add("on"); $("#vFlip", ov).disabled = true;
      tick = setInterval(() => {
        const s = (Date.now() - started) / 1000; time.textContent = "● " + fmtDur(s) + (hold && !locked ? "  ·  release to send" : "  ·  tap ■ to review");
        ring.style.strokeDashoffset = 301.6 * (1 - Math.min(s / 60, 1));
        if (s >= 60) rec.stop();
      }, 200);
    };
    go.onclick = () => { if (rec) rec.stop(); else startRec(); };
    if (hold && ctl) {  // WhatsApp style: recording starts at once; slide up to lock, left to cancel, let go to send
      if (ctl.up) { close(); toast("Hold the camera button to record"); return; }
      startRec();
      ctl.onmove = () => {
        if (locked) return;
        if (ctl.dy < -80) { locked = true; ov.classList.remove("cancelling"); ov.classList.add("locked"); if (navigator.vibrate) navigator.vibrate(12); }
        else ov.classList.toggle("cancelling", ctl.dx < -80);
      };
      ctl.onup = () => {
        if (locked) return;
        if (ctl.abort || ctl.dx < -80) cancelled = true;
        if (rec && rec.state !== "inactive") rec.stop(); else close();
      };
      if (ctl.up) ctl.onup();
    }
  }
  function bindVideoNotes(root) {  // tap a round video to play it with sound; a ring shows how far it is
    $$("[data-vn]", root).forEach((el) => {
      const v = $("video", el), ring = $("circle", el);
      v.ontimeupdate = () => { if (!v.paused && v.duration && isFinite(v.duration)) ring.style.strokeDashoffset = 301.6 * (1 - v.currentTime / v.duration); };
      v.onended = () => { el.classList.remove("playing"); ring.style.strokeDashoffset = 301.6; v.currentTime = 0.1; };
      el.onclick = (e) => {
        e.stopPropagation();
        $$("[data-vn].playing video").forEach((o) => { if (o !== v) { o.pause(); o.closest("[data-vn]").classList.remove("playing"); } });
        if (v.paused) { v.muted = false; v.play().then(() => el.classList.add("playing")).catch(() => { }); } else { v.pause(); el.classList.remove("playing"); }
      };
    });
  }
  function viewMedia(m, list) {  // full screen photos and videos, like WhatsApp: swipe through, scrub, swipe down to close
    const media = (list || S.msgs[m.conv_id] || [m]).filter((x) => !x.deleted && x.attachment && (x.kind === "image" || x.kind === "video"));
    let i = Math.max(0, media.findIndex((x) => x.id === m.id)); if (!media.length) media.push(m);
    const v = document.createElement("div"); v.className = "viewer mv"; document.body.appendChild(v);
    let hideT = 0, vid = null;
    const close = () => { if (v.classList.contains("closing")) return; clearTimeout(hideT); if (vid) vid.pause(); v.classList.add("closing"); setTimeout(() => v.remove(), 180); document.removeEventListener("keydown", key); };
    layer(v, close);
    const chrome = (on) => { v.classList.toggle("bare", !on); clearTimeout(hideT); if (on && vid && !vid.paused) hideT = setTimeout(() => v.classList.add("bare"), 2600); };
    const show = () => {
      const x = media[i], a = x.attachment || {}, isVid = x.kind === "video";
      const who = x.sender === S.me.id ? "You" : (userById(x.sender) || {}).name || "";
      v.innerHTML = `<div class="mv-top"><button class="mv-b" data-x>‹</button><div class="mv-who"><b>${esc(who)}</b><small>${esc(dayLabel(x.created) + " · " + fmtTime(x.created))}</small></div>
          <button class="mv-b" data-go title="Show in chat">💬</button><a class="mv-b" href="${fileUrl(a.id)}" download="${esc(a.name || "")}" title="Save">⤓</a></div>
        <div class="mv-stage">${isVid ? `<video src="${fileUrl(a.id)}"${a.poster ? ` poster="${fileUrl(a.poster)}"` : ""} playsinline autoplay></video><button class="mv-big" hidden>▶</button>`
          : `<img src="${fileUrl(a.id)}" alt="">`}</div>
        ${i > 0 ? `<button class="mv-nav l" data-n="-1">‹</button>` : ""}${i < media.length - 1 ? `<button class="mv-nav r" data-n="1">›</button>` : ""}
        <div class="mv-bot">${x.text ? `<div class="mv-cap">${esc(x.text)}</div>` : ""}
          ${isVid ? `<div class="mv-bar"><button class="mv-b" data-p>❚❚</button><span data-c>0:00</span><input type="range" min="0" max="1000" value="0"><span data-d>${a.dur ? fmtDur(a.dur) : "0:00"}</span><button class="mv-b" data-m>🔊</button></div>` : ""}
          ${media.length > 1 ? `<div class="mv-count">${i + 1} / ${media.length}</div>` : ""}</div>`;
      $("[data-x]", v).onclick = close;
      $("[data-go]", v).onclick = () => { close(); gotoMsg(x.conv_id, x.id); };
      $$("[data-n]", v).forEach((b) => b.onclick = (e) => { e.stopPropagation(); step(+b.dataset.n); });
      vid = isVid ? $("video", v) : null;
      if (vid) {
        const bar = $("input", v), big = $(".mv-big", v), pb = $("[data-p]", v), mb = $("[data-m]", v);
        let seeking = false;
        const sync = () => { const p = vid.paused; pb.textContent = p ? "▶" : "❚❚"; big.hidden = !p; chrome(true); };
        vid.onplay = vid.onpause = sync;
        vid.onended = () => { big.textContent = "↻"; sync(); };
        vid.onloadedmetadata = () => { if (isFinite(vid.duration)) $("[data-d]", v).textContent = fmtDur(vid.duration); };
        vid.ontimeupdate = () => { $("[data-c]", v).textContent = fmtDur(vid.currentTime); if (!seeking && vid.duration) bar.value = 1000 * vid.currentTime / vid.duration; };
        bar.oninput = () => { seeking = true; if (vid.duration) { vid.currentTime = vid.duration * bar.value / 1000; $("[data-c]", v).textContent = fmtDur(vid.currentTime); } chrome(true); };
        bar.onchange = () => { seeking = false; };
        const toggle = () => { big.textContent = "▶"; vid.paused ? vid.play().catch(() => { }) : vid.pause(); };
        pb.onclick = toggle; big.onclick = (e) => { e.stopPropagation(); toggle(); };
        mb.onclick = () => { vid.muted = !vid.muted; mb.textContent = vid.muted ? "🔇" : "🔊"; };
        vid.play().catch(() => { big.hidden = false; pb.textContent = "▶"; });
      }
      chrome(true);
    };
    const step = (d) => { if (media[i + d]) { if (vid) vid.pause(); i += d; show(); } };
    const key = (e) => {
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
      else if (e.key === " " && vid) { e.preventDefault(); vid.paused ? vid.play() : vid.pause(); }
    };
    document.addEventListener("keydown", key);
    // tap the picture to show/hide the bars; swipe sideways for the next one, down to close
    let sx = 0, sy = 0, dy = 0, moved = false;
    v.addEventListener("pointerdown", (e) => { if (e.target.closest("button,a,input")) return; sx = e.clientX; sy = e.clientY; dy = 0; moved = false; v.dataset.drag = "1"; });
    v.addEventListener("pointermove", (e) => {
      if (!v.dataset.drag) return; const dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { const st = $(".mv-stage", v); st.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 1600})`; v.style.background = `rgba(0,0,0,${1 - Math.min(dy, 300) / 450})`; }
    });
    v.addEventListener("pointerup", (e) => {
      if (!v.dataset.drag) return; delete v.dataset.drag; const dx = e.clientX - sx, st = $(".mv-stage", v); dy = e.clientY - sy;
      if (!moved) { if (!e.target.closest(".mv-bot,.mv-top,.mv-nav")) chrome(v.classList.contains("bare")); return; }
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) return close();
      if (st) st.style.transform = ""; v.style.background = "";
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    });
    show();
  }

  // ------------------------------------------------------------------ starred messages and mute
  async function toggleStar(id) {
    try { const r = await api(`/api/messages/${id}/star`, { body: {} }); r.starred ? S.stars.add(id) : S.stars.delete(id); toast(r.starred ? "⭐ Starred" : "Unstarred"); drawChat(); }
    catch (x) { toast(x.message); }
  }
  const isMuted = (c) => !!c && (c.muted || 0) > now();
  function muteSheet(c, after) {
    const s = sheet(`<h3>${isMuted(c) ? "🔕 Muted" : "Mute notifications"}</h3><div class="menu">
      ${isMuted(c) ? `<button data-h="0">🔔 Unmute</button>` : ""}<button data-h="8">8 hours</button><button data-h="168">1 week</button><button data-h="always">Always</button></div>`);
    $$("[data-h]", s).forEach((b) => b.onclick = async () => {
      s.remove(); const h = b.dataset.h;
      try { addConv(await api(`/api/convs/${c.id}/mute`, { method: "PUT", body: h === "always" ? { always: true } : h === "0" ? {} : { hours: +h } })); cacheSave(); drawList(); toast(h === "0" ? "Unmuted" : "Muted"); after && after(); }
      catch (x) { toast(x.message); }
    });
  }
  async function gotoMsg(cid, id) {  // open the chat at a message (loads older messages if it's far back)
    if (S.cur !== cid) await openConv(cid);
    for (let i = 0; i < 60 && !(S.msgs[cid] || []).some((m) => m.id === id) && S.older[cid]; i++) await loadOlder();
    const t = $(`.msg[data-id="${id}"]`); if (!t) return toast("Couldn't find that message");
    t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1400);
  }

  // ------------------------------------------------------------------ contact info: photo, about, media, links, docs, starred
  function infoPage() {
    const c = conv(S.cur); if (!c) return;
    if (c.kind === "bot") return assistantInfo(c);
    if (c.kind === "pet" && c.pet) return petInfo(c);
    const u = other(c), self = c.kind === "self";
    const page = document.createElement("div"); page.className = "page info"; page.dataset.cid = c.id;
    const close = () => { if (page.classList.contains("closing")) return; page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    page.innerHTML = `<div class="top"><button class="icon" id="iBack">‹</button><h1>${self ? "Notes to self" : "Contact info"}</h1></div>
      <div class="page-body">
        <div class="ihead">${avatar(u, "xl", self)}<div class="iname">${esc(title(c))}</div>
          ${self ? `<div class="isub">Only you can see this chat</div>` : `${S.nicks[u.id] ? `<div class="isub real">${esc(u.name || "")}</div>` : ""}<div class="isub">@${esc(u.username)}${lastSeen(u) ? " · " + esc(lastSeen(u)) : ""}</div>${c.kind === "direct" && moodNow(c.mood) ? `<div class="isub info-mood">${esc(moodTxt(moodNow(c.mood)))}</div>` : ""}${u.bio ? `<div class="ibio">${esc(u.bio)}</div>` : ""}`}</div>
        <div class="iacts"><button data-i="search"><i>🔍</i>Search</button>
          ${self ? "" : `<button data-i="mute"><i>${isMuted(c) ? "🔕" : "🔔"}</i>${isMuted(c) ? "Muted" : "Mute"}</button>`}${c.kind === "direct" && !(u || {}).bot ? `<button data-i="pet"><i>🐾</i>Share a pet</button>` : ""}</div>
        ${self || !u || u.bot ? "" : `<div class="irows"><button class="irow" data-i="nick"><i>💕</i><span><b>Nickname</b><small>${S.nicks[u.id] ? esc(S.nicks[u.id]) : "Only you see what you call them"}</small></span><em>›</em></button>${c.kind === "direct" ? `<button class="irow" data-i="mood"><i>🌤️</i><span><b>My mood</b><small>Share how you feel today</small></span><em>›</em></button><button class="irow" data-i="dates"><i>💞</i><span><b>Our dates</b><small>Together since, birthdays, next time together</small></span><em>›</em></button>` : ""}</div>
        ${S.nickFor[u.id] ? `<div class="nickfor">${esc((u.name || "").split(" ")[0] || "They")} calls you “${esc(S.nickFor[u.id])}” 💕</div>` : ""}`}
        ${themeRow(c)}
        <div class="chips tabs itabs"><button data-t="media" class="on">Media</button><button data-t="links">Links</button><button data-t="docs">Docs</button><button data-t="starred">⭐ Starred</button></div>
        <div id="ibody"></div>
      </div>`;
    document.body.appendChild(page); layer(page, close);
    $("#iBack", page).onclick = close; bindNudge(page, c);
    $$("[data-i]", page).forEach((b) => b.onclick = () => {
      const a = b.dataset.i;
      if (a === "search") { close(); $("#sbar").hidden = false; $("#sq").focus(); }
      if (a === "theme") { close(); themeSheet(); }
      if (a === "mute") muteSheet(conv(c.id), () => { page.remove(); infoPage(); });
      if (a === "nick") nickSheet(u);
      if (a === "mood") moodSheet();
      if (a === "dates") datesSheet(c.id);
      if (a === "pet") { close(); sharePet(); }
    });
    const body = $("#ibody", page);
    const when = (m) => `${dayLabel(m.created)} · ${fmtTime(m.created)}`;
    const show = async (t) => {
      $$(".itabs button", page).forEach((b) => b.classList.toggle("on", b.dataset.t === t));
      body.innerHTML = `<div class="hint">Loading…</div>`;
      let list = [];
      try { list = t === "starred" ? await api(`/api/stars?conv=${c.id}`) : await api(`/api/convs/${c.id}/media?type=${t}`); }
      catch (x) { body.innerHTML = `<div class="empty">${esc(x.message)}</div>`; return; }
      if (!list.length) { body.innerHTML = `<div class="empty">${{ media: "No photos or videos yet", links: "No links yet", docs: "No documents yet", starred: "No starred messages.<br><small>Long-press a message → ⭐ Star</small>" }[t]}</div>`; return; }
      if (t === "media") {
        body.innerHTML = `<div class="mgrid">${list.map((m, i) => {
          const a = m.attachment || {}, poster = a.poster ? fileUrl(a.poster) : "";
          return `<button data-k="${i}" class="${m.kind === "videonote" ? "round" : ""}">${m.kind === "image" ? `<img src="${fileUrl(a.id)}" loading="lazy" alt="">`
            : poster ? `<img src="${poster}" loading="lazy" alt="">` : `<video src="${fileUrl(a.id)}#t=0.1" preload="metadata" muted playsinline></video>`}${m.kind !== "image" ? `<span>▶${a.dur ? " " + fmtDur(a.dur) : ""}</span>` : ""}</button>`;
        }).join("")}</div>`;
        $$("[data-k]", body).forEach((b) => b.onclick = () => { const m = list[+b.dataset.k]; if (m.kind === "videonote") { close(); gotoMsg(c.id, m.id); } else viewMedia(m, [...list].reverse()); });
      } else if (t === "links") {
        body.innerHTML = list.flatMap((m) => (m.links || []).map((l) => {
          let host = l; try { host = new URL(l).hostname.replace(/^www\./, ""); } catch { }
          return `<a class="lrow" href="${esc(l)}" target="_blank" rel="noopener"><i>🔗</i><span><b>${esc(host)}</b><small>${esc(l)}</small><small>${esc(when(m))}</small></span></a>`;
        })).join("");
      } else if (t === "docs") {
        body.innerHTML = list.map((m) => { const a = m.attachment || {}; return `<a class="lrow" href="${fileUrl(a.id)}" target="_blank" download="${esc(a.name)}"><i>📄</i><span><b>${esc(a.name)}</b><small>${sizeTxt(a.size || 0)} · ${esc(when(m))}</small></span></a>`; }).join("");
      } else {
        body.innerHTML = list.map((m) => `<button class="lrow" data-g="${m.id}"><i>⭐</i><span><b>${esc(m.sender === S.me.id ? "You" : (userById(m.sender) || {}).name || "")}</b><small class="clip">${esc(preview(m))}</small><small>${esc(when(m))}</small></span></button>`).join("");
        $$("[data-g]", body).forEach((b) => b.onclick = () => { close(); gotoMsg(c.id, +b.dataset.g); });
      }
    };
    $$(".itabs button", page).forEach((b) => b.onclick = () => show(b.dataset.t));
    show("media");
  }

  // ------------------------------------------------------------------ Home: the pet you share (cosy scene, care buttons, daily quests)
  const PET_SPECIES = [["cat", "🐱"], ["dog", "🐶"], ["bunny", "🐰"], ["bear", "🐻"], ["fox", "🦊"], ["penguin", "🐧"], ["panda", "🐼"]];
  const PET_ACTS = [["feed", "🍖", "Feed"], ["play", "🧸", "Play"], ["tend", "🛁", "Bathe"], ["sleep", "💤", "Tuck in"]];
  const PET_FLY = { feed: "🍖", play: "🧸", tend: "🫧", sleep: "🌙" };
  const petOf = (c) => (c && c.kind === "pet" && c.pet) || null;
  const petNight = () => { const h = new Date().getHours(); return h >= 21 || h < 6; };
  const petMood = (p) => p.sleeping ? "asleep" : p.sad ? "sad" : petNight() && p.energy < 70 ? "sleepy" : p.mood === "hungry" ? "hungry" : p.mood === "happy" ? "happy" : p.mood === "sleepy" ? "sleepy" : p.mood === "lonely" ? "lonely" : "okay";
  const petWord = (p) => ({ asleep: "is sleeping", sad: "misses you", sleepy: "is sleepy", hungry: "is hungry", happy: "is happy", lonely: "wants company", okay: "is doing fine" })[petMood(p)];
  const petSub = (c) => { const p = petOf(c); return p ? `${p.streak ? "🔥 " + p.streak + " · " : ""}${p.name} ${petWord(p)}` : ""; };
  const cav = (c, cls = "") => petOf(c) ? `<div class="av pet-av ${cls}">${petOf(c).emoji}</div>` : avatar(other(c), cls, c.kind === "self");
  const petLeft = (p, k) => { if (!p._t) p._t = Date.now(); return Math.max(0, Math.ceil((p.cd[k] || 0) - (Date.now() - p._t) / 1000)); };
  const petFmt = (s) => s >= 60 ? Math.ceil(s / 60) + "m" : s + "s";
  let petFxSeen = {};

  function drawHome(fx) {
    const box = $("#home"), c = conv(S.cur), p = petOf(c);
    if (!box) return;
    box.hidden = !p; if (!p) return;
    if (!p._t) p._t = Date.now();
    const mood = petMood(p), night = petNight(), names = {};
    [S.me, other(c)].forEach((u) => { if (u) names[u.id] = (u.name || u.username || "").split(" ")[0]; });
    const done = p.quests.filter((q) => q.done).length;
    const bar = (k, ico, v) => `<div class="pbar ${v < 30 ? "low" : ""}" title="${k}"><i>${ico}</i><span><em style="width:${v}%"></em></span><b>${v}</b></div>`;
    if (!box.firstChild || box.dataset.pet !== String(p.id)) {  // first paint: build the scene once, then only update it (keeps the animations running)
      box.dataset.pet = p.id;
      box.innerHTML = `<div class="hscene"><div class="hsky"><span class="hsun">☀️</span><span class="hmoon">🌙</span><span class="hstar s1">✦</span><span class="hstar s2">✦</span><span class="hstar s3">✦</span><span class="hcloud">☁️</span></div>
        <div class="hfloor"></div><div class="hrug"></div><div class="hstage"><div class="hpet" id="hpet"></div><div class="hshadow"></div><div class="hzzz">💤</div><div class="htear">💧</div></div>
        <div class="hsay" id="hsay"></div>
        <button class="hinfo" id="hinfo" title="${esc(p.name)}'s page">🐾</button></div>
        <div class="hmeta"><div class="hstreak" id="hstreak"></div><button class="hq" id="hq"></button></div>
        <div class="hbars" id="hbars"></div><div class="hquests" id="hquests" hidden></div><div class="hacts" id="hacts"></div>`;
      $("#hinfo", box).onclick = infoPage;
      $("#hpet", box).onclick = () => { const e = $("#hpet", box); e.classList.remove("hop"); void e.offsetWidth; e.classList.add("hop"); burstAt(e, "💗", 3); };
      $("#hq", box).onclick = () => { const q = $("#hquests", box); q.hidden = !q.hidden; $("#hq", box).classList.toggle("open", !q.hidden); };
      $("#hacts", box).onclick = (e) => { const b = e.target.closest("[data-act]"); if (b) petCare(b.dataset.act, b); };
    }
    box.dataset.mood = mood; box.classList.toggle("night", night || p.sleeping); box.classList.toggle("needs", p.needs_care);
    $("#hpet", box).textContent = p.emoji;
    $(".hzzz", box).hidden = !(mood === "asleep" || mood === "sleepy");
    $(".htear", box).hidden = mood !== "sad";
    $("#hstreak", box).innerHTML = `<b>🔥 ${p.streak}</b><small>day${p.streak === 1 ? "" : "s"} · best ${p.best} · Lv ${p.level}</small>${p.both_today ? `<span class="hboth">💞 both today</span>` : p.cared_today ? `<span class="hboth one">needs you both</span>` : ""}`;
    $("#hq", box).innerHTML = `📋 Quests <b>${done}/${p.quests.length}</b>`;
    $("#hbars", box).innerHTML = bar("Fullness", "🍖", p.hunger) + bar("Happiness", "💗", p.joy) + bar("Energy", "⚡", p.energy);
    $("#hquests", box).innerHTML = p.quests.map((q) => `<div class="hqrow ${q.done ? "done" : ""}"><i>${q.done ? "✓" : ""}</i><span>${esc(q.text)}</span><small>${q.progress}/${q.target}</small></div>`).join("");
    $("#hacts", box).innerHTML = PET_ACTS.map(([k, ico, lab]) => { const s = petLeft(p, k); return `<button data-act="${k}" ${s ? "disabled" : ""}><i>${ico}</i><span>${k === "tend" ? "Bathe" : lab}</span>${s ? `<small>${petFmt(s)}</small>` : ""}</button>`; }).join("");
    if (fx) petFx(box, fx, names);
  }

  function petFx(box, fx, names) {  // food flies in, hearts burst, a little caption says who did it
    const pet = $("#hpet", box), stage = $(".hstage", box); if (!pet || !stage) return;
    const say = $("#hsay", box);
    if (fx.act) {
      const f = document.createElement("div"); f.className = "hfly"; f.textContent = PET_FLY[fx.act] || "💗"; stage.appendChild(f);
      const a = f.animate ? f.animate([{ transform: "translate(-90px,-70px) scale(.6) rotate(-40deg)", opacity: 0 }, { transform: "translate(-30px,-90px) scale(1.2) rotate(0)", opacity: 1, offset: .4 }, { transform: "translate(0,-8px) scale(.5)", opacity: 0 }], { duration: 760, easing: "cubic-bezier(.2,.8,.2,1)" }) : null;
      setTimeout(() => { f.remove(); pet.classList.remove("hop"); void pet.offsetWidth; pet.classList.add("hop"); burstAt(pet, fx.act === "tend" ? "🫧" : "💗", fx.act === "sleep" ? 3 : 8); if (navigator.vibrate) navigator.vibrate(12); }, a ? 640 : 0);
      const who = fx.by === S.me.id ? "You" : names[fx.by] || "They";
      const verb = { feed: "fed", play: "played with", tend: "bathed", sleep: "tucked in" }[fx.act];
      const p = petOf(conv(S.cur));
      say.textContent = `${who} ${verb} ${p ? p.name : "the pet"} ${PET_FLY[fx.act] === "🫧" ? "🛁" : PET_FLY[fx.act] === "🌙" ? "💤" : PET_FLY[fx.act]}`;
      say.classList.remove("on"); void say.offsetWidth; say.classList.add("on");
    }
    if (fx.fx === "quest") petConfetti(box);
  }
  function petConfetti(box) {
    const r = box.getBoundingClientRect(), cols = ["#ff5d73", "#ffb224", "#30a46c", "#0090ff", "#8e4ec6", "#ff8fb1"];
    for (let i = 0; i < 36; i++) {
      const d = document.createElement("i"); d.className = "confetti";
      d.style.left = r.left + r.width / 2 + "px"; d.style.top = r.top + 70 + "px"; d.style.background = cols[i % cols.length];
      d.style.setProperty("--dx", (Math.random() * 300 - 150) + "px"); d.style.setProperty("--dy", (120 + Math.random() * 260) + "px"); d.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
      d.style.animationDelay = Math.random() * 120 + "ms"; document.body.appendChild(d); setTimeout(() => d.remove(), 1700);
    }
    toast("🎉 Quest done!");
  }
  async function petCare(act, btn) {
    const c = conv(S.cur), p = petOf(c); if (!p || btn.disabled) return;
    btn.classList.add("press"); setTimeout(() => btn.classList.remove("press"), 300);
    try {
      const v = await api(`/api/pets/${c.id}/care`, { body: { action: act } });
      v._t = Date.now(); c.pet = v;
      if (!petFxSeen[act + S.me.id] || Date.now() - petFxSeen[act + S.me.id] > 2500) { petFxSeen[act + S.me.id] = Date.now(); drawHome({ act, by: S.me.id, fx: "" }); } else drawHome();
      drawList();
    } catch (x) { toast(x.message); }
  }
  function onPetEvent(e) {
    const c = conv(e.conv); if (!c) { resync(); return; }
    e.pet._t = Date.now(); c.pet = e.pet;
    const key = e.act + e.by, dup = e.by === S.me.id && e.act && petFxSeen[key] && Date.now() - petFxSeen[key] < 2500;
    if (S.cur === c.id) { if (e.act && e.by === S.me.id) petFxSeen[key] = Date.now(); drawHome(dup && e.fx !== "quest" ? null : { act: dup ? "" : e.act, by: e.by, fx: e.fx }); drawHeader(); }
    cacheSave(); drawList(); homeSync(e);
  }
  setInterval(() => { const c = conv(S.cur), p = petOf(c); if (p && S.view === "chat" && $("#home")) { const b = $("#hacts"); if (b) $$("[data-act]", b).forEach((x) => { const s = petLeft(p, x.dataset.act); x.disabled = !!s; const sm = $("small", x); if (s) { if (sm) sm.textContent = petFmt(s); else x.insertAdjacentHTML("beforeend", `<small>${petFmt(s)}</small>`); } else if (sm) sm.remove(); }); } }, 1000);
  setInterval(() => { const c = conv(S.cur); if (petOf(c) && S.view === "chat") drawHome(); }, 60000);  // moods and day/night drift on their own

  // the invitation card inside the chat
  function petInviteCard(m, c) {
    const a = m.attachment || {}, mine = a.from === S.me.id, who = mine ? "You" : dn(other(c)) || "They";
    let body;
    if (a.state === "accepted") body = `<div class="pi-big">${a.emoji || "🐾"}</div><b>${esc(a.name || "Your pet")} lives in Home now</b>${a.conv && conv(a.conv) ? `<button class="pi-go" data-pgo="${a.conv}">Open Home</button>` : ""}`;
    else if (a.state === "declined") body = `<div class="pi-big">🐾</div><b>Maybe another time</b>`;
    else if (mine) body = `<div class="pi-big wait">🐾</div><b>Pet invite sent</b><small>Waiting…</small>`;
    else body = `<div class="pi-big wiggle">🐾</div><b>${esc(who)} wants to share a pet with you</b><small>You'll feed it, play with it and keep a streak together.</small><div class="pi-row"><button class="pi-yes" data-pyes="${m.id}">Accept</button><button class="pi-no" data-pno="${m.id}">Not now</button></div>`;
    return `<div class="petinv">${body}</div>`;
  }
  function bindPetCards(log) {
    $$("[data-pyes]", log).forEach((b) => b.onclick = (e) => { e.stopPropagation(); acceptPet(+b.dataset.pyes); });
    $$("[data-pno]", log).forEach((b) => b.onclick = async (e) => { e.stopPropagation(); try { await api(`/api/pets/invite/${b.dataset.pno}`, { body: { answer: "decline" } }); } catch (x) { toast(x.message); } });
    $$("[data-pgo]", log).forEach((b) => b.onclick = (e) => { e.stopPropagation(); openConv(+b.dataset.pgo); });
  }
  function acceptPet(mid, stay) {
    let sp = "cat";
    const s = sheet(`<div class="petpick"><h3>Choose your pet 🐾</h3><div class="pp-sp">${PET_SPECIES.filter(([k]) => LOT_CODE[k]).map(([k, e]) => `<button data-sp="${k}" class="${k === sp ? "on" : ""}">${e}</button>`).join("")}</div>
      <input id="ppName" maxlength="20" placeholder="Give it a name" autocomplete="off"><button class="pi-yes wide" id="ppGo">Welcome home</button></div>`);
    $$("[data-sp]", s).forEach((b) => b.onclick = () => { sp = b.dataset.sp; $$("[data-sp]", s).forEach((x) => x.classList.toggle("on", x === b)); burstAt(b, b.textContent, 4); });
    $("#ppName", s).focus();
    $("#ppGo", s).onclick = async () => {
      const name = $("#ppName", s).value.trim(); if (!name) return toast("Give your pet a name");
      try {
        const r = await api(`/api/pets/invite/${mid}`, { body: { answer: "accept", species: sp, name } });
        s.remove(); if (r.conv && !conv(r.conv.id)) S.convs.unshift(r.conv);
        cacheSave(); drawList();
        if (stay) { H.cid = r.conv.id; H.data = null; H.pending = []; setTab("home"); setTimeout(() => burstAt($("#hmPet") || document.body, "💗", 10), 600); return; }
        await openConv(r.conv.id); const pe = $("#hpet"); if (pe) { pe.classList.add("hop"); burstAt(pe, "💗", 10); }
      } catch (x) { toast(x.message); }
    };
  }
  async function sharePet() {
    const c = conv(S.cur); if (!c || c.kind !== "direct") return;
    try { await api(`/api/convs/${c.id}/petinvite`, { body: {} }); toast("Pet invite sent 🐾"); } catch (x) { toast(x.message); }
  }

  // the pet's page: stats, streak, quests, the lists and reminders you share
  function petInfo(c) {
    const page = document.createElement("div"); page.className = "page info petpage";
    const close = () => { if (page.classList.contains("closing")) return; page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    const p0 = petOf(c);
    page.innerHTML = `<div class="top"><button class="icon" id="iBack">‹</button><h1>${esc(p0.name)}</h1></div>
      <div class="page-body">
        <div class="ihead"><div class="av xl pet-av">${p0.emoji}</div><div class="iname" id="pName">${esc(p0.name)}</div><div class="isub" id="pSub"></div></div>
        <div class="iacts"><button data-i="rename"><i>✏️</i>Rename</button><button data-i="search"><i>🔍</i>Search</button>
          <button data-i="mute"><i>${isMuted(c) ? "🔕" : "🔔"}</i>${isMuted(c) ? "Muted" : "Mute"}</button></div>
        ${themeRow(c)}
        <div class="hm-credit" style="text-align:center;margin:6px 0">Animated emoji © Google, CC BY 4.0</div>
        <div class="chips tabs itabs"><button data-t="care" class="on">🔥 Care</button><button data-t="notes">📝 Lists</button><button data-t="rem">⏰ Reminders</button></div>
        <div id="ibody"></div>
      </div>`;
    document.body.appendChild(page); layer(page, close);
    $("#iBack", page).onclick = close; bindNudge(page, c);
    $$("[data-i]", page).forEach((b) => b.onclick = () => {
      const a = b.dataset.i;
      if (a === "search") { close(); $("#sbar").hidden = false; $("#sq").focus(); }
      if (a === "theme") { close(); themeSheet(); }
      if (a === "mute") muteSheet(conv(c.id), () => { page.remove(); petInfo(conv(c.id)); });
      if (a === "rename") {
        const s = sheet(`<div class="petpick"><h3>Rename ${esc(petOf(conv(c.id)).name)}</h3><input id="ppName" maxlength="20" value="${esc(petOf(conv(c.id)).name)}" autocomplete="off"><button class="pi-yes wide" id="ppGo">Save</button></div>`);
        const go = async () => {
          const name = $("#ppName", s).value.trim(); if (!name) return;
          try { const cv = await api(`/api/pets/${c.id}`, { method: "PATCH", body: { name } }); const i = S.convs.findIndex((x) => x.id === c.id); if (i >= 0) S.convs[i] = cv; s.remove(); page.remove(); cacheSave(); drawList(); drawHeader(); drawHome(); petInfo(conv(c.id)); }
          catch (x) { toast(x.message); }
        };
        $("#ppGo", s).onclick = go; $("#ppName", s).onkeydown = (e) => { if (e.key === "Enter") go(); }; $("#ppName", s).select();
      }
    });
    const body = $("#ibody", page);
    let tab = "care";
    const show = async (t) => {
      tab = t; $$(".itabs button", page).forEach((b) => b.classList.toggle("on", b.dataset.t === t));
      let d; try { d = await api(`/api/pets/${c.id}`); } catch (x) { body.innerHTML = `<div class="empty">${esc(x.message)}</div>`; return; }
      if (tab !== t) return;
      const p = d.pet; p._t = Date.now(); c.pet = p;
      $("#pSub", page).textContent = `Level ${p.level} · ${p.xp} xp · ${p.name} ${petWord(p)}`;
      if (t === "care") {
        const bar = (ico, lab, v) => `<div class="pbar ${v < 30 ? "low" : ""}"><i>${ico}</i><span><em style="width:${v}%"></em></span><b>${v}</b></div>`;
        const days = [...d.history].reverse();
        body.innerHTML = `<div class="pi-stats"><div><b>🔥 ${p.streak}</b><small>day streak</small></div><div><b>🏆 ${p.best}</b><small>best</small></div><div><b>✨ ${p.level}</b><small>level</small></div></div>
          <div class="hbars pinfo">${bar("🍖", "Fullness", p.hunger)}${bar("💗", "Happiness", p.joy)}${bar("⚡", "Energy", p.energy)}</div>
          <h4 class="alist">Last ${days.length} days<small>💞 = both of you cared</small></h4>
          <div class="pi-days">${days.map((x) => `<span class="${x.both ? "both" : x.cared ? "yes" : ""}" title="${esc(x.day)}">${x.both ? "💞" : x.cared ? "✓" : "·"}<small>${esc(x.day.slice(8))}</small></span>`).join("") || `<div class="empty">No days yet.</div>`}</div>
          <h4 class="alist">Today's quests<small>${p.quests.filter((q) => q.done).length}/${p.quests.length}</small></h4>
          ${p.quests.map((q) => `<div class="hqrow big ${q.done ? "done" : ""}"><i>${q.done ? "✓" : ""}</i><span>${esc(q.text)}</span><small>${q.progress}/${q.target}</small></div>`).join("")}`;
      } else if (t === "notes") {
        const lists = {}; d.notes.forEach((n) => (lists[n.list] = lists[n.list] || []).push(n));
        body.innerHTML = Object.entries(lists).map(([name, items]) => `<h4 class="alist">${esc(name ? name[0].toUpperCase() + name.slice(1) : "Notes")}<small>${items.filter((n) => !n.done).length} left</small></h4>
            ${items.map((n) => `<div class="lrow arow ${n.done ? "done" : ""}"><button class="acheck" data-check="${n.id}">${n.done ? "✓" : ""}</button><span><b>${esc(n.text)}</b></span><button class="ax" data-del="${n.id}" title="Delete">✕</button></div>`).join("")}`).join("")
          || `<div class="empty">Nothing here yet.<br><small>Tell ${esc(p.name)}: “add milk to our shopping list”</small></div>`;
      } else {
        body.innerHTML = d.reminders.map((r) => `<div class="lrow arow"><i>⏰</i><span><b>${esc(r.text)}</b><small>${esc([r.when, r.by ? "set by " + r.by : "", r.repeat ? "repeats " + r.repeat : ""].filter(Boolean).join(" · "))}</small></span>
            <button class="ax" data-cancel="${r.id}" title="Done">✓</button></div>`).join("")
          || `<div class="empty">No shared reminders.<br><small>Tell ${esc(p.name)}: “remind us both to call mom at 7pm”</small></div>`;
      }
      const gone = (row, fn) => { row.classList.add("gone"); setTimeout(fn, 220); };
      $$("[data-cancel]", body).forEach((b) => b.onclick = () => gone(b.closest(".arow"), () => api(`/api/pets/${c.id}/reminders/${b.dataset.cancel}`, { method: "DELETE" }).then(() => show(tab)).catch((x) => toast(x.message))));
      $$("[data-del]", body).forEach((b) => b.onclick = () => gone(b.closest(".arow"), () => api(`/api/pets/${c.id}/notes/${b.dataset.del}`, { method: "DELETE" }).then(() => show(tab)).catch((x) => toast(x.message))));
      $$("[data-check]", body).forEach((b) => b.onclick = () => {
        const row = b.closest(".arow"), done = !row.classList.contains("done");
        row.classList.toggle("done", done); b.textContent = done ? "✓" : ""; if (done) { navigator.vibrate && navigator.vibrate(8); burstAt(b, "✨", 4); }
        api(`/api/pets/${c.id}/notes/${b.dataset.check}`, { method: "PATCH", body: { done } }).then(() => setTimeout(() => show(tab), 400)).catch((x) => toast(x.message));
      });
    };
    $$(".itabs button", page).forEach((b) => b.onclick = () => show(b.dataset.t));
    show("care");
  }

  // ------------------------------------------------------------------ the Assistant: its page (reminders, lists, places) and where you are
  function assistantInfo(c) {
    const page = document.createElement("div"); page.className = "page info";
    const close = () => { if (page.classList.contains("closing")) return; page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    page.innerHTML = `<div class="top"><button class="icon" id="iBack">‹</button><h1>Assistant</h1></div>
      <div class="page-body">
        <div class="ihead">${avatar(other(c), "xl")}<div class="iname">Assistant</div><div class="isub">Your personal assistant · only you can see this chat</div></div>
        <div class="iacts"><button data-i="search"><i>🔍</i>Search</button>
          <button data-i="mute"><i>${isMuted(c) ? "🔕" : "🔔"}</i>${isMuted(c) ? "Muted" : "Mute"}</button></div>
        ${themeRow(c)}
        <div class="chips tabs itabs"><button data-t="rem" class="on">⏰ Reminders</button><button data-t="notes">📝 Lists &amp; notes</button><button data-t="places">📍 Places</button></div>
        <div id="ibody"></div>
      </div>`;
    document.body.appendChild(page); layer(page, close);
    $("#iBack", page).onclick = close; bindNudge(page, c);
    $$("[data-i]", page).forEach((b) => b.onclick = () => {
      const a = b.dataset.i;
      if (a === "search") { close(); $("#sbar").hidden = false; $("#sq").focus(); }
      if (a === "theme") { close(); themeSheet(); }
      if (a === "mute") muteSheet(conv(c.id), () => { page.remove(); assistantInfo(conv(c.id)); });
    });
    const body = $("#ibody", page);
    let tab = "rem";
    const show = async (t) => {
      tab = t; $$(".itabs button", page).forEach((b) => b.classList.toggle("on", b.dataset.t === t));
      let d; try { d = await api("/api/assistant"); } catch (x) { body.innerHTML = `<div class="empty">${esc(x.message)}</div>`; return; }
      if (tab !== t) return;
      if (t === "rem") {
        body.innerHTML = d.reminders.map((r) => `<div class="lrow arow" data-r="${r.id}"><i>${r.place && !r.due ? "📍" : "⏰"}</i><span><b>${esc(r.text)}</b>
            <small>${esc([r.when, r.place ? "at " + r.place : "", r.repeat ? "repeats " + r.repeat : ""].filter(Boolean).join(" · "))}</small></span>
            <button class="ax" data-cancel="${r.id}" title="Cancel">✕</button></div>`).join("")
          || `<div class="empty">No reminders.<br><small>Ask: “remind me to drink water at 3pm”</small></div>`;
      } else if (t === "notes") {
        const lists = {}; d.notes.forEach((n) => (lists[n.list] = lists[n.list] || []).push(n));
        body.innerHTML = Object.entries(lists).map(([name, items]) => `<h4 class="alist">${esc(name ? name[0].toUpperCase() + name.slice(1) : "Notes")}<small>${items.filter((n) => !n.done).length} left</small></h4>
            ${items.map((n) => `<div class="lrow arow ${n.done ? "done" : ""}" data-n="${n.id}"><button class="acheck" data-check="${n.id}" title="${n.done ? "Untick" : "Tick"}">${n.done ? "✓" : ""}</button>
              <span><b>${esc(n.text)}</b></span><button class="ax" data-del="${n.id}" title="Delete">✕</button></div>`).join("")}`).join("")
          || `<div class="empty">No notes or lists yet.<br><small>Ask: “add eggs to my shopping list”</small></div>`;
      } else {
        body.innerHTML = d.places.map((p) => `<div class="lrow arow"><i>📍</i><span><b>${esc(p.name)}</b><small>within ${Math.round(p.radius)} m</small></span>
            <button class="ax" data-forget="${esc(p.name)}" title="Forget">✕</button></div>`).join("")
          || `<div class="empty">No saved places.<br><small>At home, tap 📎 → Share where I am, then say “save this place as home”.</small></div>`;
      }
      const gone = (row, fn) => { row.classList.add("gone"); setTimeout(fn, 220); };
      $$("[data-cancel]", body).forEach((b) => b.onclick = () => gone(b.closest(".arow"), () => api(`/api/assistant/reminders/${b.dataset.cancel}`, { method: "DELETE" }).then(() => show(tab)).catch((x) => toast(x.message))));
      $$("[data-del]", body).forEach((b) => b.onclick = () => gone(b.closest(".arow"), () => api(`/api/assistant/notes/${b.dataset.del}`, { method: "DELETE" }).then(() => show(tab)).catch((x) => toast(x.message))));
      $$("[data-forget]", body).forEach((b) => b.onclick = () => gone(b.closest(".arow"), () => api(`/api/assistant/places/${encodeURIComponent(b.dataset.forget)}`, { method: "DELETE" }).then(() => show(tab)).catch((x) => toast(x.message))));
      $$("[data-check]", body).forEach((b) => b.onclick = () => {
        const row = b.closest(".arow"), done = !row.classList.contains("done");
        row.classList.toggle("done", done); b.textContent = done ? "✓" : ""; if (done) { navigator.vibrate && navigator.vibrate(8); burstAt(b, "✨", 4); }
        api(`/api/assistant/notes/${b.dataset.check}`, { method: "PATCH", body: { done } }).then(() => setTimeout(() => show(tab), 400)).catch((x) => toast(x.message));
      });
    };
    $$(".itabs button", page).forEach((b) => b.onclick = () => show(b.dataset.t));
    show("rem");
  }
  function shareWhere() {  // the Assistant needs this to save a place ("save this place as home")
    if (!navigator.geolocation) return toast("This device can't share its location");
    toast("Finding where you are…");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const lat = p.coords.latitude, lon = p.coords.longitude;
      try { await api("/api/assistant/where", { body: { lat, lon } }); } catch (x) { return toast(x.message); }
      send({ kind: "location", text: "📍 Here's where I am", attachment: { lat, lon, acc: Math.round(p.coords.accuracy || 0) } });
    }, (e) => toast(e.code === 1 ? "Location is blocked. Allow it for this site in your browser settings." : "Couldn't find where you are"),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  let whereAt = 0;
  async function autoWhere() {  // place reminders: while the app is open, tell the Assistant where you are (only if it's waiting for a place)
    if (!isVisible() || now() - whereAt < 120 || !navigator.geolocation || !navigator.permissions || !S.convs.some((c) => c.kind === "bot" && c.wants_loc)) return;
    try { if ((await navigator.permissions.query({ name: "geolocation" })).state !== "granted") return; } catch { return; }
    whereAt = now();
    navigator.geolocation.getCurrentPosition((p) => api("/api/assistant/where", { body: { lat: p.coords.latitude, lon: p.coords.longitude } }).catch(() => { }), () => { }, { maximumAge: 60000, timeout: 20000 });
  }
  setInterval(autoWhere, 60000);

  // ------------------------------------------------------------------ reactions, like WhatsApp: tap the little pill to see who reacted; tap yours to take it back
  const rxSig = {}, rxAt = {}, rxOut = {};  // message id -> its reactions last time we drew it, when they changed (so only a change pops), a pill shrinking away
  function rxPill(m) {
    const o = rxOut[m.id], gone = o ? Date.now() - o.at : 1e9;
    if (gone < 200) return (rxSig[m.id] = Object.entries(m.reactions || {}).map(([u, e]) => u + e).sort().join()), o.html.replace(/^<button /, `<button style="--rxd:-${gone}ms" `);  // a redraw mid-shrink carries on shrinking
    const rx = Object.entries(m.reactions || {}), sig = rx.map(([u, e]) => u + e).sort().join();
    if (m.id && rxSig[m.id] !== undefined && rxSig[m.id] !== sig) rxAt[m.id] = Date.now();
    if (m.id) rxSig[m.id] = sig;
    if (!rx.length || m.deleted) return "";
    const emos = [...new Set(rx.map(([, e]) => e))].slice(0, 3), age = Date.now() - (rxAt[m.id] || 0), pop = age < 500;  // a redraw mid-pop carries on where it was
    return `<button class="reacts ${pop ? "pop" : ""} ${(m.reactions || {})[S.me.id] ? "mine" : ""}" data-rxs="${m.id}"${pop ? ` style="--rxd:-${age}ms"` : ""}>${emos.map((e) => `<span>${esc(e)}</span>`).join("")}${rx.length > 1 ? `<b>${rx.length}</b>` : ""}</button>`;
  }
  function rxSheet(id) {
    const m = findMsg(id); if (!m) return;
    const rx = Object.entries(m.reactions || {}).map(([u, e]) => [+u, e]).sort((a, b) => (b[0] === S.me.id) - (a[0] === S.me.id));
    const counts = {}; rx.forEach(([, e]) => { counts[e] = (counts[e] || 0) + 1; });
    const s = sheet(`<div class="rxs"><div class="rxs-tabs"><button class="on" data-f="">All <small>${rx.length}</small></button>${Object.entries(counts).map(([e, n]) => `<button data-f="${esc(e)}">${esc(e)} <small>${n}</small></button>`).join("")}</div>
      <div class="rxs-list">${rx.map(([uid, e], i) => {
        const me = uid === S.me.id, u = me ? S.me : userById(uid) || {};
        return `<button class="rxs-row ${me ? "me" : ""}" data-e="${esc(e)}" style="animation-delay:${i * 40}ms" ${me ? "data-rm" : ""}>${avatar(u, "sm")}<span><b>${me ? "You" : esc(dn(u))}</b>${me ? "<small>Tap to remove</small>" : ""}</span><i>${esc(e)}</i></button>`;
      }).join("")}</div></div>`);
    const shut = () => { s.classList.add("closing"); setTimeout(() => s.remove(), 180); };
    $$("[data-f]", s).forEach((b) => b.onclick = () => {
      $$("[data-f]", s).forEach((x) => x.classList.toggle("on", x === b));
      $$(".rxs-row", s).forEach((r) => { r.hidden = !!b.dataset.f && r.dataset.e !== b.dataset.f; });
    });
    const mine = $("[data-rm]", s);
    if (mine) mine.onclick = () => { mine.classList.add("gone"); setTimeout(() => { shut(); react(id, (m.reactions || {})[S.me.id]); }, 160); };
  }
  const react = (id, e) => {  // add, change or take back my reaction: shows at once, the server catches up
    const m = findMsg(id); if (!m || !e) return;
    const before = { ...(m.reactions || {}) }, removing = before[S.me.id] === e, after = { ...before };
    if (removing) delete after[S.me.id]; else after[S.me.id] = e;
    const pill = $(`.msg[data-id="${id}"] .reacts`), apply = () => { const x = findMsg(id); if (x) { x.reactions = after; drawChat(); } };
    if (removing) {
      navigator.vibrate && navigator.vibrate(6);
      const left = Object.values(after), span = pill && [...pill.querySelectorAll("span")].find((x) => x.textContent === e);
      if (pill && !left.length) pill.classList.add("out");
      else if (span && !left.includes(e)) span.classList.add("out");
      if (pill) { pill.classList.remove("pop"); pill.removeAttribute("style"); rxOut[id] = { at: Date.now(), html: pill.outerHTML }; }
      setTimeout(apply, pill ? 200 : 0);
    } else { burstAt($(`.msg[data-id="${id}"] .bub`), e); apply(); }
    return api(`/api/messages/${id}/react`, { body: { emoji: e } }).then((saved) => { const same = JSON.stringify(saved.reactions || {}) === JSON.stringify(after); upsert(saved); if (!same) drawChat(); })
      .catch((x) => { const y = findMsg(id); if (y) { y.reactions = before; drawChat(); } toast(x.message); });
  };

  // ------------------------------------------------------------------ history + touch: back button, edge swipe, sheet swipe, paste / drop
  // Every page, sheet and the open chat gets a history entry, so Android back and a desktop mouse's back button close the top one.
  const NAV = { depth: 0, chat: 0, layers: [], silent: 0, t: 0 };
  try { history.replaceState({ d: 0 }, "", location.href); } catch { }
  const navNeed = () => Math.max(NAV.chat, 0, ...NAV.layers.map((l) => l.d));
  function navSync() {  // after something closes in code, drop the leftover history entry (a short wait lets a page that is replaced by another reuse it)
    clearTimeout(NAV.t);
    NAV.t = setTimeout(() => { const need = navNeed(); if (NAV.depth > need) { const n = NAV.depth - need; NAV.depth = need; NAV.silent++; history.go(-n); } }, 40);
  }
  function navOpen(close) {
    const L = { d: 0, close };
    if (NAV.depth === navNeed() + 1) { L.d = NAV.depth; try { history.replaceState({ d: L.d }, "", location.href); } catch { } }
    else { L.d = ++NAV.depth; try { history.pushState({ d: L.d }, "", location.href); } catch { } }
    NAV.layers.push(L); return L;
  }
  function layer(el, closeFn) {  // register a page / sheet / overlay: back closes it, and removing it by code tidies the history
    const L = navOpen(() => (closeFn ? closeFn() : el.remove())), rm = el.remove.bind(el);
    el.remove = () => { const i = NAV.layers.indexOf(L); if (i >= 0) { NAV.layers.splice(i, 1); navSync(); } rm(); };
    el._layer = L; return L;
  }
  function chatEnter(cid) {
    const u = "#c=" + cid;
    try {
      if (!NAV.chat) { NAV.chat = ++NAV.depth; history.pushState({ d: NAV.chat }, "", u); }
      else history.replaceState({ d: NAV.depth }, "", u);
    } catch { }
  }
  function leaveChat() { S.cur = null; setView("list"); drawList(); drawChatPane(); }
  addEventListener("popstate", (e) => {
    if (NAV.silent > 0) { NAV.silent--; return; }
    const nd = (e.state && e.state.d) || 0;
    if (nd >= NAV.depth) { NAV.depth = nd; return; }
    NAV.depth = nd;
    for (const l of [...NAV.layers].reverse()) if (l.d > nd) { NAV.layers.splice(NAV.layers.indexOf(l), 1); l.close(); }
    if (NAV.chat > nd) { NAV.chat = 0; leaveChat(); }
  });

  // swipe from the left edge to go back, like iOS: the page follows the finger, the one underneath slides in
  const EDGE = { on: false };
  (() => {
    let id = null, sx = 0, sy = 0, lock = 0, el = null, under = null, L = null, kind = "", w = 0, ts = [];
    const phone = () => matchMedia("(max-width: 759px)").matches;
    const blocked = () => $(".sheet-bg,.viewer,.avv,.hn,.wpv,.vrec,.mpv");
    document.addEventListener("touchstart", (e) => {
      EDGE.on = false; id = null;
      if (e.touches.length !== 1 || !S.me || blocked()) return;
      const x = e.touches[0].clientX; if (x >= 24) return;
      const pgs = $$(".page"), pg = pgs[pgs.length - 1];
      if (pg && pg._layer && !pg.classList.contains("closing")) { kind = "page"; el = pg; L = pg._layer; under = pgs.length > 1 ? pgs[pgs.length - 2] : app; }
      else if (!pg && phone() && S.view === "chat" && S.cur) { kind = "chat"; el = $("#chatPane"); under = null; L = null; }
      else return;
      sx = x; sy = e.touches[0].clientY; lock = 0; w = innerWidth; ts = []; id = e.touches[0].identifier; EDGE.on = true;
    }, { passive: true, capture: true });
    const begin = () => {
      el.style.transition = "none"; el.style.willChange = "transform";
      if (kind === "chat") { app.classList.remove("settle"); app.classList.add("peek"); app.style.setProperty("--p", 0); }
      else { el.style.boxShadow = "-10px 0 30px rgba(0,0,0,.22)"; under.style.transition = "none"; under.style.willChange = "transform"; under.style.transform = "translateX(-18%)"; }
    };
    const move = (x) => {
      const p = Math.min(1, x / w); el.style.transform = `translateX(${x}px)`;
      if (kind === "chat") app.style.setProperty("--p", p); else under.style.transform = `translateX(${-18 * (1 - p)}%)`;
    };
    document.addEventListener("touchmove", (e) => {
      if (id === null) return;
      const tc = [...e.touches].find((x) => x.identifier === id); if (!tc) return;
      const dx = tc.clientX - sx, dy = tc.clientY - sy;
      if (!lock) {
        if (Math.hypot(dx, dy) < 10) return;  // decide the direction first, so vertical scrolling is never touched
        if (dx > 0 && Math.abs(dx) > Math.abs(dy)) { lock = 1; begin(); } else { lock = -1; id = null; EDGE.on = false; return; }
      }
      if (lock === 1) { if (e.cancelable) e.preventDefault(); const x = Math.max(0, dx); ts.push([x, performance.now()]); if (ts.length > 4) ts.shift(); move(x); }
    }, { passive: false, capture: true });
    const end = (e) => {
      const was = lock === 1; id = null; lock = 0; EDGE.on = false; if (!was) return;
      const a = ts[0], b = ts[ts.length - 1], x = b ? b[0] : 0, v = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
      finish(e.type !== "touchcancel" && (x / w > .35 || (v > .5 && x > 30)));
    };
    document.addEventListener("touchend", end, { passive: true, capture: true });
    document.addEventListener("touchcancel", end, { passive: true, capture: true });
    const finish = (done) => {
      const E = el, K = kind, U = under, LL = L;
      const dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260, tr = `transform ${dur}ms cubic-bezier(.2,.8,.2,1)`;
      E.style.transition = tr; if (K === "page") U.style.transition = tr; else app.classList.add("settle");
      requestAnimationFrame(() => {
        E.style.transform = `translateX(${done ? w : 0}px)`;
        if (K === "chat") app.style.setProperty("--p", done ? 1 : 0); else U.style.transform = done ? "" : "translateX(-18%)";
      });
      setTimeout(() => {
        const clear = (n) => { n.style.transition = n.style.transform = n.style.boxShadow = n.style.willChange = ""; };
        if (K === "page") {
          if (done) { E.style.display = "none"; const i = NAV.layers.indexOf(LL); if (i >= 0) NAV.layers.splice(i, 1); LL.close(); navSync(); }
          else clear(E);
          clear(U);
        } else {
          if (done) { app.classList.add("noanim"); NAV.chat = 0; leaveChat(); app.classList.remove("slide"); navSync(); setTimeout(() => app.classList.remove("noanim"), 150); }
          clear(E); app.classList.remove("peek", "settle"); app.style.removeProperty("--p");
        }
      }, dur + 30);
    };
  })();

  // paste a picture, or drop photos / videos on the chat: look at them first (with a caption)
  const isMedia = (f) => /^(image|video)\//.test(f.type);
  document.addEventListener("paste", (e) => {
    if (!S.cur || !S.me || $(".mpv,.sheet-bg,.page")) return;
    const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isMedia);
    if (fs.length) { e.preventDefault(); mediaPreview(fs); }
  });
  document.addEventListener("dragover", (e) => { if (S.cur && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    if (!S.cur || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const fs = [...e.dataTransfer.files].filter(isMedia);
    fs.length ? mediaPreview(fs) : toast("Drop photos or videos");
  });

  // the Chat theme row (all info pages) and the unread-reminder switch (1:1 chats)
  const themeRow = (c) => `<div class="irows"><button class="irow" data-i="theme"><i>🎨</i><span><b>Chat theme</b><small>Wallpaper, photo backgrounds, colours</small></span><em>›</em></button>
    ${c && c.kind === "direct" ? `<label class="irow"><i>💌</i><span><b>Remind me about unread messages</b><small>A gentle nudge after 15 and 45 minutes</small></span><input type="checkbox" class="swtog" id="iNudge" ${c.nudge === false ? "" : "checked"}></label>` : ""}</div>`;
  function bindNudge(page, c) {
    const sw = $("#iNudge", page); if (!sw) return;
    sw.onchange = async () => {
      const on = sw.checked;
      try { addConv(await api(`/api/convs/${c.id}/nudge`, { method: "PUT", body: { on } })); cacheSave(); toast(on ? "Unread reminders on 💌" : "Unread reminders off"); }
      catch (x) { sw.checked = !on; toast(x.message); }
    };
  }

  // ------------------------------------------------------------------ v20: profile photo viewer + nicknames
  function refreshInfo() {
    const pg = $(".page.info"); if (!pg || pg.classList.contains("closing") || +pg.dataset.cid !== S.cur) return;
    const keep = pg.querySelector(".page-body").scrollTop; pg.remove(); infoPage();
    const nb = $(".page.info .page-body"); if (nb) nb.scrollTop = keep;
  }
  const NICK_IDEAS = ["Sayang", "Love", "Babe", "Honey", "My person", "Cintaku"];
  function nickSheet(u) {
    const cur = S.nicks[u.id] || "", real = (u.name || "").split(" ")[0] || "them";
    const s = sheet(`<h3 style="margin:4px 0 2px">What do you call ${esc(real)}?</h3>
      <p style="color:var(--muted);margin:0 0 10px;font-size:14px">Only you see this. ${esc(real)} will see a little note that you gave one 💕</p>
      <input id="nk" maxlength="30" value="${esc(cur)}" placeholder="A sweet name" style="width:100%;min-height:44px;font-size:17px">
      <div class="nickchips">${NICK_IDEAS.map((n, i) => `<button class="chipn" style="animation-delay:${i * 45}ms">${esc(n)}</button>`).join("")}</div>
      <div class="nickbtns">${cur ? `<button class="nkrm" id="nkRm">Remove</button>` : ""}<button class="nksave" id="nkSave">Save</button></div>`);
    const nk = $("#nk", s); setTimeout(() => nk.focus(), 260);
    $$(".chipn", s).forEach((b) => b.onclick = () => { nk.value = b.textContent; nk.focus(); });
    const go = async (val) => {
      try {
        const r = await api(`/api/nicknames/${u.id}`, { method: "PUT", body: { nick: val } });
        if (r.nick) S.nicks[u.id] = r.nick; else delete S.nicks[u.id];
        s.remove(); drawAll(); refreshInfo(); toast(r.nick ? `Now “${r.nick}” 💕` : "Nickname removed");
      } catch (x) { toast(x.message); }
    };
    $("#nkSave", s).onclick = () => go(nk.value.trim());
    nk.onkeydown = (e) => { if (e.key === "Enter") go(nk.value.trim()); };
    if ($("#nkRm", s)) $("#nkRm", s).onclick = () => go("");
  }

  async function changeMyPhoto(file) {
    try { const sq = await cropImage(file, 512); if (!sq) return false; const fd = new FormData(); fd.append("file", sq, "avatar.jpg"); S.me = await api("/api/me/avatar", { body: fd }); drawAll(); if ($(".tabpage[data-tp=settings] .tp-scroll")) drawSettings(); toast("Photo updated"); return true; }
    catch (x) { toast(x.message); return false; }
  }
  function photoViewer(uid, from) {
    const u = uid === S.me.id ? S.me : userById(uid); if (!u || $(".avv")) return;
    const mine = u.id === S.me.id, nm = mine ? u.name : dn(u), nick = !mine && S.nicks[u.id];
    const ov = document.createElement("div"); ov.className = "avv";
    const ini = (u.name || u.username || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const body = () => u.avatar ? `<img src="${fileUrl(u.avatar)}" alt="" draggable="false">` : `<span class="avv-ini" style="background:${COLORS[(u.id || 0) % COLORS.length]}">${esc(ini)}</span>`;
    ov.innerHTML = `<div class="avv-pic">${body()}</div>
      <div class="avv-cap"><b>${esc(nm || "")}</b><small>${nick ? esc(u.name || "") + " · " : ""}@${esc(u.username || "")}</small>${u.avatar ? "" : `<em>No photo yet</em>`}
        ${mine ? `<label class="avv-ch"><span>${u.avatar ? "Change photo" : "Add a photo"}</span><input type="file" accept="image/*" hidden></label>` : ""}</div>
      <button class="avv-x" aria-label="Close">✕</button>`;
    document.body.appendChild(ov);
    const pic = $(".avv-pic", ov), cap = $(".avv-cap", ov), x = $(".avv-x", ov);
    const src = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
    const fit = () => { const w = Math.min(innerWidth, innerHeight * .6, 520); pic.style.width = pic.style.height = w + "px"; };
    fit();
    // spring from the tapped circle to the big picture
    const flip = (rev) => {
      const r = pic.getBoundingClientRect(); if (!src || !src.width) return null;
      const dx = src.left + src.width / 2 - (r.left + r.width / 2), dy = src.top + src.height / 2 - (r.top + r.height / 2), k = src.width / r.width;
      const a = { transform: `translate(${dx}px,${dy}px) scale(${k})` }, b = { transform: "none" };
      return pic.animate(rev ? [b, a] : [a, b], { duration: rev ? 220 : 480, easing: rev ? "cubic-bezier(.4,0,.8,.6)" : "cubic-bezier(.2,1.15,.3,1)", fill: "both" });
    };
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: "both" });
    [cap, x].forEach((e, i) => e.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 160 + i * 40, easing: "cubic-bezier(.2,1.1,.3,1)", fill: "both" }));
    flip(false);
    let closing = false;
    const shut = () => {
      if (closing) return; closing = true;
      if (!flip(true)) pic.animate([{ transform: pic.style.transform || "none" }, { transform: "scale(.85)" }], { duration: 220, fill: "both" });
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "both" });
      setTimeout(() => ov.remove(), 250);
    };
    layer(ov, shut);
    x.onclick = (e) => { e.stopPropagation(); shut(); };
    const fi = $("input", ov);
    if (fi) fi.onchange = async () => { const f = fi.files[0]; fi.value = ""; if (f && await changeMyPhoto(f)) { u.avatar = S.me.avatar; pic.innerHTML = body(); $(".avv-ch span", ov).textContent = "Change photo"; const em = $("em", ov); if (em) em.remove(); } };
    cap.onclick = (e) => e.stopPropagation();
    // pinch / double-tap zoom, drag when zoomed, swipe down to close
    let sc = 1, tx = 0, ty = 0, moved = false, pinch = 0, p0 = null, last = 0, tmr = 0;
    const apply = (anim) => { pic.style.transition = anim ? "transform .3s cubic-bezier(.2,1.1,.3,1)" : "none"; pic.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    pic.addEventListener("touchstart", (e) => {
      moved = false; if (e.touches.length === 2) pinch = dist(e.touches) / sc;
      else if (e.touches.length === 1) p0 = { x: e.touches[0].clientX - tx, y: e.touches[0].clientY - ty };
    }, { passive: true });
    pic.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && pinch) { sc = Math.max(1, Math.min(5, dist(e.touches) / pinch)); moved = true; apply(); }
      else if (e.touches.length === 1 && p0) {
        const nx = e.touches[0].clientX - p0.x, ny = e.touches[0].clientY - p0.y;
        if (sc > 1 || Math.abs(ny) > 6 || moved) { tx = sc > 1 ? nx : 0; ty = ny; moved = true; apply(); if (sc === 1) ov.style.background = `rgba(0,0,0,${Math.max(.2, .92 - Math.abs(ty) / 500)})`; }
      }
    }, { passive: true });
    pic.addEventListener("touchend", (e) => {
      if (e.touches.length) return; pinch = 0; p0 = null;
      if (sc < 1.05) { sc = 1; tx = 0; if (Math.abs(ty) > 90) { shut(); return; } ty = 0; ov.style.background = ""; apply(true); }
    });
    ov.addEventListener("click", () => {
      if (moved) { moved = false; return; }
      const t = Date.now();
      if (t - last < 300) { clearTimeout(tmr); last = 0; sc = sc > 1 ? 1 : 2.4; tx = ty = 0; apply(true); return; }
      last = t; tmr = setTimeout(shut, 300);
    });
    addEventListener("resize", fit, { once: true });
    return ov;
  }
  // any avatar with data-av opens the viewer (a tap on the picture, not the rest of the row)
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-av]");
    if (!a || !S.me || e.target.closest(".rxs-row,.hm-pick,.item.person,.avv")) return;
    e.preventDefault(); e.stopPropagation();
    photoViewer(+a.dataset.av, a);
  }, true);

  function sheet(html) {
    const bg = document.createElement("div"); bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
    const sh = bg.firstChild, shut = () => { if (bg.classList.contains("closing")) return; bg.classList.add("closing"); setTimeout(() => bg.remove(), 180); };
    bg.onclick = (e) => { if (e.target === bg) shut(); };
    document.body.appendChild(bg); layer(bg, shut);
    // swipe down from the grab handle or the top strip to close; it follows the finger and springs back if you let go early
    let y0 = 0, dy = 0, on = false, ts = [];
    sh.addEventListener("touchstart", (e) => {
      on = false; const r = sh.getBoundingClientRect(), y = e.touches[0].clientY;
      if (e.touches.length !== 1 || y - r.top > 56 || e.target.closest("input,textarea,select")) return;
      y0 = y; dy = 0; on = true; ts = []; sh.style.animation = "none"; sh.style.transition = "none";
    }, { passive: true });
    sh.addEventListener("touchmove", (e) => {
      if (!on) return; dy = e.touches[0].clientY - y0;
      if (dy <= 0) { dy = 0; sh.style.transform = ""; return; }
      if (e.cancelable) e.preventDefault();
      ts.push([dy, performance.now()]); if (ts.length > 4) ts.shift();
      sh.style.transform = `translateY(${dy}px)`; bg.style.background = `rgba(0,0,0,${.5 * (1 - Math.min(1, dy / sh.offsetHeight))})`;
    }, { passive: false });
    const up = (e) => {
      if (!on) return; on = false;
      const a = ts[0], b = ts[ts.length - 1], v = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
      if (e.type !== "touchcancel" && (dy > 110 || (v > .6 && dy > 24))) {
        sh.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)"; sh.style.transform = "translateY(105%)"; bg.style.transition = "background .22s"; bg.style.background = "rgba(0,0,0,0)";
        setTimeout(() => bg.remove(), 220);
      } else { sh.style.transition = "transform .4s cubic-bezier(.2,.9,.3,1.25)"; sh.style.transform = ""; bg.style.background = ""; }
    };
    sh.addEventListener("touchend", up, { passive: true }); sh.addEventListener("touchcancel", up, { passive: true });
    return bg;
  }

  function msgMenu(id) {
    const m = findMsg(id); if (!m || m.deleted) return;
    const mine = m.sender === S.me.id, myRx = (m.reactions || {})[S.me.id];
    const s = sheet(`<div class="menu"><div class="rx">${REACTIONS.map((r, i) => `<button data-rx="${r}" class="${myRx === r ? "on" : ""}" style="animation-delay:${i * 30}ms" title="${myRx === r ? "Remove" : ""}">${r}</button>`).join("")}</div>
      <button data-a="reply">↩️ Reply</button><button data-a="star">${S.stars.has(id) ? "☆ Unstar" : "⭐ Star"}</button>${m.text ? `<button data-a="copy">📋 Copy</button>` : ""}
      ${mine && m.text && (!m.attachment || m.kind === "image" || m.kind === "video") ? `<button data-a="edit">✏️ Edit</button>` : ""}${mine ? `<button data-a="delete" class="danger">🗑 Delete for everyone</button>` : ""}</div>`);
    $$("[data-rx]", s).forEach((b) => b.onclick = () => { s.remove(); react(id, b.dataset.rx); });
    $$("[data-a]", s).forEach((b) => b.onclick = async () => {
      s.remove(); const a = b.dataset.a;
      if (a === "reply") { S.reply = m; S.edit = null; drawReply(); $("#txt").focus(); }
      if (a === "star") toggleStar(id);
      if (a === "copy") navigator.clipboard.writeText(m.text).then(() => toast("Copied"));
      if (a === "edit") { S.edit = m; S.reply = null; $("#txt").value = m.text; window.growComposer(); drawReply(); $("#txt").focus(); }
      if (a === "delete" && confirm("Delete this message for everyone?")) api(`/api/messages/${id}`, { method: "DELETE" }).then(upsert).then(drawChat).catch((x) => toast(x.message));
    });
  }
  function drawReply() {
    const el = $("#replybar"); if (!el) return; const m = S.reply || S.edit;
    const who = m ? (m.sender === S.me.id ? "yourself" : (userById(m.sender) || {}).name || "") : "";
    el.innerHTML = m ? `<div class="reply-bar"><div><b>${S.edit ? "Editing" : "Replying to " + esc(who)}</b> · ${esc(preview(m).slice(0, 80))}</div><button class="cbtn" id="rclose">✕</button></div>` : "";
    if (m) $("#rclose").onclick = () => { if (S.edit) $("#txt").value = ""; S.reply = S.edit = null; drawReply(); window.growComposer(); };
  }
  async function sendText() {
    const txt = $("#txt"), text = txt.value.trim();
    if (S.edit) { if (text) await api(`/api/messages/${S.edit.id}`, { method: "PATCH", body: { text } }).then(upsert).catch((x) => toast(x.message)); S.edit = null; }
    else if (text) send({ text, reply_to: S.reply ? S.reply.id : null });
    txt.value = ""; S.reply = null; drawReply(); window.growComposer(); drawChat();
  }

  async function shrinkImage(file, max = 2048, square = false) {  // phone photos are huge: send a sharp JPEG instead
    const img = await createImageBitmap(file).catch(() => null); if (!img) return file;
    if (!square && file.size < 1.2e6 && Math.max(img.width, img.height) <= max) return file;
    const c = document.createElement("canvas");
    if (square) { const s = Math.min(img.width, img.height); c.width = c.height = max; c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, max, max); }
    else { const k = Math.min(1, max / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
    return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  async function sendFile(file, kind, text = "", extra = {}) {
    if (file.size > 100 * 1048576) return toast("Files up to 100 MB");
    kind = kind || (/^image\//.test(file.type) ? "image" : /^video\//.test(file.type) ? "video" : "file");
    const cid = S.cur, reply = S.reply ? S.reply.id : null;
    const temp = { id: 0, conv_id: cid, sender: S.me.id, client_id: rid(), kind, text, attachment: { local: true, name: file.name }, reactions: {}, created: now(), pending: true };
    S.reply = null; drawReply(); upsert(temp); drawChat(); scrollEnd(true);
    try {
      const f = kind === "image" ? await shrinkImage(file) : file, att = {};
      if (kind === "video" || kind === "videonote") {
        const info = await videoInfo(f);
        if (info.poster) { try { att.poster = (await upload(new File([info.poster], "poster.jpg", { type: "image/jpeg" }))).id; } catch { } }
        if (info.w) { att.w = info.w; att.h = info.h; } if (info.dur) att.dur = info.dur;
      }
      const up = await upload(f, (p) => { const el = f.size > 1.5e6 && $(`.msg[data-cid="${temp.client_id}"] .txt`); if (el) el.textContent = `⏳ ${f.name}  ${p}%`; });
      S.msgs[cid] = (S.msgs[cid] || []).filter((m) => m !== temp);
      const prevCur = S.cur; S.cur = cid; await send({ kind, text, attachment: { ...up, ...att, ...extra }, reply_to: reply }); S.cur = prevCur;
    } catch (e) { S.msgs[cid] = (S.msgs[cid] || []).filter((m) => m !== temp); if (S.cur === cid) drawChat(); toast("Couldn't send: " + e.message); }
  }
  let rec = null, vrev = null;
  function voiceDiscard() {
    if (vrev) { vrev.audio.pause(); URL.revokeObjectURL(vrev.url); vrev = null; }
    const d = $("#dock"); if (d) d.classList.remove("reviewing"); const r = $("#vrev"); if (r) r.remove();
  }
  function voiceReview(file, secs) {  // after you stop: listen, scrub, then send or throw away
    voiceDiscard(); const dock = $("#dock"); if (!dock) return;
    const url = URL.createObjectURL(file), audio = new Audio(url), N = 40; audio.preload = "auto";
    let bars = Array.from({ length: N }, (_, i) => .3 + .55 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * .6)));
    const el = document.createElement("div"); el.id = "vrev"; el.className = "vrev";
    el.innerHTML = `<button class="cbtn" data-d title="Discard" aria-label="Discard">🗑</button><button class="cbtn vplay" data-p title="Play" aria-label="Play">▶</button>
      <div class="vwave" role="slider" aria-label="Seek"></div><span class="vdur">${fmtDur(secs)}</span><button class="cbtn send" data-s title="Send" aria-label="Send">➤</button>`;
    dock.insertBefore(el, $("#compose")); dock.classList.add("reviewing");
    vrev = { audio, url, file, secs, cid: S.cur };
    const wave = $(".vwave", el), play = $("[data-p]", el), dur = $(".vdur", el), len = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : secs);
    const draw = () => { const p = Math.min(1, audio.currentTime / len()); wave.innerHTML = bars.map((h, i) => `<i class="${i / N < p ? "on" : ""}" style="height:${Math.round(h * 100)}%"></i>`).join(""); dur.textContent = fmtDur(audio.paused && !audio.currentTime ? secs : audio.currentTime); };
    draw();
    file.arrayBuffer().then((b) => { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = new AC(); return ctx.decodeAudioData(b).finally(() => { try { ctx.close(); } catch { } }); }).then((buf) => {
      if (!buf || !vrev || vrev.url !== url) return;
      const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / N)), peaks = [];
      for (let i = 0; i < N; i++) { let m = 0; for (let k = i * step; k < Math.min(d.length, (i + 1) * step); k += 24) m = Math.max(m, Math.abs(d[k])); peaks.push(m); }
      const top = Math.max(...peaks, .001); bars = peaks.map((p) => .14 + .86 * (p / top)); draw();
    }).catch(() => { });
    audio.ontimeupdate = draw; audio.onended = () => { audio.currentTime = 0; play.textContent = "▶"; draw(); };
    play.onclick = () => { if (audio.paused) { audio.play().then(() => { play.textContent = "❚❚"; }).catch(() => { }); } else { audio.pause(); play.textContent = "▶"; } };
    const seek = (e) => { const r = wave.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len(); draw(); };
    let drag = false;
    wave.onpointerdown = (e) => { drag = true; try { wave.setPointerCapture(e.pointerId); } catch { } seek(e); };
    wave.onpointermove = (e) => { if (drag) seek(e); }; wave.onpointerup = wave.onpointercancel = () => { drag = false; };
    $("[data-d]", el).onclick = voiceDiscard;
    $("[data-s]", el).onclick = () => { voiceDiscard(); sendFile(file, "voice"); };
  }
  async function toggleVoice() {
    const btn = $("#bsend");
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast(isIOS && !standalone ? "Voice notes work in the Home Screen app" : "This browser can't record");
    try {
      voiceDiscard();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const chunks = []; rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
      const started = Date.now(), tick = setInterval(() => { btn.textContent = "■ " + Math.floor((Date.now() - started) / 1000) + "s"; }, 500);
      btn.classList.add("rec"); btn.textContent = "■";
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); btn.classList.remove("rec"); window.growComposer();
        const mime = (rec.mimeType || "audio/mp4").split(";")[0], secs = (Date.now() - started) / 1000; rec = null;
        if (secs < .8) return toast("Tap the mic, talk, then tap ■ to review");
        voiceReview(new File([new Blob(chunks, { type: mime })], `voice.${mime.includes("mp4") ? "m4a" : "webm"}`, { type: mime }), secs);
      };
      rec.start();
    } catch { rec = null; toast("Microphone not allowed"); }
  }

  // every message with its category's weight (templates.json "weight", default 1): Miss you and Love come up more
  const tplPool = (cats) => cats.flatMap((c) => c.items.map((t) => [Math.max(0, +c.weight || 1), t, c]));
  function pickWeighted(pool) {
    let r = Math.random() * pool.reduce((n, [w]) => n + w, 0);
    for (let i = 0; i < pool.length; i++) if ((r -= pool[i][0]) < 0) return i;
    return pool.length - 1;
  }

  let TEMPLATES = null;
  async function loadTemplates() {
    if (!TEMPLATES) { try { TEMPLATES = await (await fetch("templates.json", { cache: "no-cache" })).json(); } catch { TEMPLATES = { categories: [] }; } }
    return TEMPLATES;
  }
  async function openTemplates() {
    await loadTemplates();
    const cats = TEMPLATES.categories || [], all = cats.flatMap((c) => c.items.map((t) => [c, t]));
    let cur = store.get("tplcat", cats[0] && cats[0].id), q = "";
    const s = sheet(`<h3>💌 Quick messages</h3><input class="inp" type="search" id="tq" placeholder="Search ${all.length} messages" style="margin-bottom:8px">
      <div class="chips" id="tchips"></div><div class="tlist" id="tlist"></div>`);
    const pick = (t) => { const txt = $("#txt"); txt.value = txt.value.trim() ? txt.value.trim() + " " + t : t; window.growComposer(); s.remove(); txt.focus(); };
    const draw = () => {
      const tab = (c) => `<button data-c="${esc(c.id)}" class="${!q && c.id === cur ? "on" : ""}">${esc(c.emoji)} ${esc(c.name)}</button>`;
      const fav = cats.filter((c) => (+c.weight || 1) > 1);  // favourites first, then Surprise me, then the rest
      $("#tchips", s).innerHTML = fav.map(tab).join("") + `<button data-c="random">🎲 Surprise me</button>` + cats.filter((c) => !fav.includes(c)).map(tab).join("");
      const items = q ? all.filter(([, t]) => t.toLowerCase().includes(q)).map(([, t]) => t) : ((cats.find((c) => c.id === cur) || { items: [] }).items);
      $("#tlist", s).innerHTML = items.map((t, i) => `<button data-i="${i}">${esc(t)}</button>`).join("") || `<div class="empty">Nothing found</div>`;
      $$("[data-i]", s).forEach((b) => b.onclick = () => pick(items[+b.dataset.i]));
      $$("[data-c]", s).forEach((b) => b.onclick = () => {
        if (b.dataset.c === "random") { const pool = tplPool(cats); return pick(pool[pickWeighted(pool)][1]); }
        cur = b.dataset.c; q = ""; $("#tq", s).value = ""; store.set("tplcat", cur); draw();
      });
    };
    $("#tq", s).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
    draw();
  }
  function openEmoji() {
    const s = sheet(`<div class="emojis">${EMOJIS.map((e) => `<button>${e}</button>`).join("")}</div>`);
    $$("button", s).forEach((b) => b.onclick = () => { const t = $("#txt"); t.value += b.textContent; window.growComposer(); s.remove(); t.focus(); });
  }

  // ------------------------------------------------------------------ new chat, profile, admin
  function newChat() {
    const s = sheet(`<h3>New chat</h3><input class="inp" id="nu" placeholder="Search a name or @username" autocapitalize="none" autocorrect="off" autocomplete="off">
      <div id="nres" class="people"></div>
      <button class="item" id="nself">${avatar(null, "sm", true)} <span><b>Notes to self</b><br><small style="color:var(--muted)">Only you can see it</small></span></button>`);
    const start = async (username) => {
      try { const c = await api("/api/convs", { body: { username } }); s.remove(); addConv(c); openConv(c.id); }
      catch (e) { toast(e.message); }
    };
    let timer = null, last = "";
    const look = async () => {
      const q = $("#nu", s).value.trim(); if (q === last) return; last = q;
      const el = $("#nres", s);
      if (!q) { el.innerHTML = recent(); bindRes(); return; }
      let res = []; try { res = await api(`/api/users/search?q=${encodeURIComponent(q)}`); } catch { }
      if (q !== last) return;
      el.innerHTML = res.length ? res.map((u) => personRow(u)).join("") : `<div class="hint">Nobody called “${esc(q)}” yet. Usernames are under each person's photo in their app.</div>`;
      bindRes();
    };
    const personRow = (u) => `<button class="item person" data-u="${esc(u.username)}"><div class="av-wrap ${u.online ? "on" : ""}">${avatar(u, "sm")}</div><span><b>${esc(u.name)}</b><br><small style="color:var(--muted)">@${esc(u.username)}</small></span></button>`;
    const recent = () => { const people = S.convs.filter((c) => c.kind === "direct").map(other).filter(Boolean).slice(0, 6); return people.length ? `<div class="hint">Recent</div>` + people.map(personRow).join("") : ""; };
    const bindRes = () => $$("[data-u]", s).forEach((b) => b.onclick = () => start(b.dataset.u));
    $("#nu", s).oninput = () => { clearTimeout(timer); timer = setTimeout(look, 180); };
    $("#nu", s).onkeydown = (e) => { if (e.key === "Enter") { const first = $("[data-u]", s); start(first ? first.dataset.u : $("#nu", s).value); } };
    $("#nself", s).onclick = async () => { const c = await api("/api/convs", { body: { self: true } }); s.remove(); addConv(c); openConv(c.id); };
    $("#nres", s).innerHTML = recent(); bindRes();
    setTimeout(() => $("#nu", s).focus(), 150);
  }
  function addConv(c) { const i = S.convs.findIndex((x) => x.id === c.id); if (i >= 0) S.convs[i] = c; else S.convs.unshift(c); }

  const inviteLink = (code) => `${location.origin}/#invite=${code}`;
  function inviteSheet() {
    const s = sheet(`<h3 style="font:600 20px var(--serif);margin:4px 0 6px">👋 Invite a friend</h3>
      <div class="note">Make a link just for them. They pick their own username and password, and your chat starts right away.</div>
      <div class="field"><label>For (their name)</label><input class="inp" id="ifor" maxlength="40" placeholder="Optional, e.g. Raina"></div>
      <button class="big-btn" id="igo2">Create invite</button><div class="err" id="ierr"></div><div id="inew2"></div>
      <h4>My invites</h4><div id="ilist"></div>`);
    const list = async () => {
      let rows = []; try { rows = await api("/api/invites"); } catch (e) { }
      $("#ilist", s).innerHTML = rows.map((i) => `<div class="row" style="justify-content:space-between;gap:8px;padding:6px 0"><div><b>${esc(i.for_name || "Anyone")}</b>
          <div style="font-size:12px;color:var(--muted)">${i.used_by ? `✓ Joined${i.used_name ? " as " + esc(i.used_name) : ""}` : "Not used yet"}</div></div>
          ${i.used_by ? "" : `<span><button class="sbtn" data-ic="${esc(i.code)}">Copy</button> <button class="sbtn" data-idel="${esc(i.code)}" title="Revoke">✕</button></span>`}</div>`).join("") || `<div class="hint">No invites yet.</div>`;
      $$("[data-ic]", s).forEach((b) => b.onclick = () => copy(inviteLink(b.dataset.ic), "Invite link copied"));
      $$("[data-idel]", s).forEach((b) => b.onclick = async () => { try { await api(`/api/invites/${b.dataset.idel}`, { method: "DELETE" }); } catch (e) { toast(e.message); } list(); });
    };
    $("#igo2", s).onclick = async () => {
      const btn = $("#igo2", s), err = $("#ierr", s); btn.disabled = true; err.textContent = "";
      try {
        const nm = $("#ifor", s).value.trim(), r = await api("/api/invites", { body: { for_name: nm } }), link = inviteLink(r.code);
        $("#inew2", s).innerHTML = `<div class="code pop" style="margin-top:10px;word-break:break-all;font-size:14px">${esc(link)}</div>
          <div class="row" style="gap:8px;margin-top:8px"><button class="big-btn gold" id="icp" style="flex:1">Copy</button><button class="big-btn" id="ish" style="flex:1">Share</button></div>`;
        $("#icp", s).onclick = () => navigator.clipboard.writeText(link).then(() => toast("Invite link copied")).catch(() => prompt("Copy this:", link));
        $("#ish", s).onclick = () => { const t = `${nm ? "Hi " + nm + ", join" : "Join"} me on AFRA: ${link}`; (navigator.share ? navigator.share({ text: t }) : navigator.clipboard.writeText(t).then(() => toast("Message copied"))).catch(() => { }); };
        $("#ifor", s).value = ""; list();
      } catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    };
    list();
  }
  function profileSheet() {
    const pushOn = "Notification" in window && Notification.permission === "granted";
    const s = sheet(`<div style="text-align:center"><label style="cursor:pointer;display:inline-block">${avatar(S.me, "lg")}<input type="file" id="pav" accept="image/*" hidden></label>
        <div style="font:600 20px var(--serif);margin-top:8px">${esc(S.me.name)}</div><div style="color:var(--muted)">@${esc(S.me.username)}${S.me.is_admin ? ` <span class="pill gold">admin</span>` : ""}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px">Tap your photo to change it. Others add you by your username.</div></div>
      <h4>Profile</h4>
      <div class="field"><label>Name</label><input class="inp" id="pname" value="${esc(S.me.name)}"></div>
      <div class="field"><label>Username</label><input class="inp" id="puser" value="${esc(S.me.username)}" autocapitalize="none" autocorrect="off"></div>
      <div class="field"><label>About</label><input class="inp" id="pbio" value="${esc(S.me.bio || "")}" maxlength="140" placeholder="A line about you (people see it on your profile)"></div>
      <button class="big-btn" id="psave">Save</button><div class="err" id="perr"></div>
      <h4>Friends</h4>
      <button class="item" id="pinv">👋 Invite a friend</button>
      <h4>Notifications</h4>
      ${isIOS && !standalone ? `<div class="note warn">📲 On iPhone, notifications work in the Home Screen app: tap <b>Share</b> ⬆ → <b>Add to Home Screen</b>, then open A.F.R.A ♥ from its icon.</div>`
        : `<div class="row"><button class="sbtn" id="ppush">${pushOn ? "✓ On" : "Turn on"}</button>${pushOn ? `<button class="sbtn" id="ptest">Send me a test</button>` : ""}</div>`}
      <h4>Appearance</h4>
      <button class="item" id="plook">🔤 Appearance</button>
      <h4>Sounds</h4>
      <label class="row" style="font-size:15px"><input type="checkbox" id="psound" ${store.get("sound", true) ? "checked" : ""}> Soft sounds when sending and receiving</label>
      <h4>Password</h4>
      <div class="field"><input class="inp" type="password" id="pold" placeholder="Current password" autocomplete="current-password"></div>
      <div class="field"><input class="inp" type="password" id="pnew" placeholder="New password" autocomplete="new-password"></div>
      <button class="sbtn" id="ppw" style="margin-top:8px">Change password</button>
      <h4>This device</h4>
      <button class="item danger" id="pout">Log out</button>`);
    $("#plook", s).onclick = () => { s.remove(); lookSheet(); };
    $("#pinv", s).onclick = () => { s.remove(); inviteSheet(); };
    $("#pav", s).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { e.target.value = ""; const sq = await cropImage(f, 512); if (!sq) return; const fd = new FormData(); fd.append("file", sq, "avatar.jpg"); S.me = await api("/api/me/avatar", { body: fd }); s.remove(); drawAll(); profileSheet(); toast("Photo updated"); }
      catch (x) { toast(x.message); }
    };
    $("#psave", s).onclick = async () => {
      try { S.me = await api("/api/me", { method: "PATCH", body: { name: $("#pname", s).value, username: $("#puser", s).value, bio: $("#pbio", s).value } }); s.remove(); drawAll(); toast("Saved"); }
      catch (x) { $("#perr", s).textContent = x.message; }
    };
    pwChecklist($("#pnew", s));
    $("#ppw", s).onclick = async () => {
      try { S.me = await api("/api/me", { method: "PATCH", body: { password: $("#pold", s).value, new_password: $("#pnew", s).value } }); cacheSave(); toast("Password changed"); s.remove(); }
      catch (x) { toast(x.message); }
    };
    const pp = $("#ppush", s); if (pp) pp.onclick = async () => { const r = await enablePush(true); toast(r); s.remove(); profileSheet(); };
    const pt = $("#ptest", s); if (pt) pt.onclick = () => api("/api/push/test", { body: {} }).then(() => toast("Sent: lock your phone to see it")).catch((x) => toast(x.message));
    $("#psound", s).onchange = (e) => { store.set("sound", e.target.checked); if (e.target.checked) sound("send"); };
    $("#pout", s).onclick = () => { if (confirm("Log out on this device?")) logout(); };
  }

  async function adminPage() {
    const page = document.createElement("div"); page.className = "page";
    page.innerHTML = `<div class="top"><button class="icon" id="pBack">‹</button><h1>🛡 Admin</h1></div>
      <div class="chips tabs"><button data-t="home" class="on">Overview</button><button data-t="users">People</button><button data-t="inv">Invites</button><button data-t="notify">📣 Notify</button><button data-t="ai">🤖 AI</button></div>
      <div class="page-body" id="adm"></div>`;
    document.body.appendChild(page);
    const pclose = () => { if (page.classList.contains("closing")) return; page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    layer(page, pclose); $("#pBack", page).onclick = pclose;
    const dl = (path) => `${path}?t=${encodeURIComponent(TOKEN)}`;
    const tab = async (t) => {
      $$("[data-t]", page).forEach((b) => b.classList.toggle("on", b.dataset.t === t));
      const el = $("#adm", page); el.innerHTML = `<div class="hint">Loading…</div>`;
      try {
        if (t === "home") {
          const st = await api("/api/admin/stats");
          const card = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
          el.innerHTML = `<div class="stats">${card(st.users, "people")}${card(st.online, "online now")}${card(st.chats, "chats")}${card(st.messages, "messages")}${card(st.today, "in the last 24 h")}${card(st.push_devices, "phones with notifications")}${card(st.files, `files (${st.files_mb} MB)`)}${card(st.invites_open, "unused invites")}</div>
            <h4>Download the data</h4>
            <a class="dl" href="${dl("/api/admin/export/pets")}" download><span>🐾</span><span><b>Everyone's pets (.zip)</b><small>Every Home chat as a transcript, with each pet's stats, streak, daily care and the lists and reminders you share.</small></span></a>
            <a class="dl" href="${dl("/api/admin/export/everything")}" download><span>📦</span><span><b>Everything (.zip)</b><small>The complete database, every chat (and everyone's Notes to self) as readable transcripts, all photos, voice notes and files, and profile photos.</small></span></a>
            <div class="dl pick"><span>👤</span><span style="flex:1"><b>One person (.zip)</b><small>Their profile and photo, every chat they're in, their Notes to self, with all files.</small>
              <span class="row" style="margin-top:6px"><select id="dlUser" class="inp" style="flex:1;padding:8px"></select><a class="sbtn" id="dlUserGo" download>Download</a></span></span></div>
            <div class="dl pick"><span>💬</span><span style="flex:1"><b>One chat (.zip)</b><small>Any chat or someone's Notes to self, as a transcript (.html to read, .txt) plus its files.</small>
              <span class="row" style="margin-top:6px"><select id="dlChat" class="inp" style="flex:1;padding:8px"></select><a class="sbtn" id="dlChatGo" download>Download</a></span></span></div>
            <a class="dl" href="${dl("/api/admin/export/notes")}" download><span>📝</span><span><b>Everyone's Notes to self (.zip)</b><small>One folder per person, with transcripts and files.</small></span></a>
            <a class="dl" href="${dl("/api/admin/export/assistant")}" download><span>🤖</span><span><b>Everyone's Assistant (.zip)</b><small>Each person's chat with the assistant plus their reminders, notes, lists and saved places.</small></span></a>
            <a class="dl" href="${dl("/api/admin/export/users.csv")}" download><span>👥</span><span><b>People (spreadsheet)</b><small>Everyone with username, name, joined, last seen, messages sent. Opens in Excel, Numbers or Google Sheets. No passwords.</small></span></a>
            <a class="dl" href="${dl("/api/admin/export/chats.json")}" download><span>💬</span><span><b>All chats (JSON)</b><small>Every person, chat and message, readable. No passwords.</small></span></a>
            <div class="dl pick"><span>🗄</span><span style="flex:1"><b>Complete database (${st.db_mb} MB)</b><small>Every table and row. <b>.db</b> opens with “DB Browser for SQLite” (for a full copy or a move); <b>.json</b> is the same data as readable JSON. Passwords stay scrambled (hashed).</small>
              <span class="row" style="margin-top:8px"><a class="sbtn" href="${dl("/api/admin/export/db")}" download>⬇ .db</a><a class="sbtn" href="${dl("/api/admin/export/db.json")}" download>⬇ .json</a></span></span></div>
            <h4>Automatic daily backups (on the server)</h4>
            ${st.backups.map((b) => `<a class="dl small" href="${dl("/api/admin/backups/" + encodeURIComponent(b.name))}" download><span>📦</span><span><b>${esc(b.name)}</b><small>${b.mb} MB · ${shortTime(b.at)}</small></span></a>`).join("") || `<div class="hint">The first one is made within a few hours.</div>`}`;
          const [people, chats] = await Promise.all([api("/api/admin/users"), api("/api/admin/chats")]);
          const us = $("#dlUser", el), cs = $("#dlChat", el);
          us.innerHTML = people.map((u) => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`).join("");
          cs.innerHTML = chats.map((c) => `<option value="${c.id}">${esc(c.label)} · ${c.messages} msg</option>`).join("");
          const sync = () => { $("#dlUserGo", el).href = dl(`/api/admin/export/user/${us.value}`); $("#dlChatGo", el).href = dl(`/api/admin/export/chat/${cs.value}`); };
          us.onchange = cs.onchange = sync; sync();
        } else if (t === "notify") {
          notifyForm(el); stormCard(el);
        } else if (t === "ai") {
          aiUsage(el);
        } else if (t === "inv") {
          const inv = await api("/api/admin/invites");
          el.innerHTML = `<div class="note">Make an invite code and send the link. They choose their own username and password, and their chat with you starts right away.</div>
            <div class="field" style="margin-top:10px"><label>Who is it for? (a note for you)</label><input class="inp" id="inote" placeholder="e.g. Raina"></div>
            <label class="row" style="font-size:14px;margin-bottom:10px"><input type="checkbox" id="iadm"> Make them an admin too</label>
            <button class="big-btn" id="igo">Make invite code</button><div id="inew"></div>
            <h4>Invites</h4>${inv.map((i) => `<div class="urow"><div class="mid"><b style="font-family:monospace">${esc(i.code)}</b>${i.admin ? ` <span class="pill gold">admin</span>` : ""}
              <small>${esc(i.note || "")} · ${i.used_by ? "used by @" + esc(i.used_name || "?") : "not used yet"}</small></div>
              ${i.used_by ? "" : `<button class="sbtn" data-copy="${esc(i.code)}">Copy link</button><button class="sbtn" data-del="${esc(i.code)}">✕</button>`}</div>`).join("") || `<div class="hint">No invites yet.</div>`}`;
          $("#igo", el).onclick = async () => {
            const r = await api("/api/admin/invites", { body: { note: $("#inote", el).value, admin: $("#iadm", el).checked } });
            const link = `${location.origin}/#invite=${r.code}`;
            $("#inew", el).innerHTML = `<div class="code pop" style="margin-top:10px">${esc(r.code)}</div><button class="big-btn gold" id="icopy" style="width:100%;margin-top:8px">Send / copy invite link</button>
              <div class="hint">The link opens the app with the code filled in. Each code works once.</div>`;
            $("#icopy", el).onclick = () => copy(link, "Invite link copied");
          };
          $$("[data-copy]", el).forEach((b) => b.onclick = () => copy(`${location.origin}/#invite=${b.dataset.copy}`, "Invite link copied"));
          $$("[data-del]", el).forEach((b) => b.onclick = async () => { await api(`/api/admin/invites/${b.dataset.del}`, { method: "DELETE" }); tab("inv"); });
        } else {
          const users = await api("/api/admin/users");
          el.innerHTML = users.map((u) => `<div class="urow"><div class="av-wrap ${u.online ? "on" : ""}">${avatar(u, "sm")}</div><div class="mid"><b>${esc(u.name)}</b> <span style="color:var(--muted)">@${esc(u.username)}</span>${u.is_admin ? ` <span class="pill gold">admin</span>` : ""}${u.disabled ? ` <span class="pill">off</span>` : ""}
              <small>${u.online ? "online" : esc(lastSeen(u) || "never online")} · ${u.device_list.length ? esc([...new Set(u.device_list.map((d) => d.model || "Unknown"))].join(", ")) : "no devices"}</small></div>
              ${u.id === S.me.id ? `<button class="sbtn" data-more="${u.id}">⋯</button>` : `<button class="sbtn" data-chat="${esc(u.username)}">💬</button><button class="sbtn" data-more="${u.id}">⋯</button>`}</div>`).join("");
          $$("[data-chat]", el).forEach((b) => b.onclick = async () => { const c = await api("/api/convs", { body: { username: b.dataset.chat } }); page.remove(); addConv(c); openConv(c.id); });
          $$("[data-more]", el).forEach((b) => b.onclick = () => {
            const u = users.find((x) => x.id === +b.dataset.more);
            const m = sheet(`<h3>${esc(u.name)} <small style="color:var(--muted)">@${esc(u.username)}</small></h3><div class="menu">
              <button data-x="devices">📱 Devices (${u.device_list.length})</button>${u.id === S.me.id ? "" : `<button data-x="reset">🔑 Password reset code</button>`}${u.id === S.me.id ? "" : `<button data-x="admin">${u.is_admin ? "Remove admin" : "🛡 Make admin"}</button>`}
              ${u.id === S.me.id ? "" : `<button data-x="off" class="${u.disabled ? "" : "danger"}">${u.disabled ? "✓ Switch account back on" : "Switch account off (logs them out)"}</button>
              <button data-x="delete" class="danger">🗑 Delete account…</button>`}</div><div id="mout"></div>`);
            $$("[data-x]", m).forEach((x) => x.onclick = async () => {
              try {
                if (x.dataset.x === "devices") {
                  const when = (t) => t ? new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
                  $("#mout", m).innerHTML = u.device_list.map((d) => `<div class="devcard"><b>${d.online ? "🟢 " : ""}${esc(d.label)}</b>
                    <small>${esc([d.system, d.browser !== d.how ? d.browser : "", d.screen && `screen ${d.screen}`, d.lang, d.tz, d.dark ? "dark mode" : d.screen ? "light mode" : "", d.push ? "🔔 notifications on" : d.screen ? "🔕 notifications off" : ""].filter(Boolean).join(" · "))}</small>
                    <small>Logged in ${esc(when(d.logged_in))} · last used ${esc(when(d.last_used))}</small>
                    ${d.ua ? `<details><summary>Technical details</summary><code>${esc(d.ua)}</code></details>` : ""}</div>`).join("") || `<div class="hint">Not logged in on any device.</div>`;
                  return;
                }
                if (x.dataset.x === "delete") {
                  $("#mout", m).innerHTML = `<div class="hint" style="margin:10px 0">This removes @${esc(u.username)} for good: their account, their Notes to self, and their chats with everyone (the other person loses those chats too), with all photos and files. "Switch account off" is the undoable option. A copy of the database is saved in the server's backups first.</div>
                    <input class="inp" id="dconf" placeholder="Type ${esc(u.username)} to confirm" autocapitalize="none" autocorrect="off" autocomplete="off">
                    <button class="big-btn danger" id="dgo" style="width:100%;margin-top:8px" disabled>Delete @${esc(u.username)}</button>`;
                  $("#dconf", m).oninput = (ev) => { $("#dgo", m).disabled = ev.target.value.trim().replace(/^@/, "").toLowerCase() !== u.username.toLowerCase(); };
                  $("#dconf", m).focus();
                  $("#dgo", m).onclick = async () => {
                    try {
                      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
                      S.convs = S.convs.filter((c) => !(c.kind === "direct" && c.members.some((p) => p.id === u.id)));
                      cacheSave(); drawList(); m.remove(); toast(`@${u.username} deleted`); tab("users");
                    } catch (e) { toast(e.message); }
                  };
                  return;
                }
                if (x.dataset.x === "reset") {
                  const r = await api(`/api/admin/users/${u.id}/reset`, { body: {} }); const link = `${location.origin}/#reset=${r.code}`;
                  $("#mout", m).innerHTML = `<div class="code">${esc(r.code)}</div><button class="big-btn gold" id="rc" style="width:100%;margin-top:8px">Send / copy reset link</button><div class="hint">Valid for 7 days. They open it and choose a new password.</div>`;
                  $("#rc", m).onclick = () => copy(link, "Reset link copied"); return;
                }
                await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: x.dataset.x === "admin" ? { is_admin: !u.is_admin } : { disabled: !u.disabled } });
                m.remove(); tab("users");
              } catch (e) { toast(e.message); }
            });
          });
        }
      } catch (e) { el.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    $$("[data-t]", page).forEach((b) => b.onclick = () => tab(b.dataset.t));
    tab("home");
  }
  function copy(text, msg) {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) navigator.share({ text }).catch(() => navigator.clipboard.writeText(text).then(() => toast(msg)));
    else navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => prompt("Copy this:", text));
  }

  // ------------------------------------------------------------------ notifications
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  async function enablePush(ask) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return isIOS ? "Open A.F.R.A ♥ from the Home Screen first" : "This browser can't do notifications";
    if (Notification.permission === "denied") return "Notifications are blocked: allow them in Settings › Notifications › A.F.R.A ♥";
    if (Notification.permission !== "granted") { if (!ask) return "off"; if (await Notification.requestPermission() !== "granted") return "Notifications not allowed"; }
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) { const { key } = await api("/api/push/key"); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }); }
      await api("/api/push", { body: { sub: sub.toJSON(), device: DEVICE } }); reportDevice();
      return "Notifications are on ♥";
    } catch (e) { return "Couldn't turn on notifications: " + e.message; }
  }
  function drawBanner() {
    const el = $("#banner"); if (!el) return;
    if (isIOS && !standalone) { el.innerHTML = `<div class="banner">📲 For notifications: <b>Share</b> ⬆ → <b>Add to Home Screen</b>, then open the app from its icon.</div>`; return; }
    if ("Notification" in window && Notification.permission === "default" && "PushManager" in window) {
      el.innerHTML = `<div class="banner">🔔 Get notified when a message arrives <button id="bnotif">Turn on</button></div>`;
      $("#bnotif").onclick = async () => { toast(await enablePush(true)); drawBanner(); };
    } else el.innerHTML = "";
  }

  // ------------------------------------------------------------------ password rules (same as the server's)
  const PW_RULES = [["8+ characters", (p) => p.length >= 8], ["A capital letter", (p) => /[A-Z]/.test(p)], ["A small letter", (p) => /[a-z]/.test(p)],
    ["A number", (p) => /[0-9]/.test(p)], ["A symbol like ! ? # @", (p) => /[^A-Za-z0-9\s]/.test(p)]];
  function pwChecklist(inp) {  // a small ✓ list under a new-password box that fills in as you type
    const box = document.createElement("div"); box.className = "pwrules";
    const draw = () => { box.innerHTML = PW_RULES.map(([t, ok]) => `<span class="${ok(inp.value) ? "ok" : ""}">${ok(inp.value) ? "✓" : "○"} ${t}</span>`).join(""); };
    inp.after(box); inp.addEventListener("input", draw); draw();
  }
  function pwGate() {  // older accounts: a stronger password is required before chatting again
    if (!S.me || !S.me.needs_new_pw || $("#pwgate")) return;
    const g = document.createElement("div"); g.id = "pwgate";
    g.innerHTML = `<div class="setup"><img class="logo" src="icon-512.png" alt=""><h1>New password needed</h1>
      <p>To keep everyone's chats safe, passwords now need 8+ characters with a capital letter, a small letter, a number and a symbol. Choose a new one to continue.</p>
      <label>Current password</label><input class="inp" type="password" id="gold" autocomplete="current-password">
      <label>New password</label><input class="inp" type="password" id="gnew" autocomplete="new-password">
      <label>New password again</label><input class="inp" type="password" id="gnew2" autocomplete="new-password">
      <button class="big-btn" id="ggo">Save and continue</button><div class="err" id="gerr"></div>
      <button class="link" id="gout">Log out</button></div>`;
    document.body.appendChild(g); pwChecklist($("#gnew", g)); $("#gold", g).focus();
    const go = async () => {
      const err = $("#gerr", g); err.textContent = "";
      if ($("#gnew", g).value !== $("#gnew2", g).value) { err.textContent = "The two new passwords don't match."; return; }
      $("#ggo", g).disabled = true;
      try {
        S.me = await api("/api/me", { method: "PATCH", body: { password: $("#gold", g).value, new_password: $("#gnew", g).value } });
        cacheSave(); g.remove(); toast("Password updated ♥"); flushOutbox();
      } catch (e) { err.textContent = e.message; $("#ggo", g).disabled = false; }
    };
    $("#ggo", g).onclick = go; $$("input", g).forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") go(); });
    $("#gout", g).onclick = () => { g.remove(); logout(); };
  }

  // ------------------------------------------------------------------ sign in / sign up / reset
  function authScreen(mode, welcomed) {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get("invite") && new URLSearchParams(location.search).get("invite")) h.set("invite", new URLSearchParams(location.search).get("invite"));
    if (!mode && !welcomed && h.get("invite") && !h.get("reset")) {  // greet the invited person first
      app.dataset.view = "auth";
      app.innerHTML = `<div class="setup"><img class="logo" src="icon-512.png" alt=""><div style="text-align:center;color:var(--muted)">♥</div></div>`;
      fetch("/api/invite/" + encodeURIComponent(h.get("invite"))).then((r) => r.json()).catch(() => ({})).then((inf) => {
        if (!inf.valid) return authScreen("signup", true);
        app.innerHTML = `<div class="setup" style="justify-content:center;text-align:center"><img class="logo pop" src="icon-512.png" alt=""><h1 style="animation:fadeUp .5s var(--spring) both">${inf.for_name ? `Hi ${esc(inf.for_name)}, you have been invited to join AFRA!` : "You have been invited to join AFRA!"}</h1>
          ${inf.from ? `<p style="animation:fadeUp .6s var(--spring) .1s both">from ${esc(inf.from)}</p>` : ""}
          <button class="big-btn gold" id="awel" style="animation:fadeUp .6s var(--spring) .2s both">Join ♥</button></div>`;
        $("#awel").onclick = () => authScreen("signup", true);
      });
      return;
    }
    mode = mode || (h.get("invite") ? "signup" : h.get("reset") ? "reset" : "login");
    app.dataset.view = "auth";
    const f = (id, label, attrs = "", cls = "inp") => `<label>${label}</label><input class="${cls}" id="${id}" ${attrs}>`;
    app.innerHTML = `<div class="setup"><img class="logo" src="icon-512.png" alt=""><h1>A.F.R.A ♥</h1><p>${mode === "signup" ? "Create your account" : mode === "reset" ? "Choose a new password" : "A private chat, just for us"}</p>
      ${mode === "login" ? f("au", "Username", 'autocapitalize="none" autocorrect="off" autocomplete="username"') + f("ap", "Password", 'type="password" autocomplete="current-password"') : ""}
      ${mode === "signup" ? f("ai", "Invite code", `value="${esc(h.get("invite") || "")}" autocapitalize="characters"`, "inp code-input") + f("au", "Choose a username", 'autocapitalize="none" autocorrect="off" placeholder="e.g. raina" autocomplete="username"')
        + f("an", "Your name", 'placeholder="How others see you" autocomplete="name"') + f("ap", "Choose a password", 'type="password" autocomplete="new-password"') : ""}
      ${mode === "reset" ? f("ai", "Reset code", `value="${esc(h.get("reset") || "")}"`, "inp code-input") + f("ap", "New password", 'type="password" autocomplete="new-password"') : ""}
      <button class="big-btn gold" id="ago">${mode === "signup" ? "Create account ♥" : mode === "reset" ? "Save password" : "Log in"}</button><div class="err" id="aerr"></div>
      ${mode !== "login" ? `<button class="link" data-m="login">I already have an account</button>` : `<button class="link" data-m="signup">I have an invite code</button><button class="link" data-m="reset">Forgot password? (ask the admin for a reset code)</button>`}
      ${isIOS && !standalone ? `<div class="note warn">📲 Tip: tap <b>Share</b> ⬆ → <b>Add to Home Screen</b>, and use the app from its icon: that's where notifications work.</div>` : ""}</div>`;
    $$("[data-m]").forEach((b) => b.onclick = () => authScreen(b.dataset.m));
    if (mode !== "login") pwChecklist($("#ap"));
    const go = async () => {
      const v = (id) => ($("#" + id) || {}).value || "", err = $("#aerr");
      $("#ago").disabled = true; err.textContent = "";
      try {
        const r = mode === "login" ? await api("/api/login", { body: { username: v("au"), password: v("ap"), device: DEVICE }, noLogout: true })
          : mode === "signup" ? await api("/api/signup", { body: { invite: v("ai"), username: v("au"), name: v("an"), password: v("ap"), device: DEVICE } })
          : await api("/api/reset", { body: { code: v("ai"), password: v("ap"), device: DEVICE } });
        TOKEN = r.token; store.set("token", TOKEN); S.me = r.user;
        history.replaceState(null, "", location.pathname); start();
      } catch (e) { err.textContent = e.message; $("#ago").disabled = false; }
    };
    $("#ago").onclick = go; $$("input").forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") go(); });
  }
  function logout(expired) {
    if (!expired) api("/api/logout", { body: {}, noLogout: true }).catch(() => { });
    TOKEN = ""; store.del("token"); store.del("cache"); store.del("outbox"); store.del("lastsync"); lastSync = 0;
    if (WS) { const w = WS; WS = null; w.close(); }
    unmountTabs(); S.me = null; S.convs = []; S.msgs = {}; S.cur = null; $$("#pwgate").forEach((g) => g.remove());
    authScreen("login"); if (expired) toast("Please log in again");
  }

  async function reportDevice() {  // tells the server what this device is (shown to the admin in People)
    const d = { screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, lang: navigator.language, standalone, embedded: window.parent !== window,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, notifications: "Notification" in window ? Notification.permission : "none",
      dark: matchMedia("(prefers-color-scheme: dark)").matches, touch: navigator.maxTouchPoints > 1, app: (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1] };
    try {
      const h = navigator.userAgentData && await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion"]);
      if (h) Object.assign(d, { model: h.model, os_version: h.platformVersion, platform: h.platform });
    } catch { }
    api("/api/device", { body: d }).catch(() => { });
  }

  // ------------------------------------------------------------------ v22: for two (today's question, moods, our dates, on this day, celebrations)
  const MOOD_LIST = [["happy", "😊", "happy"], ["loved", "🥰", "loved"], ["tired", "😴", "tired"], ["stressed", "😣", "stressed"], ["sad", "😢", "sad"], ["sick", "🤒", "sick"], ["annoyed", "😤", "annoyed"], ["excited", "🤩", "excited"]];
  const moodNow = (m) => m && m.until > now() ? m : null;
  const moodTxt = (m) => m ? m.emoji + " " + m.label + (m.word ? " · " + m.word : "") : "";
  const pName = (id) => id === S.me.id ? "You" : (S.nicks[id] || ((H.pair && H.pair.names[id]) || "They"));
  const otdSeenKey = () => H.pair ? "otd:" + H.pair.conv + ":" + H.pair.day : "";
  const otdNew = () => !!(H.pair && H.pair.otd && !store.get(otdSeenKey(), false));
  function applyMood(uid, m) {  // a mood changed (mine from this or another device, or the partner's)
    S.convs.forEach((c) => { const o = c.kind === "direct" ? other(c) : null; if (o && o.id === uid) c.mood = m; });
    if (H.pair && H.pair.moods) H.pair.moods[uid] = m;
    drawHeader(); drawList(); refreshInfo(); if (S.tab === "home" && H.drawn) homeDraw();
  }
  async function pairLoad() {
    const cid = H.cid; if (!cid) return;
    try {
      const d = await api(`/api/home/${cid}`); if (cid !== H.cid) return;
      const was = H.pair && H.pair.pet === cid ? H.pair.question : null;
      if (was && !was.revealed && d.question.revealed) H.dqJust = true;
      H.pair = d; tabBadges(); if (S.tab === "home") homeDraw();
    } catch { }
  }
  function onHomeEvent(e) {  // the partner (or another of my devices) changed the question, dates or on-this-day
    if (H.cid && (e.pet === H.cid || e.conv === H.cid)) pairLoad();
    if (e.what === "dates") celebrateCheck();
  }
  const dqFmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
  function pairHtml() {
    const d = H.pair; if (!d || d.pet !== H.cid) return "";
    const q = d.question, me = S.me.id, oid = +Object.keys(d.names).find((k) => +k !== me), on = pName(oid);
    let body;
    if (q.revealed) {
      body = `<div class="dq-pair ${H.dqJust ? "just" : ""}"><div class="dq-a mine"><small>You</small><p>${esc(q.mine)}</p></div><div class="dq-a theirs"><small>${esc(on)}</small><p>${esc(q.other)}</p></div></div>
        <small class="hm-hint">You both answered 💞 A new question comes tomorrow morning.</small>`;
    } else if (q.mine && !H.dqEdit) {
      body = `<div class="dq-pair"><div class="dq-a mine"><small>You</small><p>${esc(q.mine)}</p></div><div class="dq-a lock"><small>${esc(on)}</small><p>${q.other_answered ? "Answered 🔒" : "Hasn't answered yet"}</p></div></div>
        <div class="dq-foot"><small class="hm-hint">${q.other_answered ? "" : esc(on) + " will see yours once they answer too."}</small><button class="sbtn" id="dqEdit">Edit</button></div>`;
    } else {
      body = `${q.other_answered ? `<div class="dq-lock">${esc(on)} answered 🔒 <span>Answer to see it</span></div>` : ""}
        <textarea id="dqText" rows="2" maxlength="600" placeholder="Your answer…">${esc(H.dqEdit ? q.mine || "" : H.dqDraft || "")}</textarea>
        <div class="dq-foot"><small class="hm-hint">${q.other_answered ? "" : "Hidden from " + esc(on) + " until you both answer · +5 ♥ each"}</small><button class="pi-yes" id="dqSend">Send</button></div>`;
    }
    const dt = d.dates, up = dt.upcoming[0];
    const upTxt = up ? `${up.type === "bday" ? (up.uid === me ? "Your birthday" : esc(up.who) + "'s birthday") : up.type === "anniv" ? "Anniversary" : "Monthsary"} ${up.days === 0 ? "today" : up.days === 1 ? "tomorrow" : "in " + up.days + " days"}` : "";
    const mrow = (id) => { const m = moodNow(d.moods[id]); const mine = id === me, tg = mine ? "button" : "div"; return `<${tg} class="mrow ${mine ? "mine" : ""}" ${mine ? 'id="pcMood"' : ""}><i>${m ? m.emoji : "🫥"}</i><span><b>${esc(pName(id))}</b><small>${m ? esc(m.label + (m.word ? " · " + m.word : "")) : mine ? "Tap to share how you feel" : "No mood shared today"}</small></span>${mine ? "<em>›</em>" : ""}</${tg}>`; };
    const dates = (dt.together_days !== null || dt.next_days !== null)
      ? `<button class="hm-card pc-dates" id="pcDates"><div class="pd-row">${dt.together_days !== null ? `<div><b>${dt.together_days.toLocaleString()}</b><small>days together 💞</small></div>` : ""}${dt.next_days !== null ? `<div><b>${dt.next_days === 0 ? "Today" : dt.next_days}</b><small>${dt.next_days === 0 ? "we're together! 🥰" : (dt.next_days === 1 ? "day" : "days") + " until we meet ✈️"}</small></div>` : ""}</div>${upTxt ? `<em class="pd-up">🎁 ${upTxt}</em>` : ""}</button>`
      : `<button class="hm-card pc-dates empty" id="pcDates"><i>💞</i><span><b>Our dates</b><small>Add when you got together, birthdays and the next time you meet</small></span><em>›</em></button>`;
    const o = d.otd, fresh = otdNew();
    const otd = o ? `<div class="hm-card pc-otd"><h4>📅 On this day <small>${esc(o.label)}</small>${fresh ? `<b class="pc-new">new</b>` : ""}</h4><div class="otd-grid">${o.items.map((i) => i.kind === "image"
      ? `<button class="otd-it img" data-otd="${i.id}"><img src="${fileUrl(i.file)}" alt="" loading="lazy">${i.text ? `<small>${esc(i.text)}</small>` : ""}</button>`
      : `<button class="otd-it" data-otd="${i.id}"><p>“${esc(i.text)}”</p><small>${esc(pName(i.sender))}</small></button>`).join("")}</div></div>` : "";
    const dc = S.convs.find((x) => x.kind === "direct" && x.members.some((u) => u.id === oid)), ou = userById(oid);
    const usCard = dc && ou ? `<button class="hm-card pc-us" id="pcUs" data-cid="${dc.id}"><span class="pcus-blobs"><span class="us-blob" style="--bc:${blobCol(ou)}">${blobFace(ou)}</span><span class="us-blob" style="--bc:${blobCol(S.me)}">${blobFace(S.me)}</span></span><span><b>Us</b><small class="hm-hint">Send ${esc(dn(ou).split(" ")[0])} a hug, a kiss or a little buzz</small></span><em>🫶</em></button>` : "";
    return `<div class="pc-stack">${usCard}
      <div class="hm-card pc-dq ${q.revealed ? "done" : ""}" id="pcDq"><h4>💭 Today's question ${q.streak ? `<b class="dq-streak">🔥 ${q.streak}</b>` : ""}<button class="sbtn" id="dqPast">Past</button></h4><p class="dq-q">${esc(q.q)}</p>${body}</div>
      <div class="hm-card pc-mood"><h4>🌤️ Moods</h4>${mrow(me)}${mrow(oid)}</div>
      ${dates}${otd}</div>`;
  }
  function bindPair(box) {
    const d = H.pair; if (!d || d.pet !== H.cid) return;
    const send = $("#dqSend", box), tx = $("#dqText", box);
    if (tx) tx.oninput = () => { H.dqDraft = tx.value; };
    if (send) send.onclick = async () => {
      const v = tx.value.trim(); if (!v) { tx.focus(); return; }
      send.disabled = true;
      try {
        const r = await api(`/api/home/${H.cid}/question`, { method: "PUT", body: { answer: v } });
        const was = d.question.revealed; H.dqEdit = false; H.dqDraft = ""; H.pair = r;
        if (r.question.revealed && !was) { H.dqJust = true; if (navigator.vibrate) navigator.vibrate([15, 30, 15]); homeLoad(); }
        homeDraw(); toast(r.question.revealed ? "Both answered 💞" : "Saved 🔒");
      } catch (x) { toast(x.message); send.disabled = false; }
    };
    if (tx && send) tx.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send.click(); };
    const ed = $("#dqEdit", box); if (ed) ed.onclick = () => { H.dqEdit = true; homeDraw(); const t = $("#dqText"); if (t) t.focus(); };
    $("#dqPast", box).onclick = pastSheet;
    $("#pcMood", box).onclick = moodSheet;
    const pu = $("#pcUs", box); if (pu) pu.onclick = () => usOpen(+pu.dataset.cid);
    $("#pcDates", box).onclick = () => datesSheet(d.conv);
    $$("[data-otd]", box).forEach((b) => b.onclick = () => {
      store.set(otdSeenKey(), true); tabBadges();
      const id = +b.dataset.otd; gotoMsg(d.conv, id);
    });
    if (H.dqJust) { H.dqJust = false; const card = $("#pcDq", box); if (card) setTimeout(() => { burstAt(card, "💞", 9); burstAt(card, "✨", 6); }, 350); }
  }
  async function pastSheet() {
    const s = sheet(`<h3>Past questions</h3><div class="hint">Loading…</div>`);
    try {
      const r = await api(`/api/home/${H.cid}/questions`);
      const oid = +Object.keys(r.names).find((k) => +k !== S.me.id), nm = S.nicks[oid] || r.names[oid] || "They";
      $(".hint", s).outerHTML = `<div class="dq-past">${r.streak ? `<p class="dq-sum">🔥 ${r.streak}-day streak</p>` : ""}${r.items.length ? r.items.map((i) => `<div class="dq-pi"><small>${esc(dqFmtDay(i.day))}</small><b>${esc(i.q)}</b>
        ${i.both ? `<div class="dq-a mine"><small>You</small><p>${esc(i.mine)}</p></div><div class="dq-a theirs"><small>${esc(nm)}</small><p>${esc(i.other)}</p></div>`
          : `<p class="dq-miss">${i.mine ? "Only you answered" : i.other_answered ? esc(nm) + " answered, you didn't" : "Nobody answered"}</p>`}</div>`).join("") : `<div class="empty">Nothing yet.<br><small>Answered questions land here.</small></div>`}</div>`;
    } catch (x) { $(".hint", s).textContent = x.message; }
  }
  async function moodSheet() {
    let d = H.pair;
    if (!d) { const c = conv(S.cur); const dc = c && c.kind === "direct" ? c : S.convs.find((x) => x.kind === "direct"); if (dc) { try { d = await api(`/api/home/${dc.id}`); } catch { } } }
    const mine = moodNow(d && d.moods[S.me.id]);
    let pick = mine ? (MOOD_LIST.find((m) => m[1] === mine.emoji) || [])[0] : "";
    const s = sheet(`<h3 style="margin:4px 0 2px">How are you feeling?</h3><p style="color:var(--muted);margin:0 0 10px;font-size:14px">Your partner sees this until the day ends.</p>
      <div class="moodgrid">${MOOD_LIST.map((m) => `<button data-mk="${m[0]}" class="${pick === m[0] ? "on" : ""}"><i>${m[1]}</i><span>${m[2]}</span></button>`).join("")}</div>
      <input id="mdWord" maxlength="40" value="${esc(mine ? mine.word : "")}" placeholder="Add a word (optional)" autocomplete="off" style="width:100%;box-sizing:border-box;min-height:44px;font-size:17px;margin-top:10px">
      <div class="nickbtns" style="margin-top:12px">${mine ? `<button class="nkrm" id="mdClear">Clear</button>` : ""}<button class="nksave" id="mdSave">Share</button></div>`);
    $$("[data-mk]", s).forEach((b) => b.onclick = () => { pick = b.dataset.mk; $$("[data-mk]", s).forEach((x) => x.classList.toggle("on", x === b)); if (navigator.vibrate) navigator.vibrate(8); });
    const go = async (key) => {
      try { const r = await api("/api/mood", { method: "PUT", body: { mood: key, word: $("#mdWord", s).value.trim() } }); s.remove(); applyMood(S.me.id, r.mood); toast(r.mood ? "Shared " + r.mood.emoji : "Mood cleared"); }
      catch (x) { toast(x.message); }
    };
    $("#mdSave", s).onclick = () => pick ? go(pick) : toast("Pick a mood first");
    if ($("#mdClear", s)) $("#mdClear", s).onclick = () => go("");
  }
  async function datesSheet(cid) {
    let d = H.pair && H.pair.conv === cid ? H.pair : null;
    if (!d) { try { d = await api(`/api/home/${cid}`); } catch (x) { return toast(x.message); } }
    const dt = d.dates, ids = Object.keys(d.names), me = String(S.me.id), oid = ids.find((k) => k !== me);
    const nm = (id) => id === me ? "Your" : (S.nicks[id] || d.names[id]) + "'s";
    const s = sheet(`<h3 style="margin:4px 0 2px">💞 Our dates</h3><div class="dts">
      <label>Together since<input type="date" id="dtT" value="${esc(dt.together || "")}"></label>
      <label>Next time together<input type="date" id="dtN" value="${esc(dt.next_meet || "")}"></label>
      <label>${esc(nm(me))} birthday<input type="date" id="dtB1" value="${esc(dt.birthdays[me] || "")}"></label>
      <label>${esc(nm(oid))} birthday<input type="date" id="dtB2" value="${esc(dt.birthdays[oid] || "")}"></label>
      <label class="dts-chk"><input type="checkbox" id="dtM" ${dt.monthsary ? "checked" : ""}><span><b>Monthsary reminders</b><small>A little nudge on the same day every month</small></span></label>
      <p class="hm-hint">You'll both get a reminder the day before and on the day, for birthdays and your anniversary.</p></div>
      <div class="nickbtns" style="margin-top:12px"><button class="nksave" id="dtSave">Save</button></div>`);
    $("#dtSave", s).onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const r = await api(`/api/home/${cid}/dates`, { method: "PUT", body: { together: $("#dtT", s).value, next_meet: $("#dtN", s).value, monthsary: $("#dtM", s).checked, birthdays: { [me]: $("#dtB1", s).value, [oid]: $("#dtB2", s).value } } });
        s.remove(); toast("Saved 💞"); if (H.pair && H.pair.conv === cid) pairLoad(); celebrateCheck();
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  }
  // ---- the celebration: confetti and emoji, once, the first time either of us opens the app on the day
  var CEL = false;
  async function celebrateCheck() {
    if (CEL || !S.me || !TOKEN) return;
    try { const l = await api("/api/celebrate"); if (l.length) celebrateShow(l); } catch { }
  }
  function celebrateShow(list) {
    if (CEL || !list.length) return; CEL = true;
    const it = list[0], o = document.createElement("div"); o.className = "cel";
    const bits = ["🎉", "✨", "💖", "🎈", "🥳", "🌸", "💛", "🎊"];
    o.innerHTML = `<div class="cel-fx">${Array.from({ length: 30 }, (_, i) => `<span style="--x:${Math.round(Math.random() * 100)}vw;--dl:${(Math.random() * 1.4).toFixed(2)}s;--du:${(2.6 + Math.random() * 2).toFixed(2)}s;--r:${Math.round(Math.random() * 540 - 270)}deg;--sz:${16 + Math.round(Math.random() * 16)}px">${bits[i % bits.length]}</span>`).join("")}</div>
      <div class="cel-card" role="dialog"><div class="cel-em">${it.emoji}</div><h2>${esc(it.title)}</h2><p>${esc(it.body)}</p><button class="pi-yes wide" id="celOk">Yay 💛</button></div>`;
    document.body.appendChild(o);
    if (navigator.vibrate) navigator.vibrate([20, 40, 20, 40, 30]);
    $("#celOk", o).onclick = async () => {
      o.classList.add("out"); setTimeout(() => o.remove(), 300); CEL = false;
      try { await api("/api/celebrate/seen", { method: "POST", body: { conv: it.conv, key: it.key } }); } catch { }
      if (list.length > 1) setTimeout(() => celebrateShow(list.slice(1)), 350);
    };
  }

  // ------------------------------------------------------------------ v19: tab bar, Home (pet room), Settings, Notify everyone
  const TABS = [["chats", "💬", "Chats"], ["home", "🏠", "Home"], ["settings", "⚙️", "Settings"]];
  const LOT_CODE = { cat: "1f431", dog: "1f415", bunny: "1f407", bear: "1f43b", fox: "1f98a", penguin: "1f427", panda: "1f43c" };
  const STAGE_SC = [1, .7, .6, .8, 1];
  const H = { cid: 0, data: null, lot: null, bub: null, coins: null, drawn: 0, tod: "" };
  S.tab = store.get("tab", "chats"); if (!TABS.some((t) => t[0] === S.tab)) S.tab = "chats";
  const petConvs = () => S.convs.filter((c) => c.kind === "pet" && c.pet);
  const todOf = () => { const h = new Date().getHours(); return h >= 5 && h < 10 ? "morning" : h < 17 ? "day" : h < 20 ? "evening" : "night"; };
  const homeVisible = () => S.tab === "home" && (S.view === "list" || innerWidth >= 760) && !document.hidden && !$(".page:not(.closing)");

  function mountTabs() {
    if ($("#tabbar")) return;
    document.body.insertAdjacentHTML("beforeend", `<nav id="tabbar" aria-label="Main">
      <i class="tb-bub"></i>${TABS.map((t) => `<button data-tab="${t[0]}"><span class="ti">${t[1]}</span><span class="tl">${t[2]}</span><b class="tbadge" hidden></b></button>`).join("")}</nav>
      ${TABS.slice(1).map((t) => `<section class="tabpage" data-tp="${t[0]}"><div class="tp-scroll"></div></section>`).join("")}`);
    $$("#tabbar [data-tab]").forEach((b) => b.onclick = () => setTab(b.dataset.tab));
    setTab(S.tab, true); tabBadges();
  }
  function unmountTabs() { $("#tabbar") && $("#tabbar").remove(); $$(".tabpage").forEach((x) => x.remove()); killLot(); Object.assign(H, { cid: 0, data: null, drawn: 0, coins: null, pair: null }); }
  function setTab(t, init) {
    if (!TABS.some((x) => x[0] === t)) t = "chats";
    const cur = $(".tabpage.on"); if (cur) cur._sy = $(".tp-scroll", cur).scrollTop;
    const was = S.tab; S.tab = t; store.set("tab", t);
    const tb = $("#tabbar"); if (!tb) return;
    tb.style.setProperty("--ti", TABS.findIndex((x) => x[0] === t));
    $$("[data-tab]", tb).forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $$(".tabpage").forEach((p) => p.classList.toggle("on", p.dataset.tp === t));
    if (t === "home") homeOpen(); else if (t === "settings") drawSettings();
    const pg = $(".tabpage.on"); if (pg && pg._sy) $(".tp-scroll", pg).scrollTop = pg._sy;
    if (!init && was === t && t === "chats") { const l = $(".lscroll"); if (l) l.scrollTo({ top: 0, behavior: "smooth" }); }
    syncAnim();
  }
  function tabBadges() {
    const tb = $("#tabbar"); if (!tb) return;
    const n = S.convs.reduce((a, c) => a + (c.unread || 0), 0), b1 = $("[data-tab=chats] .tbadge", tb), b2 = $("[data-tab=home] .tbadge", tb);
    b1.hidden = !n; b1.textContent = n > 99 ? "99+" : n;
    const nh = petConvs().some((c) => c.pet.needs_home); b2.hidden = !nh && !otdNew(); b2.textContent = nh ? "♥" : "";
  }

  // ---- Lottie (loaded the first time Home shows a pet; the animations come from /pets and are cached by the service worker)
  let LOTP = null; const LOTJ = {};
  const lottieLib = () => LOTP || (LOTP = new Promise((res) => { const s = document.createElement("script"); s.src = "vendor/lottie_light.min.js?v=20"; s.onload = () => res(window.lottie || null); s.onerror = () => res(null); document.head.appendChild(s); }));
  async function lotJson(code) {
    if (!(code in LOTJ)) { try { const r = await fetch(`pets/${code}.json?v=20`); LOTJ[code] = r.ok ? await r.text() : null; } catch { LOTJ[code] = null; } }
    return LOTJ[code] ? JSON.parse(LOTJ[code]) : null;
  }
  async function lotMake(box, code, fb, loop = true) {
    const L = await lottieLib(), data = L && await lotJson(code);
    if (!box.isConnected) return null;
    if (!L || !data) { box.innerHTML = `<span class="pet-fb">${fb}</span>`; return null; }
    try { return L.loadAnimation({ container: box, renderer: "svg", loop, autoplay: false, animationData: data, rendererSettings: { preserveAspectRatio: "xMidYMid meet" } }); }
    catch { box.innerHTML = `<span class="pet-fb">${fb}</span>`; return null; }
  }
  function killLot() { if (H.lot && H.lot.anim) H.lot.anim.destroy(); if (H.bub && H.bub.anim) H.bub.anim.destroy(); H.lot = H.bub = null; }
  function syncAnim() {
    const on = homeVisible();
    [H.lot, H.bub].forEach((x) => { if (x && x.anim) { try { on ? x.anim.play() : x.anim.pause(); } catch { } } });
  }
  async function moodBubble(code, ms) {
    const room = $(".hm-room"); if (!room) return;
    if (H.bub) { if (H.bub.anim) H.bub.anim.destroy(); H.bub.el.remove(); H.bub = null; }
    const el = document.createElement("div"); el.className = "rm-bub"; room.appendChild(el);
    const b = H.bub = { el, anim: null }; b.anim = await lotMake(el, code, "💤");
    if (b.anim && homeVisible()) b.anim.play();
    setTimeout(() => { if (H.bub === b) { if (b.anim) b.anim.destroy(); el.remove(); H.bub = null; } }, ms);
  }

  // ---- Home
  const catMap = () => { const m = {}; const cat = (H.data && H.data.catalog) || {}; Object.values(cat).forEach((l) => l.forEach((i) => m[i.id] = i)); return m; };
  async function homeOpen() {
    const box = $(".tabpage[data-tp=home] .tp-scroll"); if (!box) return;
    const pets = petConvs();
    if (!pets.length) { H.pending = H.pending || []; homeDraw(); try { H.pending = await api("/api/pets/pending"); } catch { } if (S.tab === "home") homeDraw(); return; }
    if (!pets.some((c) => c.id === H.cid)) H.cid = pets.some((c) => c.id === store.get("homepet")) ? store.get("homepet") : pets[0].id;
    homeDraw(); homeLoad();
  }
  async function homeLoad() {
    const cid = H.cid; if (!cid) return;
    try { const d = await api(`/api/pets/${cid}/home`); if (cid !== H.cid) return; d.pet._t = Date.now(); const c = conv(cid); if (c) c.pet = d.pet; H.data = d; cacheSave(); tabBadges(); if (S.tab === "home") homeDraw(); } catch { }
    pairLoad();
  }
  function homeSync(e) {  // a pet event arrived (from me on another device, or from the partner)
    tabBadges();
    if (S.tab !== "home" || !H.drawn) return;
    if (e.conv === H.cid) { const before = H.stage || 0; homeDraw(); if (e.act && e.by !== S.me.id) careFx(e.act, e.pet); if (e.pet.stage > before) celebrate(e.pet); }
  }
  function homeEmpty() {
    const directs = S.convs.filter((c) => c.kind === "direct"), pend = H.pending || [];
    const rows = pend.map((x) => x.mine ? `<div class="hm-card hm-wait">⏳ Waiting for ${esc(x.name)}…<small>Your pet invite is on its way.</small></div>`
      : `<div class="hm-card hm-wait">🐾 ${esc(x.name)} wants to share a pet with you<button class="pi-yes" data-hacc="${x.mid}">Accept</button></div>`).join("");
    const first = (c) => S.nicks[(other(c) || {}).id] || (other(c) && (other(c).name || other(c).username) || "your friend").split(" ")[0];
    const pending = new Set(pend.filter((x) => x.mine).map((x) => x.conv));
    const cand = directs.filter((c) => !pending.has(c.id));
    let ask = "";
    if (!directs.length) ask = `<p class="hm-hint">Start a chat with someone first, then you can raise a pet together.</p><button class="pi-yes wide" id="hmNew">Start a chat</button>`;
    else if (cand.length === 1) ask = `<button class="pi-yes wide" data-hshare="${cand[0].id}">Share a pet with ${esc(first(cand[0]))} 🐾</button>`;
    else if (cand.length > 1) ask = `<p class="hm-hint">Who do you want to share a pet with?</p>${cand.map((c) => `<button class="hm-pick" data-hshare="${c.id}">${avatar(other(c), "sm")}<span>${esc(first(c))}</span><i>🐾</i></button>`).join("")}`;
    return `<div class="hm"><div class="hm-empty"><div class="hm-egg">🥚</div><h2>Your own little home</h2><p>Raise a pet together: feed it, play, decorate its room and watch it grow.</p>${rows}${ask}</div></div>`;
  }
  function bindEmpty(box) {
    $$("[data-hshare]", box).forEach((b) => b.onclick = async () => { b.disabled = true; try { await api(`/api/convs/${b.dataset.hshare}/petinvite`, { body: {} }); toast("Pet invite sent 🐾"); H.pending = await api("/api/pets/pending"); } catch (x) { toast(x.message); } homeDraw(); });
    $$("[data-hacc]", box).forEach((b) => b.onclick = () => acceptPet(+b.dataset.hacc, true));
    const n = $("#hmNew", box); if (n) n.onclick = () => { setTab("chats"); newChat(); };
  }
  function homeDraw() {
    const box = $(".tabpage[data-tp=home] .tp-scroll"); if (!box) return;
    const pets = petConvs(), c = conv(H.cid), p = c && petOf(c);
    if (!p) { killLot(); H.drawn = 0; box.innerHTML = homeEmpty(); bindEmpty(box); return; }
    if (!p._t) p._t = Date.now();
    const cat = catMap(), tod = todOf(), room = p.room || {}, st = p.stage || 0, mood = petMood(p);
    const sy = box.scrollTop, other_ = other(c), pn = esc(p.name);
    H.stage = st; H.tod = tod;
    const slot = (k) => room[k] && cat[room[k]] ? `<span class="rm-it s-${k}" data-slot="${k}">${cat[room[k]].emoji}</span>` : "";
    const wear = p.outfit && cat[p.outfit] && st >= 2 ? `<span class="rm-wear w-${cat[p.outfit].at}">${cat[p.outfit].emoji}</span>` : "";
    const sky = { morning: "🌤️", day: "☀️", evening: "🌅", night: "🌙" }[tod];
    const bar = (ico, v, t) => `<div class="pbar ${v < 30 ? "low" : ""}" title="${t}"><i>${ico}</i><span><em style="width:${v}%"></em></span><b>${v}</b></div>`;
    const done = p.quests.filter((q) => q.done).length;
    const log = ((H.data && H.data.log) || []);
    const checked = (p.checkin || []).includes(String(S.me.id));
    box.innerHTML = `<div class="hm">
      <div class="hm-head">${pets.length > 1 ? `<div class="hm-sw">${pets.map((x) => `<button data-hpet="${x.id}" class="${x.id === c.id ? "on" : ""}">${x.pet.emoji}<span>${esc(x.pet.name)}</span></button>`).join("")}</div>` : `<h1>${pn}<small>${esc(p.stage_name)} · Lv ${p.level}</small></h1>`}
        <button class="hm-coin" id="hmCoin" title="Shared ♥ coins">♥ <b>${p.coins}</b></button><button class="icon hm-i" id="hmInfo" title="About ${pn}" aria-label="About ${pn}">ⓘ</button></div>
      <div class="hm-room" data-tod="${tod}" data-mood="${mood}">
        <div class="rm-win"><span class="rm-sky">${sky}</span>${tod === "night" ? `<span class="rm-st a">✦</span><span class="rm-st b">✦</span><span class="rm-st c">✦</span>` : `<span class="rm-cloud">☁️</span>`}</div>
        ${slot("window")}${slot("wall")}
        <div class="rm-floor"></div>${room.floor_r ? "" : `<span class="rm-plant">🪴</span>`}${slot("floor_l")}${slot("floor_r")}
        <div class="rm-rug"></div><span class="rm-bowl">🥣</span><span class="rm-toy">🧸</span>
        <div class="rm-pet st${st}" id="hmPet"><div class="rm-scale" style="--sc:${STAGE_SC[st]}">${st === 0 ? `<span class="rm-egg">🥚</span>` : `<div class="rm-lot" id="hmLot"></div>`}${wear}</div><i class="rm-shadow"></i></div>
        ${mood === "asleep" ? `<span class="rm-zzz">💤</span>` : ""}
        <div class="rm-dim"></div></div>
      <div class="hm-card hm-grow"><div class="gr-top"><b>${["🥚", "🐣", "🐾", "🐾", "🌟"][st]} ${esc(p.stage_name)}</b><span>${p.to_next ? `${p.to_next} more fed day${p.to_next === 1 ? "" : "s"} to grow` : "Fully grown 🎉"}</span></div>
        <div class="gr-bar"><em style="width:${p.stage_pct}%"></em></div><small>Feed ${pn} on a new day to help it grow. A missed day only pauses it.</small></div>
      <div class="hm-acts" id="hmActs">${PET_ACTS.map(([k, ico, lab]) => { const s = petLeft(p, k); const direct = k === "tend" || k === "sleep"; return `<button data-care="${k}" ${s && direct ? "disabled" : ""}><i>${ico}</i><span>${k === "tend" ? "Bathe" : lab}</span>${s && direct ? `<small>${petFmt(s)}</small>` : ""}</button>`; }).join("")}</div>
      <div class="hm-acts three"><button id="hmCheck" ${checked ? "disabled" : ""}><i>💛</i><span>${checked ? "Checked in" : "Check in"}</span>${checked ? "" : `<small>+10 ♥</small>`}</button><button id="hmShop"><i>🛍️</i><span>Shop</span></button><button id="hmAlbum"><i>📸</i><span>Album</span></button></div>
      <button class="hm-talk" id="hmTalk">💬 Talk to ${pn}</button>
      ${pairHtml()}
      <div class="hm-card hm-streak"><b>🔥 ${p.streak}</b><span>day${p.streak === 1 ? "" : "s"} together · best ${p.best}</span>${p.both_today ? `<em>💞 both today</em>` : p.cared_today ? `<em class="one">needs you both</em>` : `<em class="one">no care yet today</em>`}</div>
      <div class="hm-card"><h4>${pn} feels</h4>${bar("🍖", p.hunger, "Fullness")}${bar("💗", p.joy, "Happiness")}${bar("⚡", p.energy, "Energy")}</div>
      <div class="hm-card"><h4>📋 Quests <b>${done}/${p.quests.length}</b></h4>${p.quests.map((q) => `<div class="hqrow ${q.done ? "done" : ""}"><i>${q.done ? "✓" : ""}</i><span>${esc(q.text)}</span><small>${q.progress}/${q.target}</small></div>`).join("")}<small class="hm-hint">+15 ♥ for each quest</small></div>
      <div class="hm-card"><h4>📸 Album <button class="sbtn" id="hmAll">See all</button></h4>${log.length ? log.slice(0, 3).map(albumRow).join("") : `<div class="hint">${pn}'s milestones will show up here.</div>`}</div>
      <p class="hm-credit">Animated emoji © Google, CC BY 4.0</p></div>`;
    box.scrollTop = sy; H.drawn = 1; bindPair(box);
    // pet animation: keep the running one across redraws
    const ph = $("#hmLot", box);
    if (ph) {
      const code = st === 1 ? "1f423" : LOT_CODE[p.species];
      if (H.lot && H.lot.code === code && H.lot.el.isConnected === false && H.lot.anim) ph.replaceWith(H.lot.el);
      else { killLotOnly(); const fb = st === 1 ? "🐣" : p.emoji, me = H.lot = { code, el: ph, anim: null }; lotMake(ph, code, fb).then((a) => { if (H.lot === me) { me.anim = a; if (a && homeVisible()) a.play(); } else if (a) a.destroy(); }); }
    } else killLotOnly();
    if (H.coins !== null && p.coins !== H.coins) { const e = $("#hmCoin", box); e.classList.add("pop"); }
    H.coins = p.coins;
    if (mood === "asleep" && !H.bub) moodBubble("1f634", 5000);
    thinkShow();
    bindHome(box, c);
  }
  // the pet's latest line as a thought bubble over its head in the Home room: "…" for a moment, then the words, then it fades
  function petThink(cid, text) { H.think = { cid, text, at: Date.now() }; if (S.tab === "home" && H.drawn) thinkShow(); }
  function thinkShow() {
    const t = H.think, room = $(".hm-room"), old = $(".rm-think");
    if (old) old.remove(); (H.tt || []).forEach(clearTimeout); H.tt = [];
    if (!t || !room || t.cid !== H.cid) return;
    const age = Date.now() - t.at; if (age > 6800) return;
    const el = document.createElement("div"), said = age >= 800;
    el.className = "rm-think" + (age > 150 ? " again" : "") + (said ? " said" : " dots"); el.setAttribute("role", "button");
    const words = () => `<span class="tx">${esc(t.text)}</span>`;
    el.innerHTML = said ? words() : `<span class="tt"><i></i><i></i><i></i></span>`;
    el.onclick = () => openConv(t.cid);
    room.appendChild(el);
    if (!said) H.tt.push(setTimeout(() => { el.classList.remove("dots"); el.classList.add("said", "swap"); el.innerHTML = words(); }, 800 - age));
    H.tt.push(setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 450); }, 6800 - age));
  }
  function killLotOnly() { if (H.lot && H.lot.anim) H.lot.anim.destroy(); H.lot = null; }
  const albumRow = (l) => {
    const d = l.day ? new Date(l.day + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
    return `<div class="alrow" data-lid="${l.id}"><div class="al-t"><b>${esc(l.text)}</b><small>${esc(d)}</small>${l.file ? `<img class="al-img" src="${fileUrl(l.file)}" alt="" loading="lazy">` : ""}</div>
      <label class="al-add" title="Add a photo">${l.file ? "🔄" : "📷"}<input type="file" accept="image/*" hidden data-alphoto="${l.id}"></label></div>`;
  };
  function bindHome(box, c) {
    $$("[data-hpet]", box).forEach((b) => b.onclick = () => { H.cid = +b.dataset.hpet; store.set("homepet", H.cid); H.data = null; killLotOnly(); homeDraw(); homeLoad(); });
    $("#hmInfo", box).onclick = () => petInfo(conv(H.cid));
    $("#hmTalk", box).onclick = () => openConv(H.cid);
    $("#hmShop", box).onclick = () => shopSheet();
    $("#hmAlbum", box).onclick = $("#hmAll", box).onclick = albumSheet;
    $("#hmCoin", box).onclick = () => shopSheet();
    $("#hmCheck", box).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const v = await api(`/api/pets/${H.cid}/checkin`, { body: {} }); v._t = Date.now(); conv(H.cid).pet = v; coinGain(v.gain); burstAt($("#hmPet"), "💛", 8); cacheSave(); homeDraw(); tabBadges(); } catch (x) { toast(x.message); homeDraw(); }
    };
    $$("[data-care]", box).forEach((b) => b.onclick = () => {
      const k = b.dataset.care, p = petOf(conv(H.cid));
      if (k === "feed" || k === "play") careChooser(k, p); else careDo(k, "");
    });
    $$("[data-hacc]", box).forEach((b) => b.onclick = () => acceptPet(+b.dataset.hacc, true));
    $("#hmPet", box).onclick = () => { const e = $("#hmPet"); e.classList.remove("hop"); void e.offsetWidth; e.classList.add("hop"); burstAt(e, "💗", 3); moodBubble("1f63b", 2400); if (navigator.vibrate) navigator.vibrate(10); };
    $$("[data-alphoto]", box).forEach(albumPhotoBind);
  }
  function coinGain(n) { const e = $("#hmCoin"); if (!e || !n) return; const g = document.createElement("span"); g.className = "hm-gain"; g.textContent = "+" + n + " ♥"; e.appendChild(g); setTimeout(() => g.remove(), 1500); }
  function careFx(act, p) {
    const pet = $("#hmPet"); if (!pet) return;
    burstAt(pet, act === "tend" ? "🫧" : PET_FLY[act] || "💗", act === "sleep" ? 3 : 7);
    pet.classList.remove("hop"); void pet.offsetWidth; pet.classList.add("hop");
    moodBubble(act === "sleep" ? "1f634" : "1f63b", 2400);
  }
  function celebrate(p) {
    const pet = $("#hmPet"); if (!pet) return;
    pet.classList.add("grew"); setTimeout(() => pet.classList.remove("grew"), 1400);
    burstAt(pet, "🎉", 14); burstAt(pet, "✨", 8); toast(`🌱 ${p.name} grew: ${p.stage_name}!`); if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    homeLoad();
  }
  async function careDo(act, item) {
    const c = conv(H.cid), p = c && petOf(c); if (!p) return;
    try {
      const before = p.stage, v = await api(`/api/pets/${c.id}/care`, { body: { action: act, item } });
      v._t = Date.now(); c.pet = v; H.stage = v.stage; cacheSave(); drawList(); tabBadges(); homeDraw(); careFx(act, v); coinGain(v.gain);
      if (v.stage > before) celebrate(v); else if (v.gain >= 10) homeLoad();
    } catch (x) { toast(x.message); }
  }
  function careChooser(act, p) {
    const cat = (H.data && H.data.catalog) || {}, own = (cat[act === "feed" ? "food" : "toys"] || []).filter((i) => (p.inv || {})[i.id] > 0);
    const left = petLeft(p, act), free = act === "feed" ? { e: "🥣", n: "Free kibble", d: "+20 fullness · once an hour" } : { e: "🧸", n: "Play together", d: "A little game" };
    const eff = (i) => act === "feed" ? `+${i.hunger} fullness${i.joy ? ", +" + i.joy + " joy" : ""}` : `+${22 + i.joy} joy`;
    const s = sheet(`<h3>${act === "feed" ? "Feed" : "Play with"} ${esc(p.name)}</h3><div class="chlist">
      <button data-it="" ${left ? "disabled" : ""}><i>${free.e}</i><span><b>${free.n}</b><small>${free.d}</small></span>${left ? `<em>${petFmt(left)}</em>` : ""}</button>
      ${own.map((i) => `<button data-it="${i.id}" ${act === "play" && left ? "disabled" : ""}><i>${i.emoji}</i><span><b>${esc(i.name)}</b><small>${eff(i)}</small></span><em>×${p.inv[i.id]}</em></button>`).join("")}</div>
      <div class="row" style="justify-content:center;margin-top:10px"><button class="sbtn" id="chShop">🛍️ Visit the shop</button></div>`);
    $$("[data-it]", s).forEach((b) => b.onclick = () => { s.remove(); careDo(act, b.dataset.it || "kibble"); });
    $("#chShop", s).onclick = () => { s.remove(); shopSheet(act === "feed" ? "food" : "toys"); };
  }
  function shopSheet(tab0) {
    const cat = H.data && H.data.catalog; if (!cat) { toast("Just a moment…"); homeLoad(); return; }
    let tab = tab0 || "food";
    const names = { food: "🍖 Food", toys: "🧸 Toys", room: "🛋️ Room", outfits: "🎀 Outfits" };
    const s = sheet(`<div class="shop"><div class="shop-head"><h3>🛍️ Shop</h3><b class="hm-coin" id="shCoins"></b></div>
      <div class="chips tabs shop-tabs">${Object.keys(names).map((k) => `<button data-st="${k}">${names[k]}</button>`).join("")}</div><div class="shop-grid" id="shGrid"></div></div>`);
    const draw = () => {
      const p = petOf(conv(H.cid)); if (!p) return;
      $("#shCoins", s).innerHTML = `♥ <b>${p.coins}</b>`;
      $$("[data-st]", s).forEach((b) => b.classList.toggle("on", b.dataset.st === tab));
      $("#shGrid", s).innerHTML = cat[tab].map((i) => {
        const q = (p.inv || {})[i.id] || 0; let tag, cls = "";
        if (tab === "food") tag = q ? `×${q} · ♥ ${i.price}` : `♥ ${i.price}`;
        else if (tab === "toys") tag = q ? "Owned ✓" : `♥ ${i.price}`;
        else if (tab === "room") tag = q ? ((p.room || {})[i.slot] === i.id ? "In the room ✓" : "Place") : `♥ ${i.price}`;
        else tag = q ? (p.outfit === i.id ? "Wearing ✓" : "Wear") : `♥ ${i.price}`;
        if (!q && p.coins < i.price) cls = "poor"; if (q) cls += " own";
        const sub = tab === "food" ? `+${i.hunger} fullness` : tab === "toys" ? `+${i.joy} joy` : tab === "room" ? ({ wall: "wall", window: "window", floor_l: "floor", floor_r: "floor" })[i.slot] : i.at;
        return `<button class="shop-it ${cls}" data-buy="${i.id}"><i>${i.emoji}</i><b>${esc(i.name)}</b><small>${sub}</small><em>${tag}</em></button>`;
      }).join("");
    };
    s.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-st]"); if (t) { tab = t.dataset.st; draw(); return; }
      const b = e.target.closest("[data-buy]"); if (!b) return;
      const id = b.dataset.buy, i = cat[tab].find((x) => x.id === id), c = conv(H.cid), p = petOf(c); if (!p) return;
      const q = (p.inv || {})[id] || 0;
      try {
        let v;
        if (tab === "toys" && q) { toast("Find it under Play 🧸"); return; }
        if (!q || tab === "food") { v = await api(`/api/pets/${c.id}/buy`, { body: { item: id } }); toast(`${i.emoji} ${i.name} is yours`); burstAt(b, i.emoji, 5); }
        else if (tab === "room") v = await api(`/api/pets/${c.id}/place`, { body: (p.room || {})[i.slot] === id ? { item: "", slot: i.slot } : { item: id } });
        else v = await api(`/api/pets/${c.id}/place`, { body: p.outfit === id ? { item: "", slot: "outfit" } : { item: id } });
        v._t = Date.now(); c.pet = v; cacheSave(); draw(); if (S.tab === "home") homeDraw();
      } catch (x) { toast(x.message); }
    });
    draw();
  }
  function albumSheet() {
    const log = (H.data && H.data.log) || [];
    const s = sheet(`<h3>📸 Album</h3><div class="alist">${log.length ? log.map(albumRow).join("") : `<div class="hint">Nothing here yet.</div>`}</div>`);
    $$("[data-alphoto]", s).forEach(albumPhotoBind);
  }
  function albumPhotoBind(inp) {
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; inp.value = "";
      try {
        const fd = new FormData(); fd.append("file", f, f.name || "photo.jpg"); const att = await api("/api/files", { body: fd });
        await api(`/api/pets/${H.cid}/log/${inp.dataset.alphoto}/photo`, { body: { file: att.id } });
        const l = H.data && H.data.log.find((x) => x.id === +inp.dataset.alphoto); if (l) l.file = att.id;
        $$(`[data-lid="${inp.dataset.alphoto}"]`).forEach((r) => { r.outerHTML = albumRow(l); });
        $$(`[data-alphoto]`).forEach(albumPhotoBind); toast("Photo added 📸");
      } catch (x) { toast(x.message); }
    };
  }
  setInterval(() => {  // cooldown labels tick, the room follows the clock
    if (!homeVisible()) return;
    const p = petOf(conv(H.cid)); if (!p) return;
    if (todOf() !== H.tod) { homeDraw(); return; }
    $$("#hmActs [data-care]").forEach((x) => {
      const k = x.dataset.care, direct = k === "tend" || k === "sleep", s = petLeft(p, k); if (!direct) return;
      x.disabled = !!s; const sm = $("small", x); if (s) { if (sm) sm.textContent = petFmt(s); else x.insertAdjacentHTML("beforeend", `<small>${petFmt(s)}</small>`); } else if (sm) sm.remove();
    });
  }, 1000);
  setInterval(syncAnim, 1500);
  document.addEventListener("visibilitychange", syncAnim);

  // ---- Settings (one grouped page)
  const lookHTML = () => `<div class="lookprev"><div class="msg mine"><div class="bub"><div class="txt">This is how your messages look ✨</div></div></div></div>
      <h4>Text size</h4><div class="chips lookchips" data-k="size">${LOOK_SIZES.map((x) => `<button data-v="${x[0]}">${x[1]}</button>`).join("")}</div>
      <h4>Font</h4><div class="chips lookchips" data-k="font">${LOOK_FONTS.map((x) => `<button data-v="${x[0]}" style="${x[2] ? "font-family:" + x[2] : ""}">${x[1]}</button>`).join("")}</div>
      <h4>Accent colour</h4><div class="lookdots" data-k="accent">${LOOK_ACCENTS.map((c) => `<button data-v="${c}" aria-label="${c || "Default"}" style="background:${c || "#0095f6"}"></button>`).join("")}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="sbtn" id="lreset">Reset</button></div>`;
  function lookBind(s) {
    let l = { ...LOOK_DEFAULT, ...(store.get("look") || {}) };
    const mark = () => $$("[data-k]", s).forEach((g) => $$("button", g).forEach((b) => b.classList.toggle("on", b.dataset.v === l[g.dataset.k])));
    $$("[data-k] button", s).forEach((b) => b.onclick = () => {
      l[b.parentNode.dataset.k] = b.dataset.v; store.set("look", l); applyLook(l); mark();
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
    });
    $("#lreset", s).onclick = () => { l = { ...LOOK_DEFAULT }; store.del("look"); applyLook(l); mark(); };
    mark();
  }
  function drawSettings() {
    const box = $(".tabpage[data-tp=settings] .tp-scroll"); if (!box) return;
    const sy = box.scrollTop, me = S.me, pushOn = "Notification" in window && Notification.permission === "granted", bot = S.convs.find((c) => c.kind === "bot");
    const row = (id, ico, label, sub) => `<button class="srow nav" id="${id}"><i>${ico}</i><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><u>›</u></button>`;
    box.innerHTML = `<div class="st"><h1 class="st-title">Settings</h1>
      <div class="st-prof"><label class="st-av">${avatar(me, "lg")}<i>📷</i><input type="file" id="sAv" accept="image/*" hidden></label>
        <div><b>${esc(me.name)}</b><small>@${esc(me.username)}${me.is_admin ? ` <span class="pill gold">admin</span>` : ""}</small></div></div>
      <h5>Profile</h5><div class="sbox"><label class="srow"><span>Name</span><input id="sName" value="${esc(me.name)}" maxlength="40"></label>
        <label class="srow"><span>About</span><input id="sBio" value="${esc(me.bio || "")}" maxlength="140" placeholder="A line about you"></label>
        <button class="srow act" id="sSave">Save profile</button>${row("sAcct", "🔑", "Username and password")}</div>
      <h5>Appearance</h5><div class="sbox pad" id="sLook">${lookHTML()}</div>
      <div class="sbox"><label class="swrow"><span><b>Photo backgrounds</b><small>Turn off to use the plain background on this device</small></span><input type="checkbox" class="swtog" id="tphotobg" ${store.get("photobg", true) === false ? "" : "checked"}></label>
        <label class="swrow"><span><b>Soft sounds</b><small>When sending and receiving</small></span><input type="checkbox" class="swtog" id="tsound" ${store.get("sound", true) ? "checked" : ""}></label></div>
      <h5>Notifications</h5><div class="sbox">${isIOS && !standalone ? `<div class="note warn" style="margin:10px">📲 On iPhone, notifications work in the Home Screen app: tap <b>Share</b> ⬆ then <b>Add to Home Screen</b>, and open A.F.R.A ♥ from its icon.</div>`
        : `<button class="srow act" id="sPush">${pushOn ? "✓ Notifications are on" : "Turn on notifications"}</button>${pushOn ? `<button class="srow act" id="sTest">Send me a test</button>` : ""}`}</div>
      <h5>Touches</h5><div class="sbox pad" id="sTouch"><small class="hint">Loading…</small></div>
      <h5>Friends</h5><div class="sbox">${row("sInv", "👋", "Invite a friend", "Make a link just for them")}</div>
      <h5>Assistant</h5><div class="sbox">${row("sBot", "✨", "Open the Assistant", "Reminders, notes, lists and places")}</div>
      ${me.is_admin ? `<h5>Admin</h5><div class="sbox">${row("sAdm", "🛡", "Admin page", "People, invites and data")}${row("sNot", "📣", "Notify everyone", "Send a push to all people")}</div>` : ""}
      <h5>About</h5><div class="sbox pad about"><b>A.F.R.A ♥</b><small>Version ${(document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/) || [])[1] || ""} · made with love by danafarmansyah</small>
        <small>Animated emoji © Google, CC BY 4.0</small></div>
      <div class="sbox"><button class="srow act danger" id="sOut">Log out</button></div><div style="height:12px"></div></div>`;
    box.scrollTop = sy;
    lookBind($("#sLook", box));
    $("#tphotobg", box).onchange = (e) => { store.set("photobg", e.target.checked); applyStyle(); };
    $("#tsound", box).onchange = (e) => { store.set("sound", e.target.checked); if (e.target.checked) sound("send"); };
    $("#sAv", box).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { e.target.value = ""; const sq = await cropImage(f, 512); if (!sq) return; const fd = new FormData(); fd.append("file", sq, "avatar.jpg"); S.me = await api("/api/me/avatar", { body: fd }); drawAll(); drawSettings(); toast("Photo updated"); }
      catch (x) { toast(x.message); }
    };
    $("#sSave", box).onclick = async () => {
      try { S.me = await api("/api/me", { method: "PATCH", body: { name: $("#sName", box).value, username: S.me.username, bio: $("#sBio", box).value } }); cacheSave(); drawAll(); drawSettings(); toast("Saved"); }
      catch (x) { toast(x.message); }
    };
    $("#sAcct", box).onclick = profileSheet;
    touchPrefsInit($("#sTouch", box));
    const pu = $("#sPush", box); if (pu) pu.onclick = async () => { toast(await enablePush(true)); drawSettings(); };
    const te = $("#sTest", box); if (te) te.onclick = () => api("/api/push/test", { body: {} }).then(() => toast("Sent: lock your phone to see it")).catch((x) => toast(x.message));
    $("#sInv", box).onclick = inviteSheet;
    $("#sBot", box).onclick = () => { if (bot) openConv(bot.id); else toast("The Assistant is not ready yet"); };
    const ad = $("#sAdm", box); if (ad) ad.onclick = adminPage;
    const nt = $("#sNot", box); if (nt) nt.onclick = notifySheet;
    $("#sOut", box).onclick = () => { if (confirm("Log out on this device?")) logout(); };
  }

  // ---- AI usage (admin): tokens and cost per day, who spends it, and the switch that lets the pet run on built-in lines
  async function aiUsage(el) {
    const u = await api("/api/admin/ai-usage");
    const tok = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n || 0);
    const usd = (n) => !n ? "$0" : n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(n < 1 ? 3 : 2);
    const card = (label, r) => `<div class="aicard"><small>${label}</small><b>${usd(r.cost)}</b><span>${tok(r.prompt + r.completion)} tokens · ${r.calls} call${r.calls === 1 ? "" : "s"}</span></div>`;
    const sr = u.series, max = Math.max(1, ...sr.map((d) => d.tokens));
    const bars = sr.map((d, i) => { const h = Math.max(d.tokens ? 4 : 1.5, d.tokens / max * 58); return `<rect x="${i * 20 + 3}" y="${64 - h}" width="14" height="${h}" rx="4" class="${i === sr.length - 1 ? "now" : ""}"><title>${d.day}: ${tok(d.tokens)} tokens, ${usd(d.cost)}</title></rect>`; }).join("");
    const days = (d) => new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "narrow" });
    const labels = sr.map((d, i) => `<text x="${i * 20 + 10}" y="76" text-anchor="middle">${days(d.day)}</text>`).join("");
    const w = (k) => u.by_who[k] || { calls: 0, prompt: 0, completion: 0, cost: 0 };
    const split = [["🐾 Pet", w("pet")], ["✨ Assistant", w("assistant")]];
    const tot = Math.max(1, split.reduce((a, [, r]) => a + r.prompt + r.completion, 0));
    el.innerHTML = `<label class="swrow aisw"><span><b>Pet uses AI</b><small>Off: the pet chats with built-in lines, no API cost</small></span><input type="checkbox" class="swtog" id="aiPet" ${u.pet_ai ? "checked" : ""}></label>
      <div class="aicards">${card("Today", u.periods.today)}${card("7 days", u.periods.week)}${card("30 days", u.periods.month)}</div>
      <div class="aichart"><h4>Last 14 days</h4><svg viewBox="0 0 280 82" role="img" aria-label="Tokens per day for the last 14 days">${bars}${labels}</svg><small>Tokens per day · model ${esc(u.model)}</small></div>
      <h4>Pet vs Assistant (30 days)</h4>
      <div class="aisplit">${split.map(([l, r]) => `<div><span>${l}</span><i><em style="width:${Math.round((r.prompt + r.completion) / tot * 100)}%"></em></i><b>${usd(r.cost)}</b><small>${tok(r.prompt + r.completion)} tokens · ${r.calls} calls</small></div>`).join("")}</div>
      <h4>By person (30 days)</h4>
      ${u.by_user.map((r) => `<div class="urow"><div class="mid"><b>${esc(r.name)}</b><small>${tok(r.prompt)} in · ${tok(r.completion)} out · ${r.calls} calls</small></div><b>${usd(r.cost)}</b></div>`).join("") || `<div class="hint">No AI calls yet.</div>`}
      <div class="hint" style="margin-top:10px">All time: ${usd(u.periods.all.cost)} · ${tok(u.periods.all.prompt + u.periods.all.completion)} tokens · ${u.periods.all.calls} calls. Cost shows when OpenRouter reports it.</div>`;
    const sw = $("#aiPet", el);
    sw.onchange = async () => {
      sw.disabled = true;
      try { const r = await api("/api/admin/settings", { method: "PUT", body: { pet_ai: sw.checked } }); toast(r.pet_ai ? "The pet uses AI again" : "The pet uses built-in lines"); }
      catch (x) { sw.checked = !sw.checked; toast(x.message); } finally { sw.disabled = false; }
    };
  }

  // ---- Notify everyone (admin)
  function notifyForm(root, inSheet) {
    root.innerHTML = `<div class="field"><label>Title</label><input class="inp" id="nTitle" maxlength="60" value="A.F.R.A"></div>
      <div class="field"><label>Message</label><textarea class="inp" id="nBody" maxlength="180" rows="3" placeholder="What do you want to tell everyone?"></textarea><small class="hint" id="nCount">0 / 180</small></div>
      <h4>Preview</h4><div class="nprev"><div class="np-ico">♥</div><div><b id="npT">A.F.R.A</b><span id="npB">Your message shows up here</span></div><small>now</small></div>
      <label class="nrefresh"><input type="checkbox" id="nUpd"><span>Also refresh everyone's app</span></label>
      <button class="big-btn" id="nSend" style="margin-top:12px">Send to everyone</button><h4>Recently sent</h4><div id="nList"><div class="hint">Loading…</div></div>`;
    const t = $("#nTitle", root), b = $("#nBody", root);
    const prev = () => { $("#npT", root).textContent = t.value.trim() || "A.F.R.A"; $("#npB", root).textContent = b.value.trim() || "Your message shows up here"; $("#nCount", root).textContent = b.value.length + " / 180"; };
    t.oninput = b.oninput = prev;
    const list = async () => {
      let rows = []; try { rows = await api("/api/admin/broadcasts"); } catch { }
      $("#nList", root).innerHTML = rows.map((r) => `<div class="nrow"><b>${esc(r.title)}</b><span>${esc(r.body)}</span><small>${shortTime(r.created)} · ${r.sent} people, ${r.devices} devices</small></div>`).join("") || `<div class="hint">Nothing sent yet.</div>`;
    };
    $("#nSend", root).onclick = async (e) => {
      const title = t.value.trim() || "A.F.R.A", body = b.value.trim(); if (!body) return toast("Write a message first");
      const btn = e.currentTarget; btn.disabled = true;
      try {
        let n = 0; try { n = (await api("/api/admin/users")).filter((u) => !u.disabled).length; } catch { }
        if (!confirm(`Send to all ${n} people?\n\n${title}\n${body}`)) return;
        const r = await api("/api/admin/broadcast", { body: { title, body, refresh: $("#nUpd", root).checked } });
        toast(`Sent to ${r.sent} people (${r.devices} devices) ♥`); b.value = ""; prev(); list();
      } catch (x) { toast(x.message); } finally { btn.disabled = false; }
    };
    list();
  }
  function notifySheet() { const s = sheet(`<h3 style="font:600 20px var(--serif);margin:4px 0 8px">📣 Notify everyone</h3><div id="nForm"></div>`); notifyForm($("#nForm", s)); }

  // ------------------------------------------------------------------ auto-update: the server says which version is current; this copy reloads itself when it is behind
  const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  let updBusy = false, updReady = false, updAt = 0, updBanner = null, updWait = null;
  const updIdle = () => {
    const t = $("#txt"), a = document.activeElement;
    if (t && t.value.trim()) return false;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    if (rec || vrec || vrev || S.edit) return false;
    if ($(".sheet-bg,.viewer,.avv,.hn,.wpv,.vrec,.mpv,#vrev,.page")) return false;
    if ($$("video,audio").some((v) => !v.paused && !v.ended)) return false;
    return !Object.values(S.msgs).some((l) => l.some((m) => m.pending));
  };
  function updReload(force) {  // remember where we are, then reload (not twice within 2 minutes unless the person tapped it)
    try {
      const last = JSON.parse(sessionStorage.getItem("afra_updtry") || "null");
      if (!force && last && Date.now() - last.t < 120000) return false;
      sessionStorage.setItem("afra_updtry", JSON.stringify({ t: Date.now() }));
      sessionStorage.setItem("afra_resume", JSON.stringify({ cid: S.cur || 0, t: Date.now() }));
    } catch { }
    location.reload(); return true;
  }
  function updShowBanner() {
    if (updBanner && updBanner.isConnected) return;
    const b = updBanner = document.createElement("div"); b.className = "banner-in upd-banner"; b.setAttribute("role", "button");
    b.innerHTML = `<span class="upd-ico">✨</span><div class="mid"><b>A new version is ready</b><small>Tap to refresh</small></div>`;
    b.onclick = () => { navigator.vibrate && navigator.vibrate(8); updReload(true); };
    document.body.appendChild(b);
  }
  function updNow() {  // the new version has arrived: reload quietly when nothing is in progress, otherwise ask
    updReady = true;
    if (updIdle() && updReload(false)) return;
    updShowBanner();
  }
  async function checkUpdate(force) {
    if (updReady) { if (updIdle()) updReload(false); return; }
    if (updBusy || (!force && Date.now() - updAt < 5000)) return;
    updBusy = true; updAt = Date.now();
    try {
      const r = await fetch("/api/version", { cache: "no-store" });
      const v = r.ok ? String((await r.json()).version || "") : "";
      if (!v || v === String(APP_V)) return;
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
      if (reg) {
        const arrived = new Promise((res) => { updWait = res; setTimeout(res, 8000); });
        reg.update().catch(() => { });
        await arrived; updWait = null;
      }
      updNow();
    } catch { } finally { updBusy = false; }
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;  // the very first install taking control is not an update
    if (updWait) updWait(); else updNow();
  });
  addEventListener("focus", () => checkUpdate());
  addEventListener("pageshow", (e) => { if (e.persisted) checkUpdate(true); });
  setInterval(() => { if (document.visibilityState === "visible") checkUpdate(true); }, 30 * 60 * 1000);

    // ------------------------------------------------------------------ Touches (v23): the Us screen, hugs, kisses and little buzzes
  // One touch = one event { action | word, count, strength 1-5, pattern [[ms, duration, strength], ...] }. Live touch (Phase 2) and
  // achievements (Phase 3) can hang off the same event: hit() below is the one place where taps are collected.
  const TACT = [
    { id: "hug", e: "🫂", n: "Hug", lot: "1fac2", vib: [30, 40, 60, 40, 90, 60, 120] },
    { id: "kiss", e: "💋", n: "Kiss", lot: "1f48b", vib: [25, 50, 25] },
    { id: "hold", e: "🤝", n: "Hold hands", lot: "1f91d", vib: [60, 80, 60] },
    { id: "poke", e: "👉", n: "Poke", lot: "1f449", vib: [15] },
    { id: "tickle", e: "🤭", n: "Tickle", lot: "1f92d", vib: [10, 20, 10, 20, 10, 20, 10] },
    { id: "stroke", e: "🤲", n: "Stroke", lot: "1f932", vib: [15, 15, 20, 15, 25, 15, 30] },
    { id: "heartbeat", e: "💓", n: "Heartbeat", lot: "1f493", vib: [40, 90, 70] },
    { id: "luck", e: "🍀", n: "Good luck", lot: "1f340", vib: [20, 40, 20, 40, 50] },
    { id: "tomato", e: "🍅", n: "Tomatoes", lot: "1f345", prank: 1, vib: [10, 30, 80] },
    { id: "pillow", e: "🪶", n: "Pillow", lot: "", prank: 1, vib: [50, 30, 30] },
    { id: "punch", e: "👊", n: "Punch", lot: "1f44a", prank: 1, vib: [90, 40, 40] }];
  const TNOUN = { hug: ["hug", "hugs"], kiss: ["kiss", "kisses"], hold: ["hand squeeze", "hand squeezes"], poke: ["poke", "pokes"], tickle: ["tickle", "tickles"],
    stroke: ["gentle stroke", "gentle strokes"], heartbeat: ["heartbeat", "heartbeats"], luck: ["lucky charm", "lucky charms"], tomato: ["tomato", "tomatoes"],
    pillow: ["pillow whack", "pillow whacks"], punch: ["playful punch", "playful punches"] };
  const TBUZZ = [["Thinking of you", "💭"], ["Love you", "💞"], ["Miss you", "🥹"], ["Call me", "📞"], ["Good morning", "☀️"], ["Goodnight", "🌙"], ["On my way", "🚗"], ["Hungry?", "🍜"]];
  const TSTR = ["feather-light", "gentle", "warm", "strong", "wild"];
  const tact = (id) => TACT.find((a) => a.id === id) || TACT[0];
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T = { prefs: null, overlay: null, queue: [], us: null, shown: new Set(), checking: false };

  // ---- haptics: Android and desktop have navigator.vibrate; iPhone (iOS 18+) ticks when a hidden <input switch> is toggled by a tap
  const HAP = { el: null };
  function iosTick() {
    try {
      if (!HAP.el) {
        const l = document.createElement("label"); l.className = "hap-switch"; l.setAttribute("aria-hidden", "true");
        const i = document.createElement("input"); i.type = "checkbox"; i.setAttribute("switch", ""); i.tabIndex = -1; l.appendChild(i);
        document.body.appendChild(l); HAP.el = l;
      }
      HAP.el.click(); return true;
    } catch { return false; }
  }
  function haptic(pat) {  // -> "vibrate", "ios" or "" (nothing ran)
    if (navigator.vibrate) { try { if (navigator.vibrate(pat)) return "vibrate"; } catch { } }
    if (isIOS) {
      let t = 0, n = 0; [].concat(pat).forEach((d, i) => { if (i % 2 === 0 && n++ < 10) { if (t === 0) iosTick(); else setTimeout(iosTick, t); } t += d; });
      return "ios";
    }
    return "";
  }
  function vibFromPattern(p, strength) {  // [[ms, duration, strength]] -> a vibrate() array (vibrate, pause, vibrate, ...)
    const out = []; let end = 0, total = 0;
    for (const [t, d, s] of (p || []).slice(0, 60)) {
      const dur = Math.round(Math.max(18, Math.min(220, d || 40)) * (.6 + .12 * (s || strength || 1)));
      if (out.length) { const gap = Math.max(20, Math.round(t - end)); out.push(gap); total += gap; }
      out.push(dur); total += dur; end = t + Math.max(d || 0, 0);
      if (total > 9000) break;
    }
    return out.length ? out : [50 + (strength || 1) * 25];
  }
  function pop(f = 1) {  // the soft pop of a buzz
    if (!store.get("sound", true)) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(560 * f, t); o.frequency.exponentialRampToValueAtTime(190 * f, t + .09);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.17, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + .15);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + .17);
    } catch { }
  }
  const blobFace = (u) => u && u.avatar ? `<img src="${fileUrl(u.avatar)}" alt="">`
    : `<span>${esc(((u && (u.name || u.username)) || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</span>`;
  const blobCol = (u) => COLORS[((u && u.id) || 0) % COLORS.length];
  const touchLine = (t, who) => t.action
    ? `${who} sent you ${t.count === 1 ? "a " + TNOUN[t.action][0] : t.count + " " + TNOUN[t.action][1]}`
    : `${who} says “${t.word}”`;
  const touchEmoji = (t) => t.action ? tact(t.action).e : (TBUZZ.find((b) => b[0] === t.word) || [0, "💌"])[1];

  // one little burst (a Lottie emoji, or just the emoji when it cannot load / motion is reduced) inside `host`
  function fxHit(host, a, x, y, s) {
    if (!host || !host.isConnected || host.querySelectorAll(".us-fx").length > 16) return;
    const d = document.createElement("div"); d.className = "us-fx fx-" + a.id;
    d.style.left = x + "px"; d.style.top = y + "px"; d.style.setProperty("--s", String(.8 + s * .2)); d.style.setProperty("--dx", Math.round(Math.random() * 70 - 35) + "px");
    host.appendChild(d);
    let an = null; const rm = () => { try { an && an.destroy(); } catch { } d.remove(); };
    if (a.lot && !reduceMotion()) lotMake(d, a.lot, a.e, false).then((x2) => { an = x2; if (an) { an.addEventListener("complete", rm); an.play(); } });
    else d.innerHTML = `<span class="pet-fb">${a.e}</span>`;
    setTimeout(rm, 2000);
    if (a.id === "tomato") {  // a splat that stays for a moment
      const sp = document.createElement("i"); sp.className = "us-splat"; sp.style.left = x + "px"; sp.style.top = y + "px"; sp.style.setProperty("--r", Math.round(Math.random() * 360) + "deg");
      host.appendChild(sp); setTimeout(() => sp.remove(), 3200);
    }
  }
  function wobble(el, x, y) {
    if (!el) return; el.style.setProperty("--px", x + "%"); el.style.setProperty("--py", y + "%");
    el.classList.remove("wob"); void el.offsetWidth; el.classList.add("wob");
  }

  // ---- the Us screen
  function usOpen(cid, act) {
    const c = conv(cid), them = c && other(c); if (!c || c.kind !== "direct" || !them || T.us) return;
    const page = document.createElement("div"); page.className = "page us";
    page.innerHTML = `<div class="us-top"><button class="icon" id="usBack" aria-label="Back">‹</button><div class="us-who"><b>${esc(dn(them))}</b><small id="usStat"></small></div></div>
      <div class="us-stage" id="usStage">
        <div class="us-aura"></div>
        <div class="us-blob them" id="usThem" style="--bc:${blobCol(them)}" role="button" aria-label="Touch ${esc(dn(them))}">${blobFace(them)}</div>
        <div class="us-blob me" id="usMe" style="--bc:${blobCol(S.me)}">${blobFace(S.me)}</div>
        <div class="us-count" id="usCount" hidden></div>
        <div class="us-say" id="usSay" hidden></div>
        <div class="us-hold" id="usHold">Hold or tap ${esc(dn(them).split(" ")[0])} to send</div>
      </div>
      <div class="us-sendrow"><button class="us-send" id="usSend" hidden>Send now</button></div>
      <div class="us-dock">
        <div class="us-ring" id="usRing">${TACT.map((a, i) => `${a.prank && !TACT[i - 1].prank ? `<span class="us-sep">Pranks</span>` : ""}<button class="us-act" data-a="${a.id}" aria-label="${a.n}"><i>${a.e}</i><span>${a.n}</span></button>`).join("")}</div>
        <div class="us-buzz" id="usBuzz">${TBUZZ.map((b) => `<button class="us-chip" data-w="${esc(b[0])}"><i>${b[1]}</i>${esc(b[0])}</button>`).join("")}</div>
      </div>`;
    document.body.appendChild(page);
    const U = T.us = { cid, page, them, stage: $("#usStage", page), act: act && TACT.some((a) => a.id === act) ? act : store.get("usact", "kiss"),
      count: 0, pat: [], strengths: [], t0: 0, hits: [], timer: 0, hold: 0, holdDelay: 0, downAt: 0, last: null, poll: 0, close: null };
    const close = U.close = () => {
      if (page.classList.contains("closing")) return; page.classList.add("closing"); clearInterval(U.poll); clearTimeout(U.timer); clearTimeout(U.holdDelay); clearInterval(U.hold);
      if (U.count) send(); T.us = null; setTimeout(() => page.remove(), 200);
    };
    layer(page, close); $("#usBack", page).onclick = close;
    const blob = $("#usThem", page), mine = $("#usMe", page), cnt = $("#usCount", page), sbtn = $("#usSend", page), hint = $("#usHold", page);
    const sync = () => {
      const u = other(conv(cid)) || them; U.them = u;
      U.stage.classList.toggle("lean", !!u.online);
      $("#usStat", page).textContent = u.online ? "here with you" : lastSeen(u);
    };
    sync(); U.poll = setInterval(sync, 2500);
    const selectAct = (id, quiet) => {
      U.act = id; store.set("usact", id);
      $$(".us-act", page).forEach((b) => b.classList.toggle("on", b.dataset.a === id));
      const a = tact(id); hint.innerHTML = a.prank ? `${a.e} ${a.n}: tap ${esc(dn(them).split(" ")[0])} (all in fun)` : `${a.e} Hold or tap ${esc(dn(them).split(" ")[0])} to send ${a.n.toLowerCase()}`;
      if (!quiet) { haptic([8]); const r = U.stage.getBoundingClientRect(); fxHit(U.stage, a, r.width / 2, r.height * .3, 2); }
      const on = $(`.us-act[data-a="${id}"]`, page); if (on && on.scrollIntoView) on.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
    };
    $("#usRing", page).onclick = (e) => { const b = e.target.closest(".us-act"); if (b) selectAct(b.dataset.a); };
    selectAct(U.act, true);

    // collecting taps: every tap, and every beat of a hold, is one hit; speed, hold time and touch size/force make it stronger
    function hit(e) {
      if (U.count >= 999) return;
      const t = performance.now(), a = tact(U.act);
      if (!U.count) { U.t0 = t; U.pat = []; U.strengths = []; U.hits = []; }
      U.hits = U.hits.filter((x) => t - x < 2000); U.hits.push(t);
      const rate = U.hits.length / 2, held = U.downAt ? t - U.downAt : 0;
      const rad = Math.max(e.width || 0, e.height || 0) / 2, force = e.pointerType === "touch" && e.pressure && e.pressure !== .5 ? e.pressure : 0;
      const s = Math.max(1, Math.min(5, 1 + Math.min(1.6, rate / 3) + Math.min(1, held / 1800) + (force ? Math.min(1, force * 1.2) : Math.min(.8, Math.max(0, rad - 14) / 20))));
      U.count++; U.strengths.push(s);
      if (t - U.t0 <= 10000 && U.pat.length < 150) U.pat.push([Math.round(t - U.t0), 120, +s.toFixed(1)]);
      const r = U.stage.getBoundingClientRect(), br = blob.getBoundingClientRect();
      const x = Math.max(br.left, Math.min(br.right, e.clientX)) - r.left, y = Math.max(br.top, Math.min(br.bottom, e.clientY)) - r.top;
      wobble(blob, Math.round(((e.clientX - br.left) / br.width) * 100), Math.round(((e.clientY - br.top) / br.height) * 100));
      if (a.id === "punch") { blob.classList.remove("punched"); void blob.offsetWidth; blob.classList.add("punched"); }
      fxHit(U.stage, a, x, y, s);
      haptic(U.count === 1 ? a.vib : [Math.round(8 + s * 5)]);
      cnt.hidden = false; cnt.textContent = "×" + U.count; cnt.dataset.s = Math.round(s);
      cnt.classList.remove("bump"); void cnt.offsetWidth; cnt.classList.add("bump");
      sbtn.hidden = false; hint.hidden = true;
    }
    async function send() {
      clearTimeout(U.timer); if (!U.count) return;
      const n = U.count, str = U.strengths, body = { action: U.act, count: n, pattern: U.pat,
        strength: Math.round(.5 * (str.reduce((x, y) => x + y, 0) / str.length) + .5 * Math.max(...str)) };
      U.count = 0; U.pat = []; U.strengths = []; U.hits = [];
      cnt.classList.add("gone"); setTimeout(() => { cnt.hidden = true; cnt.classList.remove("gone"); }, 500); sbtn.hidden = true; if (T.us === U) hint.hidden = false;
      mine.classList.remove("send"); void mine.offsetWidth; mine.classList.add("send");
      try { usSent(await api(`/api/touch/${cid}`, { body }), U); } catch (x) { toast(x.message); }
    }
    U.send = send;
    blob.addEventListener("pointerdown", (e) => {
      e.preventDefault(); try { blob.setPointerCapture(e.pointerId); } catch { }
      clearTimeout(U.timer); U.downAt = performance.now(); U.last = e; hit(e);
      U.holdDelay = setTimeout(() => { U.hold = setInterval(() => { if (U.last) hit(U.last); }, 230); }, 420);
    });
    blob.addEventListener("pointermove", (e) => { if (U.downAt) U.last = e; });
    const up = () => {
      if (!U.downAt) return;
      clearTimeout(U.holdDelay); clearInterval(U.hold); U.downAt = 0;
      if (U.pat.length) U.pat[U.pat.length - 1][1] = 160;
      if (U.count) U.timer = setTimeout(send, 1500);
    };
    blob.addEventListener("pointerup", up); blob.addEventListener("pointercancel", up); blob.addEventListener("lostpointercapture", up);
    blob.addEventListener("contextmenu", (e) => e.preventDefault());
    sbtn.onclick = send;
    // the buzz bar: one tap, one buzz
    let cool = 0;
    $("#usBuzz", page).onclick = async (e) => {
      const b = e.target.closest(".us-chip"); if (!b || Date.now() - cool < 350) return; cool = Date.now();
      pop(1 + Math.random() * .25); haptic([14]); wobble(mine, 50, 50); b.classList.remove("zap"); void b.offsetWidth; b.classList.add("zap");
      const say = $("#usSay", page); say.textContent = b.textContent.trim(); say.hidden = false; say.classList.remove("show"); void say.offsetWidth; say.classList.add("show");
      try { usSent(await api(`/api/touch/${cid}`, { body: { word: b.dataset.w, count: 1, strength: 2 } }), U); } catch (x) { toast(x.message); }
    };
  }
  function usSent(r, U) {  // what the server said about a touch we just sent
    if (r.reason === "limit") toast("Sent. To keep their phone calm, only a few buzzes go out per minute 💛");
    else if (r.reason === "quiet") toast("Sent. It's quiet hours for them, so it will be waiting 🌙");
    else if (r.reason === "off") toast("Sent. They've set their phone to quiet touches, so it will be waiting in the app");
    else if (r.coin && U && T.us === U) { const c = document.createElement("div"); c.className = "us-coin"; c.textContent = "+1 🪙"; U.stage.appendChild(c); setTimeout(() => c.remove(), 1400); }
  }
  // a touch from them while the Us screen is open: it happens right here, on my blob
  function usIncoming(t) {
    const U = T.us; if (!U) return;
    const a = t.action ? tact(t.action) : null, line = $("#usSay", U.page);
    line.textContent = touchLine(t, dn(U.them).split(" ")[0]); line.hidden = false; line.classList.remove("show"); void line.offsetWidth; line.classList.add("show");
    U.stage.classList.add("incoming"); setTimeout(() => U.stage.classList.remove("incoming"), 2600);
    haptic(vibFromPattern(t.pattern, t.strength)); if (!a) pop();
    playPattern(U.stage, $("#usMe", U.page), a, t);
  }
  // play a touch's rhythm (squeezed into about 4.5 s) on `target`, inside `host`
  function playPattern(host, target, a, t) {
    const pat = (t.pattern && t.pattern.length ? t.pattern : [[0, 100, t.strength || 2]]), span = pat[pat.length - 1][0] || 1, k = Math.min(1, 4500 / span), r = host.getBoundingClientRect();
    pat.slice(0, 60).forEach(([ms, , s], i) => setTimeout(() => {
      if (!host.isConnected) return;
      const tr = target.getBoundingClientRect(), x = tr.left - r.left + tr.width * (.25 + Math.random() * .5), y = tr.top - r.top + tr.height * (.2 + Math.random() * .5);
      wobble(target, Math.round(30 + Math.random() * 40), Math.round(30 + Math.random() * 40)); if (a) fxHit(host, a, x, y, s || 2);
    }, 250 + ms * k + i * 6));
  }

  // ---- receiving: the full-screen replay
  function touchReplay(t, opts) {
    opts = opts || {};
    if (!opts.force && T.shown.has(t.id)) return; T.shown.add(t.id);
    if (T.overlay) { T.queue.push(t); return; }
    const c = conv(t.conv), from = userById(t.sender) || other(c) || {}, a = t.action ? tact(t.action) : null, nm = dn(from) || "Someone";
    const ov = document.createElement("div"); ov.className = "tr-ov str" + Math.max(1, Math.min(5, t.strength || 1));
    ov.innerHTML = `<div class="tr-card" role="dialog" aria-label="A touch from ${esc(nm)}">
        <div class="tr-stage" id="trStage"><div class="us-blob them tr-blob" id="trBlob" style="--bc:${blobCol(from)}">${blobFace(from)}</div></div>
        <p class="tr-line">${esc(touchLine(t, nm))} ${touchEmoji(t)}</p>
        <small class="tr-sub">${esc(TSTR[Math.max(1, Math.min(5, t.strength || 1)) - 1])} · ${esc(shortTime(t.ts))}${opts.more ? ` · and ${opts.more} more` : ""}</small>
        <div class="tr-btns"><button class="big-btn" id="trBack">Send one back</button><button class="sbtn" id="trClose">Close</button></div></div>`;
    document.body.appendChild(ov); T.overlay = ov;
    let done = false;
    const close = (after) => {
      if (done) return; done = true; T.overlay = null; ov.classList.add("closing"); try { navigator.vibrate && navigator.vibrate(0); } catch { }
      setTimeout(() => { ov.remove(); const n = T.queue.shift(); if (n) touchReplay(n, { force: true }); else if (after && after.back) usOpen(t.conv, t.action); }, 220);
    };
    layer(ov, () => close());
    $("#trClose", ov).onclick = () => close();
    $("#trBack", ov).onclick = () => close({ back: 1 });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    const stage = $("#trStage", ov), blob = $("#trBlob", ov);
    haptic(vibFromPattern(t.pattern, t.strength)); if (!a) pop(1.1);
    setTimeout(() => playPattern(stage, blob, a, t), 450);
    if (!a) { const w = document.createElement("div"); w.className = "tr-word"; w.textContent = touchEmoji(t); stage.appendChild(w); }
    if (S.cur !== t.conv && conv(t.conv) && !opts.keep) { /* stay where we are: the chip is in the chat */ }
  }
  async function touchOpenById(id) {
    try { const t = await api(`/api/touch/${id}`); T.shown.add(t.id); touchReplay(t, { force: true }); markTouchSeen(t.id); if (conv(t.conv) && S.cur !== t.conv) openConv(t.conv); } catch { }
  }
  const markTouchSeen = (id) => api(`/api/touch/${id}/seen`, { method: "POST", body: {} }).catch(() => { });
  async function touchUnseenCheck() {  // touches that came while the app was closed (or in quiet hours) play once, now
    if (!TOKEN || !S.me || !isVisible() || T.checking) return; T.checking = true;
    try { const l = await api("/api/touch/unseen"); if (l.length) { l.forEach((t) => markTouchSeen(t.id)); touchReplay(l[l.length - 1], { more: l.length - 1 }); } } catch { }
    T.checking = false;
  }
  function onTouchEvent(e) {
    const t = e.touch; if (!t || e.mine || t.sender === S.me.id || !isVisible()) return;
    if (T.us && T.us.cid === t.conv) { T.shown.add(t.id); usIncoming(t); markTouchSeen(t.id); return; }
    touchReplay(t); markTouchSeen(t.id);
  }
  // ---- in the chat: a small centered chip
  function touchChip(m, pop_) {
    const a = m.attachment || {}, mine = m.sender === S.me.id, act = a.action ? tact(a.action) : null;
    const n = a.count || 1, s = TSTR[Math.max(1, Math.min(5, a.strength || 1)) - 1];
    const label = act ? `<i>${act.e}</i> ${n > 1 ? "×" + n : TNOUN[a.action][0]}<em> · ${s}</em>` : `<i>${touchEmoji({ word: a.word })}</i> ${esc(a.word || "")}`;
    return `<div class="tchip-row ${mine ? "mine" : ""} ${pop_}" data-id="${m.id || ""}"><button class="tchip" data-tc="${a.touch || 0}">${label}</button>
      <small>${mine ? "You" : esc(dn(userById(m.sender)))} · ${fmtTime(m.created)}${mine ? "" : ` · <button class="tback" data-tb="${esc(a.action || "")}">Send one back</button>`}</small></div>`;
  }
  function bindTouchChips(log) {
    $$(".tchip", log).forEach((b) => b.onclick = async (e) => {
      e.stopPropagation(); const id = +b.dataset.tc; if (!id) return;
      try { touchReplay(await api(`/api/touch/${id}`), { force: true }); } catch (x) { toast(x.message); }
    });
    $$(".tback", log).forEach((b) => b.onclick = (e) => { e.stopPropagation(); usOpen(S.cur, b.dataset.tb); });
  }

  // ---- Settings: how touches reach me
  async function touchPrefsInit(root) {
    const box = $("#sTouch", root); if (!box) return;
    let p = T.prefs; try { p = T.prefs = await api("/api/touch/prefs"); } catch { if (!p) { box.innerHTML = `<small class="hint">Couldn't load. Try again later.</small>`; return; } }
    if (!box.isConnected) return;
    const save = (patch) => api("/api/touch/prefs", { method: "PUT", body: patch }).then((r) => { T.prefs = r; }).catch((x) => toast(x.message));
    box.innerHTML = `<div class="tseg" id="tpMode" role="radiogroup" aria-label="Storm mode">${[["full", "Full"], ["gentle", "Gentle"], ["off", "Off"]].map(([v, l]) => `<button role="radio" aria-checked="${p.mode === v}" data-m="${v}" class="${p.mode === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <small class="hint" id="tpHint"></small>
      <label class="swrow"><span><b>Quiet hours</b><small>Touches wait for you in the app instead of buzzing your phone</small></span><input type="checkbox" class="swtog" id="tpQuiet" ${p.quiet_on ? "checked" : ""}></label>
      <div class="tpq" id="tpQ" ${p.quiet_on ? "" : "hidden"}><label>From <input type="time" id="tpA" value="${esc(p.quiet_start)}"></label><label>to <input type="time" id="tpB" value="${esc(p.quiet_end)}"></label></div>
      <label class="swrow"><span><b>Watch mode</b><small>Only the first buzz of a touch reaches your wrist</small></span><input type="checkbox" class="swtog" id="tpWatch" ${p.watch ? "checked" : ""}></label>`;
    const hints = { full: "Many hugs or kisses arrive as a little storm of buzzes, like the real thing.", gentle: "However many they send, you get one gentle buzz.", off: "Your phone stays quiet. Touches wait for you in the app." };
    const hint = () => { $("#tpHint", box).textContent = hints[T.prefs.mode]; }; hint();
    $("#tpMode", box).onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return; await save({ mode: b.dataset.m });
      $$("#tpMode button", box).forEach((x) => { const on = x.dataset.m === T.prefs.mode; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); hint();
    };
    $("#tpQuiet", box).onchange = async (e) => { $("#tpQ", box).hidden = !e.target.checked; await save({ quiet_on: e.target.checked }); };
    $("#tpA", box).onchange = (e) => save({ quiet_start: e.target.value }); $("#tpB", box).onchange = (e) => save({ quiet_end: e.target.value });
    $("#tpWatch", box).onchange = (e) => save({ watch: e.target.checked });
  }

  // ---- Admin: the touch storm test (Phase 0) and the haptic check
  function stormCard(root) {
    const card = document.createElement("div"); card.className = "storm";
    card.innerHTML = `<h4>Touch storm test</h4>
      <p class="hint">Sends your phones a burst of numbered pushes (“Test buzz 7/20”). Count how many banners really show up. “Accepted” only means the push service took it.</p>
      <div class="storm-row"><label>Pushes<select id="stN" class="inp"><option>10</option><option selected>20</option><option>40</option></select></label>
        <label>Spacing<select id="stG" class="inp"><option value="150">150 ms</option><option value="300" selected>300 ms</option><option value="600">600 ms</option></select></label></div>
      <button class="big-btn" id="stGo">Send the storm to my phones</button><div class="storm-out" id="stOut" aria-live="polite"></div>
      <h4>Storm limits</h4><p class="hint">What a real touch may send, per touch.</p>
      <div class="storm-row"><label>Most pushes<input id="stMax" class="inp" type="number" min="1" max="60"></label><label>Gap (ms)<input id="stGap" class="inp" type="number" min="50" max="5000" step="50"></label></div>
      <button class="sbtn" id="stSave">Save limits</button>
      <h4>Haptic check</h4><p class="hint">Tries the vibration of this device. Say what you felt.</p>
      <button class="sbtn" id="stHap">Try haptics</button><div class="storm-out" id="stHapOut"></div>`;
    root.appendChild(card);
    const out = $("#stOut", card);
    api("/api/admin/storm").then((r) => { $("#stMax", card).value = r.storm_max; $("#stGap", card).value = r.storm_gap_ms; }).catch(() => { });
    $("#stSave", card).onclick = () => api("/api/admin/storm", { method: "PUT", body: { storm_max: +$("#stMax", card).value, storm_gap_ms: +$("#stGap", card).value } })
      .then((r) => { $("#stMax", card).value = r.storm_max; $("#stGap", card).value = r.storm_gap_ms; toast("Saved"); }).catch((x) => toast(x.message));
    const show = (r, exp) => {
      const dev = r.devices.map((d) => `<li><b>${esc(d.type)}</b> ${d.accepted}/${d.sent} accepted${d.failed ? `, ${d.failed} failed (${Object.entries(d.statuses).map(([k, v]) => `${k}×${v}`).join(", ")})` : ""} · avg ${d.avg_ms} ms, slowest ${d.max_ms} ms</li>`).join("");
      out.innerHTML = `<b>Sent ${r.sent}${exp ? " of " + exp : ""} · accepted ${r.accepted} · failed ${r.failed}</b> <small>${r.seconds}s${r.running ? " · sending…" : ""}</small><ul>${dev}</ul>${r.errors.length ? `<small class="hint">${esc(r.errors.join(" · "))}</small>` : ""}`;
    };
    $("#stGo", card).onclick = async (e) => {
      const b = e.target; b.disabled = true; out.textContent = "Starting…";
      try {
        const r = await api("/api/admin/storm/test", { body: { count: +$("#stN", card).value, gap_ms: +$("#stG", card).value } });
        for (let i = 0; i < 400 && card.isConnected; i++) {
          await new Promise((res) => setTimeout(res, 1000));
          const s = await api(`/api/admin/storm/test/${r.run}`); show(s, r.expected);
          if (!s.running && s.sent >= r.expected) break;
        }
      } catch (x) { out.textContent = x.message; }
      b.disabled = false;
    };
    $("#stHap", card).onclick = () => {
      const ho = $("#stHapOut", card), rows = [];
      let v = "not available"; try { v = navigator.vibrate ? (navigator.vibrate([120, 60, 120]) ? "ran" : "refused") : "not available"; } catch { v = "error"; }
      rows.push(`navigator.vibrate: ${v}`);
      const sw = iosTick(); rows.push(`iOS switch tick: ${sw ? "ran" : "not available"}${isIOS ? "" : " (only iPhones answer to this one)"}`);
      ho.innerHTML = `<ul>${rows.map((r) => `<li>${r}</li>`).join("")}</ul><small class="hint">“Ran” means the call worked. Only you can tell whether you felt it.</small>`;
    };
  }

// ------------------------------------------------------------------ start
  async function start() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => { });
    checkUpdate(true);
    if (!TOKEN) return authScreen();
    S.me = S.me || store.get("cache", {}).me || null;
    if (!S.me) { try { S.me = await api("/api/me"); } catch (e) { if (!TOKEN) return; return authScreen(); } }
    cacheLoad(); shell(); connect(); pwGate(); reportDevice();
    toAfra({ type: "ready", me: { username: S.me.username, name: S.me.name } });
    const want = +(new URLSearchParams(location.hash.slice(1)).get("c") || 0);
    let back = null; try { back = JSON.parse(sessionStorage.getItem("afra_resume") || "null"); sessionStorage.removeItem("afra_resume"); } catch { }
    if (back && Date.now() - back.t < 60000) { setTimeout(() => toast("✨ Updated"), 500); if (!want && back.cid && conv(back.cid)) setTimeout(() => openConv(back.cid), 150); }
    if (want) setTimeout(() => conv(want) && openConv(want), 400);
    const wantT = +(new URLSearchParams(location.hash.slice(1)).get("touch") || 0);
    if (wantT) { setTimeout(() => touchOpenById(wantT), 700); history.replaceState(null, "", location.pathname + location.search); }
    setTimeout(touchUnseenCheck, 1500);
    if ("Notification" in window && Notification.permission === "granted") enablePush(false);
  }
  document.addEventListener("visibilitychange", () => {
    sendVis();
    if (document.visibilityState === "visible") checkUpdate();
    if (isVisible() && TOKEN && S.me) {
      autoWhere();
      if (!WS || WS.readyState > 1) connect(); else resync();
      if (S.cur && conv(S.cur) && conv(S.cur).unread) markRead(S.cur);
      celebrateCheck(); touchUnseenCheck();
    }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (!e.data) return; if (e.data.open) openConv(+e.data.open); if (e.data.touch) touchOpenById(+e.data.touch); });
  start().catch((e) => { app.innerHTML = `<div class="setup"><h1>A.F.R.A ♥</h1><p>Something went wrong: ${esc(e.message)}</p></div>`; });
})();
