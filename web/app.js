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
  const S = { me: null, convs: [], msgs: {}, cur: null, view: "list", typing: {}, filter: "", search: "", reply: null, edit: null, older: {}, seen: {} };
  const app = $("#app");
  const REACTIONS = ["❤️", "🥰", "😂", "😮", "😢", "🙏", "👍", "🔥"];
  const EMOJIS = "❤️ 🥰 😘 😍 🤗 😊 😁 😂 🥹 😭 😢 🥺 😴 🤔 😮 😎 🙈 🙏 👍 👏 💪 🎉 ✨ 🔥 💯 🌹 🌸 🌙 ☀️ ☕ 🍜 🍦 📚 ✍️ 🎓 💌 💖 💕 💞 💗 🤍 💛 💙 🫶 👀 😅 🙃 😌".split(" ");
  const COLORS = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#978365"];
  const conv = (id) => S.convs.find((c) => c.id === id);
  const other = (c) => (c && c.members && c.members[0]) || null;
  const title = (c) => !c ? "" : c.kind === "self" ? "Notes to self" : (other(c) ? other(c).name || "@" + other(c).username : "Chat");
  const userById = (id) => id === S.me.id ? S.me : S.convs.flatMap((c) => c.members).find((u) => u.id === id);

  function avatar(u, cls = "", self = false) {
    if (self) return `<div class="av ${cls}" style="background:var(--field)">📝</div>`;
    if (!u) return `<div class="av ${cls}">?</div>`;
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
  const preview = (m) => !m ? "" : m.deleted ? "Message deleted" : m.text || { image: "📷 Photo", voice: "🎤 Voice note", file: "📎 " + ((m.attachment || {}).name || "File") }[m.kind] || "";

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
          if (isVisible()) { sound(S.cur === c.id ? "recv" : "ping"); if (S.cur !== c.id) inAppNotice(c, e.msg); }
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
      drawList();    } else if (e.t === "conv_gone") {  // the admin deleted the other person's account
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
          <button class="icon" id="bAdmin" title="Admin" hidden>🛡</button></div>
        <div id="banner"></div>
        <div class="list-tools"><input type="search" id="lq" placeholder="Search chats"></div>
        <div class="convs" id="convs"></div>
        <button class="fab" id="bNew" title="New chat" aria-label="New chat"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z"/><path d="M12 8v7M8.5 11.5h7"/></svg></button>
      </section>
      <section class="pane-chat" id="chatPane"></section>`;
    $("#bNew").onclick = newChat; $("#bAdmin").onclick = adminPage; $("#meAv").onclick = profileSheet;
    $("#lq").oninput = (e) => { S.filter = e.target.value.trim().toLowerCase(); drawList(); };
    setView(S.view); drawAll(); drawBanner();
  }
  function setView(v) { if (S.view !== v) { app.classList.remove("slide"); void app.offsetWidth; app.classList.add("slide"); } S.view = v; app.dataset.view = v; }
  function drawAll() { if (!$("#convs")) return; $("#greet").innerHTML = greeting(); $("#meAv").innerHTML = avatar(S.me, "sm"); $("#bAdmin").hidden = !S.me.is_admin; drawList(); drawChatPane(); badge(); }

  function drawList(bumpId) {
    const el = $("#convs"); if (!el) return;
    const before = {}; $$(".conv", el).forEach((d) => { before[d.dataset.c] = d.getBoundingClientRect().top; });
    if (!S.convs.length && !LOADED) { el.innerHTML = [1, 2, 3, 4].map(() => `<div class="skeleton"><i style="width:44px;height:44px;border-radius:50%"></i><span style="flex:1"><i style="width:45%;height:13px;margin-bottom:8px"></i><i style="width:75%;height:11px"></i></span></div>`).join(""); return; }
    const t = now();
    const items = S.convs.filter((c) => !S.filter || title(c).toLowerCase().includes(S.filter) || (other(c) && other(c).username.includes(S.filter)));
    el.innerHTML = items.map((c) => {
      const u = other(c), typing = (S.typing[c.id] || 0) > t;
      const last = c.last ? (c.last.sender === S.me.id && c.kind !== "self" ? "You: " : "") + preview(c.last) : c.kind === "self" ? "Keep notes, links and photos for yourself" : "Say hi 👋";
      return `<div class="conv ${S.cur === c.id ? "on" : ""}" data-c="${c.id}">
        <div class="av-wrap ${u && u.online ? "on" : ""}">${avatar(u, "", c.kind === "self")}</div>
        <div class="mid"><div class="row1"><b>${esc(title(c))}</b><small>${c.last ? shortTime(c.last.created) : ""}</small></div>
          <div class="row2"><span class="${typing ? "typing" : ""}">${typing ? "typing…" : esc(last)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ""}</div></div></div>`;
    }).join("") || `<div class="empty">No chats yet.<br><small>Tap 💬 at the bottom right to start one.</small></div>`;
    $$(".conv", el).forEach((d) => {
      d.onclick = () => openConv(+d.dataset.c);
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
        <button class="icon" id="bSearch" title="Search">🔍</button></div>
      <div class="searchbar" id="sbar" hidden><input type="search" id="sq" placeholder="Search in this chat"><button class="cbtn" id="sclose">✕</button></div>
      <div class="log" id="log"></div>
      <div class="typing-line" id="typing"></div>
      <div id="replybar"></div>
      <div class="quick" id="quick"></div>
      <div class="compose">
        <button class="cbtn" id="btpl" title="Quick messages">💌</button>
        <button class="cbtn" id="bemoji" title="Emoji">😊</button>
        <textarea id="txt" rows="1" placeholder="Message"></textarea>
        <button class="cbtn" id="battach" title="Photo or file">📎</button>
        <button class="cbtn send" id="bsend" title="Send">🎤</button>
        <input type="file" id="file" hidden>
      </div>`;
    $("#bBack").onclick = () => { S.cur = null; setView("list"); history.replaceState(null, "", location.pathname); drawList(); };
    $("#bSearch").onclick = () => { $("#sbar").hidden = false; $("#sq").focus(); };
    $("#sclose").onclick = () => { $("#sbar").hidden = true; S.search = ""; drawChat(); };
    $("#sq").oninput = (e) => { S.search = e.target.value.trim().toLowerCase(); drawChat(); };
    const txt = $("#txt");
    const grow = () => {
      txt.style.height = "auto"; txt.style.height = Math.min(txt.scrollHeight, 140) + "px";
      const typed = !!(txt.value.trim() || S.edit), b = $("#bsend");
      if (b.dataset.mode !== (typed ? "send" : "mic")) { b.dataset.mode = typed ? "send" : "mic"; b.textContent = typed ? "➤" : "🎤"; b.classList.remove("swap"); void b.offsetWidth; b.classList.add("swap"); }
      $("#quick").classList.toggle("hide", typed);
    };
    let lastTyping = 0;
    txt.oninput = () => { grow(); if (txt.value && now() - lastTyping > 3 && c.kind !== "self") { lastTyping = now(); api(`/api/convs/${c.id}/typing`, { body: {} }).catch(() => { }); } };
    txt.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); sendText(); } if (e.key === "Escape") { S.reply = S.edit = null; drawReply(); } };
    $("#bsend").onclick = () => (txt.value.trim() || S.edit) ? sendText() : toggleVoice();
    $("#battach").onclick = () => $("#file").click();
    $("#file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) sendFile(f); };
    $("#btpl").onclick = openTemplates; $("#bemoji").onclick = openEmoji;
    window.growComposer = grow; grow(); drawQuick();
    drawHeader(); drawChat(); scrollEnd(true);
    if (focus && !matchMedia("(pointer: coarse)").matches) txt.focus();
  }

  async function drawQuick() {  // one tap sends: a heart, a hug, a few love notes (new ones each time), surprise
    const el = $("#quick"); if (!el) return;
    const tpl = await loadTemplates(), all = tplPool(tpl.categories || []).filter(([, t]) => t.length <= 46);
    const picks = [];
    while (picks.length < 4 && all.length) picks.push(all.splice(pickWeighted(all), 1)[0][1]);
    const chips = ["❤️", "🥰", "🤗", ...picks];
    el.innerHTML = chips.map((t, i) => `<button data-q="${i}" class="${t.length <= 3 ? "emo" : ""}">${esc(t)}</button>`).join("") + `<button data-q="more" title="More messages">💌 More</button>`;
    $$("[data-q]", el).forEach((b) => b.onclick = () => {
      if (b.dataset.q === "more") return openTemplates();
      b.classList.add("sent"); setTimeout(() => b.classList.remove("sent"), 400);
      send({ text: chips[+b.dataset.q], reply_to: S.reply ? S.reply.id : null }); S.reply = null; drawReply();
      if (chips[+b.dataset.q].length > 3) setTimeout(drawQuick, 500);  // fresh suggestions
    });
  }

  function drawHeader() {
    const c = conv(S.cur); if (!c || !$("#chatName")) return;
    const u = other(c), typing = (S.typing[c.id] || 0) > now();
    $("#chatAv").innerHTML = `<div class="av-wrap ${u && u.online ? "on" : ""}">${avatar(u, "sm", c.kind === "self")}</div>`;
    $("#chatName").textContent = title(c);
    const st = $("#chatStat");
    st.textContent = !LIVE ? "connecting…" : c.kind === "self" ? "only you can see this" : typing ? "typing…" : [lastSeen(u), u ? "@" + u.username : ""].filter(Boolean).join("  ·  ");
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
      const rx = Object.entries(m.reactions || {});
      const read = c.kind !== "self" && (c.other_read || 0) >= m.created;
      const ticks = mine && !m.deleted && c.kind !== "self" ? `<span class="ticks ${read ? "read" : ""}">${m.pending ? "🕓" : read ? "✓✓" : "✓"}</span>` : (m.pending ? "🕓" : "");
      const key = m.client_id || m.id; fresh.add(key);
      const pop = seen && !seen.has(key) ? "pop" : "";
      html += `<div class="msg ${mine ? "mine" : ""} ${m.pending ? "pending" : ""} ${pop}" data-id="${m.id || ""}" data-cid="${esc(m.client_id || "")}">
        <div class="bub ${m.deleted ? "deleted" : ""}">${bubbleBody(m, list)}</div>
        ${rx.length ? `<div class="reacts">${rx.map(([uid, e]) => `<span title="${esc((userById(+uid) || {}).name || "")}">${esc(e)}</span>`).join("")}</div>` : ""}
        <div class="meta">${m.edited && !m.deleted ? "edited · " : ""}${fmtTime(m.created)} ${ticks}</div></div>`;
    }
    log.innerHTML = html + (list.length ? "" : `<div class="empty">${c.kind === "self" ? "Your private notes: only you can see this chat." : `Say hi to ${esc(title(c))} 👋<br><small>💌 has ready-made messages.</small>`}</div>`);
    const older = $("#bOlder"); if (older) older.onclick = loadOlder;
    $$("img.photo", log).forEach((img) => img.onclick = (e) => { e.stopPropagation(); const v = document.createElement("div"); v.className = "viewer"; v.innerHTML = `<img src="${img.dataset.full}">`; v.onclick = () => v.remove(); document.body.appendChild(v); });
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
      if (e.target.closest("a,audio,img,.quote")) return;
      const t = Date.now(); if (t - lastTap < 320) { bigHeart(e.clientX, e.clientY); if ((findMsg(id) || {}).reactions?.[S.me.id] !== "❤️") react(id, "❤️"); lastTap = 0; } else lastTap = t;
    });
  }
  const findMsg = (id) => (S.msgs[S.cur] || []).find((m) => m.id === id);
  const react = (id, e) => {
    const m = findMsg(id), removing = m && (m.reactions || {})[S.me.id] === e;
    if (!removing) burstAt($(`.msg[data-id="${id}"] .bub`), e);
    return api(`/api/messages/${id}/react`, { body: { emoji: e } }).then(upsert).then(drawChat).catch((x) => toast(x.message));
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
    const s = sheet(`<div class="menu"><div class="rx">${REACTIONS.map((r) => `<button data-rx="${r}" class="${myRx === r ? "on" : ""}">${r}</button>`).join("")}</div>
      <button data-a="reply">↩️ Reply</button>${m.text ? `<button data-a="copy">📋 Copy</button>` : ""}
      ${mine && m.text && !m.attachment ? `<button data-a="edit">✏️ Edit</button>` : ""}${mine ? `<button data-a="delete" class="danger">🗑 Delete for everyone</button>` : ""}</div>`);
    $$("[data-rx]", s).forEach((b) => b.onclick = () => { s.remove(); react(id, b.dataset.rx); });
    $$("[data-a]", s).forEach((b) => b.onclick = async () => {
      s.remove(); const a = b.dataset.a;
      if (a === "reply") { S.reply = m; S.edit = null; drawReply(); $("#txt").focus(); }
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
  async function sendFile(file, kind) {
    try {
      if (file.size > 30 * 1048576) return toast("Files up to 30 MB");
      const image = !kind && /^image\//.test(file.type);
      const f = image ? await shrinkImage(file) : file;
      const cid = S.cur, temp = { id: 0, conv_id: cid, sender: S.me.id, client_id: rid(), kind: kind || (image ? "image" : "file"), text: "", attachment: { local: true, name: f.name }, reactions: {}, created: now(), pending: true };
      upsert(temp); drawChat(); scrollEnd(true);
      const fd = new FormData(); fd.append("file", f, f.name);
      const att = await api("/api/files", { body: fd });
      S.msgs[cid] = (S.msgs[cid] || []).filter((m) => m !== temp);
      const prevCur = S.cur; S.cur = cid; await send({ kind: temp.kind, attachment: att, reply_to: S.reply ? S.reply.id : null }); S.cur = prevCur;
      S.reply = null; drawReply();
    } catch (e) { toast("Couldn't send: " + e.message); }
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

  function profileSheet() {
    const pushOn = "Notification" in window && Notification.permission === "granted";
    const s = sheet(`<div style="text-align:center"><label style="cursor:pointer;display:inline-block">${avatar(S.me, "lg")}<input type="file" id="pav" accept="image/*" hidden></label>
        <div style="font:600 20px var(--serif);margin-top:8px">${esc(S.me.name)}</div><div style="color:var(--muted)">@${esc(S.me.username)}${S.me.is_admin ? ` <span class="pill gold">admin</span>` : ""}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px">Tap your photo to change it. Others add you by your username.</div></div>
      <h4>Profile</h4>
      <div class="field"><label>Name</label><input class="inp" id="pname" value="${esc(S.me.name)}"></div>
      <div class="field"><label>Username</label><input class="inp" id="puser" value="${esc(S.me.username)}" autocapitalize="none" autocorrect="off"></div>
      <button class="big-btn" id="psave">Save</button><div class="err" id="perr"></div>
      <h4>Notifications</h4>
      ${isIOS && !standalone ? `<div class="note warn">📲 On iPhone, notifications work in the Home Screen app: tap <b>Share</b> ⬆ → <b>Add to Home Screen</b>, then open A.F.R.A ♥ from its icon.</div>`
        : `<div class="row"><button class="sbtn" id="ppush">${pushOn ? "✓ On" : "Turn on"}</button>${pushOn ? `<button class="sbtn" id="ptest">Send me a test</button>` : ""}</div>`}
      <h4>Sounds</h4>
      <label class="row" style="font-size:15px"><input type="checkbox" id="psound" ${store.get("sound", true) ? "checked" : ""}> Soft sounds when sending and receiving</label>
      <h4>Password</h4>
      <div class="field"><input class="inp" type="password" id="pold" placeholder="Current password" autocomplete="current-password"></div>
      <div class="field"><input class="inp" type="password" id="pnew" placeholder="New password" autocomplete="new-password"></div>
      <button class="sbtn" id="ppw" style="margin-top:8px">Change password</button>
      <h4>This device</h4>
      <button class="item danger" id="pout">Log out</button>`);
    $("#pav", s).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const sq = await shrinkImage(f, 384, true); const fd = new FormData(); fd.append("file", sq, "avatar.jpg"); S.me = await api("/api/me/avatar", { body: fd }); s.remove(); drawAll(); profileSheet(); toast("Photo updated"); }
      catch (x) { toast(x.message); }
    };
    $("#psave", s).onclick = async () => {
      try { S.me = await api("/api/me", { method: "PATCH", body: { name: $("#pname", s).value, username: $("#puser", s).value } }); s.remove(); drawAll(); toast("Saved"); }
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
              <small>${u.online ? "online" : esc(lastSeen(u) || "never online")} · ${u.devices} device${u.devices === 1 ? "" : "s"}</small></div>
              ${u.id === S.me.id ? "" : `<button class="sbtn" data-chat="${esc(u.username)}">💬</button><button class="sbtn" data-more="${u.id}">⋯</button>`}</div>`).join("");
          $$("[data-chat]", el).forEach((b) => b.onclick = async () => { const c = await api("/api/convs", { body: { username: b.dataset.chat } }); page.remove(); addConv(c); openConv(c.id); });
          $$("[data-more]", el).forEach((b) => b.onclick = () => {
            const u = users.find((x) => x.id === +b.dataset.more);
            const m = sheet(`<h3>${esc(u.name)} <small style="color:var(--muted)">@${esc(u.username)}</small></h3><div class="menu">
              <button data-x="reset">🔑 Password reset code</button><button data-x="admin">${u.is_admin ? "Remove admin" : "🛡 Make admin"}</button>
              <button data-x="off" class="${u.disabled ? "" : "danger"}">${u.disabled ? "✓ Switch account back on" : "Switch account off (logs them out)"}</button>
              <button data-x="delete" class="danger">🗑 Delete account…</button></div><div id="mout"></div>`);
            $$("[data-x]", m).forEach((x) => x.onclick = async () => {
              try {
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
      await api("/api/push", { body: { sub: sub.toJSON(), device: DEVICE } });
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
  function authScreen(mode) {
    const h = new URLSearchParams(location.hash.slice(1));
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

  // ------------------------------------------------------------------ start
  async function start() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
    if (!TOKEN) return authScreen();
    S.me = S.me || store.get("cache", {}).me || null;
    if (!S.me) { try { S.me = await api("/api/me"); } catch (e) { if (!TOKEN) return; return authScreen(); } }
    cacheLoad(); shell(); connect(); pwGate();
    toAfra({ type: "ready", me: { username: S.me.username, name: S.me.name } });
    const want = +(new URLSearchParams(location.hash.slice(1)).get("c") || 0);
    if (want) setTimeout(() => conv(want) && openConv(want), 400);
    if ("Notification" in window && Notification.permission === "granted") enablePush(false);
  }
  document.addEventListener("visibilitychange", () => {
    sendVis();
    if (isVisible() && TOKEN && S.me) {
      if (!WS || WS.readyState > 1) connect(); else resync();
      if (S.cur && conv(S.cur) && conv(S.cur).unread) markRead(S.cur);
    }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open) openConv(+e.data.open); });
  start().catch((e) => { app.innerHTML = `<div class="setup"><h1>A.F.R.A ♥</h1><p>Something went wrong: ${esc(e.message)}</p></div>`; });
})();
