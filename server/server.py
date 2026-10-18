"""A.F.R.A ♥ chat server: a small private social chat on your own server.

Accounts with usernames, display names and profile photos; invite-only sign-up (the admin makes invite codes);
one chat per person plus "Notes to self"; text, photos, files, voice notes, replies, reactions, edits, deletes,
typing, online status and read ticks; Web Push notifications that show the sender's name and message (encrypted for
the phone on the way, RFC 8291, so Apple/Google's push services can't read them).

One file, SQLite, FastAPI. Run:  uvicorn server:app --port 8090   (see deploy/install.sh)
Admin invite:  python server.py invite --admin        (also printed at first start when there are no users)
(c) 2026 danafarmansyah. All rights reserved. Crafted with love.
"""
import asyncio
import base64
import csv
import io
import tempfile
import zipfile
from html import escape as hesc
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response

DATA = Path(os.environ.get("CHAT_DATA", Path(__file__).resolve().parent.parent / "data"))
WEB = Path(os.environ.get("WEB_DIR", Path(__file__).resolve().parent.parent / "web"))
FILES = DATA / "files"
DB = DATA / "chat.db"
CONTACT = os.environ.get("PUSH_CONTACT", "mailto:afra@localhost")
MAX_FILE = int(os.environ.get("MAX_FILE_MB", "30")) * 1024 * 1024
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._]{2,19}$")
for d in (DATA, FILES, DATA / "backups"):
    d.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, pw TEXT, avatar TEXT DEFAULT '',
  is_admin INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, created REAL, last_seen REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, device TEXT, created REAL, last_used REAL);
CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, created_by INTEGER, note TEXT DEFAULT '', admin INTEGER DEFAULT 0,
  created REAL, used_by INTEGER, used_at REAL, kind TEXT DEFAULT 'invite');
CREATE TABLE IF NOT EXISTS convs (id INTEGER PRIMARY KEY, kind TEXT, key TEXT UNIQUE, created REAL, last_at REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS members (conv_id INTEGER, user_id INTEGER, last_read REAL DEFAULT 0, PRIMARY KEY (conv_id, user_id));
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER, sender INTEGER, client_id TEXT,
  kind TEXT DEFAULT 'text', text TEXT DEFAULT '', reply_to INTEGER, attachment TEXT DEFAULT '', reactions TEXT DEFAULT '{}',
  created REAL, edited REAL DEFAULT 0, deleted INTEGER DEFAULT 0, updated REAL);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client ON messages(sender, client_id);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner INTEGER, name TEXT, mime TEXT, size INTEGER, created REAL);
CREATE TABLE IF NOT EXISTS pushes (endpoint TEXT PRIMARY KEY, user_id INTEGER, device TEXT, sub TEXT, created REAL);
"""


def db():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


with closing(db()) as _c:
    _c.execute("PRAGMA journal_mode=WAL")
    _c.executescript(SCHEMA)
    if "info" not in [r[1] for r in _c.execute("PRAGMA table_info(sessions)")]:  # what each logged-in device is (added later)
        _c.execute("ALTER TABLE sessions ADD COLUMN info TEXT DEFAULT ''")
    _c.commit()

app = FastAPI(title="A.F.R.A chat", docs_url=None, redoc_url=None, openapi_url=None)
SOCKETS: dict[int, dict[str, dict]] = {}  # user id -> device -> {"ws": WebSocket, "visible": bool}


@app.exception_handler(ValueError)
async def _value_error(_, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


# ---------------------------------------------------------------- passwords, sessions, rate limits
def hash_pw(pw: str) -> str:
    """Store the password as plain Base64. NOTE: this is encoding, not hashing - it is trivially reversible."""
    return base64.b64encode(pw.encode()).decode()


COMMON_PW = {"password", "passwrd", "qwerty", "iloveyou", "letmein", "welcome", "admin", "abc", "monkey", "dragon",
             "sunshine", "princess", "football", "baseball", "master", "superman", "trustno", "loveyou", "mylove"}


def pw_problem(pw: str, username: str = "") -> str:
    """The usual password rules (Instagram, Google, banks); an empty string means the password is fine."""
    missing = [w for ok, w in [(len(pw) >= 8, "8 characters"), (re.search(r"[A-Z]", pw), "a capital letter"),
                               (re.search(r"[a-z]", pw), "a small letter"), (re.search(r"[0-9]", pw), "a number"),
                               (re.search(r"[^A-Za-z0-9\s]", pw), "a symbol like ! ? # @")] if not ok]
    if missing:
        return "Password needs at least " + ", ".join(missing) + "."
    if username and len(username) >= 3 and username.lower() in pw.lower():
        return "Password can't contain your username."
    if re.sub(r"[^a-z]", "", pw.lower().replace("0", "o").replace("@", "a").replace("$", "s")) in COMMON_PW:
        return "That password is too easy to guess. Try something less common."
    return ""


def needs_new_pw(u) -> bool:
    """True when the saved password doesn't meet the rules above (older accounts): the app asks them to change it.
    Only reads the stored password; storage stays as it is."""
    if u["pw"].startswith("scrypt$"):
        return True
    try:
        return bool(pw_problem(base64.b64decode(u["pw"], validate=True).decode(), u["username"]))
    except (ValueError, UnicodeDecodeError):
        return True


def check_pw(pw: str, stored: str) -> bool:
    try:
        if stored.startswith("scrypt$"):  # accounts made before the switch; changed to Base64 at their next login
            _, salt, h = stored.split("$")
            return hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1).hex() == h
        return base64.b64decode(stored, validate=True).decode() == pw
    except (ValueError, UnicodeDecodeError):
        return False


def _th(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(c, user_id: int, device: str) -> str:
    token = secrets.token_urlsafe(32)
    c.execute("INSERT INTO sessions (token, user_id, device, created, last_used) VALUES (?,?,?,?,?)", (_th(token), user_id, device[:60], time.time(), time.time()))
    return token


def user_for(token: str | None) -> sqlite3.Row:
    if not token:
        raise HTTPException(401, "Please log in")
    with closing(db()) as c:
        r = c.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?""", (_th(token),)).fetchone()
        if not r or r["disabled"]:
            raise HTTPException(401, "Please log in again")
        c.execute("UPDATE sessions SET last_used=? WHERE token=?", (time.time(), _th(token)))
        c.commit()
    return r


def auth(authorization: str | None) -> sqlite3.Row:
    return user_for((authorization or "").removeprefix("Bearer ").strip())


def admin(authorization: str | None) -> sqlite3.Row:
    u = auth(authorization)
    if not u["is_admin"]:
        raise HTTPException(403, "Admins only")
    return u


ATTEMPTS: dict[str, list[float]] = {}


def throttle(key: str):
    now = time.time()
    tries = [t for t in ATTEMPTS.get(key, []) if now - t < 600]
    if len(tries) >= 8:
        raise HTTPException(429, "Too many tries. Wait 10 minutes.")
    ATTEMPTS[key] = tries + [now]


def public(u) -> dict:
    online = bool(SOCKETS.get(u["id"]))
    return {"id": u["id"], "username": u["username"], "name": u["name"], "avatar": u["avatar"], "is_admin": bool(u["is_admin"]),
            "online": online, "last_seen": time.time() if online else u["last_seen"]}


def make_code(c, kind="invite", admin_=0, by=None, note="") -> str:
    code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
    c.execute("INSERT INTO invites (code, created_by, note, admin, created, kind) VALUES (?,?,?,?,?,?)",
              (code, by, note[:80], admin_, time.time(), kind))
    return code


# ---------------------------------------------------------------- accounts
@app.post("/api/signup")
def signup(body: dict, request: Request):
    throttle("signup:" + (request.client.host if request.client else ""))
    code = (body.get("invite") or "").strip().upper()
    username = (body.get("username") or "").strip().lower().lstrip("@")
    name = (body.get("name") or "").strip()[:40] or username
    pw = body.get("password") or ""
    if not USERNAME.match(username):
        raise ValueError("Username: 3–20 letters, numbers, dots or underscores, starting with a letter or number.")
    if pw_problem(pw, username):
        raise ValueError(pw_problem(pw, username))
    with closing(db()) as c:
        inv = c.execute("SELECT * FROM invites WHERE code=? AND kind='invite'", (code,)).fetchone()
        if not inv or inv["used_by"]:
            raise ValueError("That invite code isn't valid (or was already used). Ask for a new one.")
        if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise ValueError(f"@{username} is taken. Try another username.")
        cur = c.execute("INSERT INTO users (username, name, pw, is_admin, created) VALUES (?,?,?,?,?)",
                        (username, name, hash_pw(pw), inv["admin"], time.time()))
        uid = cur.lastrowid
        c.execute("UPDATE invites SET used_by=?, used_at=? WHERE code=?", (uid, time.time(), code))
        if inv["created_by"]:  # start the chat with whoever invited you
            _conv(c, [uid, inv["created_by"]])
        token = new_session(c, uid, body.get("device") or "device")
        c.commit()
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return {"token": token, "user": public(u)}


@app.post("/api/login")
def login(body: dict, request: Request):
    username = (body.get("username") or "").strip().lower().lstrip("@")
    throttle("login:" + username)
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not u or not check_pw(body.get("password") or "", u["pw"]):
            raise HTTPException(401, "Wrong username or password.")
        if u["disabled"]:
            raise HTTPException(403, "This account is switched off. Ask the admin.")
        if u["pw"].startswith("scrypt$"):
            c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(body["password"]), u["id"]))
        token = new_session(c, u["id"], body.get("device") or "device")
        c.commit()
    ATTEMPTS.pop("login:" + username, None)
    return {"token": token, "user": {**public(u), "needs_new_pw": bool(pw_problem(body["password"], u["username"]))}}


@app.post("/api/reset")
def reset(body: dict, request: Request):
    """Set a new password with a reset code from the admin."""
    throttle("reset:" + (request.client.host if request.client else ""))
    code = (body.get("code") or "").strip().upper()
    with closing(db()) as c:
        inv = c.execute("SELECT * FROM invites WHERE code=? AND kind='reset' AND used_at IS NULL", (code,)).fetchone()
        if not inv or time.time() - inv["created"] > 7 * 86400:
            raise ValueError("That reset code isn't valid any more. Ask the admin for a new one.")
        uid = int(inv["note"])
        who = c.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        bad = pw_problem(body.get("password") or "", who["username"] if who else "")
        if bad:
            raise ValueError(bad)
        c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(body["password"]), uid))
        c.execute("UPDATE invites SET used_by=?, used_at=? WHERE code=?", (uid, time.time(), code))
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        token = new_session(c, uid, body.get("device") or "device")
        c.commit()
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return {"token": token, "user": public(u)}


@app.post("/api/logout")
def logout(authorization: str = Header(None)):
    with closing(db()) as c:
        c.execute("DELETE FROM sessions WHERE token=?", (_th((authorization or "").removeprefix("Bearer ").strip()),))
        c.commit()
    return {"ok": True}


@app.get("/api/me")
def me(authorization: str = Header(None)):
    u = auth(authorization)
    return {**public(u), "needs_new_pw": needs_new_pw(u)}


@app.patch("/api/me")
async def update_me(body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        if "name" in body:
            c.execute("UPDATE users SET name=? WHERE id=?", ((body["name"] or "").strip()[:40] or u["username"], u["id"]))
        if body.get("username") and body["username"].lower().lstrip("@") != u["username"]:
            new = body["username"].strip().lower().lstrip("@")
            if not USERNAME.match(new):
                raise ValueError("Username: 3–20 letters, numbers, dots or underscores.")
            if c.execute("SELECT 1 FROM users WHERE username=?", (new,)).fetchone():
                raise ValueError(f"@{new} is taken.")
            c.execute("UPDATE users SET username=? WHERE id=?", (new, u["id"]))
        if body.get("new_password"):
            if not check_pw(body.get("password") or "", u["pw"]):
                raise ValueError("Your current password isn't right.")
            if pw_problem(body["new_password"], u["username"]):
                raise ValueError(pw_problem(body["new_password"], u["username"]))
            c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(body["new_password"]), u["id"]))
        c.commit()
        nu = c.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    await announce_profile(nu)
    return {**public(nu), "needs_new_pw": needs_new_pw(nu)}


@app.post("/api/me/avatar")
async def set_avatar(file: UploadFile = File(...), authorization: str = Header(None)):
    u = auth(authorization)
    data = await file.read()
    if len(data) > 3 * 1024 * 1024 or not (file.content_type or "").startswith("image/"):
        raise ValueError("Choose a photo (the app shrinks it for you).")
    fid = secrets.token_hex(12)
    (FILES / fid).write_bytes(data)
    with closing(db()) as c:
        c.execute("INSERT INTO files VALUES (?,?,?,?,?,?)", (fid, u["id"], "avatar", file.content_type, len(data), time.time()))
        c.execute("UPDATE users SET avatar=? WHERE id=?", (fid, u["id"]))
        c.commit()
        nu = c.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    await announce_profile(nu)
    return {**public(nu), "needs_new_pw": needs_new_pw(nu)}


@app.get("/api/users/search")
def search_users(q: str = "", authorization: str = Header(None)):
    """People whose username or name matches what you type (for starting a chat)."""
    u = auth(authorization)
    q = q.strip().lower().lstrip("@")
    if len(q) < 1:
        return []
    with closing(db()) as c:
        rows = c.execute("""SELECT * FROM users WHERE disabled=0 AND id<>? AND (username LIKE ? OR lower(name) LIKE ?)
                            ORDER BY (username LIKE ?) DESC, username LIMIT 8""", (u["id"], f"%{q}%", f"%{q}%", f"{q}%")).fetchall()
    return [public(r) for r in rows]


@app.get("/api/users/{username}")
def find_user(username: str, authorization: str = Header(None)):
    auth(authorization)
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE username=? AND disabled=0", (username.strip().lower().lstrip("@"),)).fetchone()
    if not u:
        raise HTTPException(404, f"Nobody is called @{username.strip().lstrip('@')} here.")
    return public(u)


# ---------------------------------------------------------------- conversations
def _conv(c, user_ids: list[int]) -> int:
    ids = sorted(set(user_ids))
    kind = "self" if len(ids) == 1 else "direct"
    key = kind + ":" + ",".join(map(str, ids))
    r = c.execute("SELECT id FROM convs WHERE key=?", (key,)).fetchone()
    if r:
        return r["id"]
    cid = c.execute("INSERT INTO convs (kind, key, created, last_at) VALUES (?,?,?,?)", (kind, key, time.time(), time.time())).lastrowid
    for i in ids:
        c.execute("INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (cid, i, time.time()))
    return cid


def _member(c, cid: int, uid: int):
    if not c.execute("SELECT 1 FROM members WHERE conv_id=? AND user_id=?", (cid, uid)).fetchone():
        raise HTTPException(404, "Chat not found")


def conv_view(c, cid: int, uid: int) -> dict:
    cv = c.execute("SELECT * FROM convs WHERE id=?", (cid,)).fetchone()
    others = [public(r) for r in c.execute("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.conv_id=? AND u.id<>?", (cid, uid))]
    mine = c.execute("SELECT last_read FROM members WHERE conv_id=? AND user_id=?", (cid, uid)).fetchone()
    last = c.execute("SELECT * FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
    unread = c.execute("SELECT COUNT(*) FROM messages WHERE conv_id=? AND sender<>? AND deleted=0 AND created>?",
                       (cid, uid, mine["last_read"] if mine else 0)).fetchone()[0]
    other_read = max([r["last_read"] for r in c.execute("SELECT last_read FROM members WHERE conv_id=? AND user_id<>?", (cid, uid))] or [0])
    return {"id": cid, "kind": cv["kind"], "members": others, "last": msg_view(last) if last else None, "unread": unread,
            "last_at": cv["last_at"], "other_read": other_read}


def msg_view(m) -> dict:
    d = dict(m)
    d["attachment"] = json.loads(d["attachment"]) if d["attachment"] else None
    d["reactions"] = json.loads(d["reactions"] or "{}")
    d["deleted"] = bool(d["deleted"])
    if d["deleted"]:
        d.update(text="", attachment=None, reactions={})
    return d


@app.get("/api/convs")
def list_convs(authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _conv(c, [u["id"]])  # Notes to self always exists
        c.commit()
        ids = [r["conv_id"] for r in c.execute("SELECT conv_id FROM members WHERE user_id=?", (u["id"],))]
        convs = [conv_view(c, i, u["id"]) for i in ids]
    return sorted(convs, key=lambda v: -(v["last_at"] or 0))


@app.post("/api/convs")
async def open_conv(body: dict, authorization: str = Header(None)):
    """Start (or reopen) a chat with someone by username. No request to accept: you can talk right away."""
    u = auth(authorization)
    with closing(db()) as c:
        if body.get("self"):
            cid = _conv(c, [u["id"]])
        else:
            other = c.execute("SELECT * FROM users WHERE username=? AND disabled=0", ((body.get("username") or "").strip().lower().lstrip("@"),)).fetchone()
            if not other:
                raise HTTPException(404, f"Nobody is called @{(body.get('username') or '').strip().lstrip('@')} here.")
            cid = _conv(c, [u["id"], other["id"]])
        c.commit()
        view = conv_view(c, cid, u["id"])
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
    for m in members:
        if m != u["id"]:
            with closing(db()) as c:
                await send_to(m, {"t": "conv", "conv": conv_view(c, cid, m)})
    return view


@app.get("/api/convs/{cid}/messages")
def get_messages(cid: int, before: int = 0, since: float = 0, limit: int = 60, authorization: str = Header(None)):
    """Newest messages (or older ones with `before`), or everything new or changed since a time (reconnecting phones)."""
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        if since:
            rows = c.execute("SELECT * FROM messages WHERE conv_id=? AND updated>? ORDER BY id LIMIT 1000", (cid, since)).fetchall()
        else:
            rows = c.execute("SELECT * FROM messages WHERE conv_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?",
                             (cid, before, before, min(limit, 200))).fetchall()[::-1]
        view = conv_view(c, cid, u["id"])
    return {"conv": view, "messages": [msg_view(r) for r in rows]}


@app.post("/api/convs/{cid}/messages")
async def send_message(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    if needs_new_pw(u):  # the app shows the "choose a stronger password" screen; queued messages wait and go out after
        raise HTTPException(403, "Please choose a stronger password first (8+ characters with a capital letter, a small letter, a number and a symbol).")
    text = (body.get("text") or "").strip()[:8000]
    att = body.get("attachment")
    if not text and not att:
        raise ValueError("Empty message")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        if body.get("client_id"):
            dup = c.execute("SELECT * FROM messages WHERE sender=? AND client_id=?", (u["id"], body["client_id"])).fetchone()
            if dup:  # sent twice from a phone that went offline: keep one
                return msg_view(dup)
        now = time.time()
        mid = c.execute("""INSERT INTO messages (conv_id, sender, client_id, kind, text, reply_to, attachment, created, updated)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (cid, u["id"], body.get("client_id"), body.get("kind") or "text", text, body.get("reply_to") or None,
                         json.dumps(att) if att else "", now, now)).lastrowid
        c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, cid))
        c.execute("UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?", (now, cid, u["id"]))
        c.commit()
        m = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
    for uid in members:
        await send_to(uid, {"t": "msg", "msg": m})
    asyncio.create_task(push_message(u, m, [x for x in members if x != u["id"]]))
    return m


async def _changed(mid: int, uid: int, fn):
    with closing(db()) as c:
        m = c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        _member(c, m["conv_id"], uid)
        fn(c, m)
        c.execute("UPDATE messages SET updated=? WHERE id=?", (time.time(), mid))
        c.commit()
        m = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (m["conv_id"],))]
    for x in members:
        await send_to(x, {"t": "upd", "msg": m})
    return m


@app.patch("/api/messages/{mid}")
async def edit_message(mid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)

    def fn(c, m):
        if m["sender"] != u["id"] or m["deleted"]:
            raise HTTPException(403, "You can only edit your own messages.")
        c.execute("UPDATE messages SET text=?, edited=? WHERE id=?", ((body.get("text") or "").strip()[:8000], time.time(), mid))
    return await _changed(mid, u["id"], fn)


@app.delete("/api/messages/{mid}")
async def delete_message(mid: int, authorization: str = Header(None)):
    u = auth(authorization)

    def fn(c, m):
        if m["sender"] != u["id"]:
            raise HTTPException(403, "You can only delete your own messages.")
        c.execute("UPDATE messages SET deleted=1, text='', attachment='', reactions='{}' WHERE id=?", (mid,))
    return await _changed(mid, u["id"], fn)


@app.post("/api/messages/{mid}/react")
async def react(mid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)

    def fn(c, m):
        r = json.loads(m["reactions"] or "{}")
        e = (body.get("emoji") or "")[:8]
        if not e or r.get(str(u["id"])) == e:
            r.pop(str(u["id"]), None)
        else:
            r[str(u["id"])] = e
        c.execute("UPDATE messages SET reactions=? WHERE id=?", (json.dumps(r), mid))
    return await _changed(mid, u["id"], fn)


@app.post("/api/convs/{cid}/read")
async def mark_read(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?", (now, cid, u["id"]))
        c.commit()
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
    for x in members:
        await send_to(x, {"t": "read", "conv": cid, "user": u["id"], "at": now})
    return {"ok": True}


@app.post("/api/convs/{cid}/typing")
async def typing(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? AND user_id<>?", (cid, u["id"]))]
    for x in members:
        await send_to(x, {"t": "typing", "conv": cid, "user": u["id"]})
    return {"ok": True}


# ---------------------------------------------------------------- files (photos, voice notes, documents, profile photos)
@app.post("/api/files")
async def upload(file: UploadFile = File(...), authorization: str = Header(None)):
    u = auth(authorization)
    if needs_new_pw(u):
        raise HTTPException(403, "Please choose a stronger password first (8+ characters with a capital letter, a small letter, a number and a symbol).")
    data = await file.read()
    if len(data) > MAX_FILE:
        raise ValueError(f"Files up to {MAX_FILE // 1048576} MB.")
    fid = secrets.token_hex(16)
    (FILES / fid).write_bytes(data)
    name = os.path.basename(file.filename or "file")[:120]
    with closing(db()) as c:
        c.execute("INSERT INTO files VALUES (?,?,?,?,?,?)", (fid, u["id"], name, file.content_type or "application/octet-stream", len(data), time.time()))
        c.commit()
    return {"id": fid, "name": name, "mime": file.content_type or "application/octet-stream", "size": len(data)}


@app.get("/api/files/{fid}")
def download(fid: str, t: str = "", authorization: str = Header(None)):
    user_for(t or (authorization or "").removeprefix("Bearer ").strip())  # images load via ?t= (no headers on <img>)
    if not re.fullmatch(r"[0-9a-f]{24,32}", fid):
        raise HTTPException(404)
    with closing(db()) as c:
        f = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
    if not f or not (FILES / fid).exists():
        raise HTTPException(404)
    inline = f["mime"].startswith(("image/", "audio/", "video/"))
    return FileResponse(FILES / fid, media_type=f["mime"], filename=None if inline else f["name"],
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------------------------------------------------------------- live updates (one WebSocket per device)
async def send_to(uid: int, msg: dict):
    for dev, s in list(SOCKETS.get(uid, {}).items()):
        try:
            await s["ws"].send_text(json.dumps(msg))
        except Exception:
            SOCKETS.get(uid, {}).pop(dev, None)


async def announce_presence(uid: int, online: bool):
    with closing(db()) as c:
        if not online:
            c.execute("UPDATE users SET last_seen=? WHERE id=?", (time.time(), uid))
            c.commit()
        peers = {r[0] for r in c.execute("""SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.conv_id=m2.conv_id
                                            WHERE m1.user_id=? AND m2.user_id<>?""", (uid, uid))}
    for p in peers:
        await send_to(p, {"t": "presence", "user": uid, "online": online, "at": time.time()})


async def announce_profile(u):
    with closing(db()) as c:
        peers = {r[0] for r in c.execute("""SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.conv_id=m2.conv_id
                                            WHERE m1.user_id=?""", (u["id"],))}
    for p in peers:
        await send_to(p, {"t": "profile", "user": public(u)})


@app.websocket("/api/ws")
async def ws(sock: WebSocket, token: str = "", device: str = "device"):
    try:
        u = user_for(token)
    except HTTPException:
        await sock.close(code=4401)
        return
    await sock.accept()
    uid, dev = u["id"], device[:60]
    first = not SOCKETS.get(uid)
    old = SOCKETS.setdefault(uid, {}).get(dev)
    if old:
        try:
            await old["ws"].close(code=4000)
        except Exception:
            pass
    SOCKETS[uid][dev] = {"ws": sock, "visible": True}
    if first:
        await announce_presence(uid, True)
    try:
        while True:
            m = json.loads(await sock.receive_text())
            if m.get("t") == "vis":
                SOCKETS[uid][dev]["visible"] = bool(m.get("v"))
            elif m.get("t") == "ping":
                await sock.send_text('{"t":"pong"}')
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        if SOCKETS.get(uid, {}).get(dev, {}).get("ws") is sock:
            SOCKETS[uid].pop(dev, None)
            if not SOCKETS[uid]:
                SOCKETS.pop(uid, None)
                await announce_presence(uid, False)


# ---------------------------------------------------------------- Web Push (VAPID + RFC 8291 encrypted payload)
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _vapid_key():
    f = DATA / "vapid.pem"
    if not f.exists():
        k = ec.generate_private_key(ec.SECP256R1())
        f.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        f.chmod(0o600)
    return serialization.load_pem_private_key(f.read_bytes(), None)


VAPID = _vapid_key()
VAPID_PUBLIC = _b64(VAPID.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def _vapid_header(endpoint: str) -> str:
    u = urlparse(endpoint)
    head = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    body = _b64(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": CONTACT}).encode())
    r, s = decode_dss_signature(VAPID.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"vapid t={head}.{body}.{_b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}, k={VAPID_PUBLIC}"


def encrypt_push(sub: dict, payload: bytes) -> bytes:
    """RFC 8291 (aes128gcm): only the phone that subscribed can read the notification."""
    ua_pub = _unb64(sub["keys"]["p256dh"])
    auth_secret = _unb64(sub["keys"]["auth"])
    eph = ec.generate_private_key(ec.SECP256R1())
    eph_pub = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = eph.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_pub + eph_pub).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    return salt + (4096).to_bytes(4, "big") + bytes([len(eph_pub)]) + eph_pub + AESGCM(cek).encrypt(nonce, payload + b"\x02", None)


async def push_to(uids: list[int], payload: dict, skip_visible=True):
    with closing(db()) as c:
        rows = c.execute(f"SELECT * FROM pushes WHERE user_id IN ({','.join('?' * len(uids))})", uids).fetchall() if uids else []
    async with httpx.AsyncClient(timeout=15) as h:
        for r in rows:
            devs = SOCKETS.get(r["user_id"], {})
            if skip_visible and any(s_["visible"] for d, s_ in devs.items() if d == r["device"] or d.startswith(r["device"] + ".")):
                continue  # that device has the app open and shows the message itself
            try:
                sub = json.loads(r["sub"])
                with closing(db()) as c:
                    badge = c.execute("""SELECT COUNT(*) FROM messages ms JOIN members mb ON mb.conv_id=ms.conv_id AND mb.user_id=?
                                         WHERE ms.sender<>? AND ms.deleted=0 AND ms.created>mb.last_read""", (r["user_id"], r["user_id"])).fetchone()[0]
                body = encrypt_push(sub, json.dumps({**payload, "badge": badge}).encode()[:3800])
                resp = await h.post(sub["endpoint"], content=body, headers={
                    "Authorization": _vapid_header(sub["endpoint"]), "Content-Encoding": "aes128gcm",
                    "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high"})
                if resp.status_code in (404, 410):
                    with closing(db()) as c:
                        c.execute("DELETE FROM pushes WHERE endpoint=?", (r["endpoint"],))
                        c.commit()
            except Exception as e:
                print("push failed:", e, flush=True)


async def push_message(sender, m: dict, uids: list[int]):
    if not uids:
        return
    body = m["text"] or {"image": "📷 Photo", "voice": "🎤 Voice note", "file": "📎 " + ((m.get("attachment") or {}).get("name") or "File")}.get(m["kind"], "New message")
    await push_to(uids, {"title": sender["name"] or sender["username"], "body": body[:180], "conv": m["conv_id"],
                         "icon": f"/api/avatar/{sender['id']}" if sender["avatar"] else "/icon-512.png"})


@app.get("/api/push/key")
def push_key():
    return {"key": VAPID_PUBLIC}


@app.post("/api/push")
def add_push(body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    sub = body.get("sub") or {}
    if not sub.get("endpoint") or not (sub.get("keys") or {}).get("p256dh"):
        raise ValueError("Bad subscription")
    with closing(db()) as c:
        c.execute("INSERT OR REPLACE INTO pushes VALUES (?,?,?,?,?)", (sub["endpoint"], u["id"], (body.get("device") or "")[:60], json.dumps(sub), time.time()))
        c.commit()
    return {"ok": True}


@app.post("/api/push/test")
async def test_push(authorization: str = Header(None)):
    u = auth(authorization)
    await push_to([u["id"]], {"title": "A.F.R.A ♥", "body": "Notifications work! 💌", "conv": 0, "icon": "/icon-512.png"}, skip_visible=False)
    return {"ok": True}


@app.get("/api/avatar/{uid}")
def avatar_public(uid: int):
    """Profile photos for notifications (the phone fetches them without logging in)."""
    with closing(db()) as c:
        u = c.execute("SELECT avatar FROM users WHERE id=?", (uid,)).fetchone()
        f = c.execute("SELECT mime FROM files WHERE id=?", (u["avatar"],)).fetchone() if u and u["avatar"] else None
    if not f or not (FILES / u["avatar"]).exists():
        raise HTTPException(404)
    return FileResponse(FILES / u["avatar"], media_type=f["mime"], headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------- admin
# ---------------------------------------------------------------- devices (shown to the admin)
IPHONES = {(375, 667): "SE / 6–8", (414, 736): "6–8 Plus", (375, 812): "X / XS / 11 Pro / 12 mini / 13 mini",
           (414, 896): "XR / 11 / XS Max / 11 Pro Max", (390, 844): "12 / 13 / 14", (428, 926): "12 Pro Max / 13 Pro Max / 14 Plus",
           (393, 852): "14 Pro / 15 / 15 Pro / 16", (430, 932): "14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus",
           (402, 874): "16 Pro / 17 / 17 Pro", (440, 956): "16 Pro Max / 17 Pro Max", (420, 912): "Air"}
DEVICE_KEYS = {"model": 60, "platform": 40, "os_version": 30, "screen": 20, "dpr": 6, "lang": 20, "tz": 50, "standalone": 5,
               "embedded": 5, "notifications": 12, "dark": 5, "touch": 5, "app": 12}


def device_label(info: dict) -> dict:
    """A readable name for a device from its browser's description plus what the app reports."""
    ua = info.get("ua", "")
    m = lambda rx: (re.search(rx, ua) or [None, ""])[1]
    if "iPhone" in ua:
        w, h = sorted(int(x) for x in re.findall(r"\d+", info.get("screen", "0x0"))[:2] or (0, 0))
        model = "iPhone" + (f" (probably {IPHONES[(w, h)]})" if (w, h) in IPHONES else "")
        system = "iOS " + m(r"OS (\d+(?:_\d+)?)").replace("_", ".")
    elif "iPad" in ua or ("Macintosh" in ua and info.get("touch")):
        model, system = "iPad", "iPadOS " + m(r"OS (\d+(?:_\d+)?)").replace("_", ".")
    elif "Android" in ua:
        model = info.get("model") or m(r"Android [\d.]+; ([^;)]+)")
        model = "Android phone" if not model or model == "K" else model
        system = "Android " + (info.get("os_version") or m(r"Android ([\d.]+)"))
    elif "Windows" in ua:
        model, system = "Windows PC", "Windows" + (" 11" if (info.get("os_version") or "0").split(".")[0].isdigit()
                                                   and int((info.get("os_version") or "0").split(".")[0]) >= 13 else "")
    elif "Macintosh" in ua:
        model, system = "Mac", "macOS"
    elif "CrOS" in ua:
        model, system = "Chromebook", "ChromeOS"
    else:
        model, system = "Computer", info.get("platform") or "Linux"
    browser = ("Edge" if "Edg/" in ua else "Samsung Internet" if "SamsungBrowser" in ua else "Opera" if "OPR/" in ua
               else "Firefox" if ("Firefox" in ua or "FxiOS" in ua) else "Chrome" if ("Chrome" in ua or "CriOS" in ua)
               else "Safari" if "Safari" in ua else "Browser")
    how = "inside A.F.R.A" if info.get("embedded") else "Home Screen app" if info.get("standalone") else browser
    return {"label": f"{model} · {how}", "model": model, "system": system.strip(), "browser": browser, "how": how}


@app.post("/api/device")
def report_device(body: dict, request: Request, authorization: str = Header(None)):
    """Each device says what it is once per start, so the admin can tell phones and laptops apart."""
    auth(authorization)
    info = {k: str(body.get(k))[:n] for k, n in DEVICE_KEYS.items() if body.get(k) not in (None, "")}
    info["ua"] = (request.headers.get("user-agent") or "")[:300]
    with closing(db()) as c:
        c.execute("UPDATE sessions SET info=? WHERE token=?", (json.dumps(info), _th((authorization or "").removeprefix("Bearer ").strip())))
        c.commit()
    return {"ok": True}


def devices_of(c, uid: int) -> list:
    pushed = {r[0] for r in c.execute("SELECT device FROM pushes WHERE user_id=?", (uid,))}
    out = []
    for s in c.execute("SELECT device, created, last_used, info FROM sessions WHERE user_id=? ORDER BY last_used DESC", (uid,)):
        info = json.loads(s["info"]) if s["info"] else {}
        d = device_label(info) if info else {"label": "Unknown device (not opened since this was added)"}
        out.append({**d, "id": s["device"], "logged_in": s["created"], "last_used": s["last_used"],
                    "online": s["device"] in SOCKETS.get(uid, {}) or any(k.startswith(s["device"] + ".") for k in SOCKETS.get(uid, {})),
                    "push": s["device"] in pushed, "screen": info.get("screen", ""), "lang": info.get("lang", ""),
                    "tz": info.get("tz", ""), "dark": info.get("dark") == "True", "app": info.get("app", ""), "ua": info.get("ua", "")})
    return out


@app.get("/api/admin/users")
def admin_users(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        rows = c.execute("SELECT * FROM users ORDER BY created").fetchall()
        devs = {r["id"]: devices_of(c, r["id"]) for r in rows}
    return [{**public(r), "disabled": bool(r["disabled"]), "created": r["created"], "devices": len(devs[r["id"]]),
             "device_list": devs[r["id"]]} for r in rows]


@app.patch("/api/admin/users/{uid}")
def admin_update(uid: int, body: dict, authorization: str = Header(None)):
    me_ = admin(authorization)
    if uid == me_["id"] and ("disabled" in body or "is_admin" in body):
        raise ValueError("You can't switch off or demote yourself.")
    with closing(db()) as c:
        if "disabled" in body:
            c.execute("UPDATE users SET disabled=? WHERE id=?", (int(bool(body["disabled"])), uid))
            if body["disabled"]:
                c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        if "is_admin" in body:
            c.execute("UPDATE users SET is_admin=? WHERE id=?", (int(bool(body["is_admin"])), uid))
        c.commit()
    return {"ok": True}


@app.post("/api/admin/users/{uid}/reset")
def admin_reset(uid: int, authorization: str = Header(None)):
    me_ = admin(authorization)
    with closing(db()) as c:
        if not c.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404)
        code = make_code(c, "reset", 0, me_["id"], str(uid))
        c.commit()
    return {"code": code}


@app.delete("/api/admin/users/{uid}")
async def admin_delete(uid: int, authorization: str = Header(None)):
    """Removes an account for good: their chats (for both people), messages, files, devices. A copy of the
    database is saved first in data/backups, so a mistake can still be undone by hand."""
    me_ = admin(authorization)
    if uid == me_["id"]:
        raise ValueError("You can't delete your own account.")
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            raise HTTPException(404)
        (DATA / "backups").mkdir(parents=True, exist_ok=True)
        dst = sqlite3.connect(DATA / "backups" / time.strftime(f"before-delete-{u['username']}-%Y%m%d-%H%M%S.db"))
        with dst:
            c.backup(dst)
        dst.close()
        convs = [r[0] for r in c.execute("SELECT conv_id FROM members WHERE user_id=?", (uid,))]
        peers = {cid: [r[0] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? AND user_id<>?", (cid, uid))]
                 for cid in convs}
        fids = {u["avatar"]} if u["avatar"] else set()
        fids |= {r[0] for r in c.execute("SELECT id FROM files WHERE owner=?", (uid,))}
        for cid in convs:
            for (att,) in c.execute("SELECT attachment FROM messages WHERE conv_id=? AND attachment<>''", (cid,)).fetchall():
                try:
                    fid = json.loads(att).get("id")
                except (ValueError, AttributeError):
                    fid = None
                if fid:
                    fids.add(fid)
            c.execute("DELETE FROM messages WHERE conv_id=?", (cid,))
            c.execute("DELETE FROM members WHERE conv_id=?", (cid,))
            c.execute("DELETE FROM convs WHERE id=?", (cid,))
        for fid in fids:
            c.execute("DELETE FROM files WHERE id=?", (fid,))
            if re.fullmatch(r"[0-9a-f]+", str(fid)):
                (FILES / fid).unlink(missing_ok=True)
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        c.execute("DELETE FROM pushes WHERE user_id=?", (uid,))
        c.execute("DELETE FROM invites WHERE used_by IS NULL AND (created_by=? OR (kind='reset' AND note=?))", (uid, str(uid)))
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        c.commit()
    for s in list(SOCKETS.pop(uid, {}).values()):
        try:
            await s["ws"].close(code=4401)
        except Exception:
            pass
    for cid, others in peers.items():
        for p in others:
            await send_to(p, {"t": "conv_gone", "conv": cid})
    return {"ok": True, "chats": len(convs), "files": len(fids)}


@app.get("/api/admin/invites")
def admin_invites(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        rows = c.execute("""SELECT i.*, u.username AS used_name FROM invites i LEFT JOIN users u ON u.id=i.used_by
                            WHERE i.kind='invite' ORDER BY i.created DESC LIMIT 100""").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/invites")
def admin_new_invite(body: dict, authorization: str = Header(None)):
    me_ = admin(authorization)
    with closing(db()) as c:
        code = make_code(c, "invite", int(bool(body.get("admin"))), me_["id"], body.get("note") or "")
        c.commit()
    return {"code": code}


@app.delete("/api/admin/invites/{code}")
def admin_del_invite(code: str, authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        c.execute("DELETE FROM invites WHERE code=? AND used_by IS NULL", (code.upper(),))
        c.commit()
    return {"ok": True}


# ---------------------------------------------------------------- admin: overview and downloads
def admin_q(t: str, authorization: str | None):
    """Downloads open as plain links, so they may carry the session in ?t= instead of a header."""
    u = user_for(t or (authorization or "").removeprefix("Bearer ").strip())
    if not u["is_admin"]:
        raise HTTPException(403, "Admins only")
    return u


@app.get("/api/admin/stats")
def admin_stats(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        n = lambda q: c.execute(q).fetchone()[0]
        stats = {"users": n("SELECT COUNT(*) FROM users"), "online": len(SOCKETS), "chats": n("SELECT COUNT(*) FROM convs WHERE kind='direct'"),
                 "messages": n("SELECT COUNT(*) FROM messages WHERE deleted=0"), "today": c.execute("SELECT COUNT(*) FROM messages WHERE created>?", (time.time() - 86400,)).fetchone()[0],
                 "files": n("SELECT COUNT(*) FROM files"), "files_mb": round((n("SELECT COALESCE(SUM(size),0) FROM files")) / 1048576, 1),
                 "push_devices": n("SELECT COUNT(*) FROM pushes"), "invites_open": n("SELECT COUNT(*) FROM invites WHERE kind='invite' AND used_by IS NULL")}
    stats["db_mb"] = round(DB.stat().st_size / 1048576, 2)
    stats["backups"] = [{"name": f.name, "mb": round(f.stat().st_size / 1048576, 2), "at": f.stat().st_mtime}
                        for f in sorted((DATA / "backups").glob("chat-*.db"), reverse=True)]
    return stats


@app.get("/api/admin/export/db")
def export_db(t: str = "", authorization: str = Header(None)):
    """The whole database as one SQLite file (open it with "DB Browser for SQLite"). Passwords inside are hashed."""
    admin_q(t, authorization)
    fd, name = tempfile.mkstemp(suffix=".db", dir=DATA)
    os.close(fd)
    tmp = Path(name)
    src, dst = sqlite3.connect(DB), sqlite3.connect(tmp)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    data = tmp.read_bytes()
    tmp.unlink()
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="afra-chat-{time.strftime("%Y%m%d-%H%M")}.db"'})


def database_as_json() -> str:
    """The complete database converted to JSON: every table, every column, every row. Login tokens and the phones'
    push keys are left out (they only let someone pretend to be a device); passwords are stored as Base64-encoded text, as in the .db."""
    hidden = {("sessions", "token"), ("pushes", "endpoint"), ("pushes", "sub")}
    out = {"exported": time.strftime("%Y-%m-%d %H:%M:%S"), "database": "A.F.R.A chat", "tables": {}}
    with closing(db()) as c:
        for (table,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})")]
            rows = []
            for r in c.execute(f"SELECT * FROM {table}"):
                row = {}
                for col in cols:
                    v = r[col]
                    if (table, col) in hidden:
                        v = "(hidden)"
                    elif col in ("attachment", "reactions") and isinstance(v, str) and v[:1] in "{[":
                        try:
                            v = json.loads(v)
                        except ValueError:
                            pass
                    elif isinstance(v, bytes):
                        v = base64.b64encode(v).decode()
                    row[col] = v
                rows.append(row)
            out["tables"][table] = {"columns": cols, "count": len(rows), "rows": rows}
    return json.dumps(out, ensure_ascii=False, indent=1)


@app.get("/api/admin/export/db.json")
def export_db_json(t: str = "", authorization: str = Header(None)):
    admin_q(t, authorization)
    return Response(database_as_json(), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="afra-chat-database-{time.strftime("%Y%m%d-%H%M")}.json"'})


@app.get("/api/admin/export/users.csv")
def export_users(t: str = "", authorization: str = Header(None)):
    """Everyone in a spreadsheet (opens in Excel / Numbers / Google Sheets). No passwords."""
    admin_q(t, authorization)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "username", "name", "admin", "switched off", "joined", "last seen", "messages sent", "devices logged in", "notifications", "devices"])
    fmt = lambda x: time.strftime("%Y-%m-%d %H:%M", time.localtime(x)) if x else ""
    with closing(db()) as c:
        for u in c.execute("SELECT * FROM users ORDER BY id"):
            msgs = c.execute("SELECT COUNT(*) FROM messages WHERE sender=? AND deleted=0", (u["id"],)).fetchone()[0]
            dl = devices_of(c, u["id"]); devs = len(dl)
            push = c.execute("SELECT COUNT(*) FROM pushes WHERE user_id=?", (u["id"],)).fetchone()[0]
            seen = time.time() if SOCKETS.get(u["id"]) else u["last_seen"]
            w.writerow([u["id"], u["username"], u["name"], "yes" if u["is_admin"] else "", "yes" if u["disabled"] else "",
                        fmt(u["created"]), fmt(seen), msgs, devs, push,
                        "; ".join(f'{d["label"]} ({d.get("system", "")})' for d in dl)])
    return Response("\ufeff" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="afra-chat-users-{time.strftime("%Y%m%d")}.csv"'})


@app.get("/api/admin/export/chats.json")
def export_chats(t: str = "", authorization: str = Header(None)):
    """Every person, chat and message as readable JSON (no passwords, no sessions)."""
    admin_q(t, authorization)
    with closing(db()) as c:
        users = [{k: r[k] for k in ("id", "username", "name", "is_admin", "disabled", "created", "last_seen", "avatar")} for r in c.execute("SELECT * FROM users")]
        names = {u["id"]: u["username"] for u in users}
        chats = []
        for cv in c.execute("SELECT * FROM convs ORDER BY id"):
            members = [names.get(r[0]) for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cv["id"],))]
            msgs = [{"id": m["id"], "from": names.get(m["sender"]), "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(m["created"])),
                     "kind": m["kind"], "text": m["text"], "reply_to": m["reply_to"], "attachment": json.loads(m["attachment"]) if m["attachment"] else None,
                     "reactions": {names.get(int(k), k): v for k, v in json.loads(m["reactions"] or "{}").items()}, "edited": bool(m["edited"]), "deleted": bool(m["deleted"])}
                    for m in c.execute("SELECT * FROM messages WHERE conv_id=? ORDER BY id", (cv["id"],))]
            chats.append({"id": cv["id"], "kind": cv["kind"], "members": members, "messages": msgs})
    body = json.dumps({"exported": time.strftime("%Y-%m-%d %H:%M"), "users": users, "chats": chats}, ensure_ascii=False, indent=1)
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="afra-chat-export-{time.strftime("%Y%m%d")}.json"'})


# ---------------------------------------------------------------- admin: readable exports (ZIP: transcript .txt + .html, .json, files)
def _names(c) -> dict:
    return {r["id"]: r for r in c.execute("SELECT * FROM users")}


def _chat_label(c, cv, users) -> str:
    ids = [r[0] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? ORDER BY user_id", (cv["id"],))]
    if cv["kind"] == "self":
        u = users.get(ids[0]) if ids else None
        return f"Notes to self - @{u['username'] if u else '?'}"
    return " & ".join("@" + (users[i]["username"] if i in users else "?") for i in ids)


def _safe(name: str) -> str:
    return re.sub(r"[^\w@.& -]+", "_", name).strip()[:80] or "chat"


def _chat_bundle(c, cv, users, z: zipfile.ZipFile, folder: str, files_done: set):
    """Write one chat into the ZIP: transcript.txt, transcript.html, chat.json and its files."""
    label = _chat_label(c, cv, users)
    msgs = c.execute("SELECT * FROM messages WHERE conv_id=? ORDER BY id", (cv["id"],)).fetchall()
    by_id = {m["id"]: m for m in msgs}
    when = lambda t: time.strftime("%Y-%m-%d %H:%M", time.localtime(t))
    who = lambda uid: (users[uid]["name"] or users[uid]["username"]) if uid in users else "?"
    txt, html, js = [f"{label}\nExported {when(time.time())}\n"], [], []
    for m in msgs:
        att = json.loads(m["attachment"]) if m["attachment"] else None
        rx = {who(int(k)): v for k, v in json.loads(m["reactions"] or "{}").items()}
        fpath = ""
        if att and att.get("id") and (FILES / att["id"]).exists():
            fpath = f"files/{att['id'][:8]}-{_safe(att.get('name') or 'file')}"
            if (folder + fpath) not in files_done:
                z.write(FILES / att["id"], folder + fpath)
                files_done.add(folder + fpath)
        reply = by_id.get(m["reply_to"]) if m["reply_to"] else None
        line = f"[{when(m['created'])}] {who(m['sender'])}: "
        if m["deleted"]:
            line += "(deleted message)"
        else:
            if reply:
                line += f"(replying to {who(reply['sender'])}: \"{(reply['text'] or '')[:60]}\") "
            if att:
                line += f"[{m['kind']}: {fpath or att.get('name', 'file')}] "
            line += m["text"] or ""
            if m["edited"]:
                line += " (edited)"
            if rx:
                line += "   " + " ".join(f"{v} {k}" for k, v in rx.items())
        txt.append(line)
        body = "<i>deleted message</i>" if m["deleted"] else (
            (f'<div class="q">{hesc(who(reply["sender"]))}: {hesc((reply["text"] or "")[:80])}</div>' if reply else "")
            + (f'<img src="{hesc(fpath)}">' if att and m["kind"] == "image" and fpath else
               f'<audio controls src="{hesc(fpath)}"></audio>' if att and m["kind"] == "voice" and fpath else
               f'<a href="{hesc(fpath)}">📄 {hesc(att.get("name", "file"))}</a>' if att else "")
            + (f"<div>{hesc(m['text'])}</div>" if m["text"] else "")
            + (f'<div class="rx">{" ".join(hesc(v) for v in rx.values())}</div>' if rx else ""))
        html.append(f'<div class="m"><div class="w">{hesc(who(m["sender"]))} · {when(m["created"])}{" · edited" if m["edited"] and not m["deleted"] else ""}</div><div class="b">{body}</div></div>')
        js.append({"id": m["id"], "from": users[m["sender"]]["username"] if m["sender"] in users else None, "at": when(m["created"]),
                   "kind": m["kind"], "text": m["text"], "reply_to": m["reply_to"], "attachment": att, "file": fpath or None,
                   "reactions": rx, "edited": bool(m["edited"]), "deleted": bool(m["deleted"])})
    page = f"""<!doctype html><meta charset="utf-8"><title>{hesc(label)}</title><style>
body{{font:15px/1.45 -apple-system,Segoe UI,sans-serif;background:#f4f1ea;max-width:720px;margin:20px auto;padding:0 12px;color:#1d2433}}
h1{{font:600 20px Georgia,serif}} .m{{margin:8px 0}} .w{{font-size:12px;color:#7a8194;margin:0 6px 2px}}
.b{{background:#fff;border-radius:16px;padding:8px 12px;display:inline-block;max-width:85%;white-space:pre-wrap;box-shadow:0 1px 4px rgba(0,0,0,.06)}}
.b img{{max-width:280px;border-radius:10px;display:block}} .q{{border-left:3px solid #1f4e79;padding-left:6px;color:#7a8194;font-size:13px}} .rx{{font-size:13px}}
</style><h1>{hesc(label)}</h1><p style="color:#7a8194">{len(msgs)} messages · exported {when(time.time())}</p>{"".join(html)}"""
    z.writestr(folder + "transcript.txt", "\n".join(txt))
    z.writestr(folder + "transcript.html", page)
    z.writestr(folder + "chat.json", json.dumps({"chat": label, "kind": cv["kind"], "messages": js}, ensure_ascii=False, indent=1))
    return len(msgs)


def _profile(u) -> dict:
    return {k: u[k] for k in ("id", "username", "name", "is_admin", "disabled", "created", "last_seen", "avatar")}


def _zip_response(build, filename: str) -> Response:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        build(z)
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/admin/chats")
def admin_chats(authorization: str = Header(None)):
    """Every chat (including each person's Notes to self), for picking one to download."""
    admin(authorization)
    with closing(db()) as c:
        users = _names(c)
        out = [{"id": cv["id"], "kind": cv["kind"], "label": _chat_label(c, cv, users), "last_at": cv["last_at"],
                "messages": c.execute("SELECT COUNT(*) FROM messages WHERE conv_id=?", (cv["id"],)).fetchone()[0]}
               for cv in c.execute("SELECT * FROM convs ORDER BY kind, last_at DESC")]
    return out


@app.get("/api/admin/export/chat/{cid}")
def export_one_chat(cid: int, t: str = "", authorization: str = Header(None)):
    admin_q(t, authorization)
    with closing(db()) as c:
        cv = c.execute("SELECT * FROM convs WHERE id=?", (cid,)).fetchone()
        if not cv:
            raise HTTPException(404)
        users = _names(c)
        label = _chat_label(c, cv, users)
        return _zip_response(lambda z: _chat_bundle(c, cv, users, z, "", set()), f"chat - {_safe(label)} - {time.strftime('%Y%m%d')}.zip")


@app.get("/api/admin/export/user/{uid}")
def export_person(uid: int, t: str = "", authorization: str = Header(None)):
    """Everything about one person: profile, photo, every chat they're in (and their Notes to self) with files."""
    admin_q(t, authorization)
    with closing(db()) as c:
        users = _names(c)
        u = users.get(uid)
        if not u:
            raise HTTPException(404)

        def build(z):
            prof = _profile(u)
            prof["devices_logged_in"] = c.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (uid,)).fetchone()[0]
            prof["messages_sent"] = c.execute("SELECT COUNT(*) FROM messages WHERE sender=? AND deleted=0", (uid,)).fetchone()[0]
            z.writestr("profile.json", json.dumps(prof, ensure_ascii=False, indent=1))
            if u["avatar"] and (FILES / u["avatar"]).exists():
                z.write(FILES / u["avatar"], "profile-photo.jpg")
            done = set()
            for cv in c.execute("SELECT v.* FROM convs v JOIN members m ON m.conv_id=v.id WHERE m.user_id=? ORDER BY v.kind DESC, v.last_at DESC", (uid,)).fetchall():
                _chat_bundle(c, cv, users, z, f"{_safe(_chat_label(c, cv, users))}/", done)
            z.writestr("README.txt", f"A.F.R.A chat: everything about @{u['username']} ({u['name']}).\n"
                       "profile.json - the account (no password). Each folder is one chat (\"Notes to self\" = their private notes):\n"
                       "  transcript.html - open in a browser (photos shown)\n  transcript.txt - plain text\n  chat.json - all details\n  files/ - photos, voice notes, files\n")
        return _zip_response(build, f"person - @{u['username']} - {time.strftime('%Y%m%d')}.zip")


@app.get("/api/admin/export/notes")
def export_notes(t: str = "", authorization: str = Header(None)):
    """Everyone's Notes to self, one folder per person."""
    admin_q(t, authorization)
    with closing(db()) as c:
        users = _names(c)

        def build(z):
            done = set()
            for cv in c.execute("SELECT * FROM convs WHERE kind='self' ORDER BY id").fetchall():
                _chat_bundle(c, cv, users, z, f"{_safe(_chat_label(c, cv, users))}/", done)
        return _zip_response(build, f"notes to self - everyone - {time.strftime('%Y%m%d')}.zip")


@app.get("/api/admin/export/everything")
def export_everything(t: str = "", authorization: str = Header(None)):
    """The complete database plus every chat as readable transcripts, with all photos and files."""
    admin_q(t, authorization)
    fd, name = tempfile.mkstemp(suffix=".db", dir=DATA)
    os.close(fd)
    tmp = Path(name)
    src, dst = sqlite3.connect(DB), sqlite3.connect(tmp)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    try:
        with closing(db()) as c:
            users = _names(c)

            def build(z):
                z.write(tmp, "database/chat.db")
                z.writestr("database/chat.json", database_as_json())
                z.writestr("people.json", json.dumps([_profile(u) for u in users.values()], ensure_ascii=False, indent=1))
                done = set()
                for cv in c.execute("SELECT * FROM convs ORDER BY kind, id").fetchall():
                    _chat_bundle(c, cv, users, z, f"chats/{_safe(_chat_label(c, cv, users))}/", done)
                for u in users.values():
                    if u["avatar"] and (FILES / u["avatar"]).exists():
                        z.write(FILES / u["avatar"], f"profile-photos/@{u['username']}.jpg")
                z.writestr("README.txt", "A.F.R.A chat: complete export.\n"
                           "database/chat.db - the whole database (open with DB Browser for SQLite; passwords are Base64-encoded)\n"
                           "database/chat.json - the same database as JSON (every table and row)\n"
                           "people.json - everyone (no passwords)\nchats/ - every chat, including each person's Notes to self:\n"
                           "  transcript.html (open in a browser), transcript.txt, chat.json, files/\nprofile-photos/ - everyone's photo\n")
            return _zip_response(build, f"afra-chat - everything - {time.strftime('%Y%m%d-%H%M')}.zip")
    finally:
        tmp.unlink(missing_ok=True)


@app.get("/api/admin/backups/{name}")
def download_backup(name: str, t: str = "", authorization: str = Header(None)):
    admin_q(t, authorization)
    f = (DATA / "backups" / name).resolve()
    if f.parent != (DATA / "backups").resolve() or not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, media_type="application/octet-stream", filename=name)


# ---------------------------------------------------------------- the app itself + housekeeping
@app.get("/api/health")
def health():
    return {"app": "A.F.R.A chat", "ok": True}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/{name}")
def web_file(name: str):
    f = (WEB / name).resolve()
    if f.parent != WEB.resolve() or not f.is_file():
        raise HTTPException(404)
    types = {".webmanifest": "application/manifest+json", ".js": "text/javascript", ".json": "application/json"}
    return FileResponse(f, media_type=types.get(f.suffix), headers={"Cache-Control": "no-cache"})


def backup():
    """A consistent copy of the database every day; the newest 14 are kept."""
    dest = DATA / "backups" / time.strftime("chat-%Y%m%d.db")
    if dest.exists():
        return
    src, dst = sqlite3.connect(DB), sqlite3.connect(dest)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    for old in sorted((DATA / "backups").glob("chat-*.db"))[:-14]:
        old.unlink()


async def _housekeeping():
    while True:
        try:
            backup()
        except Exception as e:
            print("backup failed:", e, flush=True)
        await asyncio.sleep(3 * 3600)


@app.on_event("startup")
async def _start():
    asyncio.create_task(_housekeeping())
    with closing(db()) as c:
        if not c.execute("SELECT 1 FROM users").fetchone():
            open_ = c.execute("SELECT code FROM invites WHERE admin=1 AND used_by IS NULL AND kind='invite'").fetchone()
            code = open_["code"] if open_ else make_code(c, "invite", 1, None, "first admin")
            c.commit()
            print(f"\n  No accounts yet. Create the admin account with invite code: {code}\n", flush=True)


if __name__ == "__main__":  # python server.py invite [--admin] [note]
    if len(sys.argv) > 1 and sys.argv[1] == "invite":
        with closing(db()) as c:
            print(make_code(c, "invite", int("--admin" in sys.argv), None, " ".join(a for a in sys.argv[2:] if a != "--admin")))
            c.commit()
