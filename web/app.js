/* A.F.R.A ♥ chat: a small private social chat. iPhone Home Screen app (with notifications), and in any browser.
   Accounts with usernames and profile photos, one chat per person plus "Notes to self", admin invites.
   (c) 2026 danafarmansyah. All rights reserved. Crafted with love. */
(() => {
  "use strict";
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
  function lookSheet() {
    let l = { ...LOOK_DEFAULT, ...(store.get("look") || {}) };
    const s = sheet(`<h3>Appearance</h3>
      <div class="lookprev"><div class="msg mine"><div class="bub"><div class="txt">This is how your messages look ✨</div></div></div></div>
      <h4>Text size</h4><div class="chips lookchips" data-k="size">${LOOK_SIZES.map((x) => `<button data-v="${x[0]}">${x[1]}</button>`).join("")}</div>
      <h4>Font</h4><div class="chips lookchips" data-k="font">${LOOK_FONTS.map((x) => `<button data-v="${x[0]}" style="${x[2] ? "font-family:" + x[2] : ""}">${x[1]}</button>`).join("")}</div>
      <h4>Accent colour</h4><div class="lookdots" data-k="accent">${LOOK_ACCENTS.map((c) => `<button data-v="${c}" aria-label="${c || "Default"}" style="background:${c || "#0095f6"}"></button>`).join("")}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="sbtn" id="lreset">Reset</button></div>`);
    const mark = () => $$("[data-k]", s).forEach((g) => $$("button", g).forEach((b) => b.classList.toggle("on", b.dataset.v === l[g.dataset.k])));
    $$("[data-k] button", s).forEach((b) => b.onclick = () => {
      l[b.parentNode.dataset.k] = b.dataset.v; store.set("look", l); applyLook(l); mark();
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
    });
    $("#lreset", s).onclick = () => { l = { ...LOOK_DEFAULT }; store.del("look"); applyLook(l); mark(); };
    mark();
  }
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
    const close = () => { document.removeEventListener("keydown", key); o.classList.add("closing"); setTimeout(() => o.remove(), 200); };
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
  const S = { me: null, convs: [], msgs: {}, cur: null, view: "list", typing: {}, filter: "", search: "", reply: null, edit: null, older: {}, seen: {}, stars: new Set() };
  const app = $("#app");
  const REACTIONS = ["❤️", "🥰", "😂", "😮", "😢", "🙏", "👍", "🔥"];
  const EMOJIS = "❤️ 🥰 😘 😍 🤗 😊 😁 😂 🥹 😭 😢 🥺 😴 🤔 😮 😎 🙈 🙏 👍 👏 💪 🎉 ✨ 🔥 💯 🌹 🌸 🌙 ☀️ ☕ 🍜 🍦 📚 ✍️ 🎓 💌 💖 💕 💞 💗 🤍 💛 💙 🫶 👀 😅 🙃 😌".split(" ");
  const COLORS = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#978365"];
  const conv = (id) => S.convs.find((c) => c.id === id);
  const other = (c) => (c && c.members && c.members[0]) || null;
  const title = (c) => !c ? "" : c.kind === "self" ? "Notes to self" : c.kind === "bot" ? "Assistant" : (other(c) ? other(c).name || "@" + other(c).username : "Chat");
  const userById = (id) => id === S.me.id ? S.me : S.convs.flatMap((c) => c.members).find((u) => u.id === id);

  function avatar(u, cls = "", self = false) {
    if (self) return `<div class="av ${cls}" style="background:var(--field)">📝</div>`;
    if (!u) return `<div class="av ${cls}">?</div>`;
    if (u.bot) return `<div class="av bot ${cls}">✨</div>`;
    const ini = (u.name || u.username || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const col = COLORS[(u.id || 0) % COLORS.length];
    return `<div class="av ${cls}" style="background:${col}">${u.avatar ? `<img src="${fileUrl(u.avatar)}" alt="">` : esc(ini)}</div>`;
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
  const preview = (m) => !m ? "" : m.deleted ? "Message deleted" : m.text ? ({ image: "📷 ", video: "🎥 " }[m.kind] || "") + m.text
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
    if (e.t === "msg" || e.t === "upd") {
      upsert(e.msg);
      const c = conv(e.msg.conv_id);
      if (!c) { resync(); return; }
      if (e.t === "msg") {
        c.last = e.msg; c.last_at = e.msg.created;
        if (e.msg.sender !== S.me.id) {
          delete S.typing[c.id];
          if (S.cur === c.id && isVisible()) markRead(c.id); else c.unread = (c.unread || 0) + 1;
          if (!isVisible()) toAfra({ type: "message", conv: c.id, from: title(c), text: preview(e.msg) });
          if (isVisible() && (S.cur === c.id || !isMuted(c))) { sound(S.cur === c.id ? "recv" : "ping"); if (S.cur !== c.id) inAppNotice(c, e.msg); }
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
    } else if (e.t === "profile") {
      S.convs.forEach((c) => c.members.forEach((u, i) => { if (u.id === e.user.id) c.members[i] = { ...u, ...e.user }; }));
      drawAll();
    } else if (e.t === "conv") {
      const i = S.convs.findIndex((c) => c.id === e.conv.id); if (i >= 0) S.convs[i] = e.conv; else S.convs.unshift(e.conv);
      if (S.cur === e.conv.id) applyStyle();
      if (e.styled && e.by !== S.me.id && S.cur === e.conv.id) toast(`${(userById(e.by) || {}).name || "They"} changed the chat theme`);
      cacheSave(); drawList();    } else if (e.t === "conv_gone") {  // the admin deleted the other person's account
      S.convs = S.convs.filter((c) => c.id !== e.conv); delete S.msgs[e.conv];
      if (S.cur === e.conv) { S.cur = null; setView("list"); history.replaceState(null, "", location.pathname); }
      cacheSave(); drawList(); badge();
    }
  }
  function inAppNotice(c, m) {  // a banner slides down from the top; tap to open, swipe up (or wait) to dismiss
    $$(".banner-in").forEach((x) => x.remove());
    const b = document.createElement("div"); b.className = "banner-in";
    b.innerHTML = `${avatar(other(c), "sm", c.kind === "self")}<div class="mid"><b>${esc(title(c))}</b><small>${esc(preview(m))}</small></div>`;
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
    toAfra({ type: "unread", count: n });
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
      <section class="pane-list">
        <div class="top"><div id="meAv" style="cursor:pointer"></div><h1>Chats<small class="greet" id="greet"></small></h1>
          <button class="icon dedi-heart" id="bHeart" title="A little note" aria-label="A little note">♥</button><button class="icon" id="bAdmin" title="Admin" hidden>🛡</button></div>
        <div id="banner"></div>
        <div class="list-tools"><input type="search" id="lq" placeholder="Search chats"></div>
        <div class="convs" id="convs"></div>
        <button class="fab" id="bNew" title="New chat" aria-label="New chat"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z"/><path d="M12 8v7M8.5 11.5h7"/></svg></button>
      </section>
      <section class="pane-chat" id="chatPane"></section>`;
    $("#bNew").onclick = newChat; $("#bHeart").onclick = heartNotes; $("#bAdmin").onclick = adminPage; $("#meAv").onclick = profileSheet;
    $("#lq").oninput = (e) => { S.filter = e.target.value.trim().toLowerCase(); drawList(); };
    setView(S.view); drawAll(); drawBanner();
  }
  function setView(v) { if (S.view !== v) { app.classList.remove("slide"); void app.offsetWidth; app.classList.add("slide"); } S.view = v; app.dataset.view = v; }
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
      const last = c.last ? (c.last.sender === S.me.id && c.kind !== "self" ? "You: " : "") + preview(c.last) : c.kind === "self" ? "Keep notes, links and photos for yourself" : c.kind === "bot" ? "Reminders, notes, lists, questions" : "Say hi 👋";
      return `<div class="conv ${S.cur === c.id ? "on" : ""}" data-c="${c.id}">
        <div class="av-wrap ${u && u.online && !u.bot ? "on" : ""}">${avatar(u, "", c.kind === "self")}</div>
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
    location.hash = "c=" + cid;
    drawList(); drawChatPane(true);
    if (!S.msgs[cid]) { try { await loadConv(cid); } catch (e) { toast(e.message); } drawChat(); scrollEnd(true); }
    const c = conv(cid); if (c && c.unread) markRead(cid);
  }

  function drawChatPane(focus) {
    const pane = $("#chatPane"); if (!pane) return;
    const c = conv(S.cur);
    if (!c) { pane.innerHTML = `<div class="blank"><div><div style="font-size:48px">💌</div>Choose a chat, or tap 💬 to start one.</div></div>`; return; }
    pane.innerHTML = `
      <div class="top"><button class="icon back" id="bBack">‹</button><div id="chatAv"></div>
        <div class="who"><b id="chatName"></b><small id="chatStat"></small></div>
        <button class="icon" id="bTheme" title="Chat theme">🎨</button><button class="icon" id="bSearch" title="Search">🔍</button></div>
      <div class="searchbar" id="sbar" hidden><input type="search" id="sq" placeholder="Search in this chat"><button class="cbtn" id="sclose">✕</button></div>
      <div class="log" id="log"></div>
      <div class="dock" id="dock">
        <div class="typing-line" id="typing"></div>
        <div id="replybar"></div>
        <div class="quick" id="quick"></div>
        <div class="compose" id="compose">
          <button class="cbtn plus" id="battach" title="Attach" aria-label="Attach"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
          <div class="pill"><textarea id="txt" rows="1" placeholder="Message"></textarea><button class="cbtn" id="bemoji" title="Emoji">😊</button></div>
          <button class="cbtn cam" id="bcam" title="Tap for a photo or video, hold for a video note" aria-label="Camera"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.7A1.5 1.5 0 0 1 10.5 3.5h3a1.5 1.5 0 0 1 1.2.8L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/></svg></button>
          <button class="cbtn send" id="bsend" title="Send">🎤</button>
          <input type="file" id="bcamfile" accept="image/*,video/*" capture hidden>
        </div>
      </div>`;
    $("#bBack").onclick = () => { S.cur = null; setView("list"); history.replaceState(null, "", location.pathname); drawList(); };
    $("#bSearch").onclick = () => { $("#sbar").hidden = false; $("#sq").focus(); };
    $("#bTheme").onclick = themeSheet;
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
    if (window.ResizeObserver) new ResizeObserver(() => { const near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 160; logEl.style.paddingBottom = (dock.offsetHeight + 6) + "px"; if (near) logEl.scrollTop = logEl.scrollHeight; }).observe(dock);
    window.growComposer = grow; grow(); drawQuick();
    applyStyle(); drawHeader(); drawChat(); scrollEnd(true);
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
    if ((conv(S.cur) || {}).kind === "bot") {
      const ex = [["⏰ Remind me", "Remind me in 10 minutes to stretch"], ["🛒 Shopping list", "Add milk to my shopping list"],
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
    $("#chatAv").innerHTML = `<div class="av-wrap ${u && u.online && !u.bot ? "on" : ""}">${avatar(u, "sm", c.kind === "self")}</div>`;
    $("#chatName").textContent = title(c);
    const st = $("#chatStat");
    st.textContent = !LIVE ? "connecting…" : c.kind === "self" ? "only you can see this" : typing ? "typing…" : c.kind === "bot" ? "personal assistant" : [lastSeen(u), u ? "@" + u.username : ""].filter(Boolean).join("  ·  ");
    st.className = typing || (u && u.online) ? "live" : "";
    const tl = $("#typing");
    if (typing && !tl.firstChild) { tl.innerHTML = `<div class="typing-bub" title="${esc(title(c))} is typing"><i></i><i></i><i></i></div>`; scrollEnd(); }
    else if (!typing && tl.firstChild) tl.innerHTML = "";
  }
  setInterval(() => { drawHeader(); const t = now(); if (Object.values(S.typing).some((x) => x < t && x > t - 2)) drawList(); }, 2000);

  function scrollEnd(force) { const log = $("#log"); if (log && (force || log.scrollHeight - log.scrollTop - log.clientHeight < 140)) log.scrollTop = log.scrollHeight; }

  function bubbleBody(m, list) {
    if (m.deleted) return `<div class="txt">This message was deleted</div>`;
    const a = m.attachment;
    let html = "";
    if (m.reply_to) {
      const q = list.find((x) => x.id === m.reply_to);
      const who = q ? (q.sender === S.me.id ? "You" : (userById(q.sender) || {}).name || "") : "";
      html += `<div class="quote" data-goto="${m.reply_to}"><b>${esc(who)}</b> ${esc(q ? preview(q) : "Earlier message").slice(0, 120)}</div>`;
    }
    if (a && a.id) {
      if (m.kind === "image") html += `<img class="photo" src="${fileUrl(a.id)}" alt="${esc(a.name)}" loading="lazy" data-full="${fileUrl(a.id)}">`;
      else if (m.kind === "voice") html += `<audio controls preload="none" src="${fileUrl(a.id)}"></audio>`;
      else if (m.kind === "video") html += `<div class="vid" data-v${a.w ? ` style="aspect-ratio:${Math.max(.6, Math.min(1.8, a.w / a.h))}"` : ""}>${a.poster ? `<img src="${fileUrl(a.poster)}" alt="" loading="lazy">` : `<video src="${fileUrl(a.id)}#t=0.1" preload="metadata" muted playsinline></video>`}<span class="vid-play">▶</span><span class="vid-len">🎥 ${a.dur ? fmtDur(a.dur) : ""}</span></div>`;
      else if (m.kind === "videonote") html += `<div class="vnote" data-vn><video src="${fileUrl(a.id)}#t=0.1"${a.poster ? ` poster="${fileUrl(a.poster)}"` : ""} playsinline preload="metadata"></video><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg><span class="vn-play">▶${a.dur ? " " + fmtDur(a.dur) : ""}</span></div>`;
      else html += `<a class="file" href="${fileUrl(a.id)}" target="_blank" download="${esc(a.name)}"><span style="font-size:28px">📄</span><span><b>${esc(a.name)}</b><small>${sizeTxt(a.size || 0)}</small></span></a>`;
    } else if (a && a.local) html += `<div class="txt">⏳ ${esc(a.name)}</div>`;
    if (m.text) html += `<div class="txt ${onlyEmoji(m.text) ? "big" : ""}">${esc(m.text)}</div>`;
    return html;
  }

  function drawChat() {
    const log = $("#log"), c = conv(S.cur); if (!log || !c) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    const list = S.msgs[c.id] || [];
    const shown = S.search ? list.filter((m) => (m.text || "").toLowerCase().includes(S.search) || (m.attachment && (m.attachment.name || "").toLowerCase().includes(S.search))) : list;
    let html = S.older[c.id] && !S.search ? `<button class="older" id="bOlder">Show earlier messages</button>` : "", lastDay = "";
    const seen = S.seen[c.id], fresh = new Set();
    for (const m of shown) {
      const day = dayLabel(m.created);
      if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
      const mine = m.sender === S.me.id;
      const read = c.kind !== "self" && (c.other_read || 0) >= m.created;
      const ticks = mine && !m.deleted && c.kind !== "self" ? `<span class="ticks ${read ? "read" : ""}">${m.pending ? "🕓" : read ? "✓✓" : "✓"}</span>` : (m.pending ? "🕓" : "");
      const key = m.client_id || m.id; fresh.add(key);
      const pop = seen && !seen.has(key) ? "pop" : "";
      html += `<div class="msg ${mine ? "mine" : ""} ${m.pending ? "pending" : ""} ${pop}" data-id="${m.id || ""}" data-cid="${esc(m.client_id || "")}">
        <div class="bub ${m.deleted ? "deleted" : ""} ${!m.deleted && (m.kind === "videonote" || m.kind === "sticker") ? "bare" : ""}">${bubbleBody(m, list)}</div>
        ${rxPill(m)}
        <div class="meta">${S.stars.has(m.id) ? "⭐ " : ""}${m.edited && !m.deleted ? "edited · " : ""}${fmtTime(m.created)} ${ticks}</div></div>`;
    }
    log.innerHTML = html + (list.length ? "" : `<div class="empty">${c.kind === "self" ? "Your private notes: only you can see this chat." : c.kind === "bot" ? "Ask me anything, or tell me what to remember ✨" : `Say hi to ${esc(title(c))} 👋<br><small>💌 has ready-made messages.</small>`}</div>`);
    const older = $("#bOlder"); if (older) older.onclick = loadOlder;
    $$("img.photo", log).forEach((img) => img.onclick = (e) => { e.stopPropagation(); const m = list.find((x) => x.id === +img.closest(".msg").dataset.id); if (m) viewMedia(m, list); });
    $$("[data-v]", log).forEach((el) => el.onclick = (e) => { e.stopPropagation(); const m = list.find((x) => x.id === +el.closest(".msg").dataset.id); if (m) viewMedia(m, list); });
    bindVideoNotes(log);
    $$("[data-rxs]", log).forEach((b) => b.onclick = (e) => { e.stopPropagation(); navigator.vibrate && navigator.vibrate(5); rxSheet(+b.dataset.rxs); });
    $$("[data-goto]", log).forEach((q) => q.onclick = (e) => {
      e.stopPropagation(); const t = $(`.msg[data-id="${q.dataset.goto}"]`); if (!t) return;
      t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1400);
    });
    $$(".msg", log).forEach(bindPress);
    S.seen[c.id] = fresh;
    if (atBottom) log.scrollTo({ top: log.scrollHeight, behavior: seen ? "smooth" : "auto" });
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
      if (e.target.closest(".reacts")) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; el.style.transition = "none";
      timer = setTimeout(() => { timer = null; navigator.vibrate && navigator.vibrate(10); msgMenu(id); }, 450);
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {  // swipe right to reply
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
      const done = (v) => { document.removeEventListener("keydown", key); o.classList.add("closing"); setTimeout(() => { o.remove(); URL.revokeObjectURL(url); }, 180); res(v); };
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
      ${(conv(S.cur) || {}).kind === "bot" ? `<button id="aWhere"><i style="background:#34c759">📍</i>Share where I am</button>` : ""}
    </div>`);
    const take = (e, doc) => { const fs = [...e.target.files]; e.target.value = ""; s.remove(); if (!fs.length) return; doc ? fs.forEach((f) => sendFile(f, "file")) : mediaPreview(fs); };
    $("#aMedia", s).onchange = (e) => take(e); $("#aCam", s).onchange = (e) => take(e); $("#aDoc", s).onchange = (e) => take(e, true);
    $("#aNote", s).onclick = () => { s.remove(); recordVideoNote(); };
    $("#aLetter", s).onclick = () => { s.remove(); openTemplates(); };
    if ($("#aWhere", s)) $("#aWhere", s).onclick = () => { s.remove(); shareWhere(); };
  }
  function mediaPreview(files) {  // look before sending, with a caption (like WhatsApp)
    files = files.filter((f) => /^(image|video)\//.test(f.type)).slice(0, 10);
    if (!files.length) return toast("Choose photos or videos");
    const urls = files.map((f) => URL.createObjectURL(f));
    const s = sheet(`<div class="mprev">${files.map((f, i) => f.type.startsWith("video/") ? `<video src="${urls[i]}" controls playsinline muted></video>` : `<img src="${urls[i]}" alt="">`).join("")}</div>
      <div class="caprow"><textarea class="inp" id="mcap" rows="1" placeholder="Add a caption…"></textarea><button class="cbtn send" id="msend" title="Send">➤</button></div>`);
    const done = () => urls.forEach((u) => URL.revokeObjectURL(u));
    s.addEventListener("click", (e) => { if (e.target === s) done(); });
    $("#msend", s).onclick = async () => {
      const cap = $("#mcap", s).value.trim(); s.remove(); done();
      for (let i = 0; i < files.length; i++) await sendFile(files[i], null, i === 0 ? cap : "");
    };
    setTimeout(() => { const c = $("#mcap", s); if (c && !matchMedia("(pointer: coarse)").matches) c.focus(); }, 150);
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
        if (secs < 1) return toast(hold ? "Hold a little longer to record" : "Tap ●, talk, then tap ■ to send");
        sendFile(new File([new Blob(chunks, { type: mime })], `videonote.${mime.includes("mp4") ? "mp4" : "webm"}`, { type: mime }), "videonote", "", { dur: Math.round(secs) });
      };
      rec.start(250); started = Date.now(); ov.classList.add("on"); $("#vFlip", ov).disabled = true;
      tick = setInterval(() => {
        const s = (Date.now() - started) / 1000; time.textContent = "● " + fmtDur(s) + (hold && !locked ? "  ·  release to send" : "  ·  tap ■ to send");
        ring.style.strokeDashoffset = 301.6 * (1 - Math.min(s / 60, 1));
        if (s >= 60) rec.stop();
      }, 200);
    };
    go.onclick = () => { if (rec) rec.stop(); else startRec(); };
    if (hold && ctl) {  // WhatsApp style: recording starts at once; slide up to lock, left to cancel, let go to send
      if (ctl.up) { cancelled = true; close(); return; }
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
    const close = () => { clearTimeout(hideT); if (vid) vid.pause(); v.classList.add("closing"); setTimeout(() => v.remove(), 180); document.removeEventListener("keydown", key); };
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
    for (let i = 0; i < 15 && !(S.msgs[cid] || []).some((m) => m.id === id) && S.older[cid]; i++) await loadOlder();
    const t = $(`.msg[data-id="${id}"]`); if (!t) return toast("Couldn't find that message");
    t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1400);
  }

  // ------------------------------------------------------------------ contact info: photo, about, media, links, docs, starred
  function infoPage() {
    const c = conv(S.cur); if (!c) return;
    if (c.kind === "bot") return assistantInfo(c);
    const u = other(c), self = c.kind === "self";
    const page = document.createElement("div"); page.className = "page info";
    const close = () => { page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    page.innerHTML = `<div class="top"><button class="icon" id="iBack">‹</button><h1>${self ? "Notes to self" : "Contact info"}</h1></div>
      <div class="page-body">
        <div class="ihead">${avatar(u, "xl", self)}<div class="iname">${esc(title(c))}</div>
          ${self ? `<div class="isub">Only you can see this chat</div>` : `<div class="isub">@${esc(u.username)}${lastSeen(u) ? " · " + esc(lastSeen(u)) : ""}</div>${u.bio ? `<div class="ibio">${esc(u.bio)}</div>` : ""}`}</div>
        <div class="iacts"><button data-i="search"><i>🔍</i>Search</button><button data-i="theme"><i>🎨</i>Theme</button>
          ${self ? "" : `<button data-i="mute"><i>${isMuted(c) ? "🔕" : "🔔"}</i>${isMuted(c) ? "Muted" : "Mute"}</button>`}</div>
        <div class="chips tabs itabs"><button data-t="media" class="on">Media</button><button data-t="links">Links</button><button data-t="docs">Docs</button><button data-t="starred">⭐ Starred</button></div>
        <div id="ibody"></div>
      </div>`;
    document.body.appendChild(page);
    $("#iBack", page).onclick = close;
    $$("[data-i]", page).forEach((b) => b.onclick = () => {
      const a = b.dataset.i;
      if (a === "search") { close(); $("#sbar").hidden = false; $("#sq").focus(); }
      if (a === "theme") { close(); themeSheet(); }
      if (a === "mute") muteSheet(conv(c.id), () => { page.remove(); infoPage(); });
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

  // ------------------------------------------------------------------ the Assistant: its page (reminders, lists, places) and where you are
  function assistantInfo(c) {
    const page = document.createElement("div"); page.className = "page info";
    const close = () => { page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
    page.innerHTML = `<div class="top"><button class="icon" id="iBack">‹</button><h1>Assistant</h1></div>
      <div class="page-body">
        <div class="ihead">${avatar(other(c), "xl")}<div class="iname">Assistant</div><div class="isub">Your personal assistant · only you can see this chat</div></div>
        <div class="iacts"><button data-i="search"><i>🔍</i>Search</button><button data-i="theme"><i>🎨</i>Theme</button>
          <button data-i="mute"><i>${isMuted(c) ? "🔕" : "🔔"}</i>${isMuted(c) ? "Muted" : "Mute"}</button></div>
        <div class="chips tabs itabs"><button data-t="rem" class="on">⏰ Reminders</button><button data-t="notes">📝 Lists &amp; notes</button><button data-t="places">📍 Places</button></div>
        <div id="ibody"></div>
      </div>`;
    document.body.appendChild(page);
    $("#iBack", page).onclick = close;
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
        return `<button class="rxs-row ${me ? "me" : ""}" data-e="${esc(e)}" style="animation-delay:${i * 40}ms" ${me ? "data-rm" : ""}>${avatar(u, "sm")}<span><b>${me ? "You" : esc(u.name || "@" + (u.username || ""))}</b>${me ? "<small>Tap to remove</small>" : ""}</span><i>${esc(e)}</i></button>`;
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

  function sheet(html) {
    const bg = document.createElement("div"); bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
    bg.onclick = (e) => { if (e.target === bg) { bg.classList.add("closing"); setTimeout(() => bg.remove(), 180); } };
    document.body.appendChild(bg); return bg;
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
  let rec = null;
  async function toggleVoice() {
    const btn = $("#bsend");
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast(isIOS && !standalone ? "Voice notes work in the Home Screen app" : "This browser can't record");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const chunks = []; rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
      const started = Date.now(), tick = setInterval(() => { btn.textContent = "■ " + Math.floor((Date.now() - started) / 1000) + "s"; }, 500);
      btn.classList.add("rec"); btn.textContent = "■";
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); btn.classList.remove("rec"); window.growComposer();
        const mime = (rec.mimeType || "audio/mp4").split(";")[0]; rec = null;
        if (Date.now() - started < 800) return toast("Tap the mic, talk, then tap ■ to send");
        sendFile(new File([new Blob(chunks, { type: mime })], `voice.${mime.includes("mp4") ? "m4a" : "webm"}`, { type: mime }), "voice");
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
      <div class="chips tabs"><button data-t="home" class="on">Overview</button><button data-t="users">People</button><button data-t="inv">Invites</button></div>
      <div class="page-body" id="adm"></div>`;
    document.body.appendChild(page);
    $("#pBack", page).onclick = () => { page.classList.add("closing"); setTimeout(() => page.remove(), 200); };
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
    S.me = null; S.convs = []; S.msgs = {}; S.cur = null; $$("#pwgate").forEach((g) => g.remove());
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

  // ------------------------------------------------------------------ start
  async function start() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
    if (!TOKEN) return authScreen();
    S.me = S.me || store.get("cache", {}).me || null;
    if (!S.me) { try { S.me = await api("/api/me"); } catch (e) { if (!TOKEN) return; return authScreen(); } }
    cacheLoad(); shell(); connect(); pwGate(); reportDevice();
    toAfra({ type: "ready", me: { username: S.me.username, name: S.me.name } });
    const want = +(new URLSearchParams(location.hash.slice(1)).get("c") || 0);
    if (want) setTimeout(() => conv(want) && openConv(want), 400);
    if ("Notification" in window && Notification.permission === "granted") enablePush(false);
  }
  document.addEventListener("visibilitychange", () => {
    sendVis();
    if (isVisible() && TOKEN && S.me) {
      autoWhere();
      if (!WS || WS.readyState > 1) connect(); else resync();
      if (S.cur && conv(S.cur) && conv(S.cur).unread) markRead(S.cur);
    }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open) openConv(+e.data.open); });
  start().catch((e) => { app.innerHTML = `<div class="setup"><h1>A.F.R.A ♥</h1><p>Something went wrong: ${esc(e.message)}</p></div>`; });
})();
