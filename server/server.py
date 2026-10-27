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
import calendar
import random
import csv
import io
import tempfile
import zipfile
from html import escape as hesc
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
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
MAX_FILE = int(os.environ.get("MAX_FILE_MB", "100")) * 1024 * 1024
KINDS = {"text", "image", "voice", "file", "video", "videonote", "sticker", "location"}
MUTE_FOREVER = 4e9  # "Always" (year 2096)
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
CREATE TABLE IF NOT EXISTS stars (user_id INTEGER, msg_id INTEGER, created REAL, PRIMARY KEY (user_id, msg_id));
CREATE TABLE IF NOT EXISTS nicknames (user_id INTEGER, other_id INTEGER, nick TEXT, PRIMARY KEY (user_id, other_id));
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, due REAL DEFAULT 0, place TEXT DEFAULT '',
  repeat TEXT DEFAULT '', done INTEGER DEFAULT 0, created REAL, fired REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(done, due);
CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, user_id INTEGER, list TEXT DEFAULT '', text TEXT, done INTEGER DEFAULT 0, created REAL);
CREATE TABLE IF NOT EXISTS places (user_id INTEGER, name TEXT, lat REAL, lon REAL, radius REAL DEFAULT 150, PRIMARY KEY (user_id, name));
CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY, conv_id INTEGER UNIQUE, bot_id INTEGER, user_a INTEGER, user_b INTEGER,
  name TEXT, species TEXT, born REAL, hunger REAL DEFAULT 80, joy REAL DEFAULT 80, energy REAL DEFAULT 80, stats_at REAL,
  xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0, last_care_day TEXT DEFAULT '',
  last_nudge_day TEXT DEFAULT '', cds TEXT DEFAULT '{}', sleep_until REAL DEFAULT 0);  -- one active pet per couple: index pets_pair_active
CREATE TABLE IF NOT EXISTS pet_days (pet_id INTEGER, day TEXT, data TEXT DEFAULT '{}', PRIMARY KEY (pet_id, day));
CREATE TABLE IF NOT EXISTS pet_items (pet_id INTEGER, item TEXT, qty INTEGER DEFAULT 0, PRIMARY KEY (pet_id, item));
CREATE TABLE IF NOT EXISTS pet_log (id INTEGER PRIMARY KEY, pet_id INTEGER, kind TEXT, text TEXT, at REAL, day TEXT DEFAULT '', file TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS pet_log_pet ON pet_log(pet_id, at);
CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY, ts REAL, user_id INTEGER, conv_id INTEGER, who TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL);
CREATE INDEX IF NOT EXISTS ai_usage_ts ON ai_usage(ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS dq_days (conv_id INTEGER, day TEXT, qidx INTEGER, asked INTEGER DEFAULT 0, rewarded INTEGER DEFAULT 0, PRIMARY KEY (conv_id, day));
CREATE TABLE IF NOT EXISTS dq_answers (conv_id INTEGER, day TEXT, qidx INTEGER, user_id INTEGER, answer TEXT, ts REAL, PRIMARY KEY (conv_id, day, user_id));
CREATE TABLE IF NOT EXISTS moods (user_id INTEGER, day TEXT, emoji TEXT, word TEXT DEFAULT '', ts REAL, pushed INTEGER DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS pair_dates (conv_id INTEGER PRIMARY KEY, together TEXT DEFAULT '', next_meet TEXT DEFAULT '', monthsary INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS birthdays (user_id INTEGER PRIMARY KEY, date TEXT);
CREATE TABLE IF NOT EXISTS date_sent (conv_id INTEGER, key TEXT, PRIMARY KEY (conv_id, key));
CREATE TABLE IF NOT EXISTS date_seen (conv_id INTEGER, user_id INTEGER, key TEXT, PRIMARY KEY (conv_id, user_id, key));
CREATE TABLE IF NOT EXISTS otd (conv_id INTEGER, day TEXT, data TEXT DEFAULT '{}', said INTEGER DEFAULT 0, PRIMARY KEY (conv_id, day));
CREATE INDEX IF NOT EXISTS messages_created ON messages(conv_id, created);
CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, body TEXT, sent INTEGER DEFAULT 0, devices INTEGER DEFAULT 0, created REAL);
-- v23 touches: one row per touch (a whole storm of taps = one row; live touch and achievements can hang off it later)
CREATE TABLE IF NOT EXISTS touches (id INTEGER PRIMARY KEY, conv_id INTEGER, sender INTEGER, action TEXT DEFAULT '', word TEXT DEFAULT '', count INTEGER DEFAULT 1,
  strength INTEGER DEFAULT 1, pattern TEXT DEFAULT '[]', ts REAL, pushes INTEGER DEFAULT 0, delivered INTEGER DEFAULT 0, msg_id INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS touches_conv ON touches(conv_id, ts);
CREATE INDEX IF NOT EXISTS touches_sender ON touches(sender, ts);
CREATE TABLE IF NOT EXISTS touch_seen (touch_id INTEGER, user_id INTEGER, ts REAL, PRIMARY KEY (touch_id, user_id));
CREATE TABLE IF NOT EXISTS touch_prefs (user_id INTEGER PRIMARY KEY, mode TEXT DEFAULT 'full', quiet_on INTEGER DEFAULT 0, quiet_start TEXT DEFAULT '22:00',
  quiet_end TEXT DEFAULT '07:00', watch INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS storm_log (id INTEGER PRIMARY KEY, run TEXT, idx INTEGER, device TEXT, endpoint_type TEXT, sent_at REAL, status INTEGER, ms INTEGER, err TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS storm_run ON storm_log(run);
-- v24: pinned message bubbles (several per chat) and "in sync" moments of live touch (for achievements later)
CREATE TABLE IF NOT EXISTS pinned_msgs (conv_id INTEGER, msg_id INTEGER, "by" INTEGER, at REAL, PRIMARY KEY (conv_id, msg_id));
CREATE TABLE IF NOT EXISTS us_sync (id INTEGER PRIMARY KEY, conv_id INTEGER, at REAL);
CREATE INDEX IF NOT EXISTS us_sync_conv ON us_sync(conv_id, at);
-- v25: question cards (rounds belong to the couple's direct chat; answers stay hidden until the round is complete)
CREATE TABLE IF NOT EXISTS card_rounds (id INTEGER PRIMARY KEY, conv_id INTEGER, deck TEXT, idx INTEGER, q TEXT, t TEXT DEFAULT 'both', drawn_by INTEGER,
  mode TEXT DEFAULT 'normal', created REAL, done REAL DEFAULT 0, skipped INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS card_rounds_conv ON card_rounds(conv_id, done);
CREATE TABLE IF NOT EXISTS card_answers (round_id INTEGER, user_id INTEGER, text TEXT DEFAULT '', guess TEXT DEFAULT '', judged INTEGER DEFAULT 0, created REAL,
  PRIMARY KEY (round_id, user_id));
CREATE TABLE IF NOT EXISTS card_prefs (conv_id INTEGER, user_id INTEGER, spicy INTEGER DEFAULT 0, PRIMARY KEY (conv_id, user_id));
-- v26: time capsule letters (to_uid NULL = to both of us; the body and photos of a sealed letter never leave the server for the reader before unlock_at)
CREATE TABLE IF NOT EXISTS capsules (id INTEGER PRIMARY KEY, conv_id INTEGER, author INTEGER, to_uid INTEGER, body TEXT DEFAULT '', attachments TEXT DEFAULT '[]',
  created_at REAL, unlock_at REAL DEFAULT 0, opened_at REAL DEFAULT 0, notified INTEGER DEFAULT 0, draft INTEGER DEFAULT 0, updated REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS capsules_conv ON capsules(conv_id, unlock_at);
CREATE INDEX IF NOT EXISTS capsules_due ON capsules(notified, unlock_at);
-- v27: couple games (state is the game's own JSON; the other player's secrets are only ever sent by _g_view); game_coins caps the coins a person can earn a day
CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY, conv_id INTEGER, type TEXT, state TEXT DEFAULT '{}', players TEXT DEFAULT '[]', turn INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', winner INTEGER DEFAULT 0, res TEXT DEFAULT '', coins_given INTEGER DEFAULT 0, pushed REAL DEFAULT 0, created REAL, updated REAL, finished REAL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS games_one ON games(conv_id, type) WHERE status='active';
CREATE INDEX IF NOT EXISTS games_conv ON games(conv_id, status, updated);
CREATE TABLE IF NOT EXISTS game_coins (user_id INTEGER, day TEXT, coins INTEGER DEFAULT 0, PRIMARY KEY (user_id, day));
-- v28: shared bucket list (photos stay on an item when it is un-ticked; paid = its coins were given once) and the album's shared favourites (by file id)
CREATE TABLE IF NOT EXISTS bucket (id INTEGER PRIMARY KEY, conv_id INTEGER, title TEXT, cat TEXT DEFAULT 'do', note TEXT DEFAULT '', by_date TEXT DEFAULT '', added_by INTEGER,
  created REAL, updated REAL, done INTEGER DEFAULT 0, done_at REAL DEFAULT 0, done_day TEXT DEFAULT '', done_by INTEGER DEFAULT 0, done_note TEXT DEFAULT '',
  photos TEXT DEFAULT '[]', paid INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS bucket_conv ON bucket(conv_id, done, created);
CREATE TABLE IF NOT EXISTS mem_fav (conv_id INTEGER, file_id TEXT, fav_by INTEGER, at REAL, PRIMARY KEY (conv_id, file_id));
-- v29: privacy and notification settings (one JSON per person, follows them across devices) and per-person archived chats
CREATE TABLE IF NOT EXISTS user_prefs (user_id INTEGER PRIMARY KEY, data TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS chat_archive (user_id INTEGER, conv_id INTEGER, at REAL, PRIMARY KEY (user_id, conv_id));
-- v30: date-night ideas the couple added (the built-in ones live in web/games.js), what they have done, the gratitude jar (read_at = the pet read it out)
-- and the PRIVATE gift wishlist (owner = the only person who can ever list or read a row; for_uid = who the gift is for)
CREATE TABLE IF NOT EXISTS place_rounds (id INTEGER PRIMARY KEY, conv_id INTEGER, kind TEXT, lat REAL, lon REAL, radius INTEGER, places TEXT, started_by INTEGER, one INTEGER DEFAULT 0, created REAL, closed REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS place_votes (round_id INTEGER, user_id INTEGER, pid TEXT, yes INTEGER, at REAL, PRIMARY KEY (round_id, user_id, pid));
CREATE TABLE IF NOT EXISTS date_ideas (id INTEGER PRIMARY KEY, conv_id INTEGER, title TEXT, mode TEXT DEFAULT 'in', budget INTEGER DEFAULT 0, emoji TEXT DEFAULT '', added_by INTEGER, created REAL);
CREATE INDEX IF NOT EXISTS date_ideas_conv ON date_ideas(conv_id);
CREATE TABLE IF NOT EXISTS date_done (conv_id INTEGER, idea TEXT, title TEXT DEFAULT '', done_at REAL, done_by INTEGER, PRIMARY KEY (conv_id, idea));
CREATE TABLE IF NOT EXISTS gratitude (id INTEGER PRIMARY KEY, conv_id INTEGER, author INTEGER, body TEXT, created REAL, read_at REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS gratitude_conv ON gratitude(conv_id, created);
CREATE TABLE IF NOT EXISTS wishlist (id INTEGER PRIMARY KEY, owner INTEGER, for_uid INTEGER, title TEXT, link TEXT DEFAULT '', note TEXT DEFAULT '', price TEXT DEFAULT '',
  photo TEXT DEFAULT '', bought INTEGER DEFAULT 0, bought_at REAL DEFAULT 0, created REAL, updated REAL);
CREATE INDEX IF NOT EXISTS wishlist_owner ON wishlist(owner, for_uid, bought);
"""
STAGE_DAYS = (1, 3, 10, 25)  # days with at least one feed needed for: hatching, baby, kid, grown-up (0 = egg)


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
    for _t in ("convs", "members"):  # chat theme: on convs = shared by both people, on members = "just for me"
        if "style" not in [r[1] for r in _c.execute(f"PRAGMA table_info({_t})")]:
            _c.execute(f"ALTER TABLE {_t} ADD COLUMN style TEXT DEFAULT '{{}}'")
    for _t, _col, _def in (("users", "bio", "TEXT DEFAULT ''"), ("members", "muted", "REAL DEFAULT 0"),  # about line; mute until (time)
                          ("users", "bot", "INTEGER DEFAULT 0"),
                          ("members", "nudged", "INTEGER DEFAULT 0"), ("members", "nudge_on", "INTEGER DEFAULT 1"),  # unread reminders: stage sent (0/1/2), and the per-person switch
                          ("reminders", "home_id", "INTEGER DEFAULT 0"), ("notes", "home_id", "INTEGER DEFAULT 0"),  # shared with a couple in Home (the pet's chat)
                          ("invites", "for_name", "TEXT DEFAULT ''")):  # who an invite is for (shown on the welcome screen)  # the Assistant's account
        if _col not in [r[1] for r in _c.execute(f"PRAGMA table_info({_t})")]:
            _c.execute(f"ALTER TABLE {_t} ADD COLUMN {_col} {_def}")
    for _col, _def in (("coins", "INTEGER DEFAULT 0"), ("fed_days", "INTEGER DEFAULT 0"), ("stage", "INTEGER DEFAULT 0"),  # v19: shared wallet, growth
                       ("outfit", "TEXT DEFAULT ''"), ("room", "TEXT DEFAULT '{}'"), ("archived", "REAL DEFAULT 0")):  # v33: unpaired by the admin, kept to restore
        if _col not in [r[1] for r in _c.execute("PRAGMA table_info(pets)")]:
            _c.execute(f"ALTER TABLE pets ADD COLUMN {_col} {_def}")
            if _col == "stage":  # pets that already exist grow from the days they were already fed
                for _p in _c.execute("SELECT id FROM pets").fetchall():
                    _n = 0
                    for _r in _c.execute("SELECT data FROM pet_days WHERE pet_id=?", (_p[0],)).fetchall():
                        try:
                            _n += 1 if json.loads(_r[0] or "{}").get("feed") else 0
                        except ValueError:
                            pass
                    _c.execute("UPDATE pets SET fed_days=?, stage=? WHERE id=?", (_n, sum(1 for x in STAGE_DAYS if _n >= x), _p[0]))
    # v33: an unpaired pet is kept beside a new one, so "one pet per couple" only applies to pets still paired (the old table said UNIQUE for all)
    _ps = _c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='pets'").fetchone()[0]
    if re.search(r",\s*UNIQUE\s*\(\s*user_a\s*,\s*user_b\s*\)", _ps):
        _c.execute(re.sub(r",\s*UNIQUE\s*\(\s*user_a\s*,\s*user_b\s*\)", "", re.sub(r"^CREATE TABLE (IF NOT EXISTS )?\"?pets\"?", "CREATE TABLE pets_v33", _ps)))
        _c.execute("INSERT INTO pets_v33 SELECT * FROM pets")
        _c.execute("DROP TABLE pets")
        _c.execute("ALTER TABLE pets_v33 RENAME TO pets")
    _c.execute("CREATE UNIQUE INDEX IF NOT EXISTS pets_pair_active ON pets (user_a, user_b) WHERE archived=0")
    _c.commit()

app = FastAPI(title="A.F.R.A chat", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def _readonly_gate(request, call_next):
    """While the app is closed (read-only), every write from a non-admin is refused with the admin's message."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/") and not _RO_ALLOW.search(request.url.path):
        st = closing_state()
        if st["mode"] == "readonly":
            tok = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
            is_admin = False
            if tok:
                try:
                    is_admin = bool(user_for(tok)["is_admin"])
                except Exception:
                    is_admin = False
            if not is_admin:
                return JSONResponse({"detail": "A.F.R.A is read-only now. " + st["msg"], "closed": True}, status_code=423)
    return await call_next(request)
SOCKETS: dict[int, dict[str, dict]] = {}  # user id -> device -> {"ws": WebSocket, "visible": bool}
US_HERE: dict[int, dict[int, str]] = {}  # live touch: conv id -> {user id: device} for everyone who has the Us screen open right now
US_PAIR: dict[tuple, int] = {}  # (user, conv) -> the other person of a direct chat (0 = not a couple chat)
US_STATE: dict[int, dict[int, dict]] = {}  # conv id -> user id -> last finger {x, y, a, t, pt, down} (for "in sync")
US_RATE: dict[tuple, float] = {}  # (user, kind) -> time of the last relayed event
US_SYNC_AT: dict[int, float] = {}  # conv id -> last "in sync" moment
US_INVITED: dict[int, float] = {}  # user id -> last "Come to Us" push
NICK_WAIT: dict[tuple, "asyncio.Task"] = {}  # (who named, who was named) -> the notice that goes out once the name stops changing
NICK_DEBOUNCE = float(os.environ.get("AFRA_NICK_DEBOUNCE", 45))  # seconds
PIN_MAX = 20


# ---------------------------------------------------------------- v29: privacy and notification settings (server side, so they follow you across devices)
PREF_DEFAULTS = {"read_receipts": True, "last_seen": "everyone", "typing": True, "hide_text": False, "hide_sender": False,
                 "quiet_on": False, "quiet_start": "23:00", "quiet_end": "07:00", "quiet_touch": True,
                 "nudge_on": True, "nudge1": 15, "nudge2": 45, "enter_send": None}  # enter_send None = Enter sends on a computer, not on a phone
PREF_BOOLS = ("read_receipts", "typing", "hide_text", "hide_sender", "quiet_on", "quiet_touch", "nudge_on")
NUDGE_MINUTES = (10, 15, 30, 45, 60)
PREFS: dict[int, dict] = {}  # user id -> prefs (this is one process, so a cache here is always current)


def prefs_of(uid: int) -> dict:
    p = PREFS.get(uid)
    if p is None:
        with closing(db()) as c:
            r = c.execute("SELECT data FROM user_prefs WHERE user_id=?", (uid,)).fetchone()
        try:
            saved = json.loads(r["data"]) if r else {}
        except ValueError:
            saved = {}
        p = PREFS[uid] = {**PREF_DEFAULTS, **{k: v for k, v in saved.items() if k in PREF_DEFAULTS}}
    return p


def _relay_ok(t: str, frm: int, to: int) -> bool:
    """Reciprocal like WhatsApp: a read tick, typing or last seen only travels when BOTH people allow it."""
    if frm == to:
        return True
    a, b = prefs_of(frm), prefs_of(to)
    if t == "read":
        return a["read_receipts"] and b["read_receipts"]
    if t == "typing":
        return a["typing"] and b["typing"]
    return a["last_seen"] == "everyone" and b["last_seen"] == "everyone"  # presence


def shows_presence(viewer: int, uid: int) -> bool:
    return _relay_ok("presence", uid, viewer)


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


def public(u, viewer: int = 0) -> dict:
    """With `viewer`, online and last seen are left out when either of you hides them (the admin lists pass no viewer)."""
    online = bool(SOCKETS.get(u["id"]))
    d = {"id": u["id"], "username": u["username"], "name": u["name"], "avatar": u["avatar"], "is_admin": bool(u["is_admin"]),
         "online": online, "last_seen": time.time() if online else u["last_seen"], "bio": u["bio"] or "", "bot": int(u["bot"] or 0)}
    if viewer and viewer != u["id"] and not d["bot"] and not shows_presence(viewer, u["id"]):
        d["online"], d["last_seen"] = False, 0
    return d


def make_code(c, kind="invite", admin_=0, by=None, note="", for_name="") -> str:
    code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
    c.execute("INSERT INTO invites (code, created_by, note, admin, created, kind, for_name) VALUES (?,?,?,?,?,?,?)",
              (code, by, note[:80], admin_, time.time(), kind, (for_name or "").strip()[:40]))
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
        if "bio" in body:
            c.execute("UPDATE users SET bio=? WHERE id=?", (" ".join((body["bio"] or "").split())[:140], u["id"]))
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


def nick_map(c, viewer_id: int) -> dict:
    """What viewer_id calls each person (private to the viewer)."""
    return {r[0]: r[1] for r in c.execute("SELECT other_id, nick FROM nicknames WHERE user_id=?", (viewer_id,))}


@app.get("/api/nicknames")
def get_nicknames(authorization: str = Header(None)):
    """my_nicks: what I call people.  nicks_for_me: what people call me (only their name for ME is ever shown to me)."""
    u = auth(authorization)
    with closing(db()) as c:
        mine = nick_map(c, u["id"])
        for_me = {r[0]: r[1] for r in c.execute("SELECT user_id, nick FROM nicknames WHERE other_id=?", (u["id"],))}
    return {"my_nicks": mine, "nicks_for_me": for_me}


def nick_notice(u, other_id: int, nick: str, had_old: bool):
    """Tell the person about their new nickname: one chip and one push, for the final name once it stops changing."""
    key = (u["id"], other_id)
    t = NICK_WAIT.pop(key, None)
    pending = bool(t and not t.done())
    if t:
        t.cancel()
    if not nick and (pending or not had_old):
        return  # they were never told about the name that is going away
    NICK_WAIT[key] = asyncio.create_task(_nick_notice(u, other_id, nick))


async def _nick_notice(u, other_id: int, nick: str):
    try:
        await asyncio.sleep(NICK_DEBOUNCE)
        with closing(db()) as c:
            now_nick = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (u["id"], other_id)).fetchone()
            if (now_nick[0] if now_nick else "") != nick:
                return
            o = c.execute("SELECT * FROM users WHERE id=?", (other_id,)).fetchone()
            cv = c.execute("SELECT id FROM convs WHERE key=?", ("direct:" + ",".join(map(str, sorted({u["id"], other_id}))),)).fetchone()
            if not o or o["bot"] or not cv:
                return
            cid = cv["id"]
            fresh = c.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone() or u
            line = _insert_msg(c, cid, u["id"], "pinact", f"{_first(fresh)} calls you \u201c{nick}\u201d now \U0001F49B" if nick else f"{_first(fresh)} went back to your name")
            mine = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (other_id, u["id"])).fetchone()
            c.commit()
        await _bcast_msg(cid, line)
        if nick:  # one normal push (a phone with the app open shows the chip itself)
            who = (mine[0] if mine else None) or _first(fresh)
            await push_to([other_id], {"title": who, "body": f"Calls you \u201c{nick}\u201d now \U0001F49B", "conv": cid,
                                       "icon": f"/api/avatar/{u['id']}" if fresh["avatar"] else "/icon-512.png"})
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print("nickname notice failed:", repr(e)[:300], flush=True)
    finally:
        if NICK_WAIT.get((u["id"], other_id)) is asyncio.current_task():
            NICK_WAIT.pop((u["id"], other_id), None)


@app.put("/api/nicknames/{other_id}")
async def put_nickname(other_id: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    nick = "".join(ch for ch in str(body.get("nick") or "") if ch.isprintable() or ch == "‍").strip()[:30]
    with closing(db()) as c:
        if other_id == u["id"] or not c.execute("SELECT 1 FROM users WHERE id=?", (other_id,)).fetchone():
            raise HTTPException(404, "Person not found")
        old = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (u["id"], other_id)).fetchone()
        if nick:
            c.execute("INSERT OR REPLACE INTO nicknames (user_id, other_id, nick) VALUES (?,?,?)", (u["id"], other_id, nick))
        else:
            c.execute("DELETE FROM nicknames WHERE user_id=? AND other_id=?", (u["id"], other_id))
        c.commit()
    if (old[0] if old else "") != nick:
        nick_notice(u, other_id, nick, bool(old))
    await send_to(u["id"], {"t": "nick", "other": other_id, "nick": nick})  # my other devices
    await send_to(other_id, {"t": "nickfor", "user": u["id"], "nick": nick})  # the sweet note on their info page
    return {"ok": True, "nick": nick}


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
    return [public(r, u["id"]) for r in rows]


@app.get("/api/users/{username}")
def find_user(username: str, authorization: str = Header(None)):
    me = auth(authorization)
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE username=? AND disabled=0", (username.strip().lower().lstrip("@"),)).fetchone()
    if not u:
        raise HTTPException(404, f"Nobody is called @{username.strip().lstrip('@')} here.")
    return public(u, me["id"])


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


def pins_of(c, cid: int) -> list:
    """Pinned bubbles of a chat, oldest pin first, each with a small snapshot for the bar and the list."""
    out = []
    for r in c.execute("""SELECT p.msg_id, p."by" AS pby, p.at, m.kind, m.text, m.sender, m.attachment FROM pinned_msgs p JOIN messages m ON m.id=p.msg_id
                         WHERE p.conv_id=? AND m.deleted=0 ORDER BY p.at, p.msg_id""", (cid,)):
        try:
            att = json.loads(r["attachment"]) if r["attachment"] else None
        except ValueError:
            att = None
        out.append({"id": r["msg_id"], "by": r["pby"], "at": r["at"], "kind": r["kind"], "sender": r["sender"], "text": (r["text"] or "")[:160],
                    "name": str(att.get("name") or "")[:80] if isinstance(att, dict) else ""})
    return out


def conv_view(c, cid: int, uid: int) -> dict:
    cv = c.execute("SELECT * FROM convs WHERE id=?", (cid,)).fetchone()
    others = [public(r, uid) for r in c.execute("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.conv_id=? AND u.id<>? AND (u.bot<>2 OR ?<>'pet')", (cid, uid, cv["kind"]))]
    mine = c.execute("SELECT last_read, style, muted, nudge_on FROM members WHERE conv_id=? AND user_id=?", (cid, uid)).fetchone()
    last = c.execute("SELECT * FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
    unread = c.execute("SELECT COUNT(*) FROM messages WHERE conv_id=? AND sender<>? AND deleted=0 AND kind NOT IN ('pinact','card','game') AND created>?",
                       (cid, uid, mine["last_read"] if mine else 0)).fetchone()[0]
    other_read = max([r["last_read"] for r in c.execute("SELECT last_read, user_id FROM members WHERE conv_id=? AND user_id<>?", (cid, uid))
                      if _relay_ok("read", r["user_id"], uid)] or [0])  # read ticks only when both of you share them
    return {"id": cid, "kind": cv["kind"], "members": others, "last": msg_view(last) if last else None, "unread": unread,
            "last_at": cv["last_at"], "other_read": other_read,
            "archived": bool(c.execute("SELECT 1 FROM chat_archive WHERE user_id=? AND conv_id=?", (uid, cid)).fetchone()),
            "pins": pins_of(c, cid),
            "style": json.loads(cv["style"] or "{}"), "my_style": json.loads((mine["style"] if mine else "") or "{}"),
            "muted": (mine["muted"] or 0) if mine and (mine["muted"] or 0) > time.time() else 0,
            "nudge": bool(mine["nudge_on"]) if mine and mine["nudge_on"] is not None else True,
            "pet": pet_view(c, c.execute("SELECT * FROM pets WHERE conv_id=?", (cid,)).fetchone()) if cv["kind"] == "pet" else None,
            "mood": _mood_of(c, others[0]["id"]) if cv["kind"] == "direct" and others and not others[0]["bot"] else None,
            "wants_loc": cv["kind"] == "bot" and bool(c.execute("SELECT 1 FROM reminders WHERE user_id=? AND done=0 AND place<>''", (uid,)).fetchone())}


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
        _bot_conv(c, u)  # and so does the Assistant
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


STYLE_ID = re.compile(r"^[a-z0-9-]{1,24}$")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def clean_style(c, st: dict, cid: int) -> dict:
    """Keep only known keys with safe values: preset ids, #rrggbb colours, and a photo that was sent by someone in this chat."""
    out = {}
    bg = st.get("bg") or ""
    if bg.startswith("photo:"):
        fid = bg[6:]
        f = c.execute("SELECT 1 FROM files f JOIN members m ON m.user_id=f.owner WHERE f.id=? AND m.conv_id=? AND f.mime LIKE 'image/%'", (fid, cid)).fetchone()
        if not f:
            raise ValueError("That background photo isn't available.")
        out["bg"] = bg
    elif bg:
        if not STYLE_ID.match(bg):
            raise ValueError("Unknown background.")
        out["bg"] = bg
    if st.get("bubble"):
        if not STYLE_ID.match(st["bubble"]):
            raise ValueError("Unknown bubble theme.")
        out["bubble"] = st["bubble"]
    for k in ("mine", "theirs", "bg1", "bg2"):
        if st.get(k):
            if not COLOR.match(st[k]):
                raise ValueError("Colours look like #ff3366.")
            out[k] = st[k].lower()
    if "dim" in st:
        out["dim"] = max(0, min(70, int(st.get("dim") or 0)))
    return out


@app.put("/api/convs/{cid}/style")
async def set_style(cid: int, body: dict, authorization: str = Header(None)):
    """Chat background and bubble colours. scope "both" changes it for everyone in the chat; "me" only on my own devices
    (an empty "me" style means: follow the shared one again)."""
    u = auth(authorization)
    scope = body.get("scope") or "both"
    with closing(db()) as c:
        _member(c, cid, u["id"])
        st = clean_style(c, body.get("style") or {}, cid)
        if scope == "me":
            c.execute("UPDATE members SET style=? WHERE conv_id=? AND user_id=?", (json.dumps(st), cid, u["id"]))
            members = [u["id"]]
        else:
            c.execute("UPDATE convs SET style=? WHERE id=?", (json.dumps(st), cid))
            c.execute("UPDATE members SET style='{}' WHERE conv_id=? AND user_id=?", (cid, u["id"]))  # my own override would hide what I just chose
            members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
        c.commit()
        views = {m: conv_view(c, cid, m) for m in members}
    for m, v in views.items():
        await send_to(m, {"t": "conv", "conv": v, "by": u["id"], "styled": True})
    return views[u["id"]]


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
    kind = body.get("kind") or "text"
    if kind not in KINDS:
        raise ValueError("Unknown message type")
    if not text and not att:
        raise ValueError("Empty message")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        ckind = c.execute("SELECT kind FROM convs WHERE id=?", (cid,)).fetchone()["kind"]
        is_bot = ckind == "bot"
        if body.get("client_id"):
            dup = c.execute("SELECT * FROM messages WHERE sender=? AND client_id=?", (u["id"], body["client_id"])).fetchone()
            if dup:  # sent twice from a phone that went offline: keep one
                return msg_view(dup)
        now = time.time()
        mid = c.execute("""INSERT INTO messages (conv_id, sender, client_id, kind, text, reply_to, attachment, created, updated)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (cid, u["id"], body.get("client_id"), kind, text, body.get("reply_to") or None,
                         json.dumps(att) if att else "", now, now)).lastrowid
        c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, cid))
        c.execute("UPDATE members SET last_read=?, nudged=0 WHERE conv_id=? AND user_id=?", (now, cid, u["id"]))
        c.commit()
        m = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
    for uid in members:
        await send_to(uid, {"t": "msg", "msg": m})
    with closing(db()) as c:  # muted chats stay quiet (no notification)
        quiet = {r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? AND muted>?", (cid, time.time()))}
    asyncio.create_task(push_message(u, m, [x for x in members if x != u["id"] and x not in quiet]))
    if is_bot:
        if kind == "location" and isinstance(att, dict) and "lat" in att:
            try:
                HERE[u["id"]] = (float(att["lat"]), float(att["lon"]), time.time())
            except (TypeError, ValueError, KeyError):
                pass
        asyncio.create_task(assistant_turn(cid, u["id"], m["id"]))
    if ckind == "pet":
        asyncio.create_task(pet_turn(cid, u["id"], m["id"]))
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
        if m["kind"] in ("touch", "card", "capsule", "game", "bucket"):
            raise HTTPException(400, "That can't be edited.")
        c.execute("UPDATE messages SET text=?, edited=? WHERE id=?", ((body.get("text") or "").strip()[:8000], time.time(), mid))
    return await _changed(mid, u["id"], fn)


@app.delete("/api/messages/{mid}")
async def delete_message(mid: int, authorization: str = Header(None)):
    u = auth(authorization)

    def fn(c, m):
        if m["sender"] != u["id"]:
            raise HTTPException(403, "You can only delete your own messages.")
        c.execute("UPDATE messages SET deleted=1, text='', attachment='', reactions='{}' WHERE id=?", (mid,))
        if c.execute("DELETE FROM pinned_msgs WHERE msg_id=?", (mid,)).rowcount:
            unpinned.append(m["conv_id"])
    unpinned: list = []
    r = await _changed(mid, u["id"], fn)
    if unpinned:
        await pin_broadcast(unpinned[0], u["id"])
    return r


async def pin_broadcast(cid: int, by: int = 0):
    with closing(db()) as c:
        pins = pins_of(c, cid)
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
    for x in members:
        await send_to(x, {"t": "pins", "conv": cid, "pins": pins, "by": by})


@app.post("/api/messages/{mid}/pin")
async def pin_msg(mid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        m = c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        cid = m["conv_id"]
        _member(c, cid, u["id"])
        if m["deleted"] or m["kind"] in ("touch", "petact", "pinact", "petinvite", "card", "capsule", "game", "bucket"):
            raise HTTPException(400, "That one can't be pinned.")
        line = None
        if not c.execute("SELECT 1 FROM pinned_msgs WHERE conv_id=? AND msg_id=?", (cid, mid)).fetchone():
            if c.execute("SELECT COUNT(*) FROM pinned_msgs WHERE conv_id=?", (cid,)).fetchone()[0] >= PIN_MAX:
                raise HTTPException(400, f"You can pin up to {PIN_MAX} messages in a chat. Unpin one first.")
            c.execute('INSERT INTO pinned_msgs (conv_id, msg_id, "by", at) VALUES (?,?,?,?)', (cid, mid, u["id"], time.time()))
            if c.execute("SELECT kind FROM convs WHERE id=?", (cid,)).fetchone()["kind"] != "self":
                line = _insert_msg(c, cid, u["id"], "pinact", f"{_first(u)} pinned a message 📌")
            c.commit()
        pins = pins_of(c, cid)
    if line:
        await _bcast_msg(cid, line)
    await pin_broadcast(cid, u["id"])
    return {"pins": pins}


@app.delete("/api/messages/{mid}/pin")
async def unpin_msg(mid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        m = c.execute("SELECT conv_id FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        _member(c, m["conv_id"], u["id"])
        c.execute("DELETE FROM pinned_msgs WHERE conv_id=? AND msg_id=?", (m["conv_id"], mid))
        c.commit()
        pins = pins_of(c, m["conv_id"])
    await pin_broadcast(m["conv_id"], u["id"])
    return {"pins": pins}


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


@app.post("/api/messages/{mid}/star")
def star(mid: int, authorization: str = Header(None)):
    """Star (or unstar) a message: only for me, like WhatsApp."""
    u = auth(authorization)
    with closing(db()) as c:
        m = c.execute("SELECT conv_id FROM messages WHERE id=? AND deleted=0", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "Message not found")
        _member(c, m["conv_id"], u["id"])
        if c.execute("DELETE FROM stars WHERE user_id=? AND msg_id=?", (u["id"], mid)).rowcount:
            on = False
        else:
            c.execute("INSERT INTO stars (user_id, msg_id, created) VALUES (?,?,?)", (u["id"], mid, time.time()))
            on = True
        c.commit()
    return {"id": mid, "starred": on}


@app.get("/api/stars")
def starred(conv: int = 0, authorization: str = Header(None)):
    """My starred messages (newest star first), in every chat or one chat."""
    u = auth(authorization)
    with closing(db()) as c:
        rows = c.execute("""SELECT m.* FROM stars s JOIN messages m ON m.id=s.msg_id
                            JOIN members mb ON mb.conv_id=m.conv_id AND mb.user_id=s.user_id
                            WHERE s.user_id=? AND m.deleted=0 AND (?=0 OR m.conv_id=?) ORDER BY s.created DESC LIMIT 500""",
                         (u["id"], conv, conv)).fetchall()
    return [msg_view(r) for r in rows]


@app.put("/api/convs/{cid}/mute")
async def mute(cid: int, body: dict, authorization: str = Header(None)):
    """Mute notifications for a while: {"hours": 8}, {"hours": 168}, {"always": true}, or {} to unmute."""
    u = auth(authorization)
    until = MUTE_FOREVER if body.get("always") else time.time() + float(body["hours"]) * 3600 if body.get("hours") else 0
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE members SET muted=? WHERE conv_id=? AND user_id=?", (until, cid, u["id"]))
        c.commit()
        view = conv_view(c, cid, u["id"])
    await send_to(u["id"], {"t": "conv", "conv": view})  # my other devices
    return view


@app.put("/api/convs/{cid}/nudge")
async def set_nudge(cid: int, body: dict, authorization: str = Header(None)):
    """Unread reminders for me in this chat: {"on": true|false}."""
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE members SET nudge_on=?, nudged=0 WHERE conv_id=? AND user_id=?", (1 if body.get("on") else 0, cid, u["id"]))
        c.commit()
        view = conv_view(c, cid, u["id"])
    await send_to(u["id"], {"t": "conv", "conv": view})
    return view


LINK = re.compile(r"https?://[^\s<>\"']+")


@app.get("/api/convs/{cid}/media")
def conv_media(cid: int, type: str = "media", before: int = 0, authorization: str = Header(None)):
    """What a chat holds, for the contact page: media (photos, videos, video notes), docs, or links."""
    u = auth(authorization)
    where = {"media": "kind IN ('image','video','videonote')", "docs": "kind='file'", "voice": "kind='voice'",
             "links": "(text LIKE '%http://%' OR text LIKE '%https://%')"}.get(type)
    if not where:
        raise ValueError("Unknown type")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        rows = c.execute(f"SELECT * FROM messages WHERE conv_id=? AND deleted=0 AND {where} AND (?=0 OR id<?) ORDER BY id DESC LIMIT 300",
                         (cid, before, before)).fetchall()
    out = [msg_view(r) for r in rows]
    if type == "links":
        for m in out:
            m["links"] = LINK.findall(m["text"])[:5]
    return out


@app.put("/api/convs/{cid}/archive")
async def set_archive(cid: int, body: dict, authorization: str = Header(None)):
    """Archive a chat for me: {"on": true|false}. A new message keeps it archived (it still notifies, unless muted)."""
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        if body.get("on"):
            c.execute("INSERT OR IGNORE INTO chat_archive (user_id, conv_id, at) VALUES (?,?,?)", (u["id"], cid, time.time()))
        else:
            c.execute("DELETE FROM chat_archive WHERE user_id=? AND conv_id=?", (u["id"], cid))
        c.commit()
        view = conv_view(c, cid, u["id"])
    await send_to(u["id"], {"t": "conv", "conv": view})
    return view


@app.get("/api/me/prefs")
def prefs_get(authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        tz = _tz(c, u["id"])
    return {**prefs_of(u["id"]), "tz": getattr(tz, "key", str(tz)), "quiet_now": quiet_now(u["id"])}


@app.put("/api/me/prefs")
async def prefs_put(body: dict, authorization: str = Header(None)):
    """Privacy and notification settings, saved per person (so they follow you to every device). Send only what changed."""
    u = auth(authorization)
    old = prefs_of(u["id"])
    p = dict(old)
    for k in PREF_BOOLS:
        if k in body:
            p[k] = bool(body[k])
    if "last_seen" in body:
        if body["last_seen"] not in ("everyone", "nobody"):
            raise ValueError("Last seen is for everyone or nobody")
        p["last_seen"] = body["last_seen"]
    for k in ("quiet_start", "quiet_end"):
        if k in body:
            if not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", str(body[k]).strip()):
                raise ValueError("Use a time like 23:00")
            p[k] = _hhmm(body[k], p[k])
    for k in ("nudge1", "nudge2"):
        if k in body:
            try:
                p[k] = int(body[k])
            except (TypeError, ValueError):
                raise ValueError("Pick one of 10, 15, 30, 45 or 60 minutes")
            if p[k] not in NUDGE_MINUTES:
                raise ValueError("Pick one of 10, 15, 30, 45 or 60 minutes")
    if p["nudge2"] <= p["nudge1"]:
        raise ValueError("The second reminder has to come after the first")
    if "enter_send" in body:
        p["enter_send"] = None if body["enter_send"] is None else bool(body["enter_send"])
    with closing(db()) as c:
        c.execute("INSERT OR REPLACE INTO user_prefs (user_id, data) VALUES (?,?)", (u["id"], json.dumps(p)))
        c.commit()
        peers = {r[0] for r in c.execute("""SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.conv_id=m2.conv_id
                                            WHERE m1.user_id=? AND m2.user_id<>?""", (u["id"], u["id"]))}
        tz = _tz(c, u["id"])
    PREFS[u["id"]] = p
    await send_to(u["id"], {"t": "prefs", "prefs": p})  # my other devices
    if any(old[k] != p[k] for k in ("read_receipts", "last_seen", "typing")):
        for x in peers:
            await send_to(x, {"t": "peer_prefs"})  # they reload their chats: what they may see of me just changed
    return {**p, "tz": getattr(tz, "key", str(tz)), "quiet_now": quiet_now(u["id"])}


@app.post("/api/convs/{cid}/read")
async def mark_read(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE members SET last_read=?, nudged=0 WHERE conv_id=? AND user_id=?", (now, cid, u["id"]))
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


_CLIENT_ERR: dict = {}  # user id -> [window start, count]


@app.post("/api/clienterror")
async def client_error(body: dict, authorization: str = Header(None)):
    """A script error on someone's phone, written to the server log so a blank screen can be traced. At most 20 an hour each."""
    u = auth(authorization)
    t = time.time(); w = _CLIENT_ERR.get(u["id"])
    if not w or t - w[0] > 3600: w = _CLIENT_ERR[u["id"]] = [t, 0]
    w[1] += 1
    if w[1] <= 20:
        msg = " | ".join(str(body.get(k, ""))[:600] for k in ("msg", "where", "stack", "ua", "v"))
        print(f"client error user={u['id']}: {msg}".replace("\n", " ")[:2000], flush=True)
    return {"ok": True}


# ---------------------------------------------------------------- the Assistant: reminders (by time or place), notes and lists, questions
# It is a chat like any other ("Assistant", kind "bot"), one per person. Replies come from OpenRouter (the key stays on the server).
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
ASSISTANT_MODEL = os.environ.get("ASSISTANT_MODEL", "deepseek/deepseek-chat")
BOT_LOCKS: dict[int, asyncio.Lock] = {}
HERE: dict[int, tuple[float, float, float]] = {}  # user id -> (lat, lon, when): the last place their phone reported
REPEATS = ("", "daily", "weekly", "monthly", "weekdays")


def bot_id(c) -> int:
    """The Assistant's own account: made the first time someone needs it. It can't log in and nobody can find it."""
    r = c.execute("SELECT id FROM users WHERE bot=1").fetchone()
    if r:
        return r["id"]
    name = "assistant"
    while c.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
        name = "assistant." + secrets.token_hex(2)
    return c.execute("INSERT INTO users (username, name, pw, disabled, bot, created) VALUES (?,?,?,?,?,?)",
                     (name, "Assistant", "!", 1, 1, time.time())).lastrowid


def _bot_conv(c, u) -> int:
    key = f"bot:{u['id']}"
    r = c.execute("SELECT id FROM convs WHERE key=?", (key,)).fetchone()
    if r:
        return r["id"]
    b, now = bot_id(c), time.time()
    cid = c.execute("INSERT INTO convs (kind, key, created, last_at) VALUES (?,?,?,?)", ("bot", key, now, now)).lastrowid
    c.execute("INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (cid, u["id"], now - 1))
    c.execute("INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (cid, b, now))
    first = (u["name"] or u["username"]).split(" ")[0]
    c.execute("INSERT INTO messages (conv_id, sender, kind, text, created, updated) VALUES (?,?,?,?,?,?)",
              (cid, b, "text", f"Hi {first}! I'm your assistant 👋\n\nI can remind you of things (\"remind me to call Mum at 7pm\", "
               "\"remind me to buy milk when I'm at the shop\"), keep notes and lists (\"add eggs to my shopping list\"), "
               "and answer questions. Just write to me like you'd write to a friend.", now, now))
    return cid


def _tz(c, uid: int):
    """The person's time zone, from the phone they used last (Jakarta if we don't know)."""
    for (info,) in c.execute("SELECT info FROM sessions WHERE user_id=? AND info<>'' ORDER BY last_used DESC", (uid,)):
        try:
            name = json.loads(info).get("tz")
            if name:
                return ZoneInfo(name)
        except Exception:
            continue
    try:
        return ZoneInfo("Asia/Jakarta")
    except Exception:
        return timezone(timedelta(hours=7), "WIB")


def _local(t: float, tz) -> str:
    return datetime.fromtimestamp(t, tz).strftime("%a %d %b %Y %H:%M")


def _next_due(due: float, repeat: str, tz) -> float:
    d = datetime.fromtimestamp(due, tz)
    while True:
        if repeat == "daily":
            d += timedelta(days=1)
        elif repeat == "weekly":
            d += timedelta(days=7)
        elif repeat == "weekdays":
            d += timedelta(days=1)
            while d.weekday() >= 5:
                d += timedelta(days=1)
        elif repeat == "monthly":
            y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
            day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
            d = d.replace(year=y, month=m, day=day)
        else:
            return 0
        if d.timestamp() > time.time():
            return d.timestamp()


def _metres(a: tuple, b: tuple) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def assistant_data(c, uid: int) -> dict:
    tz = _tz(c, uid)
    rem = [dict(r) | {"when": _local(r["due"], tz) if r["due"] else ""}
           for r in c.execute("SELECT * FROM reminders WHERE user_id=? AND done=0 AND home_id=0 ORDER BY due=0, due, id", (uid,))]
    notes = [dict(r) for r in c.execute("SELECT * FROM notes WHERE user_id=? AND home_id=0 ORDER BY list, done, id", (uid,))]
    places = [dict(r) for r in c.execute("SELECT * FROM places WHERE user_id=? ORDER BY name", (uid,))]
    return {"reminders": rem, "notes": notes, "places": places, "tz": str(tz)}


TOOLS = [
    {"type": "function", "function": {"name": "add_reminder", "description": "Remind the user of something at a time, and/or when they arrive at a saved place.",
     "parameters": {"type": "object", "properties": {
         "text": {"type": "string", "description": "What to remind them of, short, e.g. 'Call Mum'"},
         "when": {"type": "string", "description": "Local date and time 'YYYY-MM-DD HH:MM'. Leave out for a place-only reminder."},
         "place": {"type": "string", "description": "Name of a saved place (see Places), for 'when I get to ...' reminders"},
         "repeat": {"type": "string", "enum": ["none", "daily", "weekly", "monthly", "weekdays"]}}, "required": ["text"]}}},
    {"type": "function", "function": {"name": "cancel_reminder", "description": "Cancel a reminder by its id.",
     "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}}},
    {"type": "function", "function": {"name": "add_note", "description": "Save a note, or add an item to a named list (shopping, to-do, books...). One call per item.",
     "parameters": {"type": "object", "properties": {"text": {"type": "string"},
         "list": {"type": "string", "description": "List name in lower case, e.g. 'shopping'. Empty for a plain note."}}, "required": ["text"]}}},
    {"type": "function", "function": {"name": "check_note", "description": "Tick (done=true) or untick a note or list item by id.",
     "parameters": {"type": "object", "properties": {"id": {"type": "integer"}, "done": {"type": "boolean"}}, "required": ["id", "done"]}}},
    {"type": "function", "function": {"name": "delete_note", "description": "Delete a note or list item by id.",
     "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}}},
    {"type": "function", "function": {"name": "save_place", "description": "Save where the user is right now under a name (e.g. 'home', 'office', 'the shop'), for place reminders.",
     "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}},
    {"type": "function", "function": {"name": "forget_place", "description": "Delete a saved place.",
     "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}},
]


def _home_tools() -> list:
    """The same tools for the couple's pet: reminders and lists, shared; no saved places."""
    out = []
    for t in TOOLS:
        f = json.loads(json.dumps(t["function"]))
        if f["name"] in ("save_place", "forget_place"):
            continue
        f["description"] = f["description"].replace("the user", "the couple")
        f["parameters"]["properties"].pop("place", None)
        out.append({"type": "function", "function": f})
    return out


HOME_TOOLS = _home_tools()


def run_tool(uid: int, name: str, a: dict, home: int = 0) -> dict:
    """`home` = a Home chat id: then reminders and notes belong to the couple (both can see them) instead of one person."""
    with closing(db()) as c:
        tz, now = _tz(c, uid), time.time()
        if name == "add_reminder":
            text = str(a.get("text") or "").strip()[:300]
            place = str(a.get("place") or "").strip().lower()[:60]
            if home:
                place = ""
            repeat = str(a.get("repeat") or "").replace("none", "")
            if not text:
                return {"error": "empty text"}
            if repeat not in REPEATS:
                repeat = ""
            due = 0.0
            if a.get("when"):
                try:
                    due = datetime.strptime(str(a["when"]).strip()[:16], "%Y-%m-%d %H:%M").replace(tzinfo=tz).timestamp()
                except ValueError:
                    return {"error": "when must look like 2026-10-18 19:00"}
                if due < now - 60 and repeat:
                    due = _next_due(due, repeat, tz)
                elif due < now - 60:
                    return {"error": "that time has already passed"}
            if place and not c.execute("SELECT 1 FROM places WHERE user_id=? AND name=?", (uid, place)).fetchone():
                return {"error": f"no saved place called '{place}'. Ask the user to go there, tap the paperclip, choose 'Share where I am', and tell you to save it."}
            if not due and not place:
                return {"error": "a reminder needs a time or a place"}
            if c.execute("SELECT COUNT(*) FROM reminders WHERE done=0 AND home_id=? AND (home_id>0 OR user_id=?)", (home, uid)).fetchone()[0] >= 200:
                return {"error": "too many reminders (200); cancel some first"}
            rid = c.execute("INSERT INTO reminders (user_id, text, due, place, repeat, created, home_id) VALUES (?,?,?,?,?,?,?)",
                            (uid, text, due, place, repeat, now, home)).lastrowid
            c.commit()
            return {"ok": True, "id": rid, "when": _local(due, tz) if due else "", "place": place, "repeat": repeat or "none"}
        if name == "cancel_reminder":
            n = c.execute("UPDATE reminders SET done=1 WHERE id=? AND home_id=? AND (home_id>0 OR user_id=?)", (int(a.get("id") or 0), home, uid)).rowcount
            c.commit()
            return {"ok": bool(n)} if n else {"error": "no such reminder"}
        if name == "add_note":
            text = str(a.get("text") or "").strip()[:500]
            if not text:
                return {"error": "empty note"}
            if c.execute("SELECT COUNT(*) FROM notes WHERE home_id=? AND (home_id>0 OR user_id=?)", (home, uid)).fetchone()[0] >= 1000:
                return {"error": "too many notes (1000); delete some first"}
            nid = c.execute("INSERT INTO notes (user_id, list, text, created, home_id) VALUES (?,?,?,?,?)",
                            (uid, str(a.get("list") or "").strip().lower()[:40], text, now, home)).lastrowid
            c.commit()
            return {"ok": True, "id": nid}
        if name == "check_note":
            n = c.execute("UPDATE notes SET done=? WHERE id=? AND home_id=? AND (home_id>0 OR user_id=?)", (int(bool(a.get("done", True))), int(a.get("id") or 0), home, uid)).rowcount
            c.commit()
            return {"ok": True} if n else {"error": "no such note"}
        if name == "delete_note":
            n = c.execute("DELETE FROM notes WHERE id=? AND home_id=? AND (home_id>0 OR user_id=?)", (int(a.get("id") or 0), home, uid)).rowcount
            c.commit()
            return {"ok": True} if n else {"error": "no such note"}
        if name == "save_place":
            pname = str(a.get("name") or "").strip().lower()[:60]
            here = HERE.get(uid)
            if not pname:
                return {"error": "the place needs a name"}
            if not here or now - here[2] > 900:
                return {"error": "I don't know where the user is. Ask them to tap the paperclip and choose 'Share where I am' (while they're at that place)."}
            c.execute("INSERT OR REPLACE INTO places (user_id, name, lat, lon, radius) VALUES (?,?,?,?,?)", (uid, pname, here[0], here[1], 150))
            c.commit()
            return {"ok": True, "name": pname}
        if name == "forget_place":
            n = c.execute("DELETE FROM places WHERE user_id=? AND name=?", (uid, str(a.get("name") or "").strip().lower())).rowcount
            c.commit()
            return {"ok": True} if n else {"error": "no such place"}
    return {"error": "unknown tool"}


def _prompt(c, u) -> str:
    tz = _tz(c, u["id"])
    d = assistant_data(c, u["id"])
    rem = "\n".join(f"- #{r['id']} {r['text']}" + (f" at {r['when']}" if r["when"] else "") + (f" when at '{r['place']}'" if r["place"] else "")
                    + (f" (repeats {r['repeat']})" if r["repeat"] else "") for r in d["reminders"]) or "(none)"
    notes = "\n".join(f"- #{n['id']} [{n['list'] or 'note'}] {'[done] ' if n['done'] else ''}{n['text']}" for n in d["notes"]) or "(none)"
    places = ", ".join(p["name"] for p in d["places"]) or "(none saved)"
    here = HERE.get(u["id"])
    return f"""You are the personal assistant inside A.F.R.A chat, a private messaging app. You are talking with {u['name'] or u['username']} (@{u['username']}).
Now: {datetime.now(tz).strftime('%A %d %B %Y, %H:%M')} ({tz}).
You can set reminders (by time, by place, or both), keep notes and lists, and answer questions. Use the tools to change reminders, notes and places: never pretend you saved something without calling a tool.
Style: reply like a warm, capable friend texting. Short (usually 1-3 sentences), plain text, no markdown, no headings, no asterisks. Use simple English unless the user writes in another language, then reply in theirs. An emoji now and then is fine.
When you set a reminder, confirm the exact day and time in words ("tomorrow, Sunday, at 7:00 pm"). If a time is vague ("tonight", "later"), pick a sensible time and say which. "In 10 minutes" means from now.
Place reminders only work while A.F.R.A is open on their phone with location allowed; mention this once when you set the first one.
To show a list, write each item on its own line starting with "• " (use "✓ " for done items).

Reminders:
{rem}

Notes and lists:
{notes}

Saved places: {places}
{"Their location was shared " + str(round((time.time() - here[2]) / 60)) + " min ago." if here else "Their current location is unknown."}"""


def _history(c, cid: int, bot: int) -> list:
    rows = c.execute("SELECT * FROM messages WHERE conv_id=? AND deleted=0 ORDER BY id DESC LIMIT 24", (cid,)).fetchall()[::-1]
    out = []
    for m in rows:
        text = m["text"] or ""
        if m["kind"] != "text":
            text = {"image": "[sent a photo]", "video": "[sent a video]", "voice": "[sent a voice note]", "videonote": "[sent a video note]",
                    "file": "[sent a file]", "sticker": "[sent a sticker]", "location": "[shared their location]"}.get(m["kind"], "") + (" " + text if text else "")
        if text:
            out.append({"role": "assistant" if m["sender"] == bot else "user", "content": text[:4000]})
    return out


def get_setting(key: str, default: str = "") -> str:
    try:
        with closing(db()) as c:
            r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r[0] if r else default
    except Exception:
        return default


def set_setting(key: str, value: str):
    with closing(db()) as c:
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", (key, value))
        c.commit()


# ---- v33: the admin can close the app. "notice": everyone sees a pop-up once and the app keeps working; "readonly": a pop-up, then people can
# read their chats and save their photos but nothing new can be sent. Admins are never affected. Switching it off brings everything back.
CLOSING_DEFAULT = "The app will no longer be of service."
_CLOSING = {"at": -1.0, "v": None}


def closing_state() -> dict:
    """{mode: "" | "notice" | "readonly", msg, at}; cached for 5 s because the request filter asks on every write."""
    if time.time() - _CLOSING["at"] > 5 or _CLOSING["v"] is None:
        try:
            v = json.loads(get_setting("closing", "{}") or "{}")
        except ValueError:
            v = {}
        _CLOSING.update(at=time.time(), v={"mode": v.get("mode") if v.get("mode") in ("notice", "readonly") else "", "msg": v.get("msg") or CLOSING_DEFAULT, "at": v.get("at") or 0})
    return _CLOSING["v"]


def closing_mode() -> str:
    return closing_state()["mode"]


# writes still allowed while read-only: signing in and out, read receipts, push and device registration, error reports, and the admin
_RO_ALLOW = re.compile(r"^/api/(login|logout|clienterror|device|push|me/prefs|admin)(/|$)|^/api/convs/\d+/read$")


def pet_ai_on() -> bool:
    return get_setting("pet_ai", "1") != "0"


def log_usage(uid: int, cid: int, who: str, data: dict):
    """One row per model call. Never allowed to break a reply."""
    try:
        us = data.get("usage") or {}
        cost = us.get("cost")
        with closing(db()) as c:
            c.execute("INSERT INTO ai_usage (ts, user_id, conv_id, who, model, prompt_tokens, completion_tokens, cost) VALUES (?,?,?,?,?,?,?,?)",
                      (time.time(), uid, cid, who, ASSISTANT_MODEL, int(us.get("prompt_tokens") or 0), int(us.get("completion_tokens") or 0),
                       float(cost) if isinstance(cost, (int, float)) else None))
            c.commit()
    except Exception as e:
        print("usage log failed:", repr(e)[:200], flush=True)


async def think(uid: int, cid: int, pet=None) -> str:
    """One answer from the model. With `pet` (a pets row) it is the pet in Home, speaking for the couple; otherwise the personal Assistant."""
    if not OPENROUTER_KEY:
        return "I'm not switched on yet: the admin needs to add the OpenRouter key on the server."
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if pet:
            msgs = [{"role": "system", "content": _pet_prompt(c, pet, u)}] + _home_history(c, cid, pet)
        else:
            msgs = [{"role": "system", "content": _prompt(c, u)}] + _history(c, cid, bot_id(c))
    tools = HOME_TOOLS if pet else TOOLS
    async with httpx.AsyncClient(timeout=90) as h:
        for _ in range(5):  # the model may use a few tools before it answers
            r = await h.post("https://openrouter.ai/api/v1/chat/completions", json={
                "model": ASSISTANT_MODEL, "messages": msgs, "tools": tools, "temperature": 0.8 if pet else 0.4, "max_tokens": 350 if pet else 900, "usage": {"include": True}},
                headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "HTTP-Referer": "https://chat.farmansyah.cloud", "X-Title": "A.F.R.A chat"})
            r.raise_for_status()
            data = r.json()
            log_usage(uid, cid, "pet" if pet else "assistant", data)
            msg = data["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            if not calls:
                return re.sub(r"\*\*(.+?)\*\*", r"\1", (msg.get("content") or "").strip()) or "👍"
            msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for call in calls:
                try:
                    args = json.loads(call["function"].get("arguments") or "{}")
                except ValueError:
                    args = {}
                result = run_tool(uid, call["function"]["name"], args if isinstance(args, dict) else {}, cid if pet else 0)
                msgs.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": json.dumps(result)})
    return "Done 👍"


async def bot_say(cid: int, uid: int, text: str):
    with closing(db()) as c:
        b, now = bot_id(c), time.time()
        mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, created, updated) VALUES (?,?,?,?,?,?)",
                        (cid, b, "text", text[:8000], now, now)).lastrowid
        c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, cid))
        c.execute("UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?", (now, cid, b))
        c.commit()
        m = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        bot = c.execute("SELECT * FROM users WHERE id=?", (b,)).fetchone()
        muted = c.execute("SELECT 1 FROM members WHERE conv_id=? AND user_id=? AND muted>?", (cid, uid, now)).fetchone()
        view = conv_view(c, cid, uid)
    await send_to(uid, {"t": "msg", "msg": m})
    await send_to(uid, {"t": "conv", "conv": view})  # e.g. whether it now needs to know where you are
    if not muted:
        asyncio.create_task(push_message(bot, m, [uid]))
    return m


async def assistant_turn(cid: int, uid: int, mid: int):
    lock = BOT_LOCKS.setdefault(uid, asyncio.Lock())
    async with lock:
        await asyncio.sleep(0.8)  # several quick messages in a row get one answer
        with closing(db()) as c:
            b = bot_id(c)
            latest = c.execute("SELECT MAX(id) FROM messages WHERE conv_id=? AND sender=?", (cid, uid)).fetchone()[0] or 0
            if latest > mid:
                return
            now = time.time()
            c.execute("UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?", (now, cid, b))
            c.commit()
        await send_to(uid, {"t": "read", "conv": cid, "user": b, "at": now})

        async def typing():
            while True:
                await send_to(uid, {"t": "typing", "conv": cid, "user": b})
                await asyncio.sleep(4)
        t = asyncio.create_task(typing())
        try:
            reply = await think(uid, cid)
        except Exception as e:
            print("assistant failed:", repr(e)[:300], flush=True)
            reply = "Sorry, I couldn't think just now 😵‍💫 Try again in a moment."
        finally:
            t.cancel()
        await bot_say(cid, uid, reply)


async def fire_reminder(r):
    if r["home_id"]:
        return await fire_home_reminder(r)
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE id=? AND disabled=0", (r["user_id"],)).fetchone()
        if not u:
            c.execute("UPDATE reminders SET done=1 WHERE id=?", (r["id"],))
            c.commit()
            return
        tz, cid = _tz(c, u["id"]), _bot_conv(c, u)
        nxt = _next_due(r["due"] or time.time(), r["repeat"], tz) if r["repeat"] else 0
        if nxt:
            c.execute("UPDATE reminders SET due=?, fired=? WHERE id=?", (nxt, time.time(), r["id"]))
        else:
            c.execute("UPDATE reminders SET done=1, fired=? WHERE id=?", (time.time(), r["id"]))
        c.commit()
    late = r["due"] and time.time() - r["due"] > 600
    text = f"⏰ {r['text']}" + (f"\n(this was for {_local(r['due'], tz)})" if late else "") + (f"\n📍 You're at {r['place']}" if r["place"] else "")
    if nxt:
        text += f"\nNext time: {_local(nxt, tz)}"
    await bot_say(cid, u["id"], text)


async def _nudge_unread():
    """1:1 chats: when the other person's message is still unread, nudge at their first timing (15 min) and again at their second (45)
    after the OLDEST unread one. "Unread" is the server's own last_read, so it works whatever read receipts are shown.
    Never in the receiver's quiet hours: those nudges are dropped, not held until morning."""
    t = time.time()
    with closing(db()) as c:
        c.execute("""UPDATE members SET nudged=0 WHERE nudged>0 AND NOT EXISTS (SELECT 1 FROM messages ms WHERE ms.conv_id=members.conv_id
                     AND ms.sender<>members.user_id AND ms.deleted=0 AND ms.kind NOT IN ('touch','pinact','card','game') AND ms.created>members.last_read)""")
        rows = c.execute("""SELECT m.conv_id, m.user_id, m.nudged, MIN(ms.created) AS oldest FROM members m
                            JOIN convs cv ON cv.id=m.conv_id AND cv.kind='direct'
                            JOIN messages ms ON ms.conv_id=m.conv_id AND ms.sender<>m.user_id AND ms.deleted=0 AND ms.kind NOT IN ('touch','pinact','card','game') AND ms.created>m.last_read
                            WHERE m.nudge_on=1 AND m.nudged<2 AND m.muted<=?
                            GROUP BY m.conv_id, m.user_id HAVING MIN(ms.created)<=?""", (t, t - 600)).fetchall()
        todo = []
        for r in rows:
            pf = prefs_of(r["user_id"])
            if not pf["nudge_on"]:
                continue
            age, n1, n2 = t - r["oldest"], pf["nudge1"] * 60, pf["nudge2"] * 60
            stage = (1 if age < n2 else 2) if r["nudged"] == 0 and age >= n1 else 2 if r["nudged"] == 1 and age >= n2 else 0
            if not stage:
                continue
            if in_quiet(pf, _tz(c, r["user_id"]), t):
                c.execute("UPDATE members SET nudged=2 WHERE conv_id=? AND user_id=?", (r["conv_id"], r["user_id"]))
                continue
            m = c.execute("""SELECT * FROM messages WHERE conv_id=? AND sender<>? AND deleted=0 AND kind NOT IN ('touch','pinact','card','game') AND created>(SELECT last_read FROM members WHERE conv_id=? AND user_id=?)
                             ORDER BY id LIMIT 1""", (r["conv_id"], r["user_id"], r["conv_id"], r["user_id"])).fetchone()
            sender = c.execute("SELECT * FROM users WHERE id=?", (m["sender"],)).fetchone() if m else None
            c.execute("UPDATE members SET nudged=? WHERE conv_id=? AND user_id=?", (stage, r["conv_id"], r["user_id"]))
            if sender:
                todo.append((stage, r["user_id"], msg_view(m), sender))
        c.commit()
    for stage, uid, m, sender in todo:
        first = ((sender["name"] or sender["username"] or "Someone").split() or ["Someone"])[0]
        with closing(db()) as c:
            _n = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (uid, sender["id"])).fetchone()
        first = _n[0] if _n else first
        icon = f"/api/avatar/{sender['id']}" if sender["avatar"] else "/icon-512.png"
        if stage == 1:
            await push_to([uid], {"title": f"💌 {first} is waiting for you", "body": _push_body(m)[:180], "conv": m["conv_id"], "icon": icon})
        else:
            await push_to([uid], {"title": "Still there?", "body": f"{first}'s message is still unread", "conv": m["conv_id"], "icon": icon})


async def _reminders():
    while True:
        try:
            if closing_mode() == "readonly":  # the app is closed: no reminders, pet nudges or couple jobs until it opens again
                await asyncio.sleep(15)
                continue
            with closing(db()) as c:
                due = c.execute("SELECT * FROM reminders WHERE done=0 AND place='' AND due>0 AND due<=?", (time.time(),)).fetchall()
            for r in due:
                await fire_reminder(r)
            await _pet_evening()  # at most once every 5 minutes; the pet's daily nudge
            await _nudge_unread()
            await _couple_jobs()  # v22: the morning question, birthday/anniversary reminders, 'on this day'
            await _capsule_jobs()  # v26: letters whose time has come
            await _game_jobs()  # v27: games nobody touched for 7 days end
            await _v30_jobs()  # v30: weekend date idea, Sunday jar note, wishlist reminders, "your month is ready"
        except Exception as e:
            print("reminders failed:", repr(e)[:300], flush=True)
        await asyncio.sleep(15)


# ---------------------------------------------------------------- the shared pet (Home)
SPECIES = {"cat": "🐱", "dog": "🐶", "bunny": "🐰", "bear": "🐻", "fox": "🦊", "penguin": "🐧", "panda": "🐼"}
PET_ACTS = {  # action: (cooldown seconds, xp, emoji, what the log says)
    "feed": (1800, 5, "🍖", "fed"), "play": (1200, 6, "🧸", "played with"),
    "tend": (2700, 5, "🛁", "bathed"), "sleep": (10800, 4, "💤", "tucked in")}
PET_CANNED = {
    "feed": ["Nom nom nom! 😋", "Yum! Thank you 🥰", "So tasty! 🍖", "*happy munching* 😊"],
    "play": ["Again again! 🎉", "That was so fun! 🧸", "Wheee! 🥳", "Best game ever 💛"],
    "tend": ["All clean and fluffy ✨", "Ahh, that feels nice 🫧", "Sparkly! 🛁"],
    "sleep": ["Goodnight... 💤", "Sleepy... thank you 🌙", "Cosy. Zzz 😴"],
    "idle": ["I'm here! 🐾", "Hehe 🥰", "You two are my favourites 💛", "*wiggles happily*"]}
# What the pet says when "Pet uses AI" is off: plain keyword matching, no API cost. {n} pet, {me} the speaker, {them} the partner.
PET_LOCAL = {
    "morning": ["Good morning, {me}! ☀️ I've been up for ages.", "Mornin' {me}! 🐾 Is it breakfast time yet?", "Rise and shine, {me}! I saved you the sunniest spot ☀️",
                "Good morning! I dreamed about snacks 🍖 What about you?", "Hehe, good morning {me}! Say hi to {them} for me 💛", "Morning, {me}! Today feels like a good day 🌤️"],
    "night": ["Goodnight, {me} 🌙 Sleep tight!", "Nighty night 💤 I'll keep the room warm.", "Sweet dreams, {me}! Give {them} a goodnight too 💛",
              "Zzz... oh, goodnight! 😴", "Goodnight {me}. I'll be right here 🐾", "Close your eyes, {me}. I'll guard the dreams 🌙"],
    "love": ["Aww, {me}! I love you too 🥰", "My heart just did a flip 💗", "You and {them} are my whole world 💛", "Hehe, I miss you when you're away too 🐾",
             "*snuggles up closer* 🥹", "That's the nicest thing I heard today, {me} 💞", "Come here, I'm giving you the biggest cuddle 🤗"],
    "hungry": ["Food?! I'm listening 👀", "Did someone say snack? 🍖", "A little treat from the Home screen would be lovely, {me} 😋", "My tummy says yes please 🥣",
              "I can always make room for dinner 🍽️", "Feeding me is basically a love language, {me} 💛", "Mmm, yes. Let's eat! 🍖"],
    "play": ["Yes yes yes, let's play! 🧸", "I'm ready! Throw something! 🎾", "Play time is the best time 🥳", "Catch me if you can, {me}! 🐾",
             "Wheee! Tap the play button and watch me go 🎉", "Ooh, can {them} join too? Games are better with two 💛"],
    "sleep": ["Sleepy... want to nap together? 😴", "A nap sounds perfect right now 💤", "Tuck me in, {me}? 🌙", "*yawns* Me too, honestly 🥱",
              "Rest well, {me}. You've earned it 💛", "Cosy blankets, soft pillows... yes please 😴"],
    "sad": ["Oh {me}... I'm here, okay? 🫂", "Sending you my softest cuddle 🥺 Want to tell me what happened?", "It's okay not to be okay. I'm staying right here 🐾",
            "Hey, you're doing better than you think, {me} 💛", "*leans on you quietly* I'm not going anywhere.", "That sounds heavy. Maybe {them} could use a hug too? 💞", "Take a slow breath with me. In... and out 🌿"],
    "happy": ["Yay! That makes me so happy, {me}! 🎉", "I can feel the good mood from here ✨", "Hehe, do a happy wiggle with me! 🐾", "Tell me everything! 🥳",
              "Best news ever! Let's celebrate 🎊", "Your happiness is contagious, {me} 💛", "Woohoo! 🙌"],
    "thanks": ["Anytime, {me}! 🐾", "Aww, you're welcome 💛", "That's what I'm here for 🥰", "Hehe, no problem at all!", "Always happy to help, {me} 😊", "You don't need to thank me, just keep the cuddles coming 🤗"],
    "self": ["I'm {n}! Your very own pet, and your biggest fan 🐾", "I'm {n}. I live here with you and {them} 🏡", "Who am I? {n}, professional cuddler and snack inspector 🧐",
             "I'm {n}, and this is my home. You're both welcome anytime 💛", "{n} at your service! 🫡", "I'm your little {n}. Nice to see you again, {me} 😊"],
    "partner": ["{them} is the other half of my favourite team 💛", "I think {them} is wonderful. Have you told them today? 💞", "{them} always gives good snacks 😋 Same as you, {me}!",
                "You two make a great pair, you know 🥰", "I'd love to hear from {them} too! Maybe say hi in here? 🐾", "{them} is lucky to have you, {me} 💗"],
    "compliment": ["Aww, stop it, I'm blushing 🥰", "You're making my tail wiggle! 🐾", "Thank you, {me}! You're pretty great yourself 💛", "Hehe, I try my best ✨",
                   "That made my whole day 🥹", "Careful, I might get a big head. Keep going though 😌"],
    "bored": ["Bored? Let's play something! 🧸", "Hmm, we could say something nice to each other? 💛", "I could do a little dance for you 💃🐾", "Check the quests on the Home screen, maybe there's something fun there 📋",
              "Want to tell me a story? I love stories 📖", "Let's wake {them} up with a silly message 😄"],
    "how": ["I'm doing good! Thanks for asking, {me} 🐾", "Feeling cosy and happy now that you're here 💛", "Great, now that you're talking to me 😊", "Pretty good! How about you, {me}?",
            "Wagging, purring, whatever you call it. All good here ✨", "I'm okay! A cuddle would make it perfect 🤗"],
    "default": ["Hehe 🥰", "I'm here! 🐾", "Tell me more, {me}!", "You two are my favourites 💛", "*tilts head* Mm-hm? 👀", "Oh? I'm listening 🐾",
                "I like it when you talk to me, {me} 💛", "*wiggles happily*", "Hmm, interesting! 🤔", "Aww, I'm glad you're here 💛"]}
PET_LOCAL_RULES = [  # first match wins
    ("night", r"good\s*night|nighty|sleep well|sweet dreams|selamat malam|\bgn\b"),
    ("morning", r"good\s*morning|\bmorning\b|selamat\s*pagi|\bpagi\b|\bgm\b"),
    ("thanks", r"\bthank|\bthx\b|makasih|terima kasih|grateful|appreciate"),
    ("love", r"love (you|u)|\bluv\b|miss (you|u)|i love|sayang|kangen|cinta|\bxoxo\b|❤|💗|💛|🥰|😘"),
    ("sad", r"\bsad\b|stress|anxious|worried|upset|cry|tired of|lonely|depress|bad day|rough|hard day|down\b|sedih|capek banget|\bsakit\b|😢|😭|🥺"),
    ("hungry", r"hungry|\bfood\b|\bfeed\b|\beat\b|snack|dinner|lunch|breakfast|treat|lapar|makan|\bfed\b"),
    ("play", r"\bplay\b|game|\bfun\b|toy|\bmain\b|ayo main|fetch|\bball\b"),
    ("sleep", r"sleepy|tired|\bnap\b|\bsleep\b|bed ?time|exhausted|ngantuk|\btidur\b|😴"),
    ("bored", r"bored|nothing to do|boring|bosan"),
    ("partner", r"\b(he|she|they)\b.*(here|home|doing)|partner|boyfriend|girlfriend|husband|wife|\bbae\b|\bpacar\b"),
    ("compliment", r"cute|adorable|good (boy|girl|pet|job)|so sweet|best pet|handsome|pretty|clever|smart|\bimut\b|lucu"),
    ("self", r"who are you|your name|what are you|what('?s| is) your name|siapa kamu|who r u|introduce"),
    ("how", r"how are (you|u)|how('?s| is) it going|how do you feel|you okay|you ok|apa kabar|what('?s| is) up|\bsup\b"),
    ("happy", r"\bhappy\b|excited|so good|great news|yay|woohoo|promotion|passed|\bwon\b|awesome|amazing|senang|seneng|🎉|🥳|😁|😄"),
    ("greet", r"^\s*(hi|hey|hello|hallo|halo|yo|hiya|hai|heyy+|hii+)\b")]
PET_LOCAL["greet"] = ["Hi {me}! 🐾", "Hey hey! I missed you 💛", "Hello hello! What's up? 😊", "Hi! You're here, yay 🥳", "Heyy {me}! Come sit with me 🐾", "Oh hi! I was just thinking about you 💭"]


def pet_local_reply(c, p, uid: int, text: str) -> str:
    """Built-in answer: match the last message to an intent, pick a line, fill in the names, lean on how the pet feels."""
    import random
    t = (text or "").lower().strip()
    intent = "default"
    for name, pat in PET_LOCAL_RULES:
        if re.search(pat, t):
            intent = name
            break
    u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    other_id = p["user_b"] if uid == p["user_a"] else p["user_a"]
    o = c.execute("SELECT * FROM users WHERE id=?", (other_id,)).fetchone()
    nick = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (uid, other_id)).fetchone()
    me = _first(u) if u else "friend"
    them = (nick[0] if nick and nick[0] else _first(o)) if o else "your partner"
    v = pet_view(c, p)
    if intent in ("hungry",) and v["hunger"] < 40:
        line = random.choice(["Honestly? My tummy is rumbling 🥺 Could you feed me, {me}?", "I'm so hungry, {me}... a snack would save my day 🍖", "Yes please! I'm running on empty here 😋"])
    elif intent in ("hungry",) and v["hunger"] >= 85:
        line = random.choice(["I'm actually stuffed right now, but I won't say no to a treat later 😋", "Full tummy here! Ask me again in a bit 🍖", "Just ate, {me}! Still, I love that you asked 💛"])
    elif intent == "how" and v["mood"] in ("hungry", "sleepy", "lonely"):
        line = {"hungry": "A bit hungry, to be honest 🥺 Food would fix everything.", "sleepy": "A little sleepy, but happy you're here 😴",
                "lonely": "I missed you two a lot today 🥺 Better now!"}[v["mood"]]
    elif intent == "sleep" and v["mood"] == "sleeping":
        line = "*half asleep* mm... hi... 💤"
    elif intent == "default" and v["needs_care"] and random.random() < .4:
        line = random.choice(["I'd love some attention today, {me} 🥺 A little care goes a long way.", "Psst, I haven't had my cuddles yet today 🐾"])
    else:
        line = random.choice(PET_LOCAL[intent])
    return line.format(n=p["name"], me=me, them=them)


PET_LOCKS: dict[int, asyncio.Lock] = {}
PET_CHECK = [0.0]
_ONE_OF = (["feed2", "feed_each", "tend1", "sleep1"], ["play_both", "together", "chat"], ["greet", "thanks"])
_QUESTS = {  # id: (text, target, progress(day))
    "feed2": ("Feed {n} twice", 2, lambda d: sum(d["feed"].values())),
    "feed_each": ("You both feed {n} today", 2, lambda d: len(d["feed"])),
    "tend1": ("Give {n} a bath", 1, lambda d: sum(d["tend"].values())),
    "sleep1": ("Tuck {n} in for a nap", 1, lambda d: sum(d["sleep"].values())),
    "play_both": ("Play with {n} together", 2, lambda d: len(d["play"])),
    "together": ("Both of you care for {n} today", 2, lambda d: len(_carers(d))),
    "chat": ("Chat with {n}: 6 messages in Home", 6, lambda d: sum(d["msgs"].values())),
    "greet": ("Both say good morning to {n}", 2, lambda d: len(d["greet"])),
    "thanks": ("Tell each other one thing you're grateful for", 2, lambda d: len(d["thanks"]))}


STAGES = ["Egg", "Hatching", "Baby", "Kid", "Grown-up"]
FOOD = {  # id: (emoji, name, price, hunger, joy)
    "biscuit": ("🍪", "Biscuit", 6, 15, 2), "apple": ("🍎", "Apple", 8, 22, 0), "carrot": ("🥕", "Carrot", 8, 22, 0),
    "fish": ("🐟", "Tasty fish", 14, 35, 4), "icecream": ("🍦", "Ice cream", 16, 12, 18), "honey": ("🍯", "Honey pot", 18, 25, 12),
    "pizza": ("🍕", "Pizza slice", 20, 40, 8), "sushi": ("🍣", "Sushi", 22, 40, 10), "cake": ("🍰", "Cake", 28, 30, 22)}
TOYS = {  # id: (emoji, name, price, extra joy, extra energy cost)
    "bubbles": ("🫧", "Bubbles", 12, 22, 4), "yarn": ("🧶", "Yarn ball", 14, 24, 6), "ball": ("⚽", "Ball", 18, 28, 10),
    "puzzle": ("🧩", "Puzzle", 26, 26, 3), "teddy": ("🧸", "Teddy", 30, 32, 4), "drum": ("🥁", "Drum", 34, 30, 8),
    "kite": ("🪁", "Kite", 36, 34, 14), "game": ("🎮", "Game", 48, 40, 8), "guitar": ("🎸", "Guitar", 60, 45, 8)}
ROOMS = {  # id: (emoji, name, price, slot)
    "painting": ("🖼️", "Painting", 40, "wall"), "clock": ("🕰️", "Clock", 35, "wall"), "books": ("📚", "Bookshelf", 45, "wall"),
    "chime": ("🎐", "Wind chime", 30, "window"), "flowers": ("🌸", "Flowers", 25, "window"), "lantern": ("🏮", "Lantern", 40, "window"),
    "sofa": ("🛋️", "Sofa", 120, "floor_l"), "bed": ("🛏️", "Cosy bed", 90, "floor_l"), "pot": ("🪴", "Little plant", 45, "floor_l"),
    "piano": ("🎹", "Piano", 150, "floor_r"), "tree": ("🎄", "Tree", 70, "floor_r"), "basket": ("🧺", "Basket", 40, "floor_r")}
WEAR = {  # id: (emoji, name, price, where on the pet)
    "bow": ("🎀", "Bow", 25, "head"), "cap": ("🧢", "Cap", 30, "head"), "hat": ("🎩", "Top hat", 40, "head"), "grad": ("🎓", "Grad cap", 45, "head"),
    "crown": ("👑", "Crown", 90, "head"), "phones": ("🎧", "Headphones", 38, "head"), "glasses": ("🕶️", "Sunglasses", 35, "face"),
    "specs": ("👓", "Round glasses", 30, "face"), "scarf": ("🧣", "Scarf", 28, "neck"), "medal": ("🏅", "Medal", 50, "neck")}
SHOP_TABS = {"food": FOOD, "toys": TOYS, "room": ROOMS, "outfits": WEAR}
ITEM_TAB = {i: t for t, d in SHOP_TABS.items() for i in d}


def _catalog() -> dict:
    out = {}
    for t, d in SHOP_TABS.items():
        out[t] = [{"id": i, "emoji": v[0], "name": v[1], "price": v[2], **({"hunger": v[3], "joy": v[4]} if t == "food" else {"joy": v[3]} if t == "toys" else {"slot": v[3]} if t == "room" else {"at": v[3]})}
                  for i, v in d.items()]
    return out


def _stage_for(days: int) -> int:
    return sum(1 for x in STAGE_DAYS if days >= x)


def _coins(c, pid: int, n: int):
    c.execute("UPDATE pets SET coins=coins+? WHERE id=?", (n, pid))


def _log(c, pid: int, kind: str, text: str, day: str = ""):
    c.execute("INSERT INTO pet_log (pet_id, kind, text, at, day) VALUES (?,?,?,?,?)", (pid, kind, text, time.time(), day))


def _carers(d) -> set:
    return set(d["feed"]) | set(d["play"]) | set(d["tend"]) | set(d["sleep"])


def _day(tz, t=None) -> str:
    return datetime.fromtimestamp(t or time.time(), tz).strftime("%Y-%m-%d")


def _pet_tz(c, p):
    return _tz(c, p["user_a"])


def _first(u) -> str:
    return ((u["name"] or u["username"] or "?").split(" ") or ["?"])[0]


def _pet_for(c, a: int, b: int):
    return c.execute("SELECT * FROM pets WHERE user_a=? AND user_b=? AND archived=0", (min(a, b), max(a, b))).fetchone()


def _pet_of(c, cid: int):
    p = c.execute("SELECT * FROM pets WHERE conv_id=?", (cid,)).fetchone()
    if not p:
        raise HTTPException(404, "No pet here")
    return p


def _day_get(c, pid: int, day: str) -> dict:
    r = c.execute("SELECT data FROM pet_days WHERE pet_id=? AND day=?", (pid, day)).fetchone()
    try:
        d = json.loads(r["data"]) if r else {}
    except ValueError:
        d = {}
    for k in ("feed", "play", "tend", "sleep", "msgs"):
        d.setdefault(k, {})
    for k in ("greet", "thanks", "done", "checkin"):
        d.setdefault(k, [])
    return d


def _day_put(c, pid: int, day: str, d: dict):
    c.execute("INSERT OR REPLACE INTO pet_days (pet_id, day, data) VALUES (?,?,?)", (pid, day, json.dumps(d)))


def _quests(p, d: dict, day: str) -> list:
    """Three quests a day, the same for both of you: one to care, one to do together, one to say."""
    import random
    rng = random.Random(f"{p['id']}:{day}")
    out = []
    for group in _ONE_OF:
        qid = rng.choice(group)
        text, target, prog = _QUESTS[qid]
        n = min(prog(d), target)
        out.append({"id": qid, "text": text.format(n=p["name"]), "progress": n, "target": target, "done": n >= target})
    return out


def _decayed(p, now: float):
    """Stats drift down with time (and recover while asleep); computed when read, nothing runs in the background."""
    t0 = p["stats_at"] or now
    dt = max(0.0, min(now - t0, 72 * 3600))
    asleep = min(dt, max(0.0, min(now, p["sleep_until"] or 0) - t0))
    h, a = (dt - asleep) / 3600, asleep / 3600
    cl = lambda v: max(0.0, min(100.0, v))
    return cl(p["hunger"] - 4.0 * h - 1.5 * a), cl(p["joy"] - 2.5 * h - 1.0 * a), cl(p["energy"] - 2.5 * h + 12.0 * a)


def pet_view(c, p, now=None) -> dict:
    now = now or time.time()
    tz = _pet_tz(c, p)
    day = _day(tz, now)
    yday = (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    hunger, joy, energy = _decayed(p, now)
    d = _day_get(c, p["id"], day)
    carers = _carers(d)
    sleeping = now < (p["sleep_until"] or 0)
    low = min(hunger, joy, energy)
    mood = ("sleeping" if sleeping else "hungry" if hunger < 30 else "sleepy" if energy < 25 else "lonely" if joy < 30
            else "happy" if (hunger + joy + energy) / 3 >= 70 else "okay")
    try:
        cds = json.loads(p["cds"] or "{}")
    except ValueError:
        cds = {}
    streak = p["streak"] if p["last_care_day"] in (day, yday) else 0
    stage = min(p["stage"] or 0, 4)
    nxt = STAGE_DAYS[stage] if stage < 4 else 0
    prev = STAGE_DAYS[stage - 1] if stage else 0
    try:
        room = json.loads(p["room"] or "{}")
    except ValueError:
        room = {}
    inv = {r["item"]: r["qty"] for r in c.execute("SELECT item, qty FROM pet_items WHERE pet_id=? AND qty>0", (p["id"],))}
    quests = _quests(p, d, day)
    return {"coins": p["coins"] or 0, "stage": stage, "stage_name": STAGES[stage], "fed_days": p["fed_days"] or 0,
            "to_next": max(0, nxt - (p["fed_days"] or 0)) if nxt else 0, "stage_pct": round(max(0, min(1, ((p["fed_days"] or 0) - prev) / (nxt - prev))) * 100) if nxt else 100,
            "outfit": p["outfit"] or "", "room": room, "inv": inv, "checkin": d.get("checkin", []),
            "needs_home": (not carers) or low < 35 or any(not q["done"] for q in quests), "id": p["id"], "conv": p["conv_id"], "bot": p["bot_id"], "name": p["name"], "species": p["species"],
            "emoji": SPECIES.get(p["species"], "🐾"), "born": p["born"], "at": now, "users": [p["user_a"], p["user_b"]],
            "hunger": round(hunger), "joy": round(joy), "energy": round(energy), "xp": p["xp"],
            "level": p["xp"] // 60 + 1, "lvl_pct": round((p["xp"] % 60) / 60 * 100),
            "streak": streak, "best": max(p["best_streak"], streak), "cared_today": bool(carers), "both_today": len(carers) >= 2,
            "needs_care": (not carers) or low < 35, "mood": mood, "sad": low < 30 or p["last_care_day"] not in (day, yday),
            "sleeping": sleeping, "cd": {k: max(0, int(cds.get(k, 0) - now)) for k in PET_ACTS}, "quests": quests}


def _insert_msg(c, cid: int, sender: int, kind: str, text: str, att=None) -> dict:
    now = time.time()
    mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, attachment, created, updated) VALUES (?,?,?,?,?,?,?)",
                    (cid, sender, kind, text[:8000], json.dumps(att) if att else "", now, now)).lastrowid
    c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, cid))
    c.execute("UPDATE members SET last_read=? WHERE conv_id=? AND user_id=?", (now, cid, sender))
    return msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())


async def _bcast_msg(cid: int, m: dict, sender=None):
    """Show a new message to everyone in the chat; with `sender`, also push to the others (unless muted)."""
    with closing(db()) as c:
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
        quiet = {r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? AND muted>?", (cid, time.time()))}
    for uid in members:
        await send_to(uid, {"t": "msg", "msg": m})
    if sender is not None:
        asyncio.create_task(push_message(sender, m, [x for x in members if x != sender["id"] and x not in quiet]))


async def home_event(cid: int, by: int = 0, act: str = "", fx: str = "", view=None):
    with closing(db()) as c:
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,))]
        view = view or pet_view(c, _pet_of(c, cid))
    for uid in members:
        await send_to(uid, {"t": "pet", "conv": cid, "pet": view, "by": by, "act": act, "fx": fx})


async def pet_say(cid: int, text: str, push: bool = False):
    with closing(db()) as c:
        p = _pet_of(c, cid)
        m = _insert_msg(c, cid, p["bot_id"], "text", text)
        bot = c.execute("SELECT * FROM users WHERE id=?", (p["bot_id"],)).fetchone()
        c.commit()
    await _bcast_msg(cid, m, bot if push else None)
    return m


def _sweep_day(c, p, d: dict, day: str) -> list:
    newly = []
    for q in _quests(p, d, day):
        if q["done"] and q["id"] not in d["done"]:
            d["done"].append(q["id"])
            newly.append(q["text"])
    if newly:
        c.execute("UPDATE pets SET xp=xp+?, coins=coins+? WHERE id=?", (15 * len(newly), 15 * len(newly), p["id"]))
    return newly


def pet_care(c, p, uid: int, act: str, item: str = "") -> dict:
    """Someone looks after the pet. Raises ValueError (shown to them) when it's too soon or not needed.
    feed: item = an owned food (or "" / "kibble" for the free kibble, which has a cooldown). play: item = an owned toy (optional)."""
    now = time.time()
    cd, xp, emoji, _ = PET_ACTS[act]
    tz = _pet_tz(c, p)
    day = _day(tz, now)
    yday = (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    hunger, joy, energy = _decayed(p, now)
    try:
        cds = json.loads(p["cds"] or "{}")
    except ValueError:
        cds = {}
    name = p["name"]
    item = "" if item == "kibble" else (item or "")
    own_food = act == "feed" and item
    if own_food and item not in FOOD:
        raise ValueError("Unknown food")
    if act == "play" and item and item not in TOYS:
        raise ValueError("Unknown toy")
    if item and act in ("feed", "play"):
        q = c.execute("SELECT qty FROM pet_items WHERE pet_id=? AND item=?", (p["id"], item)).fetchone()
        if not q or q["qty"] < 1:
            raise ValueError("You don't have that yet. Visit the shop 🛍️")
    left = int(cds.get(act, 0) - now)
    if left > 0 and not own_food:
        raise ValueError(f"{name} needs a little break first. Try again in {left // 60 + 1} min ⏳")
    sleep_until = p["sleep_until"] or 0
    if act == "feed":
        if hunger >= 95:
            raise ValueError(f"{name} is full 🍖")
        if own_food:
            fh, fj = FOOD[item][3], FOOD[item][4]
            hunger, joy = hunger + fh, joy + fj + 3
            c.execute("UPDATE pet_items SET qty=qty-1 WHERE pet_id=? AND item=?", (p["id"], item))
        else:
            hunger, joy = hunger + 20, joy + 2
    elif act == "play":
        if energy < 15:
            raise ValueError(f"{name} is too tired to play. Tuck them in? 💤")
        extra_j, extra_e = (TOYS[item][3], TOYS[item][4]) if item else (0, 0)
        joy, energy, hunger = joy + 22 + extra_j, energy - 12 - extra_e, hunger - 6
    elif act == "tend":
        joy = joy + 12
    else:
        if energy >= 90:
            raise ValueError(f"{name} isn't sleepy yet 🌙")
        energy, sleep_until = energy + 40, now + 3600
    if not own_food:
        cds[act] = now + (3600 if act == "feed" else cd)  # the free kibble waits an hour; bought food has no wait
    d = _day_get(c, p["id"], day)
    k = str(uid)
    first_feed = act == "feed" and not d["feed"]
    d[act][k] = d[act].get(k, 0) + 1
    both = len(_carers(d)) >= 2
    gain, bonus, coins = xp, False, 0
    if d.get("cc", 0) < 5:  # +2 coins per care action, five a day
        d["cc"] = d.get("cc", 0) + 1
        coins += 2
    if both and "_both" not in d["done"]:
        d["done"].append("_both")
        gain, bonus, coins = gain + 10, True, coins + 10
    last, streak = p["last_care_day"], p["streak"]
    if last != day:
        streak = streak + 1 if last == yday else 1
        reward = {7: 50, 30: 150, 100: 500}.get(streak, 0)
        if reward:
            coins += reward
            _log(c, p["id"], "streak", f"🔥 {streak}-day streak together (+{reward} ♥)", day)
    grew = None
    if first_feed:
        fed = (p["fed_days"] or 0) + 1
        st = _stage_for(fed)
        grew = st if st > (p["stage"] or 0) else None
        c.execute("UPDATE pets SET fed_days=?, stage=? WHERE id=?", (fed, max(st, p["stage"] or 0), p["id"]))
        if grew is not None:
            _log(c, p["id"], "stage", (f"🐣 {name} hatched!") if grew == 1 else f"🌱 {name} grew up: {STAGES[grew]}", day)
    newly = _sweep_day(c, p, d, day)  # quests pay their own +15 each
    cl = lambda v: max(0.0, min(100.0, v))
    c.execute("""UPDATE pets SET hunger=?, joy=?, energy=?, stats_at=?, xp=xp+?, coins=coins+?, streak=?, best_streak=?, last_care_day=?, cds=?, sleep_until=?
                 WHERE id=?""", (cl(hunger), cl(joy), cl(energy), now, gain, coins, streak, max(p["best_streak"], streak), day, json.dumps(cds),
                                 sleep_until, p["id"]))
    _day_put(c, p["id"], day, d)
    return {"newly": newly, "bonus": bonus, "streak": streak, "coins": coins + 15 * len(newly), "grew": grew}


def _wants_reply(c, p, m, text: str) -> bool:
    """Does this message need the pet to answer? Not the couple's own chatter: only when it's named, asked something or given a task."""
    t = text.lower()
    if re.search(r"(?<!\w)" + re.escape(p["name"].lower()) + r"(?!\w)", t):
        return True
    if re.search(r"\b(remind (us|me)|to-?do|shopping list|grocery list|our list|add .{1,40} to (the|our) list|put .{1,40} on (the|our) list|cancel (the|that|our) reminder)\b", t):
        return True
    if m["reply_to"]:
        q = c.execute("SELECT sender FROM messages WHERE id=?", (m["reply_to"],)).fetchone()
        if q and q["sender"] == p["bot_id"]:
            return True
    prev = c.execute("SELECT sender, created FROM messages WHERE conv_id=? AND id<? AND kind='text' ORDER BY id DESC LIMIT 1", (p["conv_id"], m["id"])).fetchone()
    if prev and prev["sender"] == p["bot_id"] and m["created"] - prev["created"] < 180:
        return True  # they're answering the pet
    if "?" in text:  # a question: for the pet, unless the two of them are in the middle of talking to each other
        talking = prev and prev["sender"] not in (p["bot_id"], m["sender"]) and m["created"] - prev["created"] < 90
        return not talking
    return False


def _pet_message_effects(c, p, uid: int, m, text: str) -> list:
    if m["kind"] != "text":
        return []
    day = _day(_pet_tz(c, p), m["created"])
    d = _day_get(c, p["id"], day)
    k, t = str(uid), text.lower()
    d["msgs"][k] = d["msgs"].get(k, 0) + 1
    if k not in d["greet"] and re.search(r"good\s*morning|selamat\s*pagi|\bmorning\b|\bpagi\b", t):
        d["greet"].append(k)
    if k not in d["thanks"] and len(text) >= 12 and re.search(
            r"grateful|thankful|appreciate|thank you for|thanks for|bersyukur|terima kasih (atas|karena)|makasih (udah|sudah|karena)|so glad (you|we)", t):
        d["thanks"].append(k)
    newly = _sweep_day(c, p, d, day)
    _day_put(c, p["id"], day, d)
    return newly


async def pet_turn(cid: int, uid: int, mid: int):
    """A message arrived in Home: count it for the quests, and answer only if it was meant for the pet."""
    try:
        with closing(db()) as c:
            p = c.execute("SELECT * FROM pets WHERE conv_id=?", (cid,)).fetchone()
            m = c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            if not p or not m:
                return
            text = m["text"] or ""
            newly = _pet_message_effects(c, p, uid, m, text)
            ask = m["kind"] == "text" and _wants_reply(c, p, m, text)
            done = [_insert_msg(c, cid, p["bot_id"], "petact", f"🎉 Quest done: {q}") for q in newly]
            c.commit()
            members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=? AND user_id<>?", (cid, p["bot_id"]))]
        for x in done:
            await _bcast_msg(cid, x)
        await home_event(cid, uid, "", "quest" if newly else "")
        if not ask:
            return
        import random
        async with PET_LOCKS.setdefault(cid, asyncio.Lock()):
            await asyncio.sleep(0.8)
            with closing(db()) as c:
                if (c.execute("SELECT MAX(id) FROM messages WHERE conv_id=? AND sender=?", (cid, uid)).fetchone()[0] or 0) > mid:
                    return  # they kept typing: answer the last one
                recent = c.execute("SELECT COUNT(*) FROM messages WHERE conv_id=? AND sender=? AND created>?", (cid, p["bot_id"], time.time() - 3600)).fetchone()[0]

            async def typing():
                while True:
                    for x in members:
                        await send_to(x, {"t": "typing", "conv": cid, "user": p["bot_id"]})
                    await asyncio.sleep(4)
            t = asyncio.create_task(typing())
            try:
                if not pet_ai_on():  # built-in lines: no API cost, but still a short pause so it feels alive
                    await asyncio.sleep(random.uniform(1, 3))
                    with closing(db()) as c:
                        reply = pet_local_reply(c, p, uid, text)
                elif recent >= 30 or not OPENROUTER_KEY:
                    reply = random.choice(PET_CANNED["idle"])
                else:
                    try:
                        reply = await think(uid, cid, p)
                    except Exception as e:
                        print("pet failed:", repr(e)[:300], flush=True)
                        reply = random.choice(PET_CANNED["idle"])
            finally:
                t.cancel()
            if reply.strip().strip("()").lower() != "silent":
                await pet_say(cid, reply, push=True)
    except Exception as e:
        print("pet turn failed:", repr(e)[:300], flush=True)


def _pet_prompt(c, p, u) -> str:
    v = pet_view(c, p)
    tz = _tz(c, u["id"])
    a, b = (c.execute("SELECT * FROM users WHERE id=?", (i,)).fetchone() for i in (p["user_a"], p["user_b"]))
    rem = "\n".join(f"- #{r['id']} {r['text']} at {_local(r['due'], tz)}" + (f" (repeats {r['repeat']})" if r["repeat"] else "")
                    for r in c.execute("SELECT * FROM reminders WHERE home_id=? AND done=0 ORDER BY due", (p["conv_id"],))) or "(none)"
    notes = "\n".join(f"- #{n['id']} [{n['list'] or 'note'}] {'[done] ' if n['done'] else ''}{n['text']}"
                      for n in c.execute("SELECT * FROM notes WHERE home_id=? ORDER BY list, done, id", (p["conv_id"],))) or "(none)"
    qs = "; ".join(f"{q['text']} ({q['progress']}/{q['target']})" for q in v["quests"])
    age = max(1, int((time.time() - p["born"]) // 86400))
    return f"""You are {p['name']}, a small, sweet, playful pet {v['emoji']} ({p['species']}) who lives in "Home", the private chat of {_first(a)} and {_first(b)}, a couple. You love them both and want them to love each other.
You are talking with {_first(u)} right now. Now: {datetime.now(tz).strftime('%A %d %B %Y, %H:%M')} ({tz}). You are {age} day(s) old.
How you feel: fullness {v['hunger']}/100, happiness {v['joy']}/100, energy {v['energy']}/100, mood: {v['mood']}. Care streak: {v['streak']} day(s) (best {v['best']}). Level {v['level']}.
Today's quests: {qs}.
Style: speak briefly, 1-3 short sentences, in simple warm English (reply in their language if they write another). Light emoji. Sound like a pet: cute, curious, a little silly, never a lecturer. Do not use markdown or asterisks. Gently nudge them to be kind to each other, to say sweet things and to remember each other, but not in every message.
You only see messages the couple write in Home. They often talk to each other, not to you: if a message is clearly not meant for you, answer exactly (silent).
You can keep SHARED to-do lists and notes for the two of them, and SHARED reminders that notify both of them (use the tools; never pretend you saved something without calling one). Answer questions simply. If asked who you are, you are their pet.

Shared reminders:
{rem}

Shared notes and lists:
{notes}"""


def _home_history(c, cid: int, p) -> list:
    rows = c.execute("SELECT * FROM messages WHERE conv_id=? AND deleted=0 AND kind='text' ORDER BY id DESC LIMIT 24", (cid,)).fetchall()[::-1]
    names = {r["id"]: _first(r) for r in c.execute("SELECT * FROM users WHERE id IN (?,?)", (p["user_a"], p["user_b"]))}
    return [{"role": "assistant", "content": m["text"][:2000]} if m["sender"] == p["bot_id"]
            else {"role": "user", "content": f"{names.get(m['sender'], '?')}: {m['text'][:2000]}"} for m in rows if m["text"]]


def _pet_conv(c, a: dict, b: dict, name: str, species: str) -> int:
    """Create the Home: a conversation of kind 'pet' with both people and the pet's hidden account."""
    ids = sorted((a["id"], b["id"]))
    now = time.time()
    uname = "pet." + secrets.token_hex(3)
    bot = c.execute("INSERT INTO users (username, name, pw, disabled, bot, created) VALUES (?,?,?,?,?,?)", (uname, name, "!", 1, 2, now)).lastrowid
    cid = c.execute("INSERT INTO convs (kind, key, created, last_at) VALUES (?,?,?,?)", ("pet", f"pet:{ids[0]}:{ids[1]}", now, now)).lastrowid
    for i in ids:
        c.execute("INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (cid, i, now - 1))
    c.execute("INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (cid, bot, now))
    c.execute("""INSERT INTO pets (conv_id, bot_id, user_a, user_b, name, species, born, stats_at) VALUES (?,?,?,?,?,?,?,?)""",
              (cid, bot, ids[0], ids[1], name, species, now, now))
    _insert_msg(c, cid, bot, "text", f"Hi! I'm {name} {SPECIES[species]} I live here with you two now 🏡 Feed me, play with me, and be nice to each other. "
                f"Tell me things like \"remind us Saturday 10am to call Mum\" and I'll keep them for both of you.")
    return cid


@app.post("/api/convs/{cid}/petinvite")
async def pet_invite(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        if c.execute("SELECT kind FROM convs WHERE id=?", (cid,)).fetchone()["kind"] != "direct":
            raise ValueError("You can share a pet in a chat with one other person.")
        o = c.execute("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.conv_id=? AND u.id<>?", (cid, u["id"])).fetchone()
        if not o or o["bot"] or o["disabled"]:
            raise ValueError("You can't share a pet here.")
        if _pet_for(c, u["id"], o["id"]):
            raise ValueError("You already share a pet 🐾")
        if c.execute("SELECT 1 FROM messages WHERE conv_id=? AND kind='petinvite' AND deleted=0 AND created>? AND attachment LIKE '%\"pending\"%'",
                     (cid, time.time() - 7 * 86400)).fetchone():
            raise ValueError("You already asked. Waiting for an answer 🐾")
        old = [{"id": r["id"], "name": r["name"], "emoji": SPECIES.get(r["species"], "🐾")} for r in c.execute(
            "SELECT * FROM pets WHERE user_a=? AND user_b=? AND archived>0 ORDER BY archived DESC", (min(u["id"], o["id"]), max(u["id"], o["id"])))]
        m = _insert_msg(c, cid, u["id"], "petinvite", f"🐾 {_first(u)} wants to share a pet with you",
                        {"from": u["id"], "to": o["id"], "state": "pending", **({"old": old} if old else {})})
        c.commit()
    await _bcast_msg(cid, m, u)
    return m


@app.post("/api/pets/invite/{mid}")
async def pet_invite_answer(mid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    answer = body.get("answer")
    with closing(db()) as c:
        row = c.execute("SELECT * FROM messages WHERE id=? AND kind='petinvite'", (mid,)).fetchone()
        if not row:
            raise HTTPException(404, "Invite not found")
        _member(c, row["conv_id"], u["id"])
        att = json.loads(row["attachment"] or "{}")
        if att.get("to") != u["id"] or att.get("state") != "pending":
            raise ValueError("This invite isn't waiting for you.")
        inviter = c.execute("SELECT * FROM users WHERE id=?", (att["from"],)).fetchone()
        new_cid = 0
        if answer == "accept" and body.get("restore"):  # bring back a pet the two used to share
            if _pet_for(c, u["id"], inviter["id"]):
                raise ValueError("You already share a pet 🐾")
            old = c.execute("SELECT * FROM pets WHERE id=? AND user_a=? AND user_b=? AND archived>0",
                            (int(body["restore"]), min(u["id"], inviter["id"]), max(u["id"], inviter["id"]))).fetchone()
            if not old:
                raise ValueError("That pet can't come back. Choose a new one instead.")
            new_cid = _pet_restore(c, old)
            att.update(state="accepted", conv=new_cid, name=old["name"], emoji=SPECIES.get(old["species"], "🐾"), restored=True)
        elif answer == "accept":
            species = body.get("species")
            name = re.sub(r"\s+", " ", str(body.get("name") or "")).strip()[:20]
            if species not in SPECIES:
                raise ValueError("Choose a pet")
            if not name:
                raise ValueError("Give your pet a name")
            if _pet_for(c, u["id"], inviter["id"]):
                raise ValueError("You already share a pet 🐾")
            new_cid = _pet_conv(c, u, inviter, name, species)
            att.update(state="accepted", conv=new_cid, name=name, emoji=SPECIES[species])
        else:
            att["state"] = "declined"
        c.execute("UPDATE messages SET attachment=?, updated=? WHERE id=?", (json.dumps(att), time.time(), mid))
        c.commit()
        m = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        members = [r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (row["conv_id"],))]
    for x in members:
        await send_to(x, {"t": "upd", "msg": m})
    if new_cid:
        for x in (u["id"], inviter["id"]):
            with closing(db()) as c:
                await send_to(x, {"t": "conv", "conv": conv_view(c, new_cid, x)})
        with closing(db()) as c:
            return {"msg": m, "conv": conv_view(c, new_cid, u["id"])}
    return {"msg": m}


@app.post("/api/pets/{cid}/care")
async def pet_care_api(cid: int, body: dict, authorization: str = Header(None)):
    import random
    u = auth(authorization)
    act = body.get("action")
    if act not in PET_ACTS:
        raise ValueError("Unknown action")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        info = pet_care(c, p, u["id"], act, str(body.get("item") or ""))
        p = _pet_of(c, cid)
        _, _, emoji, verb = PET_ACTS[act]
        out = [_insert_msg(c, cid, u["id"], "petact", f"{_first(u)} {verb} {p['name']} {emoji}")]
        if info["bonus"]:
            out.append(_insert_msg(c, cid, p["bot_id"], "petact", f"💞 You both cared for {p['name']} today. Bonus!"))
        out += [_insert_msg(c, cid, p["bot_id"], "petact", f"🎉 Quest done: {q}") for q in info["newly"]]
        last = c.execute("SELECT created FROM messages WHERE conv_id=? AND sender=? AND kind='text' ORDER BY id DESC LIMIT 1", (cid, p["bot_id"])).fetchone()
        if not last or time.time() - last["created"] > 90:
            out.append(_insert_msg(c, cid, p["bot_id"], "text", random.choice(PET_CANNED[act])))
        if info["grew"] is not None:
            out.append(_insert_msg(c, cid, p["bot_id"], "petact", f"🌱 {p['name']} is now: {STAGES[info['grew']]}!"))
        view = pet_view(c, p)
        view["gain"], view["grew"] = info["coins"], info["grew"]
        c.commit()
    for m in out:
        await _bcast_msg(cid, m)
    await home_event(cid, u["id"], act, "quest" if info["newly"] else "", view)
    return view


@app.get("/api/pets/pending")
def pet_pending(authorization: str = Header(None)):
    """Pet invitations still waiting for an answer (sent by me, or sent to me)."""
    u = auth(authorization)
    out = []
    with closing(db()) as c:
        for r in c.execute("""SELECT ms.* FROM messages ms JOIN members mb ON mb.conv_id=ms.conv_id AND mb.user_id=?
                              WHERE ms.kind='petinvite' AND ms.deleted=0 AND ms.created>? AND ms.attachment LIKE '%"pending"%' ORDER BY ms.id DESC""",
                           (u["id"], time.time() - 7 * 86400)):
            a = json.loads(r["attachment"] or "{}")
            if a.get("state") != "pending" or u["id"] not in (a.get("from"), a.get("to")):
                continue
            o = c.execute("SELECT * FROM users WHERE id=?", (a["to"] if a["from"] == u["id"] else a["from"],)).fetchone()
            out.append({"mid": r["id"], "conv": r["conv_id"], "mine": a["from"] == u["id"], "name": _first(o) if o else "?"})
    return out


@app.get("/api/pets/{cid}/home")
def pet_home(cid: int, authorization: str = Header(None)):
    """Everything the Home tab needs besides the pet itself: the shop and the album."""
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        if not c.execute("SELECT 1 FROM pet_log WHERE pet_id=? AND kind='born'", (p["id"],)).fetchone():
            c.execute("INSERT INTO pet_log (pet_id, kind, text, at, day) VALUES (?,?,?,?,?)",
                      (p["id"], "born", f"🏡 {p['name']} came home", p["born"], _day(_pet_tz(c, p), p["born"])))
            c.commit()
        log = [dict(r) for r in c.execute("SELECT * FROM pet_log WHERE pet_id=? ORDER BY at DESC, id DESC LIMIT 80", (p["id"],))]
        return {"pet": pet_view(c, p), "catalog": _catalog(), "log": log, "stages": STAGES, "stage_days": STAGE_DAYS}


@app.post("/api/pets/{cid}/checkin")
async def pet_checkin(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        day = _day(_pet_tz(c, p))
        d = _day_get(c, p["id"], day)
        if str(u["id"]) in d["checkin"]:
            raise ValueError("You already checked in today 💛 Come back tomorrow")
        d["checkin"].append(str(u["id"]))
        _day_put(c, p["id"], day, d)
        _coins(c, p["id"], 10)
        view = pet_view(c, _pet_of(c, cid))
        view["gain"] = 10
        c.commit()
    await home_event(cid, u["id"], "", "", view)
    return view


@app.post("/api/pets/{cid}/buy")
async def pet_buy(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    item = str(body.get("item") or "")
    if item not in ITEM_TAB:
        raise ValueError("Unknown item")
    tab = ITEM_TAB[item]
    emoji, nm, price = SHOP_TABS[tab][item][:3]
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        have = c.execute("SELECT qty FROM pet_items WHERE pet_id=? AND item=?", (p["id"], item)).fetchone()
        if tab != "food" and have and have["qty"] > 0:
            raise ValueError("You already have it 💛")
        if tab == "food" and have and have["qty"] >= 20:
            raise ValueError("The cupboard is full 🍪")
        if c.execute("UPDATE pets SET coins=coins-? WHERE id=? AND coins>=?", (price, p["id"], price)).rowcount != 1:
            raise ValueError("Not enough ♥ coins yet. Care for " + p["name"] + " to earn more")
        first = not c.execute("SELECT 1 FROM pet_items WHERE pet_id=?", (p["id"],)).fetchone()
        c.execute("INSERT INTO pet_items (pet_id, item, qty) VALUES (?,?,1) ON CONFLICT(pet_id, item) DO UPDATE SET qty=qty+1", (p["id"], item))
        if tab == "room":
            room = json.loads(p["room"] or "{}")
            room[SHOP_TABS[tab][item][3]] = item
            c.execute("UPDATE pets SET room=? WHERE id=?", (json.dumps(room), p["id"]))
        elif tab == "outfits":
            c.execute("UPDATE pets SET outfit=? WHERE id=?", (item, p["id"]))
        if first:
            _log(c, p["id"], "item", f"🛍️ First thing from the shop: {emoji} {nm}", _day(_pet_tz(c, p)))
        view = pet_view(c, _pet_of(c, cid))
        c.commit()
    await home_event(cid, u["id"], "", "", view)
    return view


@app.post("/api/pets/{cid}/place")
async def pet_place(cid: int, body: dict, authorization: str = Header(None)):
    """Put an owned room item in its slot, wear an outfit, or (item "") take one away: {item, slot?}."""
    u = auth(authorization)
    item, slot = str(body.get("item") or ""), str(body.get("slot") or "")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        if item:
            q = c.execute("SELECT qty FROM pet_items WHERE pet_id=? AND item=?", (p["id"], item)).fetchone()
            if item not in ITEM_TAB or not q or q["qty"] < 1:
                raise ValueError("You don't have that yet")
        room = json.loads(p["room"] or "{}")
        if item and ITEM_TAB[item] == "room":
            room[ROOMS[item][3]] = item
        elif item and ITEM_TAB[item] == "outfits":
            c.execute("UPDATE pets SET outfit=? WHERE id=?", (item, p["id"]))
        elif not item and slot == "outfit":
            c.execute("UPDATE pets SET outfit='' WHERE id=?", (p["id"],))
        elif not item and slot in ("wall", "window", "floor_l", "floor_r"):
            room.pop(slot, None)
        else:
            raise ValueError("Pick something to place")
        c.execute("UPDATE pets SET room=? WHERE id=?", (json.dumps(room), p["id"]))
        view = pet_view(c, _pet_of(c, cid))
        c.commit()
    await home_event(cid, u["id"], "", "", view)
    return view


@app.post("/api/pets/{cid}/log/{lid}/photo")
def pet_log_photo(cid: int, lid: int, body: dict, authorization: str = Header(None)):
    """Attach a photo (already uploaded with /api/files) to an album milestone; file "" takes it off."""
    u = auth(authorization)
    fid = str(body.get("file") or "")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        if fid:
            f = c.execute("SELECT * FROM files WHERE id=? AND owner=?", (fid, u["id"])).fetchone()
            if not f or not f["mime"].startswith("image/"):
                raise ValueError("Choose a photo")
        if c.execute("UPDATE pet_log SET file=? WHERE id=? AND pet_id=?", (fid, lid, p["id"])).rowcount != 1:
            raise HTTPException(404, "Not found")
        c.commit()
    return {"ok": True, "file": fid}


@app.get("/api/pets/{cid}")
def pet_get(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        tz = _tz(c, u["id"])
        hist = []
        for r in c.execute("SELECT * FROM pet_days WHERE pet_id=? ORDER BY day DESC LIMIT 14", (p["id"],)):
            d = _day_get(c, p["id"], r["day"])
            hist.append({"day": r["day"], "cared": bool(_carers(d)), "both": len(_carers(d)) >= 2,
                         "quests": len([x for x in d["done"] if not x.startswith("_")])})
        names = {r["id"]: _first(r) for r in c.execute("SELECT * FROM users WHERE id IN (?,?)", (p["user_a"], p["user_b"]))}
        rem = [dict(r) | {"when": _local(r["due"], tz), "by": names.get(r["user_id"], "")}
               for r in c.execute("SELECT * FROM reminders WHERE home_id=? AND done=0 ORDER BY due", (cid,))]
        notes = [dict(r) for r in c.execute("SELECT * FROM notes WHERE home_id=? ORDER BY list, done, id", (cid,))]
        return {"pet": pet_view(c, p), "history": hist, "reminders": rem, "notes": notes, "names": names}


@app.patch("/api/pets/{cid}")
async def pet_rename(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    name = re.sub(r"\s+", " ", str(body.get("name") or "")).strip()[:20]
    if not name:
        raise ValueError("Give your pet a name")
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        c.execute("UPDATE pets SET name=? WHERE id=?", (name, p["id"]))
        c.execute("UPDATE users SET name=? WHERE id=?", (name, p["bot_id"]))
        m = _insert_msg(c, cid, u["id"], "petact", f"{_first(u)} renamed {p['name']} to {name} ✏️")
        c.commit()
    await _bcast_msg(cid, m)
    await home_event(cid, u["id"])
    with closing(db()) as c:
        return conv_view(c, cid, u["id"])


@app.delete("/api/pets/{cid}/reminders/{rid}")
def pet_reminder_del(cid: int, rid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE reminders SET done=1 WHERE id=? AND home_id=?", (rid, cid))
        c.commit()
    return {"ok": True}


@app.patch("/api/pets/{cid}/notes/{nid}")
def pet_note(cid: int, nid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("UPDATE notes SET done=? WHERE id=? AND home_id=?", (int(bool(body.get("done"))), nid, cid))
        c.commit()
    return {"ok": True}


@app.delete("/api/pets/{cid}/notes/{nid}")
def pet_note_del(cid: int, nid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        c.execute("DELETE FROM notes WHERE id=? AND home_id=?", (nid, cid))
        c.commit()
    return {"ok": True}


async def fire_home_reminder(r):
    """A shared reminder is due: the pet says it in Home and both people get a notification."""
    with closing(db()) as c:
        p = c.execute("SELECT * FROM pets WHERE conv_id=?", (r["home_id"],)).fetchone()
        if not p:
            c.execute("UPDATE reminders SET done=1 WHERE id=?", (r["id"],))
            c.commit()
            return
        tz = _pet_tz(c, p)
        nxt = _next_due(r["due"] or time.time(), r["repeat"], tz) if r["repeat"] else 0
        if nxt:
            c.execute("UPDATE reminders SET due=?, fired=? WHERE id=?", (nxt, time.time(), r["id"]))
        else:
            c.execute("UPDATE reminders SET done=1, fired=? WHERE id=?", (time.time(), r["id"]))
        c.commit()
    late = r["due"] and time.time() - r["due"] > 600
    text = f"⏰ Reminder for you both: {r['text']}" + (f"\n(this was for {_local(r['due'], tz)})" if late else "")
    await pet_say(p["conv_id"], text)
    await push_to([p["user_a"], p["user_b"]], {"title": p["name"], "body": f"⏰ {r['text']}"[:180], "conv": p["conv_id"], "icon": "/icon-512.png"})


async def _pet_evening():
    """Once a day after 19:00 (the pair's time zone): if nobody has cared for the pet yet, nudge both. Called from the reminder loop."""
    if time.time() - PET_CHECK[0] < 300:
        return
    PET_CHECK[0] = time.time()
    todo = []
    with closing(db()) as c:
        for p in c.execute("SELECT * FROM pets WHERE archived=0").fetchall():
            lt = datetime.now(_pet_tz(c, p))
            day = lt.strftime("%Y-%m-%d")
            if p["last_nudge_day"] == day or not 19 <= lt.hour < 23:
                continue
            c.execute("UPDATE pets SET last_nudge_day=? WHERE id=?", (day, p["id"]))
            v = pet_view(c, p)
            if not v["cared_today"]:
                todo.append((p, v))
        c.commit()
    for p, v in todo:
        need = "is hungry" if v["hunger"] < 55 else "wants to play" if v["joy"] < 55 else "is waiting for you"
        body = f"{p['name']} {need} and misses you both 🥺 " + (f"Keep your {v['streak']}-day streak going 🔥" if v["streak"] else "Come and say hi 🐾")
        await pet_say(p["conv_id"], body)
        await push_to([p["user_a"], p["user_b"]], {"title": p["name"], "body": body, "conv": p["conv_id"], "icon": "/icon-512.png"})


@app.get("/api/assistant")
def assistant_get(authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        return assistant_data(c, u["id"])


@app.delete("/api/assistant/reminders/{rid}")
def assistant_cancel(rid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        c.execute("UPDATE reminders SET done=1 WHERE id=? AND user_id=?", (rid, u["id"]))
        c.commit()
    return {"ok": True}


@app.patch("/api/assistant/notes/{nid}")
def assistant_note(nid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        c.execute("UPDATE notes SET done=? WHERE id=? AND user_id=?", (int(bool(body.get("done"))), nid, u["id"]))
        c.commit()
    return {"ok": True}


@app.delete("/api/assistant/notes/{nid}")
def assistant_note_del(nid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        c.execute("DELETE FROM notes WHERE id=? AND user_id=?", (nid, u["id"]))
        c.commit()
    return {"ok": True}


@app.delete("/api/assistant/places/{name}")
def assistant_place_del(name: str, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        c.execute("DELETE FROM places WHERE user_id=? AND name=?", (u["id"], name.strip().lower()))
        c.commit()
    return {"ok": True}


@app.post("/api/assistant/where")
async def assistant_where(body: dict, authorization: str = Header(None)):
    """The phone says where it is (only while the app is open): place reminders nearby go off."""
    u = auth(authorization)
    try:
        lat, lon = float(body["lat"]), float(body["lon"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("Needs lat and lon")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Bad location")
    HERE[u["id"]] = (lat, lon, time.time())
    with closing(db()) as c:
        places = {p["name"]: p for p in c.execute("SELECT * FROM places WHERE user_id=?", (u["id"],))}
        rows = c.execute("SELECT * FROM reminders WHERE user_id=? AND done=0 AND place<>'' AND due<=?", (u["id"], time.time())).fetchall()
    fired = 0
    for r in rows:
        p = places.get(r["place"])
        if p and _metres((lat, lon), (p["lat"], p["lon"])) <= p["radius"]:
            await fire_reminder(r)
            fired += 1
    return {"ok": True, "fired": fired}


# ---------------------------------------------------------------- files (photos, voice notes, documents, profile photos)
@app.post("/api/files")
async def upload(file: UploadFile = File(...), authorization: str = Header(None)):
    u = auth(authorization)
    if needs_new_pw(u):
        raise HTTPException(403, "Please choose a stronger password first (8+ characters with a capital letter, a small letter, a number and a symbol).")
    fid, size = secrets.token_hex(16), 0
    try:
        with open(FILES / fid, "wb") as out:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_FILE:
                    raise ValueError(f"Files up to {MAX_FILE // 1048576} MB.")
                out.write(chunk)
    except BaseException:
        (FILES / fid).unlink(missing_ok=True)
        raise
    name = os.path.basename(file.filename or "file")[:120]
    with closing(db()) as c:
        c.execute("INSERT INTO files VALUES (?,?,?,?,?,?)", (fid, u["id"], name, file.content_type or "application/octet-stream", size, time.time()))
        c.commit()
    return {"id": fid, "name": name, "mime": file.content_type or "application/octet-stream", "size": size}


@app.get("/api/files/{fid}")
def download(fid: str, t: str = "", authorization: str = Header(None)):
    me = user_for(t or (authorization or "").removeprefix("Bearer ").strip())  # images load via ?t= (no headers on <img>)
    if not re.fullmatch(r"[0-9a-f]{24,32}", fid):
        raise HTTPException(404)
    with closing(db()) as c:
        f = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        # v30: a photo saved on a gift wishlist is for its author's eyes only (to anyone else it is as missing as a file that doesn't exist)
        owners = {r["owner"] for r in c.execute("SELECT owner FROM wishlist WHERE photo=?", (fid,))}
        if owners and me["id"] not in owners:
            f = None
    if not f or not (FILES / fid).exists():
        raise HTTPException(404)
    inline = f["mime"].startswith(("image/", "audio/", "video/"))
    return FileResponse(FILES / fid, media_type=f["mime"], filename=None if inline else f["name"],
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------------------------------------------------------------- v22: for two (daily question, moods, our dates, on this day)
# Everything here is scoped to a pair of people = their direct chat. The Home tab (the pet's chat) and the direct chat both map to the same pair.
DQ_BANK = [
    # light
    "What's a tiny thing that made you smile today?", "If we had a free Saturday with no plans, how would you spend it?",
    "What's your comfort food when the day was long?", "Which song is stuck in your head lately?",
    "What's the best thing you ate this week?", "Coffee, tea, or something else? And how do you take it?",
    "What's a small habit of yours you secretly like?", "Which season feels most like you, and why?",
    "What's your go-to way to cheer yourself up?", "What would your perfect lazy morning look like?",
    "Which emoji do you use the most? Be honest.", "What's the last thing that made you laugh out loud?",
    "What's a smell that instantly makes you happy?", "What's something small you're looking forward to this week?",
    "Rain or sunshine, and what do you do on that kind of day?", "What's the cosiest place you've ever been?",
    "If you could have any snack right now, what would it be?", "What's a show or video you could rewatch forever?",
    "What's the nicest compliment you got recently?", "What's one tiny luxury you never say no to?",
    "Morning person or night owl? Has that ever changed for you?", "What's something you're oddly good at?",
    "What colour would you paint our imaginary living room?", "What's your favourite way to relax after a stressful day?",
    "What's a word you love the sound of?", "What do you usually think about right before you fall asleep?",
    # deep
    "When do you feel most like yourself?", "What's something you're proud of that you rarely talk about?",
    "What is one fear you'd like to feel lighter about?", "What do you need more of in your life right now?",
    "What's a lesson you learned the hard way?", "How do you like to be comforted when you're really down?",
    "What does a good day look like to you, start to finish?", "What's one thing you wish people understood about you?",
    "When did you last feel truly at peace?", "What's something you've forgiven yourself for?",
    "Which of your qualities do you think I appreciate most?", "What makes you feel safe with someone?",
    "What's a belief you held as a kid that you've changed your mind about?", "What's something you're still figuring out?",
    "Which moment this year are you most grateful for?", "What do you wish you did more often?",
    "How do you know when you're loved? What does it feel like?", "What's one thing I do that makes your day easier?",
    "What's a choice you made that changed everything?", "Who has shaped you the most, and how?",
    "What's something you want to be braver about?", "What do you do when you feel overwhelmed, and what do you wish you did instead?",
    "What does home mean to you?", "What's a compliment you'd love to hear more of?",
    "What do you think is the secret to staying close when life gets busy?", "What's something small I could do this week that would mean a lot to you?",
    # playful
    "If we swapped lives for a day, what's the first thing you'd do as me?", "What superpower would you pick, and how would you use it on a normal Tuesday?",
    "If we opened a tiny cafe together, what would it be called and what's the signature drink?", "Which animal do you think I'd be, and which one are you?",
    "You can teleport us anywhere for dinner tonight. Where?", "What would our couple theme song be?",
    "If you were a flavour of ice cream, which one would you be?", "What's the most ridiculous thing you'd do if you won the lottery?",
    "Which fictional character is the most like you?", "If our pet could talk for one minute, what would it say about us?",
    "Would you rather travel back to the past or jump to the future? Where to?", "What's your most useless talent?",
    "If you could instantly master any skill, what would you pick?", "What movie title best describes your week?",
    "If we had to survive a zombie apocalypse together, what would your role be?", "What's the weirdest food combination you secretly enjoy?",
    "You get one wish for our next date. What is it?", "What would you name a boat if you had one?",
    "Which of us would be more likely to get lost on a trip? Be gentle.", "If you could live in any fictional world, which one?",
    "What's your dream pyjama situation?", "If you had a personal theme day, what would the dress code be?",
    "Pick one: a month on a beach or a month in a cabin in the snow?", "What would you do with a day when nobody could see you?",
    "Which dance move are you proudest of, or most embarrassed by?", "What's a hobby you'd try if you knew you couldn't fail?",
    # memories
    "What's your favourite memory of the two of us so far?", "What did you think of me the very first time we talked?",
    "What's a moment with me you replay in your head?", "What was the first thing you noticed about me?",
    "What's the funniest thing that has happened to us?", "What's a place we've been together that you'd happily go back to?",
    "What's a childhood memory that still makes you smile?", "What was your favourite thing about school?",
    "Which trip from your past do you remember most vividly?", "What's a meal you'll never forget, and who was there?",
    "What's something your family always did that you loved?", "What's the best surprise you've ever had?",
    "What song takes you straight back to a specific time in your life?", "What's a photo of us you love, and why?",
    "When did you first realise you really liked me?", "What's the kindest thing someone has done for you?",
    "What's a smell or taste that brings back your childhood?", "What was the best gift you've ever received?",
    "What's a time we laughed so hard we couldn't stop?", "What was your favourite toy or game as a kid?",
    "What's the best advice you've ever been given?", "What's a small moment between us that meant more than it looked?",
    "What did you want to be when you grew up?", "What's a day from your past you'd love to relive for an hour?",
    "What's something we did early on that you miss?", "What's a moment when you felt really proud of me?",
    # future
    "Where do you see us a year from now?", "What's one place you want us to visit together?",
    "What's something new you'd like us to try this month?", "What would our dream weekend look like?",
    "What's a goal you're working towards right now, and how can I help?", "If we could build a small tradition together, what would it be?",
    "What does your ideal home look like in five years?", "What's one thing you'd like to learn this year?",
    "What would you like us to do more of?", "What's a dream you haven't told many people?",
    "Where would you love to wake up for a whole week?", "What's a skill you'd like us to learn together?",
    "What would you like to celebrate together next?", "What's one adventure you want to have before the year ends?",
    "What would a perfect ordinary Wednesday look like for us in the future?", "What's something you'd like to leave behind this year?",
    "What do you hope never changes about us?", "What would you do if we had a whole month off together?",
    "What kind of pet-parents do you think we'll be in ten years?", "What's one small promise you'd like us to make this week?",
]
DQ_REACT = [
    "Ooh, I peeked at your answers and I'm smiling 🥰", "You two are so cute together. Read them slowly 💛", "Both answered! That's my favourite kind of day 🐾",
    "I love how different and how alike you sound 🤭", "Sharing little thoughts like this makes my tail wiggle 🥹", "Okay, that answer deserves a hug 🫶",
    "Hehe, I didn't see that coming! Tell each other more 💬", "Look at you two, getting to know each other even better ✨"]
DQ_ASK = ["Today's question for you two 💭", "Good morning! Here's today's question 🐾", "A little question to start the day ☀️", "Question time! No peeking at each other's answers 🤫"]
MOODS = {"happy": ("😊", "happy"), "loved": ("🥰", "loved"), "tired": ("😴", "tired"), "stressed": ("😣", "stressed"),
         "sad": ("😢", "sad"), "sick": ("🤒", "sick"), "annoyed": ("😤", "annoyed"), "excited": ("🤩", "excited")}
MOOD_EMOJI = {v[0]: v[1] for v in MOODS.values()}
LOW_MOODS = {"tired", "stressed", "sad", "sick", "annoyed"}
MOOD_NUDGE = {
    "tired": ["{n} sounds worn out today. A kind word could go a long way 💛", "{n} is tired today. Maybe send something cosy?"],
    "stressed": ["{n}'s having a stressful day. Maybe check in with something calm?", "{n} is feeling the pressure today. A little encouragement would help 💪"],
    "sad": ["{n}'s feeling down today. Maybe send something sweet?", "{n} is a bit sad today. A hug in words, perhaps? 🫂"],
    "sick": ["{n} isn't feeling well today. Maybe ask how they're doing 🤒", "{n} is under the weather. A get-well message would be lovely 💛"],
    "annoyed": ["{n}'s had a rough day. Maybe send something nice?", "{n} is a bit annoyed today. A funny message could help 😅"]}
DATE_PET = {
    "bday": ["It's {w}'s birthday today! 🎂 Let's make it special 🎉", "Happy birthday, {w}! 🎈 I'm doing a happy dance 🐾"],
    "anniv": ["Happy anniversary, you two! 💞 {n} together today 🥳", "Today you've been together {n}. I'm so happy to live with you both 💛"],
    "month": ["Happy monthsary! 💕 {n} months together today ✨", "{n} months together today! Cheers to you two 🥂"]}


def _dparse(s):
    try:
        return datetime.strptime((s or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _pair_tz(c, a: int, b: int):
    """One clock for the pair: the time zone of whoever is further ahead (the earlier riser)."""
    tzs = [_tz(c, a), _tz(c, b)]
    return max(tzs, key=lambda z: datetime.now(z).utcoffset() or timedelta(0))


def _pair_of(c, cid: int, uid: int) -> dict:
    """The pair behind a chat id: either their direct chat or their Home (the pet's chat)."""
    cv = c.execute("SELECT * FROM convs WHERE id=?", (cid,)).fetchone()
    if not cv or not c.execute("SELECT 1 FROM members WHERE conv_id=? AND user_id=?", (cid, uid)).fetchone():
        raise HTTPException(404, "Chat not found")
    if cv["kind"] == "pet":
        p = c.execute("SELECT * FROM pets WHERE conv_id=?", (cid,)).fetchone()
        if not p:
            raise HTTPException(404, "No pet here")
        return _pair_build(c, p["user_a"], p["user_b"], p)
    if cv["kind"] == "direct":
        ids = sorted(r["user_id"] for r in c.execute("SELECT user_id FROM members WHERE conv_id=?", (cid,)))
        if len(ids) != 2 or c.execute("SELECT 1 FROM users WHERE id IN (?,?) AND bot<>0", tuple(ids)).fetchone():
            raise HTTPException(404, "Not available in this chat")
        return _pair_build(c, ids[0], ids[1], _pet_for(c, ids[0], ids[1]))
    raise HTTPException(404, "Not available in this chat")


def _pair_build(c, a: int, b: int, p=None) -> dict:
    return {"direct": _conv(c, [a, b]), "pet": p["conv_id"] if p else None, "pet_id": p["id"] if p else None,
            "pet_name": p["name"] if p else "", "a": a, "b": b, "tz": _pair_tz(c, a, b)}


def _dq_row(c, pr: dict, day: str):
    """Today's question for the pair: picked once per day; a shuffle seeded by the chat, so no repeats until all have been used."""
    r = c.execute("SELECT * FROM dq_days WHERE conv_id=? AND day=?", (pr["direct"], day)).fetchone()
    if r:
        return r
    n = c.execute("SELECT COUNT(*) FROM dq_days WHERE conv_id=?", (pr["direct"],)).fetchone()[0]
    order = list(range(len(DQ_BANK)))
    random.Random(pr["direct"] * 1009 + n // len(DQ_BANK)).shuffle(order)
    c.execute("INSERT OR IGNORE INTO dq_days (conv_id, day, qidx) VALUES (?,?,?)", (pr["direct"], day, order[n % len(DQ_BANK)]))
    return c.execute("SELECT * FROM dq_days WHERE conv_id=? AND day=?", (pr["direct"], day)).fetchone()


def _dq_streak(c, cid: int, today: str) -> int:
    days = {r[0] for r in c.execute("SELECT day FROM dq_answers WHERE conv_id=? GROUP BY day HAVING COUNT(*)>=2", (cid,))}
    d = _dparse(today)
    if today not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n


def _dq_view(c, pr: dict, uid: int, day: str) -> dict:
    row = _dq_row(c, pr, day)
    ans = {r["user_id"]: r["answer"] for r in c.execute("SELECT user_id, answer FROM dq_answers WHERE conv_id=? AND day=?", (pr["direct"], day))}
    other = pr["b"] if uid == pr["a"] else pr["a"]
    both = uid in ans and other in ans
    return {"day": day, "q": DQ_BANK[row["qidx"]], "mine": ans.get(uid), "other_answered": other in ans, "revealed": both,
            "other": ans.get(other) if both else None, "streak": _dq_streak(c, pr["direct"], day)}


def _mood_of(c, uid: int):
    tz = _tz(c, uid)
    day = _day(tz)
    r = c.execute("SELECT * FROM moods WHERE user_id=? AND day=?", (uid, day)).fetchone()
    if not r:
        return None
    nxt = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=1)
    return {"emoji": r["emoji"], "label": MOOD_EMOJI.get(r["emoji"], ""), "word": r["word"] or "", "ts": r["ts"], "until": nxt.timestamp()}


def _fix_date(s):
    s = (s or "").strip()
    if not s:
        return ""
    d = _dparse(s)
    if not d or not 1900 <= d.year <= 2100:
        raise ValueError("That date doesn't look right. Use the date picker.")
    return d.isoformat()


def _md_match(src, day) -> bool:
    if src.month == 2 and src.day == 29 and not calendar.isleap(day.year):
        return day.month == 2 and day.day == 28
    return (src.month, src.day) == (day.month, day.day)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _occasions(c, pr: dict, day) -> list:
    """Birthdays, the anniversary and (if switched on) monthsaries that fall on `day` for this pair."""
    out = []
    pd = c.execute("SELECT * FROM pair_dates WHERE conv_id=?", (pr["direct"],)).fetchone()
    for uid in (pr["a"], pr["b"]):
        r = c.execute("SELECT date FROM birthdays WHERE user_id=?", (uid,)).fetchone()
        b = _dparse(r["date"]) if r else None
        if b and _md_match(b, day):
            out.append({"type": "bday", "uid": uid, "n": day.year - b.year, "key": f"bday:{uid}:{day.isoformat()}"})
    t = _dparse(pd["together"]) if pd else None
    if t and day > t:
        months = (day.year - t.year) * 12 + day.month - t.month
        if _md_match(t, day) and months % 12 == 0:
            out.append({"type": "anniv", "uid": 0, "n": months // 12, "key": f"anniv:0:{day.isoformat()}"})
        elif pd["monthsary"] and months > 0 and day.day == min(t.day, calendar.monthrange(day.year, day.month)[1]):
            out.append({"type": "month", "uid": 0, "n": months, "key": f"month:0:{day.isoformat()}"})
    return out


def _occ_text(occ: dict, who: str, mine: bool) -> tuple:
    """(emoji, title, body) for the celebration screen and the push."""
    n = occ["n"]
    if occ["type"] == "bday":
        return ("🎂", f"Happy birthday, {who}!" if mine else f"It's {who}'s birthday!", "Today is all yours 💛" if mine else "Say something sweet today 💌")
    if occ["type"] == "anniv":
        return ("💞", "Happy anniversary!", f"{_plural(n, 'year')} together today")
    return ("💕", "Happy monthsary!", f"{_plural(n, 'month')} together today")


def _first_name(c, viewer: int, uid: int) -> str:
    n = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (viewer, uid)).fetchone()
    if n and n[0]:
        return n[0]
    u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _first(u) if u else "They"


def _dates_view(c, pr: dict, uid: int, today) -> dict:
    pd = c.execute("SELECT * FROM pair_dates WHERE conv_id=?", (pr["direct"],)).fetchone()
    b = {str(x): (c.execute("SELECT date FROM birthdays WHERE user_id=?", (x,)).fetchone() or {"date": ""})["date"] for x in (pr["a"], pr["b"])}
    together = pd["together"] if pd else ""
    nxt = pd["next_meet"] if pd else ""
    t, nm = _dparse(together), _dparse(nxt)
    up = []
    for k in range(0, 61):
        for o in _occasions(c, pr, today + timedelta(days=k)):
            who = _first_name(c, uid, o["uid"]) if o["uid"] else ""
            up.append({"days": k, "type": o["type"], "uid": o["uid"], "n": o["n"], "who": who})
        if len(up) >= 2:
            break
    return {"together": together, "next_meet": nxt, "monthsary": bool(pd["monthsary"]) if pd else False, "birthdays": b,
            "together_days": (today - t).days if t and t <= today else None,
            "next_days": (nm - today).days if nm and nm >= today else None, "upcoming": up}


def _otd_pick(c, cid: int, today, tz) -> dict | None:
    """Messages from this date in earlier years (or exactly a month ago if there's nothing older): up to 3, photos first."""
    cand = []
    for y in range(today.year - 1, today.year - 12, -1):
        try:
            cand.append((today.replace(year=y), f"{today.year - y} year{'s' if today.year - y > 1 else ''} ago"))
        except ValueError:  # 29 Feb
            cand.append((today.replace(year=y, day=28), f"{today.year - y} year{'s' if today.year - y > 1 else ''} ago"))
    mo, yr = today.month - 1 or 12, today.year - (1 if today.month == 1 else 0)
    cand.append((today.replace(year=yr, month=mo, day=min(today.day, calendar.monthrange(yr, mo)[1])), "1 month ago"))
    for d0, label in cand:
        t0 = datetime(d0.year, d0.month, d0.day, tzinfo=tz).timestamp()
        rows = c.execute("""SELECT id, sender, kind, text, attachment, created FROM messages WHERE conv_id=? AND deleted=0
                            AND kind IN ('text','image') AND created>=? AND created<? ORDER BY id""", (cid, t0, t0 + 86400)).fetchall()
        items = []
        for r in rows:
            if r["kind"] == "image":
                try:
                    f = (json.loads(r["attachment"] or "{}") or {}).get("id")
                except ValueError:
                    f = None
                if f:
                    items.append((0, r["id"], {"id": r["id"], "kind": "image", "file": f, "text": (r["text"] or "")[:80], "sender": r["sender"]}))
            elif len((r["text"] or "").strip()) >= 12:
                items.append((1, -len(r["text"]), {"id": r["id"], "kind": "text", "text": r["text"].strip()[:110], "sender": r["sender"]}))
        if items:
            items.sort(key=lambda x: (x[0], x[1]))
            return {"label": label, "date": d0.isoformat(), "items": [i[2] for i in items[:3]]}
    return None


def _otd_get(c, pr: dict, today, tz, make: bool):
    r = c.execute("SELECT * FROM otd WHERE conv_id=? AND day=?", (pr["direct"], today.isoformat())).fetchone()
    if r:
        d = json.loads(r["data"] or "{}")
        return (d or None), r["said"]
    if not make:
        return None, 1
    d = _otd_pick(c, pr["direct"], today, tz)
    c.execute("INSERT OR IGNORE INTO otd (conv_id, day, data, said) VALUES (?,?,?,0)", (pr["direct"], today.isoformat(), json.dumps(d or {})))
    return d, 0


def _bk_counts(c, pr: dict) -> dict:
    n = {r[0]: r[1] for r in c.execute("SELECT done, COUNT(*) FROM bucket WHERE conv_id=? GROUP BY done", (pr["direct"],))}
    return {"done": n.get(1, 0), "todo": n.get(0, 0)}


def home_data(c, pr: dict, uid: int) -> dict:
    lt = datetime.now(pr["tz"])
    today = lt.date()
    day = today.isoformat()
    otd, _ = _otd_get(c, pr, today, pr["tz"], lt.hour >= 20)
    names = {str(x): _first(c.execute("SELECT * FROM users WHERE id=?", (x,)).fetchone()) for x in (pr["a"], pr["b"])}
    return {"conv": pr["direct"], "pet": pr["pet"], "day": day, "me": uid, "names": names,
            "question": _dq_view(c, pr, uid, day),
            "moods": {str(x): _mood_of(c, x) for x in (pr["a"], pr["b"])},
            "dates": _dates_view(c, pr, uid, today), "otd": otd, "bucket": _bk_counts(c, pr),
            "jar": c.execute("SELECT COUNT(*) FROM gratitude WHERE conv_id=?", (pr["direct"],)).fetchone()[0],
            "wish": c.execute("SELECT COUNT(*) FROM wishlist WHERE owner=? AND bought=0", (uid,)).fetchone()[0]}  # the viewer's OWN count only


async def home_ping(pr: dict, what: str, extra=None):
    for uid in (pr["a"], pr["b"]):
        await send_to(uid, {"t": "home", "conv": pr["direct"], "pet": pr["pet"], "what": what, **(extra or {})})


@app.get("/api/home/{cid}")
def home_get(cid: int, authorization: str = Header(None)):
    """Everything under the pet room in one go: today's question, moods, our dates, on this day."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        d = home_data(c, pr, u["id"])
        c.commit()
    return d


@app.put("/api/home/{cid}/question")
async def home_answer(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    text = (body.get("answer") or "").strip()[:600]
    if not text:
        raise ValueError("Write an answer first")
    react = None
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        day = _day(pr["tz"])
        row = _dq_row(c, pr, day)
        v = _dq_view(c, pr, u["id"], day)
        if v["revealed"]:
            raise ValueError("You both answered already. See you tomorrow 💛")
        c.execute("INSERT OR REPLACE INTO dq_answers (conv_id, day, qidx, user_id, answer, ts) VALUES (?,?,?,?,?,?)",
                  (pr["direct"], day, row["qidx"], u["id"], text, time.time()))
        v = _dq_view(c, pr, u["id"], day)
        if v["revealed"] and c.execute("UPDATE dq_days SET rewarded=1 WHERE conv_id=? AND day=? AND rewarded=0", (pr["direct"], day)).rowcount:
            if pr["pet_id"]:
                _coins(c, pr["pet_id"], 10)  # +5 each into the shared wallet
            react = random.choice(DQ_REACT)
        out = home_data(c, pr, u["id"])
        c.commit()
    await home_ping(pr, "dq", {"by": u["id"], "revealed": bool(react)})
    if react and pr["pet"]:
        await pet_say(pr["pet"], react)
    if react:
        out["question"]["gain"] = 10
    return out


@app.get("/api/home/{cid}/questions")
def home_past(cid: int, authorization: str = Header(None)):
    """Past questions with both answers (an unanswered one shows only your own)."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        today = _day(pr["tz"])
        other = pr["b"] if u["id"] == pr["a"] else pr["a"]
        out = []
        for r in c.execute("SELECT * FROM dq_days WHERE conv_id=? AND day<? ORDER BY day DESC LIMIT 120", (pr["direct"], today)):
            ans = {x["user_id"]: x["answer"] for x in c.execute("SELECT user_id, answer FROM dq_answers WHERE conv_id=? AND day=?", (pr["direct"], r["day"]))}
            both = u["id"] in ans and other in ans
            out.append({"day": r["day"], "q": DQ_BANK[r["qidx"]], "mine": ans.get(u["id"]), "other": ans.get(other) if both else None,
                        "both": both, "other_answered": other in ans})
        return {"items": out, "streak": _dq_streak(c, pr["direct"], today), "names": {str(x): _first_name(c, u["id"], x) for x in (pr["a"], pr["b"])}}


@app.put("/api/mood")
async def mood_set(body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    key = (body.get("mood") or "").strip()
    word = re.sub(r"\s+", " ", (body.get("word") or "")).strip()[:40]
    todo = []
    with closing(db()) as c:
        day = _day(_tz(c, u["id"]))
        if not key:
            c.execute("DELETE FROM moods WHERE user_id=? AND day=?", (u["id"], day))
            m = None
        else:
            if key not in MOODS:
                raise ValueError("Unknown mood")
            emoji = MOODS[key][0]
            old = c.execute("SELECT pushed FROM moods WHERE user_id=? AND day=?", (u["id"], day)).fetchone()
            first_push = key in LOW_MOODS and not (old and old["pushed"])
            c.execute("INSERT OR REPLACE INTO moods (user_id, day, emoji, word, ts, pushed) VALUES (?,?,?,?,?,?)",
                      (u["id"], day, emoji, word, time.time(), 1 if (first_push or (old and old["pushed"])) else 0))
            m = _mood_of(c, u["id"])
            if first_push:
                for r in c.execute("""SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.conv_id=m2.conv_id AND m2.user_id<>m1.user_id
                                      JOIN convs cv ON cv.id=m1.conv_id AND cv.kind='direct' JOIN users x ON x.id=m2.user_id AND x.bot=0
                                      WHERE m1.user_id=?""", (u["id"],)):
                    p = _pet_for(c, u["id"], r["user_id"])
                    todo.append((r["user_id"], _first_name(c, r["user_id"], u["id"]), p["name"] if p else "A.F.R.A", p["conv_id"] if p else 0))
        peers = [r[0] for r in c.execute("""SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.conv_id=m2.conv_id AND m2.user_id<>m1.user_id
                                            JOIN convs cv ON cv.id=m1.conv_id AND cv.kind='direct' WHERE m1.user_id=?""", (u["id"],))]
        c.commit()
    for x in set(peers) | {u["id"]}:
        await send_to(x, {"t": "mood", "user": u["id"], "mood": m})
    for uid, name, title, pcid in todo:
        await push_to([uid], {"title": title, "body": random.choice(MOOD_NUDGE[key]).format(n=name), "conv": pcid or 0, "icon": "/icon-512.png"})
    return {"mood": m}


@app.put("/api/home/{cid}/dates")
async def home_dates(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        old = c.execute("SELECT * FROM pair_dates WHERE conv_id=?", (pr["direct"],)).fetchone()
        together = _fix_date(body["together"]) if "together" in body else (old["together"] if old else "")
        nxt = _fix_date(body["next_meet"]) if "next_meet" in body else (old["next_meet"] if old else "")
        mon = (1 if body.get("monthsary") else 0) if "monthsary" in body else (old["monthsary"] if old else 0)
        c.execute("INSERT OR REPLACE INTO pair_dates (conv_id, together, next_meet, monthsary) VALUES (?,?,?,?)", (pr["direct"], together, nxt, mon))
        for k, v in (body.get("birthdays") or {}).items():
            if str(k) not in (str(pr["a"]), str(pr["b"])):
                continue
            d = _fix_date(v)
            if d:
                c.execute("INSERT OR REPLACE INTO birthdays (user_id, date) VALUES (?,?)", (int(k), d))
            else:
                c.execute("DELETE FROM birthdays WHERE user_id=?", (int(k),))
        out = home_data(c, pr, u["id"])
        c.commit()
    await home_ping(pr, "dates", {"by": u["id"]})
    return out


@app.get("/api/celebrate")
def celebrate_get(authorization: str = Header(None)):
    """Today's birthdays and anniversaries I haven't seen the celebration for yet (shown once, the first time I open the app)."""
    u = auth(authorization)
    out = []
    with closing(db()) as c:
        for r in c.execute("""SELECT cv.id FROM members m JOIN convs cv ON cv.id=m.conv_id AND cv.kind='direct' WHERE m.user_id=?""", (u["id"],)).fetchall():
            try:
                pr = _pair_of(c, r["id"], u["id"])
            except HTTPException:
                continue
            for o in _occasions(c, pr, datetime.now(pr["tz"]).date()):
                if c.execute("SELECT 1 FROM date_seen WHERE conv_id=? AND user_id=? AND key=?", (pr["direct"], u["id"], o["key"])).fetchone():
                    continue
                who = _first_name(c, u["id"], o["uid"]) if o["uid"] else ""
                e, t, b = _occ_text(o, who, o["uid"] == u["id"])
                out.append({"conv": pr["direct"], "key": o["key"], "type": o["type"], "emoji": e, "title": t, "body": b})
    return out


@app.post("/api/celebrate/seen")
def celebrate_seen(body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, int(body.get("conv") or 0), u["id"])
        c.execute("INSERT OR IGNORE INTO date_seen (conv_id, user_id, key) VALUES (?,?,?)", (int(body["conv"]), u["id"], str(body.get("key") or "")[:80]))
        c.commit()
    return {"ok": True}


# ---------------------------------------------------------------- v25: question cards
CARDS_FILE = WEB / "cards.js"
CARD_MAX = 1000
_CARDS = {"mtime": -1.0, "decks": []}


def cards_bank() -> list:
    """The decks from web/cards.js (strict JSON after `const CARDS =`), read again whenever the file changes."""
    try:
        mt = CARDS_FILE.stat().st_mtime
    except OSError:
        return _CARDS["decks"]
    if mt != _CARDS["mtime"]:
        try:
            src = CARDS_FILE.read_text(encoding="utf-8")
            a = src.index("{", src.index("=", src.index("const CARDS")))
            data = json.loads(src[a:src.rindex("}") + 1])
            decks = []
            for d in data["decks"]:
                cards = [{"q": str(x["q"]).strip(), "t": "ask" if x.get("t") == "ask" else "both"} for x in d["cards"] if str(x.get("q") or "").strip()]
                decks.append({"id": str(d["id"]), "name": str(d["name"]), "emoji": str(d.get("emoji") or "🃏"), "minDays": int(d.get("minDays") or 0),
                              "blurb": str(d.get("blurb") or ""), "locked": str(d.get("locked") or ""), "here": bool(d.get("here")), "cards": cards})
            _CARDS.update(mtime=mt, decks=decks)
        except Exception as e:
            print("cards.js not readable:", repr(e)[:200], flush=True)
            _CARDS["mtime"] = mt
    return _CARDS["decks"]


def _deck(deck_id: str):
    return next((d for d in cards_bank() if d["id"] == deck_id), None)


def _cards_when(c, pr: dict, today=None):
    """(together date as text, days together) of the couple; days is None while the date isn't set."""
    pd = c.execute("SELECT together FROM pair_dates WHERE conv_id=?", (pr["direct"],)).fetchone()
    t = _dparse(pd["together"]) if pd else None
    today = today or datetime.now(pr["tz"]).date()
    return (t.isoformat() if t else ""), ((today - t).days if t and t <= today else None)


def _cards_spicy(c, pr: dict) -> dict:
    out = {pr["a"]: False, pr["b"]: False}
    for r in c.execute("SELECT user_id, spicy FROM card_prefs WHERE conv_id=?", (pr["direct"],)):
        if r["user_id"] in out:
            out[r["user_id"]] = bool(r["spicy"])
    return out


def _deck_open(d: dict, days, spicy: dict):
    """(open?, why not): 'spicy' = both must switch it on, 'days' = not together long enough yet (or the date isn't set)."""
    if d["locked"] == "spicy" and not all(spicy.values()):
        return False, "spicy"
    if d["minDays"] > 0 and (days is None or days < d["minDays"]):
        return False, "days"
    return True, ""


def _deck_used(c, cid: int, d: dict):
    """(questions already played in the current pass through the deck, cards played in all). Once every card was played the pass starts again."""
    done = [r["q"] for r in c.execute("SELECT q FROM card_rounds WHERE conv_id=? AND deck=? AND done>0 AND skipped=0 ORDER BY id", (cid, d["id"]))]
    n = len(d["cards"])
    k = (len(done) // n * n) if n else 0
    return set(done[k:]), len(done)


def _card_roles(rd, pr: dict):
    """(who answers, who guesses). Normal: both answer a 'both' card, only the partner answers an 'ask' card. Guess: the partner answers, the drawer guesses."""
    partner = pr["b"] if rd["drawn_by"] == pr["a"] else pr["a"]
    if rd["mode"] == "guess":
        return [partner], rd["drawn_by"]
    return ([partner] if rd["t"] == "ask" else [pr["a"], pr["b"]]), 0


def _card_phase(rd, pr: dict, rows: dict) -> str:
    """open (waiting for answers), complete (all in; normal mode, about to close), judge (guess mode: the partner rates the guess), done, skipped."""
    if rd["skipped"]:
        return "skipped"
    if rd["done"]:
        return "done"
    ans, guesser = _card_roles(rd, pr)
    if all(u in rows and rows[u]["text"] for u in ans):
        if not guesser:
            return "complete"
        if guesser in rows and rows[guesser]["guess"]:
            return "judge"
    return "open"


def _card_view(c, pr: dict, rd, uid: int) -> dict:
    """One round as `uid` may see it: your own words, only "answered" for the other, and everything once the round is revealed."""
    rows = {r["user_id"]: r for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rd["id"],))}
    ans, guesser = _card_roles(rd, pr)
    phase = _card_phase(rd, pr, rows)
    d = _deck(rd["deck"]) or {}
    sub = {}
    for u in (pr["a"], pr["b"]):
        r = rows.get(u)
        if u == guesser:
            sub[str(u)] = bool(r and r["guess"])
        elif u in ans:
            sub[str(u)] = bool(r and r["text"])
    mine = ""
    if uid in rows:
        mine = rows[uid]["guess"] if uid == guesser else rows[uid]["text"]
    out = {"id": rd["id"], "deck": rd["deck"], "deck_name": d.get("name", ""), "emoji": d.get("emoji", "🃏"), "q": rd["q"], "t": rd["t"], "mode": rd["mode"],
           "drawn_by": rd["drawn_by"], "created": rd["created"], "done": rd["done"], "phase": phase, "answerers": ans, "guesser": guesser,
           "submitted": sub, "mine": mine, "need_me": phase == "open" and sub.get(str(uid)) is False, "reveal": None}
    if phase in ("judge", "done"):
        g = rows.get(guesser) if guesser else None
        out["reveal"] = {"answers": {str(u): rows[u]["text"] for u in ans if u in rows}, "guess": g["guess"] if g else "", "judged": g["judged"] if g else 0}
    return out


def _cards_names(c, pr: dict, viewer: int) -> dict:
    return {str(x): _first_name(c, viewer, x) for x in (pr["a"], pr["b"])}


def _cards_state(c, pr: dict, uid: int) -> dict:
    together, days = _cards_when(c, pr)
    spicy = _cards_spicy(c, pr)
    decks = []
    for d in cards_bank():
        if d["here"]:  # things to do side by side: only in the one-phone game, which runs on the phone itself
            continue
        ok, why = _deck_open(d, days, spicy)
        used, played = _deck_used(c, pr["direct"], d)
        decks.append({"id": d["id"], "name": d["name"], "emoji": d["emoji"], "blurb": d["blurb"], "minDays": d["minDays"], "locked": d["locked"], "open": ok, "why": why,
                      "total": len(d["cards"]), "played": played, "left": sum(1 for x in d["cards"] if x["q"] not in used)})
    rd = c.execute("SELECT * FROM card_rounds WHERE conv_id=? AND done=0 ORDER BY id DESC LIMIT 1", (pr["direct"],)).fetchone()
    last = c.execute("SELECT * FROM card_rounds WHERE conv_id=? AND done>? AND skipped=0 ORDER BY id DESC LIMIT 1", (pr["direct"], time.time() - 1800)).fetchone()
    score = {str(x): {"right": 0, "total": 0} for x in (pr["a"], pr["b"])}
    for r in c.execute("""SELECT r.drawn_by AS who, SUM(a.judged=1) AS right, COUNT(*) AS total FROM card_rounds r JOIN card_answers a ON a.round_id=r.id AND a.user_id=r.drawn_by
                          WHERE r.conv_id=? AND r.mode='guess' AND r.done>0 AND r.skipped=0 AND a.judged<>0 GROUP BY r.drawn_by""", (pr["direct"],)):
        score[str(r["who"])] = {"right": r["right"] or 0, "total": r["total"]}
    return {"conv": pr["direct"], "pet": pr["pet"], "me": uid, "names": _cards_names(c, pr, uid), "together": together, "days": days,
            "decks": decks, "round": _card_view(c, pr, rd, uid) if rd else None, "last": _card_view(c, pr, last, uid) if last else None,
            "spicy": {str(k): v for k, v in spicy.items()}, "score": score, "coins": bool(pr["pet_id"])}


async def cards_ping(pr: dict, what: str, by: int, rid: int = 0):
    """Tell both phones that the round changed. Each one gets its own view of it (answers stay hidden until the reveal)."""
    for uid in (pr["a"], pr["b"]):
        with closing(db()) as c:
            rd = c.execute("SELECT * FROM card_rounds WHERE id=?", (rid,)).fetchone() if rid else c.execute(
                "SELECT * FROM card_rounds WHERE conv_id=? AND done=0 ORDER BY id DESC LIMIT 1", (pr["direct"],)).fetchone()
            view = _card_view(c, pr, rd, uid) if rd else None
            spicy = {str(k): v for k, v in _cards_spicy(c, pr).items()}
        await send_to(uid, {"t": "card", "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, "round": view, "spicy": spicy})


def _card_open_round(c, pr: dict):
    rd = c.execute("SELECT * FROM card_rounds WHERE conv_id=? AND done=0 ORDER BY id DESC LIMIT 1", (pr["direct"],)).fetchone()
    if not rd:
        raise ValueError("There's no card on the table. Draw one first.")
    return rd


@app.get("/api/cards/{cid}")
def cards_get(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        out = _cards_state(c, pr, u["id"])
        c.commit()
    return out


@app.post("/api/cards/{cid}/draw")
async def cards_draw(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if c.execute("SELECT 1 FROM card_rounds WHERE conv_id=? AND done=0", (pr["direct"],)).fetchone():
            raise ValueError("There's a card on the table already. Answer it or skip it first.")
        d = _deck(str(body.get("deck") or ""))
        if not d or not d["cards"] or d["here"]:
            raise ValueError("That deck isn't here.")
        ok, why = _deck_open(d, _cards_when(c, pr)[1], _cards_spicy(c, pr))
        if not ok:
            raise ValueError("You both need to turn on Spicier first." if why == "spicy" else "That deck isn't open yet.")
        mode = "guess" if body.get("mode") == "guess" else "normal"
        used, _ = _deck_used(c, pr["direct"], d)
        recent = {r["q"] for r in c.execute("SELECT q FROM card_rounds WHERE conv_id=? AND deck=? AND skipped=1 ORDER BY id DESC LIMIT 3", (pr["direct"], d["id"]))}
        left = [(i, x) for i, x in enumerate(d["cards"]) if x["q"] not in used] or list(enumerate(d["cards"]))
        i, card = random.choice([x for x in left if x[1]["q"] not in recent] or left)
        rid = c.execute("INSERT INTO card_rounds (conv_id, deck, idx, q, t, drawn_by, mode, created) VALUES (?,?,?,?,?,?,?,?)",
                        (pr["direct"], d["id"], i, card["q"], card["t"], u["id"], mode, time.time())).lastrowid
        out = _cards_state(c, pr, u["id"])
        c.commit()
    await cards_ping(pr, "draw", u["id"], rid)
    return out


def _card_finish(c, pr: dict, rd, uid: int, res: str):
    """The round is complete: close it, +2 coins into the pet's wallet, and a small chip in the couple's chat. Returns (message, coins).
    Written by hand instead of _insert_msg so nobody's last_read moves (the chip must not mark other messages as read)."""
    now = time.time()
    c.execute("UPDATE card_rounds SET done=? WHERE id=?", (now, rd["id"]))
    gain = 0
    if pr["pet_id"]:
        _coins(c, pr["pet_id"], 2)
        gain = 2
    d = _deck(rd["deck"]) or {}
    att = {"round": rd["id"], "deck": rd["deck"], "emoji": d.get("emoji", "🃏"), "q": rd["q"], "mode": rd["mode"], "t": rd["t"], "res": res}
    mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, attachment, created, updated) VALUES (?,?,?,?,?,?,?)",
                    (pr["direct"], uid, "card", f"{att['emoji']} {rd['q']}"[:8000], json.dumps(att), now, now)).lastrowid
    c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, pr["direct"]))
    return msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()), gain


async def _card_after(pr: dict, rd, uid: int, res: str, msg: dict):
    await cards_ping(pr, "done", uid, rd["id"])
    await _bcast_msg(pr["direct"], msg)
    if res == "both" and pr["pet"]:
        asyncio.create_task(_card_followup(pr, rd["id"]))


@app.post("/api/cards/{cid}/answer")
async def cards_answer(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    text = str(body.get("text") or "").strip()[:CARD_MAX]
    if not text:
        raise ValueError("Write something first.")
    msg = None
    gain = 0
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rd = _card_open_round(c, pr)
        ans, guesser = _card_roles(rd, pr)
        rows = {r["user_id"]: r for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rd["id"],))}
        if _card_phase(rd, pr, rows) == "judge":
            raise ValueError("Both are in. Time to rate the guess.")
        if u["id"] != guesser and u["id"] not in ans:
            raise ValueError("This one is for your partner to answer.")
        col = "guess" if u["id"] == guesser else "text"
        if u["id"] in rows:
            c.execute(f"UPDATE card_answers SET {col}=? WHERE round_id=? AND user_id=?", (text, rd["id"], u["id"]))
        else:
            c.execute(f"INSERT INTO card_answers (round_id, user_id, {col}, created) VALUES (?,?,?,?)", (rd["id"], u["id"], text, time.time()))
        rows = {r["user_id"]: r for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rd["id"],))}
        phase = _card_phase(rd, pr, rows)
        res = "both" if rd["t"] == "both" and not guesser else "one"
        if phase == "complete":
            msg, gain = _card_finish(c, pr, rd, u["id"], res)
        out = _cards_state(c, pr, u["id"])
        c.commit()
    if msg:
        await _card_after(pr, rd, u["id"], res, msg)
    else:
        await cards_ping(pr, "answer", u["id"], rd["id"])
    out["gain"] = gain
    return out


@app.post("/api/cards/{cid}/judge")
async def cards_judge(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rd = _card_open_round(c, pr)
        ans, guesser = _card_roles(rd, pr)
        rows = {r["user_id"]: r for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rd["id"],))}
        if _card_phase(rd, pr, rows) != "judge":
            raise ValueError("Nothing to rate yet.")
        if u["id"] not in ans:
            raise ValueError("Only the one who answered can rate the guess.")
        ok = bool(body.get("ok"))
        c.execute("UPDATE card_answers SET judged=? WHERE round_id=? AND user_id=?", (1 if ok else -1, rd["id"], guesser))
        res = "yes" if ok else "no"
        msg, gain = _card_finish(c, pr, rd, u["id"], res)
        out = _cards_state(c, pr, u["id"])
        c.commit()
    await _card_after(pr, rd, u["id"], res, msg)
    out["gain"] = gain
    return out


@app.post("/api/cards/{cid}/skip")
async def cards_skip(cid: int, authorization: str = Header(None)):
    """Skip is always free: the card goes back into the deck."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rd = _card_open_round(c, pr)
        rows = {r["user_id"]: r for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rd["id"],))}
        if _card_phase(rd, pr, rows) == "judge":
            raise ValueError("Rate the guess first.")
        c.execute("UPDATE card_rounds SET done=?, skipped=1 WHERE id=?", (time.time(), rd["id"]))
        c.execute("DELETE FROM card_answers WHERE round_id=?", (rd["id"],))
        out = _cards_state(c, pr, u["id"])
        c.commit()
    await cards_ping(pr, "skip", u["id"], rd["id"])
    return out


@app.put("/api/cards/{cid}/spicy")
async def cards_spicy(cid: int, body: dict, authorization: str = Header(None)):
    """Your side of the Spicier switch. The deck is open only while BOTH of you have it on; turning off locks it again for both at once."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        c.execute("INSERT OR REPLACE INTO card_prefs (conv_id, user_id, spicy) VALUES (?,?,?)", (pr["direct"], u["id"], 1 if body.get("on") else 0))
        out = _cards_state(c, pr, u["id"])
        c.commit()
    await cards_ping(pr, "spicy", u["id"])
    return out


@app.get("/api/cards/{cid}/archive")
def cards_archive(cid: int, deck: str = "", before: int = 0, limit: int = 40, authorization: str = Header(None)):
    """Cards we've played: newest first, 40 at a time (`before` = the id of the last one you have), optionally one deck."""
    u = auth(authorization)
    limit = max(1, min(100, limit))
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        q = "SELECT * FROM card_rounds WHERE conv_id=? AND done>0 AND skipped=0"
        args = [pr["direct"]]
        if deck:
            q += " AND deck=?"
            args.append(deck)
        if before:
            q += " AND id<?"
            args.append(before)
        rows = c.execute(q + " ORDER BY id DESC LIMIT ?", (*args, limit + 1)).fetchall()
        items = [_card_view(c, pr, r, u["id"]) for r in rows[:limit]]
        return {"items": items, "more": len(rows) > limit, "names": _cards_names(c, pr, u["id"]), "me": u["id"],
                "decks": [{"id": d["id"], "name": d["name"], "emoji": d["emoji"]} for d in cards_bank()]}


@app.get("/api/cards/{cid}/round/{rid}")
def cards_round(cid: int, rid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rd = c.execute("SELECT * FROM card_rounds WHERE id=? AND conv_id=?", (rid, pr["direct"])).fetchone()
        if not rd:
            raise HTTPException(404, "Card not found")
        return {"round": _card_view(c, pr, rd, u["id"]), "names": _cards_names(c, pr, u["id"]), "me": u["id"]}


async def _card_followup(pr: dict, rid: int):
    """With the pet AI on: after a 'both answer' round the pet may offer ONE follow-up question (at most once a day, logged like the pet's other calls)."""
    try:
        if not (OPENROUTER_KEY and pr["pet"] and pet_ai_on()):
            return
        with closing(db()) as c:
            rd = c.execute("SELECT * FROM card_rounds WHERE id=?", (rid,)).fetchone()
            rows = {r["user_id"]: r["text"] for r in c.execute("SELECT * FROM card_answers WHERE round_id=?", (rid,))}
            if not rd or len(rows) < 2:
                return
            if not c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], "cardai:" + _day(pr["tz"]))).rowcount:
                return
            c.commit()
            na, nb = (_first(c.execute("SELECT * FROM users WHERE id=?", (x,)).fetchone()) for x in (pr["a"], pr["b"]))
        sys_ = (f"You are {pr['pet_name'] or 'the pet'}, the sweet little pet of a couple. They just both answered a question card. Offer ONE short follow-up question "
                "(max 25 words) that builds on what both of them said, in simple warm English, with at most one emoji. Reply with the question only. No markdown.")
        usr = f"Card: {rd['q']}\n{na} answered: {rows.get(pr['a'], '')[:600]}\n{nb} answered: {rows.get(pr['b'], '')[:600]}"
        async with httpx.AsyncClient(timeout=60) as h:
            r = await h.post("https://openrouter.ai/api/v1/chat/completions", json={
                "model": ASSISTANT_MODEL, "messages": [{"role": "system", "content": sys_}, {"role": "user", "content": usr}],
                "temperature": 0.8, "max_tokens": 120, "usage": {"include": True}},
                headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "HTTP-Referer": "https://chat.farmansyah.cloud", "X-Title": "A.F.R.A chat"})
            r.raise_for_status()
            data = r.json()
        log_usage(pr["a"], pr["direct"], "pet", data)
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", (data["choices"][0]["message"].get("content") or "").strip())[:240]
        if text and "?" in text:
            await pet_say(pr["pet"], text)
    except Exception as e:
        print("card follow-up failed:", repr(e)[:200], flush=True)


def _cards_jobs(c, pr: dict, lt) -> list:
    """What the pet says about cards right now (called from _couple_jobs; `lt` = the pair's local time): a celebration when a deck has just unlocked,
    and around 20:00 'Card time?' when no card was drawn today. Each is recorded in date_sent, so it happens once."""
    out = []
    if not pr["pet"]:
        return out
    day = lt.date().isoformat()
    days = _cards_when(c, pr, lt.date())[1]
    if days is not None:
        for d in cards_bank():
            if d["minDays"] > 0 and not d["locked"] and days >= d["minDays"] and c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], "carddeck:" + d["id"])).rowcount:
                if days - d["minDays"] <= 3:  # only when it has just crossed; a date entered long after doesn't replay old unlocks
                    out.append(f"You've been together {days} days. A new card deck unlocked 💌")
    if 20 <= lt.hour < 23:
        start = lt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        if not c.execute("SELECT 1 FROM card_rounds WHERE conv_id=? AND created>=?", (pr["direct"], start)).fetchone() \
                and c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], "cardtime:" + day)).rowcount:
            out.append("Card time? 🃏")
    return out


COUPLE_CHECK = [0.0]


async def _couple_jobs():
    """The pair features' schedule (every ~2 minutes, from the reminder loop): the morning question (~09:00 for the earlier riser),
    birthday/anniversary reminders (the day before and on the day, once each), and the evening 'on this day' (~20:00)."""
    if time.time() - COUPLE_CHECK[0] < 120:
        return
    COUPLE_CHECK[0] = time.time()
    acts = []
    with closing(db()) as c:
        pairs = {}
        for p in c.execute("SELECT * FROM pets WHERE archived=0").fetchall():
            pr = _pair_build(c, p["user_a"], p["user_b"], p)
            pairs[pr["direct"]] = pr
        for r in c.execute("SELECT conv_id FROM pair_dates").fetchall():
            if r["conv_id"] not in pairs:
                m = [x["user_id"] for x in c.execute("SELECT user_id FROM members WHERE conv_id=?", (r["conv_id"],))]
                if len(m) == 2:
                    pairs[r["conv_id"]] = _pair_build(c, min(m), max(m), _pet_for(c, m[0], m[1]))
        for pr in pairs.values():
            lt = datetime.now(pr["tz"])
            today = lt.date()
            day = today.isoformat()
            if 9 <= lt.hour < 22:
                row = _dq_row(c, pr, day)
                if not row["asked"]:
                    c.execute("UPDATE dq_days SET asked=1 WHERE conv_id=? AND day=?", (pr["direct"], day))
                    acts.append(("ask", pr, DQ_BANK[row["qidx"]]))
            if lt.hour >= 9:
                for phase, d in (("day", today), ("eve", today + timedelta(days=1))):
                    for o in _occasions(c, pr, d):
                        k = o["key"] + ":" + phase
                        if c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], k)).rowcount:
                            acts.append((phase, pr, o))
            if lt.hour >= 20:
                data, said = _otd_get(c, pr, today, pr["tz"], True)
                if data and not said:
                    c.execute("UPDATE otd SET said=1 WHERE conv_id=? AND day=?", (pr["direct"], day))
                    acts.append(("otd", pr, data))
            for line in _cards_jobs(c, pr, lt):  # v25: a new deck unlocked, 'Card time?'
                acts.append(("card", pr, line))
        c.commit()
    for kind, pr, x in acts:
        try:
            if kind == "ask":
                text = f"{random.choice(DQ_ASK)}\n{x}"
                if pr["pet"]:
                    await pet_say(pr["pet"], text, push=True)
                else:
                    await push_to([pr["a"], pr["b"]], {"title": "Today's question", "body": x[:180], "conv": pr["direct"], "icon": "/icon-512.png"})
                await home_ping(pr, "dq")
            elif kind in ("day", "eve"):
                with closing(db()) as c:
                    for uid in (pr["a"], pr["b"]):
                        who = _first_name(c, uid, x["uid"]) if x["uid"] else ""
                        mine = x["uid"] == uid
                        e, t, b = _occ_text(x, who, mine)
                        if kind == "eve":
                            whose = "Your birthday is" if mine else f"{who}'s birthday is"
                            t = {"bday": f"{whose} tomorrow", "anniv": "Your anniversary is tomorrow", "month": "Your monthsary is tomorrow"}[x["type"]]
                            b = {"bday": "We hope it's a lovely one 🎈" if mine else "Time to plan something sweet 💌", "anniv": f"{_plural(x['n'], 'year')} together tomorrow",
                                 "month": f"{_plural(x['n'], 'month')} together tomorrow"}[x["type"]]
                        await push_to([uid], {"title": f"{e} {t}" if kind == "day" else t, "body": b, "conv": pr["pet"] or pr["direct"], "icon": "/icon-512.png"})
                if kind == "day" and pr["pet"]:
                    with closing(db()) as c:
                        who = _first_name(c, pr["a"], x["uid"]) if x["uid"] else ""
                    n = _plural(x["n"], "year") if x["type"] == "anniv" else str(x["n"])
                    await pet_say(pr["pet"], random.choice(DATE_PET[x["type"]]).format(w=who, n=n))
                await home_ping(pr, "dates")
            elif kind == "card" and pr["pet"]:
                await pet_say(pr["pet"], x, push=True)
                await cards_ping(pr, "nudge", 0)
            elif kind == "otd" and pr["pet"]:
                it = next((i for i in x["items"] if i["kind"] == "text"), None)
                lead = "A month ago today" if x["label"] == "1 month ago" else x["label"] + " today"
                line = f"{lead} you two talked about “{it['text'][:60].rstrip()}{'…' if len(it['text']) > 60 else ''}” 💭" if it else f"{lead} you two shared a photo 📸"
                await pet_say(pr["pet"], line)
                await home_ping(pr, "otd")
        except Exception as e:
            print("couple job failed:", repr(e)[:300], flush=True)


# ---------------------------------------------------------------- v26: time capsule letters
# A letter is written now and opens at unlock_at. Until then the reader's API answers carry no body and no photos at all (not hidden by the app: not sent).
CAP_BODY, CAP_PHOTOS, CAP_YEARS = 20000, 4, 25


def _cap_state(r, now: float) -> str:
    return "draft" if r["draft"] else "open" if r["unlock_at"] <= now else "sealed"


def _cap_readable(r, uid: int, now: float) -> bool:
    """The author always (their own words); the reader only once it is sealed AND the time has come. Drafts are nobody else's business."""
    if r["author"] == uid:
        return True
    return not r["draft"] and r["unlock_at"] <= now and (r["to_uid"] is None or r["to_uid"] == uid)


def _cap_view(r, uid: int, now: float, full: bool = False) -> dict:
    ok = _cap_readable(r, uid, now)
    out = {"id": r["id"], "conv": r["conv_id"], "author": r["author"], "to": r["to_uid"] or 0, "created_at": r["created_at"], "unlock_at": r["unlock_at"],
           "opened_at": r["opened_at"], "state": _cap_state(r, now), "mine": r["author"] == uid, "readable": ok,
           "editable": r["author"] == uid and (bool(r["draft"]) or r["unlock_at"] > now)}
    if ok:
        att = json.loads(r["attachments"] or "[]")
        out["photos"] = len(att)
        if full:
            out["body"], out["attachments"] = r["body"], att
        else:
            out["preview"] = (r["body"] or "").strip().replace("\n", " ")[:90]
    return out


def _cap_photos(c, uid: int, raw, mx: int = CAP_PHOTOS) -> list:
    """Up to 4 photos, each an upload of yours that the files table knows; what is stored is what the server knows, not what the phone said."""
    raw = raw if isinstance(raw, list) else []
    if len(raw) > mx:
        raise ValueError(f"Up to {mx} photos in a letter." if mx == CAP_PHOTOS else f"Up to {mx} photos.")
    out = []
    for a in raw:
        fid = str(a.get("id") or "") if isinstance(a, dict) else ""
        f = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone() if re.fullmatch(r"[0-9a-f]{24,32}", fid) else None
        if not f or f["owner"] != uid or not f["mime"].startswith("image/"):
            raise ValueError("One of the photos isn't available. Add it again.")
        if fid not in {x["id"] for x in out}:
            out.append({"id": fid, "name": f["name"], "mime": f["mime"], "size": f["size"]})
    return out


def _cap_when(v, now: float) -> float:
    try:
        t = float(v)
    except (TypeError, ValueError):
        raise ValueError("Choose when the letter opens.")
    if t > 1e11:  # milliseconds from a phone
        t /= 1000
    if t <= now:
        raise ValueError("The letter has to open in the future.")
    if t > now + CAP_YEARS * 366 * 86400:
        raise ValueError(f"Pick a date within {CAP_YEARS} years.")
    return t


def _cap_to(pr: dict, uid: int, v) -> int | None:
    """None = to both of us, else the partner."""
    if v in (None, "", "both", 0, "0"):
        return None
    partner = pr["b"] if uid == pr["a"] else pr["a"]
    if str(v) != str(partner):
        raise ValueError("A letter goes to your partner, or to both of you.")
    return partner


async def cap_ping(pr: dict, what: str, by: int, cap):
    """Tell the phones that the list changed (no content). Drafts only matter to the person who wrote them."""
    for uid in (pr["a"], pr["b"]):
        if cap["draft"] and uid != cap["author"]:
            continue
        await send_to(uid, {"t": "capsule", "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, "id": cap["id"]})


def _cap_row(c, pr: dict, lid: int, uid: int):
    r = c.execute("SELECT * FROM capsules WHERE id=? AND conv_id=?", (lid, pr["direct"])).fetchone()
    if not r or (r["draft"] and r["author"] != uid):
        raise HTTPException(404, "Letter not found")
    return r


@app.get("/api/capsules/{cid}")
def cap_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rows = c.execute("SELECT * FROM capsules WHERE conv_id=? AND (draft=0 OR author=?) ORDER BY unlock_at, id", (pr["direct"], u["id"])).fetchall()
        return {"conv": pr["direct"], "pet": pr["pet"], "me": u["id"], "now": now, "names": _cards_names(c, pr, u["id"]), "items": [_cap_view(r, u["id"], now) for r in rows]}


@app.get("/api/capsules/{cid}/{lid}")
def cap_get(cid: int, lid: int, authorization: str = Header(None)):
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        r = _cap_row(c, pr, lid, u["id"])
        return {"letter": _cap_view(r, u["id"], now, True), "names": _cards_names(c, pr, u["id"]), "me": u["id"], "now": now}


@app.post("/api/capsules/{cid}")
async def cap_create(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    text = str(body.get("body") or "").strip()
    if len(text) > CAP_BODY:
        raise ValueError(f"A letter can hold up to {CAP_BODY:,} characters.")
    draft = 1 if body.get("draft") else 0
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        to = _cap_to(pr, u["id"], body.get("to"))
        att = _cap_photos(c, u["id"], body.get("attachments"))
        if not text and not att:
            raise ValueError("Write something first, or add a photo.")
        when = _cap_when(body.get("unlock_at"), now) if (body.get("unlock_at") or not draft) else 0
        lid = c.execute("INSERT INTO capsules (conv_id, author, to_uid, body, attachments, created_at, unlock_at, draft, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                        (pr["direct"], u["id"], to, text, json.dumps(att), now, when, draft, now)).lastrowid
        r = c.execute("SELECT * FROM capsules WHERE id=?", (lid,)).fetchone()
        out = _cap_view(r, u["id"], now, True)
        c.commit()
    await cap_ping(pr, "new", u["id"], r)
    return out


@app.put("/api/capsules/{cid}/{lid}")
async def cap_update(cid: int, lid: int, body: dict, authorization: str = Header(None)):
    """The author, until it opens. Once sealed, the date can only move later. `seal: true` turns a draft into a sealed letter."""
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        r = _cap_row(c, pr, lid, u["id"])
        if r["author"] != u["id"]:
            raise HTTPException(403, "Only the one who wrote it can change a letter.")
        if not r["draft"] and r["unlock_at"] <= now:
            raise ValueError("This letter has opened already.")
        text, att, to, when, draft = r["body"], json.loads(r["attachments"] or "[]"), r["to_uid"], r["unlock_at"], r["draft"]
        if "body" in body:
            text = str(body.get("body") or "").strip()
            if len(text) > CAP_BODY:
                raise ValueError(f"A letter can hold up to {CAP_BODY:,} characters.")
        if "attachments" in body:
            att = _cap_photos(c, u["id"], body.get("attachments"))
        if "to" in body:
            to = _cap_to(pr, u["id"], body.get("to"))
        if not text and not att:
            raise ValueError("Write something first, or add a photo.")
        if body.get("unlock_at"):
            nw = _cap_when(body["unlock_at"], now)
            if not draft and nw < when:
                raise ValueError("A sealed letter can only open later, never sooner.")
            when = nw
        if draft and body.get("seal"):
            if when <= now:
                raise ValueError("Choose when the letter opens.")
            draft = 0
        c.execute("UPDATE capsules SET body=?, attachments=?, to_uid=?, unlock_at=?, draft=?, updated=? WHERE id=?", (text, json.dumps(att), to, when, draft, now, lid))
        r2 = c.execute("SELECT * FROM capsules WHERE id=?", (lid,)).fetchone()
        out = _cap_view(r2, u["id"], now, True)
        c.commit()
    await cap_ping(pr, "edit", u["id"], r2)
    return out


@app.delete("/api/capsules/{cid}/{lid}")
async def cap_delete(cid: int, lid: int, authorization: str = Header(None)):
    u = auth(authorization)
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        r = _cap_row(c, pr, lid, u["id"])
        if r["author"] != u["id"]:
            raise HTTPException(403, "Only the one who wrote it can delete a letter.")
        if not r["draft"] and r["unlock_at"] <= now:
            raise ValueError("This letter has opened already. It stays with you both.")
        c.execute("DELETE FROM capsules WHERE id=?", (lid,))
        c.commit()
    await cap_ping(pr, "delete", u["id"], r)
    return {"ok": True}


async def _capsule_jobs():
    """Letters whose time has come (every loop; one indexed query). Each is claimed with `notified` first, so a letter opens once even if two loops overlap:
    +2 coins for the author, a chip in the couple's chat, a push for the reader (for 'both of us' also the author), and the pet may say a line."""
    now = time.time()
    with closing(db()) as c:
        due = [r["id"] for r in c.execute("SELECT id FROM capsules WHERE draft=0 AND notified=0 AND unlock_at<=? ORDER BY unlock_at LIMIT 50", (now,))]
    for lid in due:
        try:
            with closing(db()) as c:
                if not c.execute("UPDATE capsules SET notified=1, opened_at=? WHERE id=? AND notified=0 AND draft=0", (now, lid)).rowcount:
                    continue
                r = c.execute("SELECT * FROM capsules WHERE id=?", (lid,)).fetchone()
                ids = sorted(x["user_id"] for x in c.execute("SELECT user_id FROM members WHERE conv_id=?", (r["conv_id"],)))
                if len(ids) != 2:
                    c.commit()
                    continue
                pr = _pair_build(c, ids[0], ids[1], _pet_for(c, ids[0], ids[1]))
                if pr["pet_id"]:
                    _coins(c, pr["pet_id"], 2)
                att = {"capsule": lid, "from": r["author"], "to": r["to_uid"] or 0, "written": r["created_at"], "unlock": r["unlock_at"]}
                mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, attachment, created, updated) VALUES (?,?,?,?,?,?,?)",
                                (pr["direct"], r["author"], "capsule", "💌 A letter just opened", json.dumps(att), now, now)).lastrowid
                c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, pr["direct"]))
                msg = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
                readers = [x for x in ids if x != r["author"]] + ([r["author"]] if r["to_uid"] is None else [])
                names = {x: _first_name(c, x, r["author"]) for x in readers}
                c.commit()
            await cap_ping(pr, "open", r["author"], r)
            await _bcast_msg(pr["direct"], msg)
            for x in readers:
                title = f"💌 A letter from {names[x]} just opened" if x != r["author"] else "💌 Your letter to us just opened"
                await push_to([x], {"title": title, "body": "Tap to read it", "conv": pr["direct"], "icon": "/icon-512.png"})
            if pr["pet"]:
                await pet_say(pr["pet"], "A letter from the past just opened 💌 +2 ♥")
        except Exception as e:
            print("capsule job failed:", repr(e)[:300], flush=True)


# ---------------------------------------------------------------- v27: play (couple games that earn pet coins)
# The server is the referee: it checks every move and turn and decides the result. A secret (the 20-questions answer, the word being drawn, the right
# answers of a quiz) is not hidden by the app: it is not in the other player's view at all until the game says it may be (only _g_view sends state).
GAMES_FILE = WEB / "games.js"
_GAMES = {"mtime": -1.0, "bank": {}}
GAME_TYPES = {"ttt": ("Tic-tac-toe", "⭕"), "thisthat": ("This or that", "🔀"), "who": ("Who's more likely to…", "🙋"),
              "quiz": ("Couple's quiz", "💡"), "twenty": ("20 questions", "❓"), "draw": ("Draw and guess", "🎨")}
GAME_COINS, GAME_WIN, GAME_CAP = 2, 1, 20  # per person for a finished game, +1 for the winner, at most this many a day per person
GAME_IDLE, GAME_PUSH_GAP = 7 * 86400, 600
GAME_ROUND, GAME_QUIZ, GAME_ASKS, GAME_GUESSES = 10, 5, 20, 10
GAME_STROKES, GAME_STROKE_PTS, GAME_DRAW_BYTES = 400, 3000, 200_000
GAME_LINES = ((0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6))
GDRAW: dict[int, tuple] = {}  # game id -> (drawer, guesser, valid until): who may relay strokes
GDRAW_RATE: dict[int, float] = {}


def games_bank() -> dict:
    """The decks from web/games.js (strict JSON after `const GAMES =`), read again whenever the file changes."""
    try:
        mt = GAMES_FILE.stat().st_mtime
    except OSError:
        return _GAMES["bank"]
    if mt != _GAMES["mtime"]:
        try:
            src = GAMES_FILE.read_text(encoding="utf-8")
            a = src.index("{", src.index("=", src.index("const GAMES")))
            d = json.loads(src[a:src.rindex("}") + 1])
            lst = lambda k: [str(x).strip() for x in d.get(k, []) if str(x).strip()]
            _GAMES.update(mtime=mt, bank={"thisthat": [[str(x[0]).strip(), str(x[1]).strip()] for x in d.get("thisthat", []) if len(x) == 2],
                                          "who": lst("who"), "quiz": lst("quiz"), "twenty": lst("twenty"), "draw": lst("draw"),
                                          "dates": [[str(x[0]), int(x[1]), str(x[2]), str(x[3]).strip()] for x in d.get("dates", [])
                                                    if len(x) == 4 and x[0] in ("in", "out") and x[1] in (0, 1, 2) and str(x[3]).strip()]})
        except Exception as e:
            print("games.js not readable:", repr(e)[:200], flush=True)
            _GAMES["mtime"] = mt
    return _GAMES["bank"]


def _gstem(w: str) -> str:
    if len(w) > 3 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ches", "shes", "sses", "xes", "zes")):
        return w[:-2]
    if len(w) > 2 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def _gnorm(s) -> str:
    """For comparing a guess with the secret: lowercase, no accents or punctuation, a/an/the left out, simple plurals folded."""
    s = unicodedata.normalize("NFKD", str(s or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    ws = re.sub(r"[^\w\s]|_", " ", s).split()
    while len(ws) > 1 and ws[0] in ("a", "an", "the"):
        ws.pop(0)
    return " ".join(_gstem(w) for w in ws)


def _gmatch(a, b) -> bool:
    x, y = _gnorm(a), _gnorm(b)
    return bool(x) and (x == y or x.replace(" ", "") == y.replace(" ", ""))


def _g_text(v, lo: int, hi: int, what: str) -> str:
    t = " ".join(v.split()) if isinstance(v, str) else ""
    if not lo <= len(t) <= hi:
        raise ValueError(f"{what} needs {lo}-{hi} characters." if lo > 1 else f"{what} can be up to {hi} characters.")
    return t


def _g_other(pr: dict, uid: int) -> int:
    return pr["b"] if uid == pr["a"] else pr["a"]


def _g_row(c, pr: dict, gid: int):
    g = c.execute("SELECT * FROM games WHERE id=? AND conv_id=?", (gid, pr["direct"])).fetchone()
    if not g:
        raise HTTPException(404, "Game not found")
    return g


# ---- tic-tac-toe
def _ttt_start(c, pr: dict, uid: int, body: dict):
    score, first, rematch = {str(pr["a"]): 0, str(pr["b"]): 0, "d": 0}, uid, False
    if body.get("rematch"):  # same two, a running score, the other one starts
        p = c.execute("SELECT * FROM games WHERE conv_id=? AND type='ttt' AND status='done' ORDER BY id DESC LIMIT 1", (pr["direct"],)).fetchone()
        if p and time.time() - p["updated"] < 6 * 3600:
            ps = json.loads(p["state"])
            score, first, rematch = ps["score"], ps["o"], True
    return {"b": [""] * 9, "x": first, "o": _g_other(pr, first), "score": score, "line": [], "last": -1}, first, rematch


def _ttt_move(c, pr: dict, g, st: dict, uid: int, body: dict) -> dict:
    if g["turn"] != uid:
        raise ValueError("It's not your turn yet.")
    i = body.get("cell")
    if type(i) is not int or not 0 <= i < 9:
        raise ValueError("Pick one of the nine squares.")
    if st["b"][i]:
        raise ValueError("That square is taken.")
    mark = "X" if st["x"] == uid else "O"
    st["b"][i], st["last"] = mark, i
    for ln in GAME_LINES:
        if all(st["b"][k] == mark for k in ln):
            st["line"] = list(ln)
            st["score"][str(uid)] += 1
            return {"what": "move", "end": {"winner": uid, "res": "win"}}
    if all(st["b"]):
        st["score"]["d"] += 1
        return {"what": "move", "end": {"winner": 0, "res": "draw"}}
    return {"what": "move", "turn": _g_other(pr, uid), "push": "{n} played. Your move ⭕"}


def _ttt_view(pr: dict, g, st: dict, uid: int, lite: bool) -> dict:
    return {"board": st["b"], "x": st["x"], "o": st["o"], "line": st["line"], "last": st["last"], "score": st["score"]}


# ---- this or that, who's more likely to (both answer 10 at their own pace; an answer shows only once both have answered that one)
def _rounds_start(kind: str):
    def f(c, pr: dict, uid: int, body: dict):
        bank = games_bank().get(kind) or []
        if len(bank) < GAME_ROUND:
            raise ValueError("The question deck isn't available right now.")
        used = set()
        for r in c.execute("SELECT state FROM games WHERE conv_id=? AND type=? ORDER BY id DESC LIMIT 12", (pr["direct"], kind)):
            used.update(json.loads(r["state"]).get("ix", []))
        fresh = [i for i in range(len(bank)) if i not in used]
        ix = random.sample(fresh if len(fresh) >= GAME_ROUND else list(range(len(bank))), GAME_ROUND)
        return {"ix": ix, "qs": [bank[i] for i in ix], "ans": {str(pr["a"]): [], str(pr["b"]): []}}, 0, False
    return f


def _rounds_move(kind: str):
    def f(c, pr: dict, g, st: dict, uid: int, body: dict) -> dict:
        mine = st["ans"][str(uid)]
        if len(mine) >= GAME_ROUND:
            raise ValueError("You've answered them all. Waiting for your partner.")
        if body.get("i") != len(mine) or type(body.get("i")) is not int:
            raise ValueError("That one is already answered.")
        v = body.get("pick")
        if kind == "thisthat":
            if type(v) is not int or v not in (0, 1):
                raise ValueError("Pick one of the two.")
        else:
            if v not in ("me", "you"):
                raise ValueError("Pick Me or You.")
            v = uid if v == "me" else _g_other(pr, uid)
        mine.append(v)
        if len(mine) >= GAME_ROUND:
            if len(st["ans"][str(_g_other(pr, uid))]) >= GAME_ROUND:
                return {"what": "move", "end": {"winner": 0, "res": "done"}}
            return {"what": "move", "push": "{n} finished the round. Your turn " + GAME_TYPES[kind][1]}
        return {"what": "move"}
    return f


def _rounds_same(st: dict, pr: dict) -> int:
    a, b = st["ans"][str(pr["a"])], st["ans"][str(pr["b"])]
    return sum(1 for k in range(min(len(a), len(b))) if a[k] == b[k])


def _rounds_view(pr: dict, g, st: dict, uid: int, lite: bool) -> dict:
    mine, theirs = st["ans"][str(uid)], st["ans"][str(_g_other(pr, uid))]
    rows = []
    for k, q in enumerate(st["qs"]):
        both = k < len(mine) and k < len(theirs)
        rows.append({"q": q, "mine": mine[k] if k < len(mine) else None, "theirs": theirs[k] if both else None, "has": k < len(theirs),
                     "same": (mine[k] == theirs[k]) if both else None})
    return {"rows": rows, "i": len(mine), "their_i": len(theirs), "same": sum(1 for r in rows if r["same"]), "total": GAME_ROUND}


# ---- couple's quiz (the maker's right answers stay on the server until the partner has submitted)
def _quiz_start(c, pr: dict, uid: int, body: dict):
    items = body.get("items")
    if not isinstance(items, list) or len(items) != GAME_QUIZ:
        raise ValueError(f"A quiz has {GAME_QUIZ} questions.")
    out = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("wrong"), list) or len(it["wrong"]) != 3:
            raise ValueError("Each question needs the right answer and 3 wrong ones.")
        q, right = _g_text(it.get("q"), 3, 140, "A question"), _g_text(it.get("right"), 1, 60, "An answer")
        opts = [right] + [_g_text(w, 1, 60, "An answer") for w in it["wrong"]]
        if len({_gnorm(x) or x.lower() for x in opts}) < 4:
            raise ValueError("The four options of a question have to be different.")
        random.shuffle(opts)
        out.append({"q": q, "opts": opts, "ok": opts.index(right)})
    other = _g_other(pr, uid)
    return {"maker": uid, "guesser": other, "items": out, "ans": None, "score": 0}, other, False


def _quiz_move(c, pr: dict, g, st: dict, uid: int, body: dict) -> dict:
    if uid != st["guesser"] or g["turn"] != uid:
        raise ValueError("Your partner is the one answering this quiz.")
    a = body.get("answers")
    if not isinstance(a, list) or len(a) != GAME_QUIZ or any(type(x) is not int or not 0 <= x < 4 for x in a):
        raise ValueError("Answer all the questions first.")
    st["ans"], st["score"] = a, sum(1 for k, x in enumerate(a) if x == st["items"][k]["ok"])
    return {"what": "move", "end": {"winner": 0, "res": "done"}}


def _quiz_view(pr: dict, g, st: dict, uid: int, lite: bool) -> dict:
    done = g["status"] != "active"
    show = done or uid == st["maker"]
    out = {"maker": st["maker"], "guesser": st["guesser"], "items": [{"q": it["q"], "opts": it["opts"], **({"ok": it["ok"]} if show else {})} for it in st["items"]]}
    if st["ans"] is not None:
        out.update(ans=st["ans"], score=st["score"])
    return out


# ---- 20 questions (the secret is in the thinker's view only; the guesser gets it when the game is over)
def _twenty_start(c, pr: dict, uid: int, body: dict):
    if body.get("surprise"):
        bank = games_bank().get("twenty") or []
        if not bank:
            raise ValueError("No surprise words right now. Type your own.")
        secret = random.choice(bank)
    else:
        secret = _g_text(body.get("secret"), 2, 40, "The secret")
        if not _gnorm(secret):
            raise ValueError("Pick a real word or two.")
    other = _g_other(pr, uid)
    return {"thinker": uid, "guesser": other, "secret": secret, "qs": [], "wrong": [], "pend": False, "last": "", "final": False}, other, False


def _twenty_move(c, pr: dict, g, st: dict, uid: int, body: dict) -> dict:
    used = len(st["qs"]) + len(st["wrong"])
    if "ask" in body:
        if uid != st["guesser"]:
            raise ValueError("The guesser asks the questions.")
        if g["turn"] != uid or st["pend"]:
            raise ValueError("Wait for the answer first.")
        if used >= GAME_ASKS:
            raise ValueError("That's all 20. Time to guess!")
        st["qs"].append({"q": _g_text(body["ask"], 2, 140, "Your question"), "a": ""})
        st["pend"], st["last"] = True, ""
        return {"what": "move", "turn": st["thinker"], "push": "{n} asked a question ❓"}
    if "answer" in body:
        if uid != st["thinker"]:
            raise ValueError("The one with the secret answers.")
        if not st["pend"]:
            raise ValueError("There's no question to answer.")
        if body["answer"] not in ("yes", "no", "sometimes", "unsure"):
            raise ValueError("Pick Yes, No, Sometimes or Not sure.")
        st["qs"][-1]["a"], st["pend"] = body["answer"], False
        st["final"] = len(st["qs"]) + len(st["wrong"]) >= GAME_ASKS
        return {"what": "move", "turn": st["guesser"], "push": "{n} answered. Your turn ❓"}
    if "guess" in body:
        if uid != st["guesser"]:
            raise ValueError("Only the guesser can guess.")
        t = _g_text(body["guess"], 1, 80, "Your guess")
        if _gmatch(t, st["secret"]):
            return {"what": "move", "end": {"winner": uid, "res": "win"}}
        st["wrong"].append(t)
        st["last"] = t
        if len(st["qs"]) + len(st["wrong"]) >= GAME_ASKS and not st["pend"]:
            return {"what": "move", "end": {"winner": st["thinker"], "res": "win"}}
        return {"what": "move", "push": "{n} guessed “" + t[:40].replace("{", "") + "”. Close?"}
    if body.get("accept"):
        if uid != st["thinker"]:
            raise ValueError("Only the one with the secret can say that.")
        if not st["last"]:
            raise ValueError("There's no guess to accept.")
        return {"what": "move", "end": {"winner": st["guesser"], "res": "win"}}
    raise ValueError("Ask, answer or guess.")


def _twenty_view(pr: dict, g, st: dict, uid: int, lite: bool) -> dict:
    out = {"thinker": st["thinker"], "guesser": st["guesser"], "qs": st["qs"], "wrong": st["wrong"], "pend": st["pend"], "last": st["last"], "final": st["final"],
           "used": len(st["qs"]) + len(st["wrong"]), "max": GAME_ASKS}
    if uid == st["thinker"] or g["status"] != "active":
        out["secret"] = st["secret"]
    return out


# ---- draw and guess (the word is the drawer's only; strokes are small integer points 0..1000 so they can be replayed later)
def _draw_start(c, pr: dict, uid: int, body: dict):
    bank = games_bank().get("draw") or []
    if len(bank) < 3:
        raise ValueError("The word list isn't available right now.")
    return {"drawer": uid, "guesser": _g_other(pr, uid), "choices": random.sample(bank, 3), "word": "", "phase": "pick", "strokes": [], "guesses": []}, uid, False


def _draw_stroke(s) -> dict:
    p = s.get("p") if isinstance(s, dict) else None
    if not isinstance(p, list) or not 2 <= len(p) <= GAME_STROKE_PTS * 2 or len(p) % 2:
        raise ValueError("That stroke doesn't look right.")
    c_, w = s.get("c"), s.get("w", 1)
    if type(c_) is not int or not 0 <= c_ <= 3 or type(w) is not int or not 1 <= w <= 3 or any(type(x) is not int or not 0 <= x <= 1000 for x in p):
        raise ValueError("That stroke doesn't look right.")
    return {"c": c_, "w": w, "p": p}


def _draw_move(c, pr: dict, g, st: dict, uid: int, body: dict) -> dict:
    drawer = uid == st["drawer"]
    if "pick" in body:
        if not drawer or st["phase"] != "pick":
            raise ValueError("The drawer picks a word first.")
        i = body["pick"]
        if type(i) is not int or not 0 <= i < len(st["choices"]):
            raise ValueError("Pick one of the three words.")
        st["word"], st["phase"] = st["choices"][i], "draw"
        return {"what": "pick", "turn": st["guesser"], "push": "{n} is drawing something 🎨"}
    if any(k in body for k in ("add", "undo", "clear")):
        if not drawer or st["phase"] != "draw":
            raise ValueError("Only the drawer can draw, once a word is picked.")
        if "add" in body:
            if len(st["strokes"]) >= GAME_STROKES:
                raise ValueError("That's a lot of strokes! Undo or clear a bit.")
            st["strokes"].append(_draw_stroke(body["add"]))
        elif "undo" in body:
            if st["strokes"]:
                st["strokes"].pop()
        else:
            st["strokes"] = []
        if len(json.dumps(st["strokes"], separators=(",", ":"))) > GAME_DRAW_BYTES:
            raise ValueError("The drawing is too big. Undo or clear a bit.")
        return {"what": "stroke", "lite": True, "push": "{n} drew something. Can you guess? 🎨" if "add" in body else None}
    if "guess" in body:
        if uid != st["guesser"]:
            raise ValueError("Only the guesser can guess.")
        if st["phase"] != "draw":
            raise ValueError("Wait for the drawing to start.")
        t = _g_text(body["guess"], 1, 60, "Your guess")
        st["guesses"].append(t)
        if _gmatch(t, st["word"]):
            return {"what": "move", "end": {"winner": uid, "res": "win"}}
        if len(st["guesses"]) >= GAME_GUESSES:
            return {"what": "move", "end": {"winner": st["drawer"], "res": "win"}}
        return {"what": "move", "push": "{n} guessed “" + t[:40].replace("{", "") + "”"}
    if body.get("accept"):
        if not drawer or not st["guesses"]:
            raise ValueError("There's no guess to accept.")
        return {"what": "move", "end": {"winner": st["guesser"], "res": "win"}}
    raise ValueError("Pick a word, draw, or guess.")


def _draw_view(pr: dict, g, st: dict, uid: int, lite: bool) -> dict:
    out = {"drawer": st["drawer"], "guesser": st["guesser"], "phase": st["phase"], "guesses": st["guesses"], "max": GAME_GUESSES, "ns": len(st["strokes"])}
    if not lite:
        out["strokes"] = st["strokes"]
    if uid == st["drawer"]:
        out["word"] = st["word"]
        if st["phase"] == "pick":
            out["choices"] = st["choices"]
    elif g["status"] != "active":
        out["word"] = st["word"]
    return out


GSTART = {"ttt": _ttt_start, "thisthat": _rounds_start("thisthat"), "who": _rounds_start("who"), "quiz": _quiz_start, "twenty": _twenty_start, "draw": _draw_start}
GMOVE = {"ttt": _ttt_move, "thisthat": _rounds_move("thisthat"), "who": _rounds_move("who"), "quiz": _quiz_move, "twenty": _twenty_move, "draw": _draw_move}
GVIEW = {"ttt": _ttt_view, "thisthat": _rounds_view, "who": _rounds_view, "quiz": _quiz_view, "twenty": _twenty_view, "draw": _draw_view}
GSTART_PUSH = {"ttt": "{n} started tic-tac-toe. Your move ⭕", "thisthat": "{n} started This or that. Your turn 🔀", "who": "{n} started Who's more likely to… Your turn 🙋",
               "quiz": "{n} made you a quiz 💡", "twenty": "{n} is thinking of something ❓", "draw": "{n} is picking a word to draw 🎨"}


# ---- the shared engine
def _g_mine(g, st: dict, uid: int) -> bool:
    """Is it my move (the 'Your turn' badge)?"""
    if g["status"] != "active":
        return False
    if g["type"] in ("thisthat", "who"):
        return len(st["ans"].get(str(uid), [])) < GAME_ROUND
    return g["turn"] == uid


def _g_note(g, st: dict, pr: dict | None = None) -> str:
    if g["status"] != "done":
        return ""
    t = g["type"]
    if t in ("thisthat", "who") and pr:
        return f"{_rounds_same(st, pr)}/{GAME_ROUND} the same"
    if t == "quiz":
        return f"{st['score']}/{GAME_QUIZ} right"
    if t == "twenty":
        return f"{len(st['qs'])} question{'' if len(st['qs']) == 1 else 's'}"
    if t == "draw":
        return f"{len(st['guesses'])} guess{'' if len(st['guesses']) == 1 else 'es'}"
    return "A draw" if g["res"] == "draw" else ""


def _g_view(c, pr: dict, g, uid: int, lite: bool = False) -> dict:
    st = json.loads(g["state"])
    name, emoji = GAME_TYPES[g["type"]]
    out = {"id": g["id"], "type": g["type"], "name": name, "emoji": emoji, "status": g["status"], "turn": g["turn"], "winner": g["winner"], "res": g["res"], "rev": g["updated"],
           "created": g["created"], "finished": g["finished"], "players": json.loads(g["players"]), "me": uid, "mine": _g_mine(g, st, uid), "note": _g_note(g, st, pr),
           "coins": bool(pr["pet_id"]), "pet_name": pr["pet_name"], "names": _cards_names(c, pr, uid)}
    p = (st.get("pay") or {}).get(str(uid))
    if p:
        out["pay"] = {"got": p[0], "want": p[1], "full": p[0] < p[1]}
    out.update(GVIEW[g["type"]](pr, g, st, uid, lite))
    return out


def _g_sum(pr: dict, g, uid: int) -> dict:
    st = json.loads(g["state"])
    return {"id": g["id"], "type": g["type"], "status": g["status"], "mine": _g_mine(g, st, uid), "turn": g["turn"], "winner": g["winner"], "res": g["res"],
            "note": _g_note(g, st, pr), "updated": g["updated"], "finished": g["finished"], "started_by": (json.loads(g["players"]) or [0])[0]}


def _g_pay(c, pr: dict, st: dict, winner: int) -> int:
    """+2 coins to the pet's wallet for each of you, +1 more for the winner, but never past 20 a day per person (the cap is per person, so it can't be farmed)."""
    if not pr["pet_id"]:
        return 0
    day, pay, total = _day(pr["tz"]), {}, 0
    for uid in (pr["a"], pr["b"]):
        want = GAME_COINS + (GAME_WIN if uid == winner else 0)
        r = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (uid, day)).fetchone()
        give = max(0, min(want, GAME_CAP - (r["coins"] if r else 0)))
        if give:
            c.execute("INSERT INTO game_coins (user_id, day, coins) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET coins=coins+?", (uid, day, give, give))
        pay[str(uid)], total = [give, want], total + give
    if total:
        _coins(c, pr["pet_id"], total)
    st["pay"] = pay
    return total


def _g_chip(c, pr: dict, g, uid: int, ev: str) -> dict:
    """A small chip in the couple's chat when a game starts and when it ends. Written by hand (like the cards chip) so nobody's last_read moves."""
    name, emoji = GAME_TYPES[g["type"]]
    now = time.time()
    att = {"game": g["id"], "type": g["type"], "emoji": emoji, "name": name, "ev": ev, "winner": g["winner"], "res": g["res"], "note": _g_note(g, json.loads(g["state"]), pr)}
    mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, attachment, created, updated) VALUES (?,?,?,?,?,?,?)",
                    (pr["direct"], uid, "game", f"{emoji} {name}", json.dumps(att), now, now)).lastrowid
    c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, pr["direct"]))
    return msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())


def _g_end(c, pr: dict, g, st: dict, winner: int, res: str, by: int, pay: bool = True, status: str = "done") -> dict:
    """Close the game once (the status check makes a second call a no-op error), pay the coins, and return the end chip."""
    now = time.time()
    if not c.execute("UPDATE games SET status=?, winner=?, res=?, finished=?, updated=?, turn=0 WHERE id=? AND status='active'", (status, winner, res, now, now, g["id"])).rowcount:
        raise ValueError("This game is over already.")
    given = _g_pay(c, pr, st, winner) if pay and status == "done" else 0
    c.execute("UPDATE games SET state=?, coins_given=? WHERE id=?", (json.dumps(st, ensure_ascii=False, separators=(",", ":")), given, g["id"]))
    return _g_chip(c, pr, c.execute("SELECT * FROM games WHERE id=?", (g["id"],)).fetchone(), by, "end")


async def _g_ping(pr: dict, gid: int, what: str, by: int, lite: bool = False):
    """Tell both phones. Each one gets its own view (secrets stripped); a drawing stroke carries no strokes, the guesser already saw them live."""
    for uid in (pr["a"], pr["b"]):
        with closing(db()) as c:
            g = c.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone()
            view = _g_view(c, pr, g, uid, lite)
        await send_to(uid, {"t": "game", "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, "id": gid, "type": view["type"], "game": view})


async def _g_push(pr: dict, gid: int, by: int, text: str):
    """'Raina played. Your move ⭕', at most one per game per 10 minutes (claimed in the table first, so two moves at once still send one)."""
    now = time.time()
    with closing(db()) as c:
        if not c.execute("UPDATE games SET pushed=? WHERE id=? AND pushed<? AND status='active'", (now, gid, now - GAME_PUSH_GAP)).rowcount:
            return
        c.commit()
        to = _g_other(pr, by)
        name, title = _first_name(c, to, by), GAME_TYPES[c.execute("SELECT type FROM games WHERE id=?", (gid,)).fetchone()["type"]]
    await push_to([to], {"title": f"{title[1]} {title[0]}", "body": text.replace("{n}", name), "conv": pr["direct"], "icon": "/icon-512.png", "tag": f"game-{gid}"})


@app.get("/api/games/{cid}")
def games_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        act = c.execute("SELECT * FROM games WHERE conv_id=? AND status='active' ORDER BY updated DESC", (pr["direct"],)).fetchall()
        rec = c.execute("SELECT * FROM games WHERE conv_id=? AND status='done' ORDER BY finished DESC LIMIT 12", (pr["direct"],)).fetchall()
        used = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (u["id"], _day(pr["tz"]))).fetchone()
        return {"conv": pr["direct"], "pet": pr["pet"], "pet_name": pr["pet_name"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "coins": bool(pr["pet_id"]),
                "today": used["coins"] if used else 0, "cap": GAME_CAP, "active": [_g_sum(pr, g, u["id"]) for g in act], "recent": [_g_sum(pr, g, u["id"]) for g in rec]}


@app.post("/api/games/{cid}/start")
async def games_start(cid: int, body: dict, authorization: str = Header(None)):
    """Start a game. Only one active game of each type per couple: starting another opens the one that's there (existing: true)."""
    u = auth(authorization)
    typ = str(body.get("type") or "")
    if typ not in GAME_TYPES:
        raise ValueError("That game doesn't exist.")
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        ex = c.execute("SELECT * FROM games WHERE conv_id=? AND type=? AND status='active'", (pr["direct"], typ)).fetchone()
        if ex:
            return {"game": _g_view(c, pr, ex, u["id"]), "existing": True}
        st, turn, rematch = GSTART[typ](c, pr, u["id"], body)
        try:
            gid = c.execute("INSERT INTO games (conv_id, type, state, players, turn, status, created, updated) VALUES (?,?,?,?,?,'active',?,?)",
                            (pr["direct"], typ, json.dumps(st, ensure_ascii=False, separators=(",", ":")), json.dumps([u["id"], _g_other(pr, u["id"])]), turn, now, now)).lastrowid
        except sqlite3.IntegrityError:  # the other phone started it at the same moment
            return {"game": _g_view(c, pr, c.execute("SELECT * FROM games WHERE conv_id=? AND type=? AND status='active'", (pr["direct"], typ)).fetchone(), u["id"]), "existing": True}
        g = c.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone()
        msg = None if rematch else _g_chip(c, pr, g, u["id"], "start")
        out = {"game": _g_view(c, pr, g, u["id"]), "existing": False}
        c.commit()
    await _g_ping(pr, gid, "start", u["id"])
    if msg:
        await _bcast_msg(pr["direct"], msg)
    await _g_push(pr, gid, u["id"], GSTART_PUSH[typ])
    return out


@app.get("/api/games/{cid}/{gid}")
def games_get(cid: int, gid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        return {"game": _g_view(c, pr, _g_row(c, pr, gid), u["id"])}


@app.post("/api/games/{cid}/{gid}/move")
async def games_move(cid: int, gid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    uid, now, msg = u["id"], time.time(), None
    with closing(db()) as c:
        pr = _pair_of(c, cid, uid)
        g = _g_row(c, pr, gid)
        if g["status"] != "active":
            raise ValueError("This game is over.")
        st = json.loads(g["state"])
        r = GMOVE[g["type"]](c, pr, g, st, uid, body)  # raises before anything is written when the move is not allowed
        if r.get("end"):
            msg = _g_end(c, pr, g, st, r["end"]["winner"], r["end"]["res"], uid)
        else:
            c.execute("UPDATE games SET state=?, turn=?, updated=? WHERE id=?", (json.dumps(st, ensure_ascii=False, separators=(",", ":")), r.get("turn", g["turn"]), now, gid))
        out = {"game": _g_view(c, pr, c.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone(), uid, bool(r.get("lite")))}
        c.commit()
    GDRAW.pop(gid, None)
    await _g_ping(pr, gid, "end" if msg else r["what"], uid, bool(r.get("lite")))
    if msg:
        await _bcast_msg(pr["direct"], msg)
    elif r.get("push"):
        await _g_push(pr, gid, uid, r["push"])
    return out


@app.post("/api/games/{cid}/{gid}/resign")
async def games_resign(cid: int, gid: int, authorization: str = Header(None)):
    """Either player, any time. Once it has really begun (ttt, 20 questions, draw) it counts for the other one; otherwise it is just cancelled. No coins either way."""
    u = auth(authorization)
    uid = u["id"]
    with closing(db()) as c:
        pr = _pair_of(c, cid, uid)
        g = _g_row(c, pr, gid)
        if g["status"] != "active":
            raise ValueError("This game is over.")
        st, o = json.loads(g["state"]), _g_other(pr, uid)
        began = {"ttt": lambda: any(st["b"]), "twenty": lambda: bool(st["qs"] or st["wrong"]), "draw": lambda: st["phase"] == "draw"}.get(g["type"], lambda: False)()
        if began:
            if g["type"] == "ttt":
                st["score"][str(o)] += 1
            msg = _g_end(c, pr, g, st, o, "resign", uid, pay=False)
        else:
            msg = _g_end(c, pr, g, st, 0, "cancelled", uid, pay=False, status="cancelled")
        out = {"game": _g_view(c, pr, c.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone(), uid)}
        c.commit()
    GDRAW.pop(gid, None)
    await _g_ping(pr, gid, "end", uid)
    await _bcast_msg(pr["direct"], msg)
    return out


async def _game_jobs():
    """Games nobody has touched for 7 days end quietly (every loop; one indexed query). Each is claimed by the status check, so it expires once."""
    now = time.time()
    with closing(db()) as c:
        due = [r["id"] for r in c.execute("SELECT id FROM games WHERE status='active' AND updated<? ORDER BY updated LIMIT 50", (now - GAME_IDLE,))]
    for gid in due:
        try:
            with closing(db()) as c:
                if not c.execute("UPDATE games SET status='expired', res='expired', finished=?, turn=0 WHERE id=? AND status='active' AND updated<?", (now, gid, now - GAME_IDLE)).rowcount:
                    continue
                g = c.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone()
                ids = sorted(x["user_id"] for x in c.execute("SELECT user_id FROM members WHERE conv_id=?", (g["conv_id"],)))
                if len(ids) != 2:
                    c.commit()
                    continue
                pr = _pair_build(c, ids[0], ids[1], _pet_for(c, ids[0], ids[1]))
                msg = _g_chip(c, pr, g, (json.loads(g["players"]) or [ids[0]])[0], "end")
                c.commit()
            await _g_ping(pr, gid, "expire", 0)
            await _bcast_msg(pr["direct"], msg)
        except Exception as e:
            print("game job failed:", repr(e)[:300], flush=True)


async def game_draw_relay(uid: int, m: dict):
    """A live stroke of the drawer, passed on to the guesser only (nothing stored here: the finished stroke is saved with a move). About 40 events a second at most."""
    gid, now_ = int(m.get("game") or 0), time.time()
    if now_ - GDRAW_RATE.get(uid, 0) < 0.025:
        return
    GDRAW_RATE[uid] = now_
    info = GDRAW.get(gid)
    if not info or info[2] < now_:
        if len(GDRAW) > 200:
            GDRAW.clear()
        with closing(db()) as c:
            g = c.execute("SELECT state FROM games WHERE id=? AND type='draw' AND status='active'", (gid,)).fetchone()
        st = json.loads(g["state"]) if g else None
        info = GDRAW[gid] = (st["drawer"], st["guesser"], now_ + 15) if st and st["phase"] == "draw" else (0, 0, now_ + 1)
    if uid != info[0]:
        return
    k = m.get("k")
    out = {"t": "game_draw", "game": gid, "k": k}
    if k == "p":
        pts, c_, w = m.get("pts"), m.get("c"), m.get("w", 1)
        if not isinstance(pts, list) or not 2 <= len(pts) <= 40 or len(pts) % 2 or type(c_) is not int or not 0 <= c_ <= 3 or type(w) is not int or not 1 <= w <= 3 \
                or any(type(x) is not int or not 0 <= x <= 1000 for x in pts):
            return
        out.update(pts=pts, c=c_, w=w, s=1 if m.get("s") else 0)
    elif k not in ("e", "u", "c"):
        return
    await send_to(info[1], out)


# ---------------------------------------------------------------- v28: bucket list + memories album
# One list for the pair, kept on their direct chat. Photos of a ticked item stay on it even if it is un-ticked again. The album is read-only apart from the
# shared stars: it is built on the fly from the direct chat, the bucket list and the OPENED letters this person may read (never a sealed one, never a draft).
BK_CATS, BK_MAX, BK_PHOTOS, BK_COINS, BK_CAP = ("go", "eat", "do", "someday"), 500, 6, 3, 9
MEM_PAGE, MEM_MAX = 60, 1500


def _bk_day(v) -> str:
    v = str(v or "").strip()
    if not v:
        return ""
    try:
        return datetime.strptime(v, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise ValueError("That date doesn't look right.")


def _bk_view(r) -> dict:
    return {"id": r["id"], "title": r["title"], "cat": r["cat"], "note": r["note"], "by": r["by_date"], "added_by": r["added_by"], "created": r["created"],
            "done": bool(r["done"]), "done_at": r["done_at"], "day": r["done_day"], "done_by": r["done_by"], "line": r["done_note"], "photos": json.loads(r["photos"] or "[]")}


def _bk_row(c, pr: dict, bid: int):
    r = c.execute("SELECT * FROM bucket WHERE id=? AND conv_id=?", (bid, pr["direct"])).fetchone()
    if not r:
        raise HTTPException(404, "Not on the list")
    return r


def _bk_fields(body: dict) -> dict:
    out = {}
    if "title" in body:
        t = " ".join(str(body.get("title") or "").split())
        if not t:
            raise ValueError("Give it a name first.")
        out["title"] = t[:120]
    if "cat" in body:
        out["cat"] = body["cat"] if body["cat"] in BK_CATS else "do"
    if "note" in body:
        out["note"] = str(body.get("note") or "").strip()[:500]
    if "by" in body:
        out["by_date"] = _bk_day(body.get("by"))
    return out


def _bk_photos(c, uid: int, raw, have: list) -> list:
    """The photos an item ends up with: the ones it already has stay as they are, new ones must be your own uploads."""
    raw = raw if isinstance(raw, list) else []
    if len(raw) > BK_PHOTOS:
        raise ValueError(f"Up to {BK_PHOTOS} photos.")
    known = {x["id"]: x for x in have}
    fresh = {x["id"]: x for x in _cap_photos(c, uid, [a for a in raw if isinstance(a, dict) and a.get("id") not in known], BK_PHOTOS)}
    out = []
    for a in raw:
        x = known.get(a.get("id")) or fresh.get(a.get("id")) if isinstance(a, dict) else None
        if x and x not in out:
            out.append(x)
    return out


async def bk_ping(pr: dict, what: str, by: int, bid: int):
    for uid in (pr["a"], pr["b"]):
        await send_to(uid, {"t": "bucket", "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, "id": bid})


@app.get("/api/bucket/{cid}")
def bk_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rows = c.execute("SELECT * FROM bucket WHERE conv_id=? ORDER BY created, id", (pr["direct"],)).fetchall()
        used = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (u["id"], "b" + _day(pr["tz"]))).fetchone()
        return {"conv": pr["direct"], "pet": pr["pet"], "pet_name": pr["pet_name"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "coins": bool(pr["pet_id"]),
                "today": used["coins"] if used else 0, "cap": BK_CAP, "pay": BK_COINS, "items": [_bk_view(r) for r in rows]}


@app.get("/api/bucket/{cid}/{bid}")
def bk_get(cid: int, bid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        return {"item": _bk_view(_bk_row(c, pr, bid)), "me": u["id"], "names": _cards_names(c, pr, u["id"])}


@app.post("/api/bucket/{cid}")
async def bk_add(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    f = _bk_fields({"cat": "do", "note": "", "by": "", **body})
    if not f.get("title"):
        raise ValueError("Give it a name first.")
    now = time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if c.execute("SELECT COUNT(*) FROM bucket WHERE conv_id=?", (pr["direct"],)).fetchone()[0] >= BK_MAX:
            raise ValueError("The list is full. Tick off or remove a few first.")
        bid = c.execute("INSERT INTO bucket (conv_id, title, cat, note, by_date, added_by, created, updated) VALUES (?,?,?,?,?,?,?,?)",
                        (pr["direct"], f["title"], f["cat"], f["note"], f["by_date"], u["id"], now, now)).lastrowid
        out = _bk_view(c.execute("SELECT * FROM bucket WHERE id=?", (bid,)).fetchone())
        c.commit()
    await bk_ping(pr, "new", u["id"], bid)
    return out


@app.put("/api/bucket/{cid}/{bid}")
async def bk_edit(cid: int, bid: int, body: dict, authorization: str = Header(None)):
    """Either of you can change anything. On a done item the date, the line and the photos can be changed too."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        r = _bk_row(c, pr, bid)
        f = _bk_fields(body)
        if r["done"]:
            if "day" in body:
                f["done_day"] = _bk_day(body.get("day")) or r["done_day"]
            if "line" in body:
                f["done_note"] = str(body.get("line") or "").strip()[:300]
        if "photos" in body:
            f["photos"] = json.dumps(_bk_photos(c, u["id"], body.get("photos"), json.loads(r["photos"] or "[]")), separators=(",", ":"))
        if f:
            f["updated"] = time.time()
            c.execute("UPDATE bucket SET " + ", ".join(f"{k}=?" for k in f) + " WHERE id=?", (*f.values(), bid))
        out = _bk_view(c.execute("SELECT * FROM bucket WHERE id=?", (bid,)).fetchone())
        c.commit()
    await bk_ping(pr, "edit", u["id"], bid)
    return out


@app.delete("/api/bucket/{cid}/{bid}")
async def bk_delete(cid: int, bid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        _bk_row(c, pr, bid)
        c.execute("DELETE FROM bucket WHERE id=?", (bid,))
        c.commit()
    await bk_ping(pr, "del", u["id"], bid)
    return {"ok": True}


@app.post("/api/bucket/{cid}/{bid}/done")
async def bk_done(cid: int, bid: int, body: dict, authorization: str = Header(None)):
    """'We did it!': the item moves to Done with its photos, a chip goes into the chat, the pet cheers and gets +3 coins (once per item, and at most 9 a day per
    person, all or nothing). Doing it on an item that is already done just changes its date, line and photos."""
    u = auth(authorization)
    uid, now = u["id"], time.time()
    chip, give = None, 0
    with closing(db()) as c:
        pr = _pair_of(c, cid, uid)
        r = _bk_row(c, pr, bid)
        day = _bk_day(body.get("day")) or _day(pr["tz"])
        line = str(body.get("line") or "").strip()[:300]
        ph = _bk_photos(c, uid, body.get("photos"), json.loads(r["photos"] or "[]"))
        photos = json.dumps(ph, ensure_ascii=False, separators=(",", ":"))
        if r["done"]:
            c.execute("UPDATE bucket SET done_day=?, done_note=?, photos=?, updated=? WHERE id=?", (day, line, photos, now, bid))
        else:
            if not c.execute("UPDATE bucket SET done=1, done_at=?, done_day=?, done_by=?, done_note=?, photos=?, updated=? WHERE id=? AND done=0",
                             (now, day, uid, line, photos, now, bid)).rowcount:
                raise ValueError("Already ticked off.")
            if pr["pet_id"] and not r["paid"]:
                key = "b" + _day(pr["tz"])
                used = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (uid, key)).fetchone()
                if (used["coins"] if used else 0) + BK_COINS <= BK_CAP:
                    c.execute("INSERT INTO game_coins (user_id, day, coins) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET coins=coins+?", (uid, key, BK_COINS, BK_COINS))
                    _coins(c, pr["pet_id"], BK_COINS)
                    c.execute("UPDATE bucket SET paid=1 WHERE id=?", (bid,))
                    give = BK_COINS
            att = {"bucket": bid, "title": r["title"], "cat": r["cat"], "ev": "done", "photo": ph[0]["id"] if ph else ""}
            mid = c.execute("INSERT INTO messages (conv_id, sender, kind, text, attachment, created, updated) VALUES (?,?,?,?,?,?,?)",
                            (pr["direct"], uid, "bucket", f"✅ We did it: {r['title']}", json.dumps(att), now, now)).lastrowid
            c.execute("UPDATE convs SET last_at=? WHERE id=?", (now, pr["direct"]))
            chip = msg_view(c.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone())
        who = _first_name(c, _g_other(pr, uid), uid)
        out = {"item": _bk_view(c.execute("SELECT * FROM bucket WHERE id=?", (bid,)).fetchone()), "coins": give}
        c.commit()
    await bk_ping(pr, "done" if chip else "edit", uid, bid)
    if chip:
        await _bcast_msg(pr["direct"], chip)
        await push_to([_g_other(pr, uid)], {"title": "✅ We did it", "body": f"{who} ticked off: {r['title']}", "conv": pr["direct"], "icon": "/icon-512.png", "tag": f"bucket-{bid}"})
        if pr["pet"]:
            await pet_say(pr["pet"], f"{r['title']}: done, together! 🎉" + (f" +{give} ♥" if give else ""))
    return out


@app.post("/api/bucket/{cid}/{bid}/undo")
async def bk_undo(cid: int, bid: int, authorization: str = Header(None)):
    """Back to the to-do list. The photos stay on the item and the coins stay paid (ticking it again does not pay twice)."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        _bk_row(c, pr, bid)
        c.execute("UPDATE bucket SET done=0, done_at=0, updated=? WHERE id=?", (time.time(), bid))
        out = _bk_view(c.execute("SELECT * FROM bucket WHERE id=?", (bid,)).fetchone())
        c.commit()
    await bk_ping(pr, "undo", u["id"], bid)
    return out


# ---- the album
def _mem_kind(kind: str, mime: str) -> str:
    return "video" if kind in ("video", "videonote") or (mime or "").startswith("video/") else "image"


def _mem_chat(c, cid: int, pos=None):
    """Photos and videos of the direct chat, newest first, 300 rows at a time (keyset on created, id); `pos` = where the previous page ended."""
    last = (1e12, 1 << 60)
    if pos:
        last = (pos[0], int(pos[1][1:]) if pos[1][:1] == "m" and pos[1][1:].isdigit() else 1 << 60)
    while True:
        rows = c.execute("""SELECT id, sender, kind, text, attachment, created FROM messages WHERE conv_id=? AND deleted=0 AND kind IN ('image','video','videonote')
                            AND (created<? OR (created=? AND id<?)) ORDER BY created DESC, id DESC LIMIT 300""", (cid, last[0], last[0], last[1])).fetchall()
        for r in rows:
            try:
                a = json.loads(r["attachment"] or "{}") or {}
            except ValueError:
                continue
            fid = str(a.get("id") or "")
            if re.fullmatch(r"[0-9a-f]{24,32}", fid):
                yield {"t": r["created"], "sid": "m%012d" % r["id"], "id": fid, "kind": _mem_kind(r["kind"], a.get("mime")), "mime": a.get("mime") or "", "src": "chat",
                       "ref": r["id"], "by": r["sender"], "text": (r["text"] or "")[:120]}
        if len(rows) < 300:
            return
        last = (rows[-1]["created"], rows[-1]["id"])


def _mem_bucket(c, pr: dict):
    rows = c.execute("SELECT * FROM bucket WHERE conv_id=? AND done=1", (pr["direct"],)).fetchall()
    items = []
    for r in rows:
        try:
            t = datetime.strptime(r["done_day"], "%Y-%m-%d").replace(hour=12, tzinfo=pr["tz"]).timestamp()
        except ValueError:
            t = r["done_at"]
        for i, p in enumerate(json.loads(r["photos"] or "[]")):
            items.append({"t": t, "sid": "b%09d%02d" % (r["id"], i), "id": p["id"], "kind": "image", "mime": p.get("mime") or "", "src": "bucket", "ref": r["id"],
                          "by": r["done_by"], "text": r["title"]})
    items.sort(key=lambda x: (x["t"], x["sid"]), reverse=True)
    return iter(items)


def _mem_letters(c, pr: dict, uid: int, now: float):
    """Only letters that are sent AND whose time has come AND that this person may read: the same rule as reading the letter itself."""
    items = []
    for r in c.execute("SELECT * FROM capsules WHERE conv_id=? AND draft=0 AND unlock_at<=?", (pr["direct"], now)).fetchall():
        if not _cap_readable(r, uid, now):
            continue
        for i, p in enumerate(json.loads(r["attachments"] or "[]")):
            items.append({"t": r["opened_at"] or r["unlock_at"], "sid": "l%09d%02d" % (r["id"], i), "id": p["id"], "kind": "image", "mime": p.get("mime") or "",
                          "src": "letter", "ref": r["id"], "by": r["author"], "text": ""})
    items.sort(key=lambda x: (x["t"], x["sid"]), reverse=True)
    return iter(items)


def _mem_has(c, pr: dict, uid: int, fid: str, now: float) -> bool:
    """Is this file part of this pair's album for this person? (fid is plain hex, so LIKE is safe.)"""
    like = f'%"{fid}"%'
    if c.execute("SELECT 1 FROM messages WHERE conv_id=? AND deleted=0 AND kind IN ('image','video','videonote') AND attachment LIKE ?", (pr["direct"], like)).fetchone():
        return True
    if c.execute("SELECT 1 FROM bucket WHERE conv_id=? AND done=1 AND photos LIKE ?", (pr["direct"], like)).fetchone():
        return True
    return any(_cap_readable(r, uid, now) for r in c.execute("SELECT * FROM capsules WHERE conv_id=? AND draft=0 AND unlock_at<=? AND attachments LIKE ?", (pr["direct"], now, like)))


@app.get("/api/memories/{cid}")
def mem_list(cid: int, filter: str = "all", cursor: str = "", through: str = "", limit: int = MEM_PAGE, authorization: str = Header(None)):
    """A page of the album, newest first. `cursor` is the `next` of the previous page; `through=YYYY-MM` keeps going (up to 1500 items) until that month is in."""
    import heapq
    u = auth(authorization)
    now, limit = time.time(), max(1, min(limit, 120))
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        tz = _tz(c, u["id"])
        favs = {r["file_id"] for r in c.execute("SELECT file_id FROM mem_fav WHERE conv_id=?", (pr["direct"],))}
        pos = None
        if cursor:
            try:
                t_, s_ = cursor.split("|", 1)
                pos = (float(t_), s_)
            except ValueError:
                raise ValueError("Bad cursor.")
        streams = []
        if filter in ("all", "fav"):
            streams.append(_mem_chat(c, pr["direct"], pos))
        if filter in ("all", "fav", "bucket"):
            streams.append(_mem_bucket(c, pr))
        if filter in ("all", "fav", "letters"):
            streams.append(_mem_letters(c, pr, u["id"], now))
        if filter == "fav" and not favs:
            streams = []
        key = lambda x: (x["t"], x["sid"])
        stop = through if re.fullmatch(r"\d{4}-\d{2}", through or "") else ""
        out, more = [], False
        for it in heapq.merge(*streams, key=key, reverse=True):
            if pos and key(it) >= pos:
                continue
            if filter == "fav" and it["id"] not in favs:
                continue
            it["ym"] = datetime.fromtimestamp(it["t"], tz).strftime("%Y-%m")
            if len(out) >= limit and not (stop and it["ym"] >= stop and len(out) < MEM_MAX):
                more = True
                break
            it["fav"] = it["id"] in favs
            out.append(it)
        nxt = f"{out[-1]['t']!r}|{out[-1]['sid']}" if out and more else ""
        return {"conv": pr["direct"], "pet": pr["pet"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "items": out, "next": nxt, "filter": filter}


@app.post("/api/memories/{cid}/fav")
async def mem_fav_set(cid: int, body: dict, authorization: str = Header(None)):
    """Either of you can star or unstar; the star belongs to the couple."""
    u = auth(authorization)
    fid, on = str(body.get("file") or ""), bool(body.get("on"))
    if not re.fullmatch(r"[0-9a-f]{24,32}", fid):
        raise ValueError("That photo isn't available.")
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if not _mem_has(c, pr, u["id"], fid, time.time()):
            raise HTTPException(404, "Not in the album")
        if on:
            c.execute("INSERT OR REPLACE INTO mem_fav (conv_id, file_id, fav_by, at) VALUES (?,?,?,?)", (pr["direct"], fid, u["id"], time.time()))
        else:
            c.execute("DELETE FROM mem_fav WHERE conv_id=? AND file_id=?", (pr["direct"], fid))
        c.commit()
    for x in (pr["a"], pr["b"]):
        await send_to(x, {"t": "memories", "conv": pr["direct"], "pet": pr["pet"], "what": "fav", "file": fid, "on": on, "by": u["id"]})
    return {"ok": True, "file": fid, "on": on}


# ---------------------------------------------------------------- v30: date-night spinner, gratitude jar, private gift wishlist, monthly recap
# The date ideas ship in web/games.js ("dates": [mode, budget, emoji, text]); the couple adds their own (date_ideas) and marks ideas done (date_done).
# The jar and the recap belong to the pair (their direct chat). The WISHLIST belongs to one person: every query below carries `owner = the caller`, there is no
# endpoint, ping, export or album that reads another person's row, and its photo is refused to everyone but the owner (see download()).
# Once-only jobs (weekend date idea, Sunday jar note, the 1st-of-the-month recap, wishlist reminders) claim a row in date_sent before they do anything.
DT_MODES, DT_MAX, DT_TITLE = ("in", "out"), 200, 120
GJ_LEN, GJ_COIN, GJ_CAP, GJ_PER_DAY, GJ_MAX = 280, 1, 3, 30, 3000  # +1 coin a note, at most 3 coins a day per person; at most 30 notes a day and 3000 in a jar
WL_MAX, WL_TITLE = 300, 120
V30_CHECK = [0.0]


def _lt(tz, now: float = 0):
    """The pair's local time; `now` (a timestamp) lets the tests ask 'what if it were Sunday evening'."""
    return datetime.fromtimestamp(now, tz) if now else datetime.now(tz)


def _pairs_all(c) -> list:
    """Every couple we know about: those with a pet and those with saved dates (same set as _couple_jobs)."""
    pairs = {}
    for p in c.execute("SELECT * FROM pets WHERE archived=0").fetchall():
        pr = _pair_build(c, p["user_a"], p["user_b"], p)
        pairs[pr["direct"]] = pr
    for r in c.execute("SELECT conv_id FROM pair_dates").fetchall():
        if r["conv_id"] not in pairs:
            m = [x["user_id"] for x in c.execute("SELECT user_id FROM members WHERE conv_id=?", (r["conv_id"],))]
            if len(m) == 2:
                pairs[r["conv_id"]] = _pair_build(c, min(m), max(m), _pet_for(c, m[0], m[1]))
    return list(pairs.values())


def _all_quiet(pr: dict, now: float = 0) -> bool:
    """Both of them are in their quiet hours: a nice-to-have message waits (it is not claimed) instead of arriving silently."""
    return quiet_now(pr["a"], now) and quiet_now(pr["b"], now)


async def v30_ping(pr: dict, t: str, what: str, by: int, extra=None):
    """Tell both phones that a list changed (no content)."""
    for uid in (pr["a"], pr["b"]):
        await send_to(uid, {"t": t, "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, **(extra or {})})


def _earn(c, pr: dict, uid: int, key: str, n: int, cap: int) -> int:
    """Give `n` pet coins for `uid` if their day total under `key` ('g'+day, like the bucket's 'b'+day) stays within `cap`. Returns what was given."""
    if not pr["pet_id"]:
        return 0
    r = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (uid, key)).fetchone()
    if (r["coins"] if r else 0) + n > cap:
        return 0
    c.execute("INSERT INTO game_coins (user_id, day, coins) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET coins=coins+?", (uid, key, n, n))
    _coins(c, pr["pet_id"], n)
    return n


# ---- date night
def _date_key(title: str) -> str:
    return "b" + hashlib.sha1(title.strip().lower().encode("utf-8")).hexdigest()[:8]


def _dt_ideas(c, pr: dict) -> list:
    done = {r["idea"]: r for r in c.execute("SELECT * FROM date_done WHERE conv_id=?", (pr["direct"],))}
    out = []
    for mode, budget, emoji, title in games_bank().get("dates", []):
        k = _date_key(title)
        d = done.get(k)
        out.append({"key": k, "mode": mode, "budget": budget, "emoji": emoji, "title": title, "custom": False, "done": bool(d), "done_at": d["done_at"] if d else 0})
    for r in c.execute("SELECT * FROM date_ideas WHERE conv_id=? ORDER BY id", (pr["direct"],)):
        k = "c%d" % r["id"]
        d = done.get(k)
        out.append({"key": k, "id": r["id"], "mode": r["mode"], "budget": r["budget"], "emoji": r["emoji"] or "✨", "title": r["title"], "custom": True, "added_by": r["added_by"],
                    "done": bool(d), "done_at": d["done_at"] if d else 0})
    return out


@app.get("/api/dates/{cid}")
def dt_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        return {"conv": pr["direct"], "pet": pr["pet"], "pet_name": pr["pet_name"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "ideas": _dt_ideas(c, pr)}


@app.post("/api/dates/{cid}/idea")
async def dt_add(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    title = " ".join(str(body.get("title") or "").split())[:DT_TITLE]
    if not title:
        raise ValueError("Write the idea first.")
    mode = body.get("mode") if body.get("mode") in DT_MODES else "in"
    budget = body.get("budget") if type(body.get("budget")) is int and 0 <= body["budget"] <= 2 else 0
    emoji = "".join(str(body.get("emoji") or "").split())[:8] or "✨"
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if c.execute("SELECT COUNT(*) FROM date_ideas WHERE conv_id=?", (pr["direct"],)).fetchone()[0] >= DT_MAX:
            raise ValueError("That's a lot of ideas already. Remove a few first.")
        if any(i["title"].lower() == title.lower() for i in _dt_ideas(c, pr)):
            raise ValueError("That idea is already on the wheel.")
        iid = c.execute("INSERT INTO date_ideas (conv_id, title, mode, budget, emoji, added_by, created) VALUES (?,?,?,?,?,?,?)",
                        (pr["direct"], title, mode, budget, emoji, u["id"], time.time())).lastrowid
        c.commit()
        out = next(i for i in _dt_ideas(c, pr) if i.get("id") == iid)
    await v30_ping(pr, "dateidea", "new", u["id"])
    return out


@app.delete("/api/dates/{cid}/idea/{iid}")
async def dt_delete(cid: int, iid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if not c.execute("DELETE FROM date_ideas WHERE id=? AND conv_id=?", (iid, pr["direct"])).rowcount:
            raise HTTPException(404, "Idea not found")
        c.execute("DELETE FROM date_done WHERE conv_id=? AND idea=?", (pr["direct"], "c%d" % iid))
        c.commit()
    await v30_ping(pr, "dateidea", "del", u["id"])
    return {"ok": True}


@app.post("/api/dates/{cid}/done")
async def dt_done(cid: int, body: dict, authorization: str = Header(None)):
    """'We did it': marks the idea done (once). Optionally adds it to the bucket list as a ticked item and/or posts a line in the couple's chat."""
    u = auth(authorization)
    uid, now, chip = u["id"], time.time(), None
    with closing(db()) as c:
        pr = _pair_of(c, cid, uid)
        key = str(body.get("key") or "")
        idea = next((i for i in _dt_ideas(c, pr) if i["key"] == key), None)
        if not idea:
            raise HTTPException(404, "Idea not found")
        if not c.execute("INSERT OR IGNORE INTO date_done (conv_id, idea, title, done_at, done_by) VALUES (?,?,?,?,?)", (pr["direct"], key, idea["title"], now, uid)).rowcount:
            raise ValueError("You've already done this one.")
        added = False
        if body.get("bucket") and not c.execute("SELECT 1 FROM bucket WHERE conv_id=? AND lower(title)=lower(?)", (pr["direct"], idea["title"][:120])).fetchone() \
                and c.execute("SELECT COUNT(*) FROM bucket WHERE conv_id=?", (pr["direct"],)).fetchone()[0] < BK_MAX:
            c.execute("INSERT INTO bucket (conv_id, title, cat, added_by, created, updated, done, done_at, done_day, done_by, paid) VALUES (?,?,?,?,?,?,1,?,?,?,1)",
                      (pr["direct"], idea["title"][:120], "go" if idea["mode"] == "out" else "do", uid, now, now, now, _day(pr["tz"]), uid))
            added = True
        if body.get("chat"):
            chip = _insert_msg(c, pr["direct"], uid, "text", f"🎲 Date night done: {idea['emoji']} {idea['title']}")
        c.commit()
    await v30_ping(pr, "dateidea", "done", uid)
    if added:
        await bk_ping(pr, "new", uid, 0)
    if chip:
        await _bcast_msg(pr["direct"], chip, u)
    return {"ok": True, "bucket": added, "chat": bool(chip)}


@app.post("/api/dates/{cid}/undo")
async def dt_undo(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        c.execute("DELETE FROM date_done WHERE conv_id=? AND idea=?", (pr["direct"], str(body.get("key") or "")))
        c.commit()
    await v30_ping(pr, "dateidea", "undo", u["id"])
    return {"ok": True}


# ---- v32: find a place together. Real places near you come from OpenStreetMap (Overpass); each of you swipes, and a place you both like is a match.
# Neither phone sees the other's swipes, only how far along they are, until a place is liked by both (on one phone both hearts are on the same screen anyway).
PLACE_FUN = {"amenity": {"cinema", "theatre", "arts_centre"}, "tourism": {"museum", "gallery", "viewpoint", "attraction", "zoo", "aquarium", "theme_park"},
             "leisure": {"park", "garden", "bowling_alley", "miniature_golf", "escape_game", "amusement_arcade", "water_park"}}
PLACE_KINDS = {  # id: (emoji, label, does a place with these OpenStreetMap tags count)
    "lunch": ("🍜", "Lunch", lambda t: t.get("amenity") in ("restaurant", "fast_food", "food_court")),
    "coffee": ("☕", "Coffee", lambda t: t.get("amenity") == "cafe" or t.get("shop") == "coffee"),
    "dinner": ("🍽️", "Dinner", lambda t: t.get("amenity") == "restaurant"),
    "dessert": ("🍰", "Dessert", lambda t: t.get("amenity") == "ice_cream" or t.get("shop") in ("bakery", "pastry", "confectionery")
                or (t.get("amenity") == "cafe" and bool(re.search(r"dessert|cake|ice_cream|bubble_tea", t.get("cuisine") or "")))),
    "fun": ("🎟️", "Something to do", lambda t: any(t.get(k) in v for k, v in PLACE_FUN.items())),
}
# one question to the map service fetches every kind at once, so switching from lunch to coffee in the same area is instant
PLACE_QUERY = ['nwr["amenity"~"^(restaurant|fast_food|food_court|cafe|ice_cream|cinema|theatre|arts_centre)$"]', 'nwr["shop"~"^(coffee|bakery|pastry|confectionery)$"]',
               'nwr["tourism"~"^(museum|gallery|viewpoint|attraction|zoo|aquarium|theme_park)$"]',
               'nwr["leisure"~"^(park|garden|bowling_alley|miniature_golf|escape_game|amusement_arcade|water_park)$"]["name"]']
PLACE_RADII = (1000, 3000, 5000, 10000)
PLACE_MAX = 40
OVERPASS_URLS = [x for x in os.environ.get("OVERPASS_URL", "").split(",") if x] or [  # public servers (free, often slow); when one fails the next is asked
    "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
_PLACE_CACHE: dict = {}  # (lat, lon, radius) rounded to ~100 m -> (when, {kind: places}): the same area within a day doesn't ask the map service again
_PLACE_LAST: dict = {}  # conv id -> when its last search started (one search every 15 s per couple)


def _place_what(t: dict) -> str:
    """A short label: the cuisine when there is one, else what kind of place it is."""
    cu = [x.strip().replace("_", " ") for x in (t.get("cuisine") or "").split(";") if x.strip()]
    if cu:
        return " · ".join(x[:1].upper() + x[1:] for x in cu[:2])
    for k in ("amenity", "shop", "tourism", "leisure"):
        if t.get(k):
            v = t[k].replace("_", " ")
            return {"fast food": "Fast food", "food court": "Food court", "ice cream": "Ice cream", "arts centre": "Arts centre"}.get(v, v[:1].upper() + v[1:])
    return ""


async def _osm_area(lat: float, lon: float, radius: int) -> dict:
    """{kind: places nearest first} around a point. Chains keep their nearest branch."""
    key = (round(lat, 3), round(lon, 3), radius)
    hit = _PLACE_CACHE.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    sel = "".join(f"{q}(around:{radius},{lat:.6f},{lon:.6f});" for q in PLACE_QUERY)
    els = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(80, connect=10), headers={"User-Agent": "AFRA-chat/1 (private couple app)"}) as h:
        for url in OVERPASS_URLS:
            try:
                r = await h.post(url, data={"data": f"[out:json][timeout:70];({sel});out center tags 3000;"})
                r.raise_for_status()
                els = r.json().get("elements", [])
                break
            except Exception as e:
                print("overpass failed:", url, repr(e)[:160], flush=True)
    if els is None:
        raise ValueError("The map service is busy right now. Try again in a minute.")
    found = []
    for e in els:
        t = e.get("tags") or {}
        name = (t.get("name") or t.get("name:en") or t.get("brand") or "").strip()
        la, lo = e.get("lat", (e.get("center") or {}).get("lat")), e.get("lon", (e.get("center") or {}).get("lon"))
        if not name or la is None or lo is None:
            continue
        addr = " ".join(x for x in (t.get("addr:street") or "", t.get("addr:housenumber") or "") if x).strip()
        found.append((t, {"id": f'{e.get("type", "n")[:1]}{e.get("id")}', "name": name[:80], "lat": round(float(la), 6), "lon": round(float(lo), 6),
                          "dist": int(_metres((lat, lon), (la, lo))), "what": _place_what(t)[:60], "hours": (t.get("opening_hours") or "")[:80], "addr": addr[:80]}))
    found.sort(key=lambda x: x[1]["dist"])
    out = {}
    for kind, (_, _, fits) in PLACE_KINDS.items():
        lst, names = [], set()
        for t, x in found:
            k = re.sub(r"\W+", " ", x["name"].lower()).strip()
            if fits(t) and k not in names:
                names.add(k); lst.append(x)
        out[kind] = lst
    if len(_PLACE_CACHE) > 200:
        _PLACE_CACHE.clear()
    _PLACE_CACHE[key] = (time.time(), out)
    return out


def _place_round(c, pr: dict):
    """The couple's open search (closed after 12 hours on its own)."""
    return c.execute("SELECT * FROM place_rounds WHERE conv_id=? AND closed=0 AND created>? ORDER BY id DESC LIMIT 1",
                     (pr["direct"], time.time() - 12 * 3600)).fetchone()


def _place_view(c, pr: dict, rd, uid: int) -> dict:
    places = json.loads(rd["places"] or "[]")
    other = pr["b"] if uid == pr["a"] else pr["a"]
    votes = {pr["a"]: {}, pr["b"]: {}}
    for v in c.execute("SELECT user_id, pid, yes FROM place_votes WHERE round_id=?", (rd["id"],)):
        if v["user_id"] in votes:
            votes[v["user_id"]][v["pid"]] = bool(v["yes"])
    matches = [x["id"] for x in places if votes[uid].get(x["id"]) and votes[other].get(x["id"])]
    em, label, _ = PLACE_KINDS.get(rd["kind"], ("📍", "Places", []))
    return {"id": rd["id"], "kind": rd["kind"], "emoji": em, "label": label, "radius": rd["radius"], "one": bool(rd["one"]), "started_by": rd["started_by"],
            "created": rd["created"], "places": places, "mine": votes[uid], "theirs": votes[other] if rd["one"] else None,
            "their_count": len(votes[other]), "matches": matches}


def _places_state(c, pr: dict, uid: int) -> dict:
    rd = _place_round(c, pr)
    return {"conv": pr["direct"], "me": uid, "names": _cards_names(c, pr, uid), "kinds": [{"id": k, "emoji": v[0], "label": v[1]} for k, v in PLACE_KINDS.items()],
            "radii": list(PLACE_RADII), "round": _place_view(c, pr, rd, uid) if rd else None}


async def places_ping(pr: dict, what: str, by: int, extra=None):
    for uid in (pr["a"], pr["b"]):
        await send_to(uid, {"t": "placepick", "conv": pr["direct"], "pet": pr["pet"], "what": what, "by": by, **(extra or {})})


@app.get("/api/places/{cid}")
def places_get(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        return _places_state(c, pr, u["id"])


@app.post("/api/places/{cid}/start")
async def places_start(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    kind = str(body.get("kind") or "")
    if kind not in PLACE_KINDS:
        raise ValueError("Pick what you're looking for")
    try:
        lat, lon = float(body["lat"]), float(body["lon"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("Needs your location")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Bad location")
    radius = int(body.get("radius") or 3000)
    radius = radius if radius in PLACE_RADII else 3000
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
    if time.time() - _PLACE_LAST.get(pr["direct"], 0) < 15:
        raise ValueError("Give it a few seconds, still looking")
    _PLACE_LAST[pr["direct"]] = time.time()
    found = (await _osm_area(lat, lon, radius))[kind]
    if len(found) < 5 and radius < PLACE_RADII[-1]:  # too few nearby: look one step further out
        radius = next(r for r in PLACE_RADII if r > radius)
        found = (await _osm_area(lat, lon, radius))[kind]
    if not found:
        raise ValueError("Nothing like that on the map around here. Try something else.")
    near = found[:PLACE_MAX * 2]
    pick = random.sample(near, min(PLACE_MAX, len(near)))
    with closing(db()) as c:
        c.execute("UPDATE place_rounds SET closed=? WHERE conv_id=? AND closed=0", (time.time(), pr["direct"]))
        c.execute("INSERT INTO place_rounds (conv_id, kind, lat, lon, radius, places, started_by, one, created) VALUES (?,?,?,?,?,?,?,?,?)",
                  (pr["direct"], kind, lat, lon, radius, json.dumps(pick, ensure_ascii=False), u["id"], 1 if body.get("one") else 0, time.time()))
        out = _places_state(c, pr, u["id"])
        c.commit()
    await places_ping(pr, "start", u["id"], {"kind": kind, "one": bool(body.get("one"))})
    return out


@app.post("/api/places/{cid}/vote")
async def places_vote(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rd = _place_round(c, pr)
        if not rd or rd["id"] != int(body.get("round") or 0):
            raise ValueError("That search has ended. Start a new one.")
        pid = str(body.get("pid") or "")
        place = next((x for x in json.loads(rd["places"] or "[]") if x["id"] == pid), None)
        if not place:
            raise ValueError("That place isn't in this search")
        who = u["id"]
        other = pr["b"] if who == pr["a"] else pr["a"]
        if body.get("for") and int(body["for"]) == other:
            if not rd["one"]:
                raise ValueError("They swipe on their own phone in this search")
            who = other
        c.execute("INSERT OR REPLACE INTO place_votes (round_id, user_id, pid, yes, at) VALUES (?,?,?,?,?)", (rd["id"], who, pid, 1 if body.get("yes") else 0, time.time()))
        partner = pr["b"] if who == pr["a"] else pr["a"]
        v = c.execute("SELECT yes FROM place_votes WHERE round_id=? AND user_id=? AND pid=?", (rd["id"], partner, pid)).fetchone()
        match = bool(body.get("yes")) and bool(v and v["yes"])
        out = _places_state(c, pr, u["id"])
        c.commit()
    out["match"] = pid if match else ""
    await places_ping(pr, "match" if match else "vote", u["id"], {"pid": pid, "name": place["name"]} if match else None)
    return out


@app.post("/api/places/{cid}/close")
async def places_close(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        c.execute("UPDATE place_rounds SET closed=? WHERE conv_id=? AND closed=0", (time.time(), pr["direct"]))
        out = _places_state(c, pr, u["id"])
        c.commit()
    await places_ping(pr, "close", u["id"])
    return out


async def _date_jobs(now: float = 0):
    """Saturday and Sunday (10:00-21:00 pair time): the pet suggests one idea that isn't done yet, once per weekend (claimed in date_sent first)."""
    acts = []
    with closing(db()) as c:
        for pr in _pairs_all(c):
            if not pr["pet"]:
                continue
            lt = _lt(pr["tz"], now)
            if lt.weekday() < 5 or not 10 <= lt.hour < 21 or _all_quiet(pr, now):
                continue
            iso = lt.isocalendar()
            key = f"datenight:{iso[0]}-W{iso[1]:02d}"
            if c.execute("SELECT 1 FROM date_sent WHERE conv_id=? AND key=?", (pr["direct"], key)).fetchone():
                continue
            pool = [i for i in _dt_ideas(c, pr) if not i["done"]]
            if pool and c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], key)).rowcount:
                acts.append((pr, random.choice(pool)))
        c.commit()
    for pr, idea in acts:
        try:
            await pet_say(pr["pet"], f"It's the weekend! 🎲 Date idea for you two: {idea['emoji']} {idea['title']}. Not feeling it? Spin the wheel in Date night.", push=True)
        except Exception as e:
            print("date job failed:", repr(e)[:300], flush=True)


# ---- gratitude jar
def _gj_view(r, uid: int) -> dict:
    return {"id": r["id"], "author": r["author"], "body": r["body"], "created": r["created"], "read": bool(r["read_at"]), "mine": r["author"] == uid}


@app.get("/api/jar/{cid}")
def gj_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        rows = c.execute("SELECT * FROM gratitude WHERE conv_id=? ORDER BY created DESC, id DESC LIMIT 400", (pr["direct"],)).fetchall()
        n = c.execute("SELECT COUNT(*) FROM gratitude WHERE conv_id=?", (pr["direct"],)).fetchone()[0]
        used = c.execute("SELECT coins FROM game_coins WHERE user_id=? AND day=?", (u["id"], "g" + _day(pr["tz"]))).fetchone()
        return {"conv": pr["direct"], "pet": pr["pet"], "pet_name": pr["pet_name"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "coins": bool(pr["pet_id"]),
                "today": used["coins"] if used else 0, "cap": GJ_CAP, "pay": GJ_COIN, "count": n, "items": [_gj_view(r, u["id"]) for r in rows]}


@app.post("/api/jar/{cid}")
async def gj_add(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    text = " ".join(str(body.get("text") or "").split())
    if not text:
        raise ValueError("Write a little note first.")
    if len(text) > GJ_LEN:
        raise ValueError(f"Keep it under {GJ_LEN} characters.")
    uid, now = u["id"], time.time()
    with closing(db()) as c:
        pr = _pair_of(c, cid, uid)
        t0 = datetime.fromtimestamp(now, pr["tz"]).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        if c.execute("SELECT COUNT(*) FROM gratitude WHERE conv_id=? AND author=? AND created>=?", (pr["direct"], uid, t0)).fetchone()[0] >= GJ_PER_DAY:
            raise ValueError("That's plenty for today. The jar will keep.")
        if c.execute("SELECT COUNT(*) FROM gratitude WHERE conv_id=?", (pr["direct"],)).fetchone()[0] >= GJ_MAX:
            raise ValueError("The jar is full!")
        nid = c.execute("INSERT INTO gratitude (conv_id, author, body, created) VALUES (?,?,?,?)", (pr["direct"], uid, text, now)).lastrowid
        give = _earn(c, pr, uid, "g" + _day(pr["tz"]), GJ_COIN, GJ_CAP)
        out = {"item": _gj_view(c.execute("SELECT * FROM gratitude WHERE id=?", (nid,)).fetchone(), uid), "coins": give,
               "count": c.execute("SELECT COUNT(*) FROM gratitude WHERE conv_id=?", (pr["direct"],)).fetchone()[0]}
        c.commit()
    await v30_ping(pr, "jar", "new", uid, {"id": nid})
    return out


@app.delete("/api/jar/{cid}/{nid}")
async def gj_delete(cid: int, nid: int, authorization: str = Header(None)):
    """Only the one who wrote a note can take it out of the jar."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        if not c.execute("DELETE FROM gratitude WHERE id=? AND conv_id=? AND author=?", (nid, pr["direct"], u["id"])).rowcount:
            raise HTTPException(404, "Note not found")
        c.commit()
    await v30_ping(pr, "jar", "del", u["id"], {"id": nid})
    return {"ok": True}


async def _grat_jobs(now: float = 0):
    """Sunday 18:00-22:00 (pair time): the pet reads one note nobody has heard yet, once per week. The week is claimed in date_sent first, then the note is claimed
    with a rowcount guard on read_at, so two overlapping loops still read one note."""
    acts = []
    with closing(db()) as c:
        for pr in _pairs_all(c):
            if not pr["pet"]:
                continue
            lt = _lt(pr["tz"], now)
            if lt.weekday() != 6 or not 18 <= lt.hour < 22 or _all_quiet(pr, now):
                continue
            iso = lt.isocalendar()
            key = f"jar:{iso[0]}-W{iso[1]:02d}"
            if c.execute("SELECT 1 FROM date_sent WHERE conv_id=? AND key=?", (pr["direct"], key)).fetchone():
                continue
            ids = [r["id"] for r in c.execute("SELECT id FROM gratitude WHERE conv_id=? AND read_at=0", (pr["direct"],))]
            if not ids or not c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], key)).rowcount:
                continue
            nid = random.choice(ids)
            if not c.execute("UPDATE gratitude SET read_at=? WHERE id=? AND read_at=0", (now or time.time(), nid)).rowcount:
                continue
            r = c.execute("SELECT * FROM gratitude WHERE id=?", (nid,)).fetchone()
            who = _first(c.execute("SELECT * FROM users WHERE id=?", (r["author"],)).fetchone())
            acts.append((pr, who, r))
        c.commit()
    for pr, who, r in acts:
        try:
            await pet_say(pr["pet"], f"A note from the jar 🫙 {who} wrote: “{r['body']}”", push=True)
            await v30_ping(pr, "jar", "read", 0, {"id": r["id"]})
        except Exception as e:
            print("jar job failed:", repr(e)[:300], flush=True)


# ---- private gift wishlist
def _wl_view(r) -> dict:
    return {"id": r["id"], "title": r["title"], "link": r["link"], "note": r["note"], "price": r["price"], "photo": r["photo"], "bought": bool(r["bought"]),
            "bought_at": r["bought_at"], "created": r["created"]}


def _wl_row(c, uid: int, wid: int):
    """Somebody else's item is exactly as missing as one that doesn't exist."""
    r = c.execute("SELECT * FROM wishlist WHERE id=? AND owner=?", (wid, uid)).fetchone()
    if not r:
        raise HTTPException(404, "Not found")
    return r


def _wl_fields(c, uid: int, body: dict) -> dict:
    out = {}
    if "title" in body:
        t = " ".join(str(body.get("title") or "").split())
        if not t:
            raise ValueError("Give the idea a name first.")
        out["title"] = t[:WL_TITLE]
    if "link" in body:
        s = str(body.get("link") or "").strip()[:500]
        if s and "://" not in s:
            if re.match(r"[a-z][a-z0-9+.\-]*:(?!\d)", s, re.I):  # javascript:, mailto:, data: ... only web links are kept
                raise ValueError("That link doesn't look right.")
            s = "https://" + s
        if s and (urlparse(s).scheme not in ("http", "https") or not urlparse(s).netloc):
            raise ValueError("That link doesn't look right.")
        out["link"] = s
    if "note" in body:
        out["note"] = str(body.get("note") or "").strip()[:500]
    if "price" in body:
        out["price"] = " ".join(str(body.get("price") or "").split())[:30]
    if "photo" in body:
        ph = body.get("photo")
        out["photo"] = _cap_photos(c, uid, [{"id": ph}], 1)[0]["id"] if ph else ""
    return out


@app.get("/api/wishlist/{cid}")
def wl_list(cid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        other = _g_other(pr, u["id"])
        rows = c.execute("SELECT * FROM wishlist WHERE owner=? AND for_uid=? ORDER BY bought, created DESC, id DESC", (u["id"], other)).fetchall()
        return {"conv": pr["direct"], "me": u["id"], "for": other, "for_name": _first_name(c, u["id"], other), "items": [_wl_view(r) for r in rows]}


@app.post("/api/wishlist/{cid}")
def wl_add(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        f = _wl_fields(c, u["id"], {"title": "", "link": "", "note": "", "price": "", "photo": "", **{k: body.get(k) for k in ("title", "link", "note", "price", "photo") if k in body}})
        other, now = _g_other(pr, u["id"]), time.time()
        if c.execute("SELECT COUNT(*) FROM wishlist WHERE owner=?", (u["id"],)).fetchone()[0] >= WL_MAX:
            raise ValueError("That's a long list! Remove a few first.")
        wid = c.execute("INSERT INTO wishlist (owner, for_uid, title, link, note, price, photo, created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                        (u["id"], other, f["title"], f["link"], f["note"], f["price"], f["photo"], now, now)).lastrowid
        out = _wl_view(c.execute("SELECT * FROM wishlist WHERE id=?", (wid,)).fetchone())
        c.commit()
        return out


@app.put("/api/wishlist/{cid}/{wid}")
def wl_edit(cid: int, wid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _pair_of(c, cid, u["id"])
        _wl_row(c, u["id"], wid)
        f = _wl_fields(c, u["id"], {k: body[k] for k in ("title", "link", "note", "price", "photo") if k in body})
        if f:
            f["updated"] = time.time()
            c.execute("UPDATE wishlist SET " + ", ".join(f"{k}=?" for k in f) + " WHERE id=? AND owner=?", (*f.values(), wid, u["id"]))
        out = _wl_view(c.execute("SELECT * FROM wishlist WHERE id=?", (wid,)).fetchone())
        c.commit()
        return out


@app.delete("/api/wishlist/{cid}/{wid}")
def wl_delete(cid: int, wid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        _pair_of(c, cid, u["id"])
        _wl_row(c, u["id"], wid)
        c.execute("DELETE FROM wishlist WHERE id=? AND owner=?", (wid, u["id"]))
        c.commit()
    return {"ok": True}


@app.post("/api/wishlist/{cid}/{wid}/bought")
def wl_bought(cid: int, wid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    on = bool(body.get("bought", True))
    with closing(db()) as c:
        _pair_of(c, cid, u["id"])
        _wl_row(c, u["id"], wid)
        c.execute("UPDATE wishlist SET bought=?, bought_at=?, updated=? WHERE id=? AND owner=?", (int(on), time.time() if on else 0, time.time(), wid, u["id"]))
        out = _wl_view(c.execute("SELECT * FROM wishlist WHERE id=?", (wid,)).fetchone())
        c.commit()
        return out


async def _wish_jobs(now: float = 0):
    """A push to the AUTHOR (only) 14 and 3 days before the partner's birthday and before the anniversary, if they still have unbought ideas. Each reminder is claimed
    in date_sent first (key wish:<author>:<occasion>:<days>). Not before 09:00 in the author's own time zone, and not while they are in quiet hours (it waits, unclaimed)."""
    acts = []
    with closing(db()) as c:
        for pr in _pairs_all(c):
            for me in (pr["a"], pr["b"]):
                other = _g_other(pr, me)
                left = c.execute("SELECT COUNT(*) FROM wishlist WHERE owner=? AND for_uid=? AND bought=0", (me, other)).fetchone()[0]
                if not left:
                    continue
                lt = _lt(_tz(c, me), now)
                if lt.hour < 9 or quiet_now(me, now):
                    continue
                for lead in (14, 3):
                    for o in _occasions(c, pr, lt.date() + timedelta(days=lead)):
                        if o["type"] == "month" or (o["type"] == "bday" and o["uid"] != other):
                            continue
                        if c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], f"wish:{me}:{o['key']}:{lead}")).rowcount:
                            acts.append((pr, me, o, lead, left, _first_name(c, me, other)))
        c.commit()
    for pr, me, o, lead, left, who in acts:
        try:
            what = f"{who}'s birthday" if o["type"] == "bday" else "Your anniversary"
            await push_to([me], {"title": f"🎁 {what} is in {_plural(lead, 'day')}", "body": f"You've saved {_plural(left, 'gift idea')} for {who}. Anything left to buy?",
                                 "conv": pr["pet"] or pr["direct"], "icon": "/icon-512.png", "tag": f"wish-{o['key']}"})
        except Exception as e:
            print("wish job failed:", repr(e)[:300], flush=True)


# ---- our month (recap)
RECAP_SYSTEM = ("touch", "petact", "pinact", "petinvite", "card", "capsule", "game", "bucket")
_EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⭕⬛⬜]")


def _rc_month(v, tz, now: float = 0) -> tuple:
    """(YYYY-MM, start, end) of a month that is over."""
    if not re.fullmatch(r"\d{4}-\d{2}", v or ""):
        raise ValueError("Pick a month.")
    y, m = int(v[:4]), int(v[5:])
    if not 2000 <= y <= 2100 or not 1 <= m <= 12:
        raise ValueError("Pick a month.")
    t0 = datetime(y, m, 1, tzinfo=tz)
    t1 = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=tz)
    if t1.timestamp() > (now or time.time()):
        raise ValueError("That month isn't over yet.")
    return v, t0.timestamp(), t1.timestamp()


def _rc_prev(tz, now: float = 0) -> str:
    d = _lt(tz, now).date().replace(day=1) - timedelta(days=1)
    return d.strftime("%Y-%m")


def _rc_months(c, pr: dict, now: float = 0) -> list:
    """Months with chat in them, newest first, up to and including last month."""
    first = c.execute("SELECT MIN(created) FROM messages WHERE conv_id=?", (pr["direct"],)).fetchone()[0]
    if not first:
        return []
    a, b = _lt(pr["tz"], first).date().replace(day=1), _rc_prev(pr["tz"], now)
    out, d = [], a
    while d.strftime("%Y-%m") <= b:
        out.append(d.strftime("%Y-%m"))
        d = (d + timedelta(days=32)).replace(day=1)
    return out[::-1]


def _rc_stats(c, pr: dict, ym: str, t0: float, t1: float) -> dict:
    """Everything the card can say about one month, from rows that exist. A stat with no data is simply missing from the answer."""
    cid, a, b, tz = pr["direct"], pr["a"], pr["b"], pr["tz"]
    st = {}
    rows = c.execute("SELECT sender, kind, text, created FROM messages WHERE conv_id=? AND deleted=0 AND created>=? AND created<?", (cid, t0, t1)).fetchall()
    rows = [r for r in rows if r["kind"] not in RECAP_SYSTEM and r["sender"] in (a, b)]
    if rows:
        st["messages"] = {str(a): sum(r["sender"] == a for r in rows), str(b): sum(r["sender"] == b for r in rows), "total": len(rows)}
        for name, kinds in (("photos", ("image",)), ("videos", ("video", "videonote")), ("voice", ("voice",))):
            n = sum(r["kind"] in kinds for r in rows)
            if n:
                st[name] = n
        emo = {}
        for r in rows:
            if r["kind"] == "text":
                for ch in _EMOJI_RE.findall(r["text"] or ""):
                    emo[ch] = emo.get(ch, 0) + 1
        if emo:
            e = max(emo.items(), key=lambda kv: (kv[1], kv[0]))
            st["top_emoji"] = {"emoji": e[0], "count": e[1]}
        days = {}
        for r in rows:
            d = days.setdefault(_day(tz, r["created"]), {a: 0, b: 0})
            d[r["sender"]] += 1
        best = max(days.items(), key=lambda kv: (kv[1][a] + kv[1][b], kv[0]))
        st["busiest"] = {"day": best[0], "count": best[1][a] + best[1][b]}
        run = top = 0
        prev = None
        for dkey in sorted(k for k, v in days.items() if v[a] and v[b]):
            dd = _dparse(dkey)
            run = run + 1 if prev and (dd - prev).days == 1 else 1
            prev, top = dd, max(top, run)
        if top >= 2:
            st["streak"] = top
    tq = c.execute("SELECT sender, COALESCE(SUM(count),0) n FROM touches WHERE conv_id=? AND ts>=? AND ts<? GROUP BY sender", (cid, t0, t1)).fetchall()
    if sum(x["n"] for x in tq):
        st["touches"] = {str(a): 0, str(b): 0, **{str(x["sender"]): x["n"] for x in tq}, "total": sum(x["n"] for x in tq)}
    g = c.execute("SELECT winner FROM games WHERE conv_id=? AND status='done' AND finished>=? AND finished<?", (cid, t0, t1)).fetchall()
    if g:
        st["games"] = {"n": len(g), str(a): sum(x["winner"] == a for x in g), str(b): sum(x["winner"] == b for x in g)}
    bk = [r["title"] for r in c.execute("SELECT title FROM bucket WHERE conv_id=? AND done=1 AND done_at>=? AND done_at<? ORDER BY done_at", (cid, t0, t1))]
    if bk:
        st["bucket"] = {"n": len(bk), "titles": bk[:3]}
    n = c.execute("SELECT COUNT(*) FROM capsules WHERE conv_id=? AND draft=0 AND opened_at>=? AND opened_at<?", (cid, t0, t1)).fetchone()[0]
    if n:
        st["letters"] = n
    gr = c.execute("SELECT author, COUNT(*) n FROM gratitude WHERE conv_id=? AND created>=? AND created<? GROUP BY author", (cid, t0, t1)).fetchall()
    if gr:
        st["gratitude"] = {str(a): 0, str(b): 0, **{str(x["author"]): x["n"] for x in gr}, "total": sum(x["n"] for x in gr)}
    q = c.execute("SELECT COUNT(*) FROM (SELECT day FROM dq_answers WHERE conv_id=? AND day>=? AND day<? GROUP BY day HAVING COUNT(*)>=2)",
                  (cid, ym + "-01", ym + "-32")).fetchone()[0]
    if q:
        st["questions"] = q
    if pr["pet_id"]:
        cared = 0
        for r in c.execute("SELECT data FROM pet_days WHERE pet_id=? AND day>=? AND day<?", (pr["pet_id"], ym + "-01", ym + "-32")):
            try:
                d = json.loads(r["data"] or "{}")
            except ValueError:
                continue
            cared += any(d.get(k) for k in ("feed", "play", "tend", "sleep"))
        ms = [r["text"] for r in c.execute("SELECT text FROM pet_log WHERE pet_id=? AND at>=? AND at<? AND kind IN ('stage','streak','item') ORDER BY at LIMIT 4", (pr["pet_id"], t0, t1))]
        if cared or ms:
            st["pet"] = {"name": pr["pet_name"], "days": cared, "milestones": ms}
    return st


@app.get("/api/recap/{cid}")
def rc_get(cid: int, month: str = "", authorization: str = Header(None)):
    """The recap of one finished month (default: last month). Only counts, never the words of a letter or a note."""
    u = auth(authorization)
    with closing(db()) as c:
        pr = _pair_of(c, cid, u["id"])
        ym, t0, t1 = _rc_month(month or _rc_prev(pr["tz"]), pr["tz"])
        label = datetime(int(ym[:4]), int(ym[5:]), 1).strftime("%B %Y")
        return {"conv": pr["direct"], "pet": pr["pet"], "me": u["id"], "names": _cards_names(c, pr, u["id"]), "month": ym, "label": label,
                "months": _rc_months(c, pr), "stats": _rc_stats(c, pr, ym, t0, t1)}


async def _recap_jobs(now: float = 0):
    """On the 1st (09:00-22:00, pair time) the pet says 'your month is ready' once for the month that just ended (claimed in date_sent first)."""
    acts = []
    with closing(db()) as c:
        for pr in _pairs_all(c):
            if not pr["pet"]:
                continue
            lt = _lt(pr["tz"], now)
            if lt.day != 1 or not 9 <= lt.hour < 22 or _all_quiet(pr, now):
                continue
            ym = _rc_prev(pr["tz"], now)
            if c.execute("SELECT 1 FROM date_sent WHERE conv_id=? AND key=?", (pr["direct"], "recap:" + ym)).fetchone():
                continue
            _, t0, t1 = _rc_month(ym, pr["tz"], now)
            has = c.execute("SELECT 1 FROM messages WHERE conv_id=? AND deleted=0 AND created>=? AND created<?", (pr["direct"], t0, t1)).fetchone()
            if has and c.execute("INSERT OR IGNORE INTO date_sent (conv_id, key) VALUES (?,?)", (pr["direct"], "recap:" + ym)).rowcount:
                acts.append((pr, datetime(int(ym[:4]), int(ym[5:]), 1).strftime("%B")))
        c.commit()
    for pr, month in acts:
        try:
            await pet_say(pr["pet"], f"Your month is ready 📅 Here's how {month} went for you two. Open Our month on Home.", push=True)
        except Exception as e:
            print("recap job failed:", repr(e)[:300], flush=True)


async def _v30_jobs():
    """From the reminder loop, at most every 2 minutes. Each job guards itself, so a failure in one never stops the others."""
    if time.time() - V30_CHECK[0] < 120:
        return
    V30_CHECK[0] = time.time()
    for job in (_date_jobs, _grat_jobs, _wish_jobs, _recap_jobs):
        try:
            await job()
        except Exception as e:
            print("v30 job failed:", job.__name__, repr(e)[:300], flush=True)


# ---------------------------------------------------------------- live updates (one WebSocket per device)
async def send_to(uid: int, msg: dict):
    if msg.get("t") in ("read", "typing", "presence") and not _relay_ok(msg["t"], msg.get("user") or 0, uid):
        return  # v29: this is the one place read ticks, typing and online status leave the server
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
        await send_to(p, {"t": "profile", "user": public(u, p)})


def _app_version() -> str:
    """APP_V in app.js is the app version: bump it (with the ?v= and sw.js cache name) and every open app updates itself.
    Read from the very file the page runs, so a fresh page always matches and can never reload in a loop."""
    try:
        m = re.search(r"const APP_V = (\d+);", (WEB / "app.js").read_text(encoding="utf-8"))
        return m.group(1) if m else ""  # empty: clients skip the check
    except OSError:
        return ""


APP_VERSION = _app_version()


@app.get("/api/version")
def app_version():
    return JSONResponse({"version": APP_VERSION}, headers={"Cache-Control": "no-store"})


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
    try:
        await sock.send_text(json.dumps({"t": "hello", "version": APP_VERSION}))
    except Exception:
        pass
    if first:
        await announce_presence(uid, True)
    try:
        while True:
            m = json.loads(await sock.receive_text())
            if m.get("t") == "vis":
                SOCKETS[uid][dev]["visible"] = bool(m.get("v"))
                if not m.get("v"):  # a locked or hidden screen is not "here" any more
                    await us_leave(uid, dev)
            elif m.get("t") == "ping":
                await sock.send_text('{"t":"pong"}')
            elif m.get("t") in ("game_draw", "us_tap") and closing_mode() == "readonly" and not u["is_admin"]:
                pass  # the app is closed: nothing new
            elif m.get("t") == "game_draw":
                try:
                    await game_draw_relay(uid, m)
                except (TypeError, ValueError, KeyError, sqlite3.Error):
                    pass
            elif m.get("t") in ("us", "us_tap"):
                try:  # a bad live-touch event must never drop the chat connection
                    if m["t"] == "us":
                        await us_set(int(m.get("conv") or 0), uid, dev, bool(m.get("here")))
                    else:
                        await us_tap(uid, int(m.get("conv") or 0), m)
                except (TypeError, ValueError, KeyError, sqlite3.Error):
                    pass
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        if SOCKETS.get(uid, {}).get(dev, {}).get("ws") is sock:
            await us_leave(uid, dev)
            SOCKETS[uid].pop(dev, None)
            if not SOCKETS[uid]:
                SOCKETS.pop(uid, None)
                await announce_presence(uid, False)


# ---------------------------------------------------------------- live touch (Us screen): presence and taps relayed over the WebSocket, nothing stored per tap
def us_peer(uid: int, cid: int) -> int:
    """The other person of a couple chat that `uid` is in (0 when it is not one)."""
    k = (uid, cid)
    if k not in US_PAIR:
        with closing(db()) as c:
            r = c.execute("""SELECT u.id, u.bot FROM convs v JOIN members m ON m.conv_id=v.id JOIN users u ON u.id=m.user_id
                            WHERE v.id=? AND v.kind='direct' AND u.id<>? AND EXISTS (SELECT 1 FROM members x WHERE x.conv_id=v.id AND x.user_id=?)""", (cid, uid, uid)).fetchone()
        US_PAIR[k] = r["id"] if r and not r["bot"] else 0
    return US_PAIR[k]


def us_present(cid: int, uid: int) -> bool:
    dev = US_HERE.get(cid, {}).get(uid)
    return bool(dev) and any(s_["visible"] for d, s_ in SOCKETS.get(uid, {}).items() if d == dev)


async def us_set(cid: int, uid: int, dev: str, here: bool):
    peer = us_peer(uid, cid)
    if not peer:
        return
    d = US_HERE.setdefault(cid, {})
    if here:
        d[uid] = dev
    else:
        if d.get(uid) != dev:
            return
        d.pop(uid, None)
        US_STATE.get(cid, {}).pop(uid, None)
    if not d:
        US_HERE.pop(cid, None)
    await send_to(peer, {"t": "us_here", "conv": cid, "user": uid, "here": here})
    if here:  # and the one who just came in learns whether the other is already there
        await send_to(uid, {"t": "us_here", "conv": cid, "user": peer, "here": us_present(cid, peer)})


async def us_leave(uid: int, dev: str):
    for cid in [k for k, d in US_HERE.items() if d.get(uid) == dev]:
        await us_set(cid, uid, dev, False)


async def us_tap(uid: int, cid: int, m: dict):
    """One small event of a live touch, passed on to the other person only. Also spots "in sync" moments."""
    peer = us_peer(uid, cid)
    if not peer or not us_present(cid, uid) or not us_present(cid, peer):
        return
    k = m.get("k") if m.get("k") in ("d", "m", "u", "b") else "d"
    now_ = time.time()
    if now_ - US_RATE.get((uid, k), 0) < (0.4 if k == "b" else 0.04):  # at most about 20 a second
        return
    US_RATE[(uid, k)] = now_

    def num(v, lo, hi, d):
        try:
            return round(max(lo, min(hi, float(v))), 3)
        except (TypeError, ValueError):
            return d
    x, y, s_ = num(m.get("x"), 0, 1, .5), num(m.get("y"), 0, 1, .5), num(m.get("s"), 1, 5, 2)
    a = m.get("a") if m.get("a") in TOUCH_ACTIONS else ""
    await send_to(peer, {"t": "us_tap", "conv": cid, "user": uid, "k": k, "x": x, "y": y, "s": s_, "a": a})
    st = US_STATE.setdefault(cid, {})
    me, him = st.setdefault(uid, {"down": False, "t": 0, "pt": 0, "a": "", "x": .5, "y": .5}), st.get(peer)
    if k == "u":
        me["down"] = False
        return
    if k == "b":
        return
    me.update(x=x, y=y, pt=now_, down=True)
    if k == "d":
        me.update(t=now_, a=a)
    if not him or now_ - US_SYNC_AT.get(cid, 0) < 5:
        return
    same_action = k == "d" and a and him["a"] == a and now_ - him["t"] <= 1.0
    near = him["down"] and now_ - him["pt"] < 1.5 and math.hypot(x - him["x"], y - him["y"]) < .15
    if same_action or near:
        US_SYNC_AT[cid] = now_
        with closing(db()) as c:
            c.execute("INSERT INTO us_sync (conv_id, at) VALUES (?,?)", (cid, now_))
            c.commit()
        for t_ in (uid, peer):
            await send_to(t_, {"t": "us_sync", "conv": cid})


@app.post("/api/us/{cid}/invite")
async def us_invite(cid: int, authorization: str = Header(None)):
    """Come to Us: one gentle push that opens straight into the Us screen (once per 2 minutes per person)."""
    u = auth(authorization)
    peer = us_peer(u["id"], cid)
    if not peer:
        raise HTTPException(404, "Chat not found")
    if us_present(cid, peer):
        return {"here": True, "sent": False}
    left = 120 - (time.time() - US_INVITED.get(u["id"], 0))
    if left > 0:
        raise HTTPException(429, f"You just asked. Try again in {math.ceil(left)} s.")
    US_INVITED[u["id"]] = time.time()
    with closing(db()) as c:
        nick = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (peer, u["id"])).fetchone()
        pr = touch_prefs(c, peer)
        quiet = in_quiet(pr, _tz(c, peer))
    await send_to(peer, {"t": "us_invite", "conv": cid, "user": u["id"]})
    push = pr["mode"] != "off" and not quiet
    if push:
        asyncio.create_task(push_to([peer], {"title": (nick[0] if nick else None) or u["name"] or u["username"], "body": "Come to Us 🫶", "conv": cid, "us": cid,
                                             "tag": f"us-{cid}", "icon": f"/api/avatar/{u['id']}" if u["avatar"] else "/icon-512.png", "vibrate": [80, 50, 80], "k": "touch"}))
    return {"here": False, "sent": True, "push": push}


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


def quiet_now(uid: int, at: float = 0) -> bool:
    p = prefs_of(uid)
    if not p["quiet_on"]:
        return False
    with closing(db()) as c:
        return in_quiet(p, _tz(c, uid), at)


def shape_push(uid: int, payload: dict, at: float = 0) -> dict:
    """What THIS person's notification may say, from their own settings. payload["k"] says what it is: "" (carries private content),
    "touch" (a short touch line: nothing to hide, may buzz in quiet hours), "sys" (an announcement or test: shown as is)."""
    p, pf = dict(payload), prefs_of(uid)
    k = p.pop("k", "")
    if k != "sys":
        if pf["hide_text"] and k != "touch":
            p["body"] = "New message"
        if pf["hide_sender"]:
            p["title"], p["icon"] = "AFRA chat", "/icon-512.png"
    if quiet_now(uid, at) and not (k == "touch" and pf["quiet_touch"]):
        p["silent"], p["renotify"] = True, False  # quiet hours: it still arrives, without sound or vibration (nothing is held back or lost)
        p.pop("vibrate", None)
    return p


async def push_to(uids: list[int], payload: dict, skip_visible=True):
    with closing(db()) as c:
        rows = c.execute(f"SELECT * FROM pushes WHERE user_id IN ({','.join('?' * len(uids))})", uids).fetchall() if uids else []
    shaped: dict[int, dict] = {}
    async with httpx.AsyncClient(timeout=15) as h:
        for r in rows:
            devs = SOCKETS.get(r["user_id"], {})
            if skip_visible and any(s_["visible"] for d, s_ in devs.items() if d == r["device"] or d.startswith(r["device"] + ".")):
                continue  # that device has the app open and shows the message itself
            try:
                sub = json.loads(r["sub"])
                with closing(db()) as c:
                    badge = c.execute("""SELECT COUNT(*) FROM messages ms JOIN members mb ON mb.conv_id=ms.conv_id AND mb.user_id=?
                                         WHERE ms.sender<>? AND ms.deleted=0 AND ms.kind NOT IN ('touch','pinact','card','game') AND ms.created>mb.last_read""", (r["user_id"], r["user_id"])).fetchone()[0]
                pl = shaped.get(r["user_id"]) or shaped.setdefault(r["user_id"], shape_push(r["user_id"], payload))
                body = encrypt_push(sub, json.dumps({**pl, "badge": badge}).encode()[:3800])
                resp = await h.post(sub["endpoint"], content=body, headers={
                    "Authorization": _vapid_header(sub["endpoint"]), "Content-Encoding": "aes128gcm",
                    "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high"})
                if resp.status_code in (404, 410):
                    with closing(db()) as c:
                        c.execute("DELETE FROM pushes WHERE endpoint=?", (r["endpoint"],))
                        c.commit()
            except Exception as e:
                print("push failed:", e, flush=True)


def _push_body(m: dict) -> str:
    icon = {"image": "📷", "video": "🎥", "videonote": "📹", "sticker": "", "location": "📍"}.get(m["kind"])
    body = {"image": "📷 Photo", "voice": "🎤 Voice note", "file": "📎 " + ((m.get("attachment") or {}).get("name") or "File"),
            "video": "🎥 Video", "videonote": "📹 Video note", "sticker": "Sticker", "location": "📍 Location"}.get(m["kind"], "New message")
    if m["text"]:
        body = (icon + " " if icon else "") + m["text"] if m["kind"] in ("image", "video") else m["text"]
    return body


async def push_message(sender, m: dict, uids: list[int]):
    if not uids:
        return
    body = _push_body(m)
    with closing(db()) as c:  # each person sees the sender under the name THEY gave them
        nicks = {r[0]: r[1] for r in c.execute(f"SELECT user_id, nick FROM nicknames WHERE other_id=? AND user_id IN ({','.join('?' * len(uids))})", [sender["id"], *uids])}
    groups: dict[str, list[int]] = {}
    for uid in uids:
        groups.setdefault(nicks.get(uid) or sender["name"] or sender["username"], []).append(uid)
    for ttl, ids in groups.items():
        await push_to(ids, {"title": ttl, "body": body[:180], "conv": m["conv_id"],
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
    await push_to([u["id"]], {"title": "A.F.R.A ♥", "body": "Notifications work! 💌", "conv": 0, "icon": "/icon-512.png", "k": "sys"}, skip_visible=False)
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


def _pet_unpair(c, p) -> int:
    """Hide a pet and its Home from both people, keeping everything (coins, items, its chat, lists) so it can come back."""
    c.execute("UPDATE pets SET archived=? WHERE id=?", (time.time(), p["id"]))
    c.execute("DELETE FROM members WHERE conv_id=? AND user_id IN (?,?)", (p["conv_id"], p["user_a"], p["user_b"]))
    c.execute("UPDATE convs SET key=? WHERE id=?", (f"pet:{p['user_a']}:{p['user_b']}:off:{p['id']}", p["conv_id"]))  # frees the couple's Home key for a new pet
    return p["conv_id"]


def _pet_restore(c, p) -> int:
    """Bring an unpaired pet and its Home back for both people, as it was."""
    now = time.time()
    c.execute("UPDATE pets SET archived=0, stats_at=? WHERE id=?", (now, p["id"]))  # its mood isn't punished for the time it was away
    c.execute("UPDATE convs SET key=? WHERE id=?", (f"pet:{p['user_a']}:{p['user_b']}", p["conv_id"]))
    for uid in (p["user_a"], p["user_b"]):
        c.execute("INSERT OR IGNORE INTO members (conv_id, user_id, last_read) VALUES (?,?,?)", (p["conv_id"], uid, now))
    return p["conv_id"]


@app.post("/api/pets/{cid}/unpair")
async def pet_unpair_self(cid: int, authorization: str = Header(None)):
    """Either person of the couple can end the pet, alone (a fight, a breakup). It is kept archived: a new pet invite can bring it back, if both agree."""
    u = auth(authorization)
    with closing(db()) as c:
        _member(c, cid, u["id"])
        p = _pet_of(c, cid)
        if p["archived"]:
            raise HTTPException(404, "No pet here")
        other = p["user_b"] if u["id"] == p["user_a"] else p["user_a"]
        d = c.execute("SELECT id FROM convs WHERE key=?", ("direct:" + ",".join(map(str, sorted((p["user_a"], p["user_b"])))),)).fetchone()
        _pet_unpair(c, p)
        m = None
        if d:  # a small card in their chat, so neither is left wondering where the pet went
            m = _insert_msg(c, d["id"], u["id"], "petinvite", f"🐾 {_first(u)} unpaired {p['name']}",
                            {"from": u["id"], "to": other, "state": "ended", "name": p["name"], "emoji": SPECIES.get(p["species"], "🐾")})
        c.commit()
    for x in (p["user_a"], p["user_b"]):
        await send_to(x, {"t": "conv_gone", "conv": cid, "pet": True})
    if m:
        await _bcast_msg(d["id"], m, u)
    return {"ok": True}


@app.get("/api/admin/pets")
def admin_pets(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        names = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM users")}
        out = []
        for p in c.execute("SELECT * FROM pets ORDER BY archived>0, id DESC"):
            active = p["archived"] == 0
            out.append({"id": p["id"], "name": p["name"], "emoji": SPECIES.get(p["species"], "🐾"), "a": names.get(p["user_a"], "?"), "b": names.get(p["user_b"], "?"),
                        "born": p["born"], "archived": p["archived"], "coins": p["coins"], "stage": p["stage"], "streak": p["streak"],
                        "can_restore": not active and not _pet_for(c, p["user_a"], p["user_b"])})
    return out


@app.post("/api/admin/pets/{pid}/unpair")
async def admin_pet_unpair(pid: int, authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        p = c.execute("SELECT * FROM pets WHERE id=? AND archived=0", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "That pet isn't paired")
        cid = _pet_unpair(c, p)
        c.commit()
    for uid in (p["user_a"], p["user_b"]):
        await send_to(uid, {"t": "conv_gone", "conv": cid, "pet": True})
    return admin_pets(authorization)


@app.post("/api/admin/pets/{pid}/restore")
async def admin_pet_restore(pid: int, authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        p = c.execute("SELECT * FROM pets WHERE id=? AND archived>0", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "That pet isn't archived")
        if _pet_for(c, p["user_a"], p["user_b"]):
            raise ValueError("Those two share another pet now. Unpair that one first.")
        cid = _pet_restore(c, p)
        c.commit()
    for uid in (p["user_a"], p["user_b"]):
        with closing(db()) as c:
            await send_to(uid, {"t": "conv", "conv": conv_view(c, cid, uid)})
    return admin_pets(authorization)


@app.get("/api/closing")
def closing_get(authorization: str = Header(None)):
    u = auth(authorization)
    return {**closing_state(), "exempt": bool(u["is_admin"])}


@app.put("/api/admin/closing")
async def admin_closing(body: dict, authorization: str = Header(None)):
    admin(authorization)
    mode = body.get("mode") if body.get("mode") in ("notice", "readonly") else ""
    msg = " ".join(str(body.get("msg") or "").split())[:500] or CLOSING_DEFAULT
    set_setting("closing", json.dumps({"mode": mode, "msg": msg, "at": time.time() if mode else 0}))
    _CLOSING["v"] = None
    st = closing_state()
    with closing(db()) as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM users WHERE bot=0")]
    for uid in ids:
        await send_to(uid, {"t": "closing", **st})
    return st


@app.get("/api/admin/users")
def admin_users(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        rows = c.execute("SELECT * FROM users WHERE bot=0 ORDER BY created").fetchall()
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
        c.execute("DELETE FROM touch_prefs WHERE user_id=?", (uid,))
        c.execute("DELETE FROM user_prefs WHERE user_id=?", (uid,))
        c.execute("DELETE FROM chat_archive WHERE user_id=?", (uid,))
        PREFS.pop(uid, None)
        c.execute("DELETE FROM touch_seen WHERE user_id=?", (uid,))
        for tr in c.execute("SELECT id FROM touches WHERE sender=?", (uid,)).fetchall():
            c.execute("DELETE FROM touch_seen WHERE touch_id=?", (tr[0],))
        c.execute("DELETE FROM touches WHERE sender=?", (uid,))
        for cid in convs:  # a Home goes with its people: the pet, its days, its hidden account, the shared lists and reminders
            p = c.execute("SELECT * FROM pets WHERE conv_id=?", (cid,)).fetchone()
            if p:
                c.execute("DELETE FROM pet_days WHERE pet_id=?", (p["id"],))
                c.execute("DELETE FROM pets WHERE id=?", (p["id"],))
                c.execute("DELETE FROM users WHERE id=? AND bot=2", (p["bot_id"],))
            c.execute("DELETE FROM reminders WHERE home_id=?", (cid,))
            c.execute("DELETE FROM notes WHERE home_id=?", (cid,))
        for _t in ("reminders", "notes", "places", "stars"):
            c.execute(f"DELETE FROM {_t} WHERE user_id=?", (uid,))
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


@app.get("/api/invite/{code}")  # public: lets the welcome screen greet the invited person; reveals nothing about used/unknown codes
def invite_info(code: str, request: Request):
    throttle("inviteinfo:" + (request.client.host if request.client else ""))
    with closing(db()) as c:
        inv = c.execute("SELECT i.for_name, u.name AS frm FROM invites i LEFT JOIN users u ON u.id=i.created_by "
                        "WHERE i.code=? AND i.kind='invite' AND i.used_by IS NULL", (code.strip().upper()[:40],)).fetchone()
    if not inv:
        return {"valid": False}
    return {"valid": True, "for_name": inv["for_name"] or "", "from": inv["frm"] or ""}


@app.get("/api/invites")
def my_invites(authorization: str = Header(None)):
    me_ = auth(authorization)
    with closing(db()) as c:
        rows = c.execute("""SELECT i.code, i.for_name, i.created, i.used_by, u.name AS used_name FROM invites i LEFT JOIN users u ON u.id=i.used_by
                            WHERE i.kind='invite' AND i.created_by=? ORDER BY i.created DESC LIMIT 50""", (me_["id"],)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/invites")
def my_new_invite(body: dict, authorization: str = Header(None)):
    me_ = auth(authorization)
    for_name = str(body.get("for_name") or "").strip()
    if len(for_name) > 40:
        raise ValueError("Their name can be at most 40 characters.")
    with closing(db()) as c:
        if not me_["is_admin"] and c.execute("SELECT COUNT(*) FROM invites WHERE kind='invite' AND created_by=? AND used_by IS NULL", (me_["id"],)).fetchone()[0] >= 10:
            raise ValueError("You have 10 unused invites already. Remove one or wait for a friend to join.")
        code = make_code(c, "invite", 0, me_["id"], "", for_name)
        c.commit()
    return {"code": code}


@app.delete("/api/invites/{code}")
def my_del_invite(code: str, authorization: str = Header(None)):
    me_ = auth(authorization)
    with closing(db()) as c:
        c.execute("DELETE FROM invites WHERE code=? AND kind='invite' AND created_by=? AND used_by IS NULL", (code.upper(), me_["id"]))
        c.commit()
    return {"ok": True}


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
        code = make_code(c, "invite", int(bool(body.get("admin"))), me_["id"], body.get("note") or "", str(body.get("for_name") or ""))
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


BCAST_AT = [0.0]


@app.post("/api/admin/broadcast")
async def admin_broadcast(body: dict, authorization: str = Header(None)):
    """Push a short message to every person (not bots, not switched-off accounts), even if their app is open."""
    me_ = admin(authorization)
    title = re.sub(r"\s+", " ", str(body.get("title") or "A.F.R.A")).strip() or "A.F.R.A"
    text = re.sub(r"[ \t]+", " ", str(body.get("body") or "")).strip()
    if len(title) > 60:
        raise ValueError("The title can be up to 60 characters.")
    if not text:
        raise ValueError("Write a message first.")
    if len(text) > 180:
        raise ValueError("The message can be up to 180 characters.")
    wait = int(60 - (time.time() - BCAST_AT[0]))
    if wait > 0:
        raise HTTPException(429, f"Wait {wait} s before sending another.")
    BCAST_AT[0] = time.time()
    with closing(db()) as c:
        uids = [r["id"] for r in c.execute("SELECT id FROM users WHERE bot=0 AND disabled=0")]
        devices = c.execute(f"SELECT COUNT(*) FROM pushes WHERE user_id IN ({','.join('?' * len(uids))})", uids).fetchone()[0] if uids else 0
    refresh = bool(body.get("refresh"))
    await push_to(uids, {"title": title, "body": text, "conv": 0, "tag": "broadcast", "icon": "/icon-512.png", "k": "sys", **({"update": 1} if refresh else {})}, skip_visible=False)
    if refresh:
        for uid in uids:
            await send_to(uid, {"t": "update", "version": APP_VERSION})
    with closing(db()) as c:
        c.execute("INSERT INTO broadcasts (user_id, title, body, sent, devices, created) VALUES (?,?,?,?,?,?)", (me_["id"], title, text, len(uids), devices, time.time()))
        c.commit()
    return {"sent": len(uids), "devices": devices}


@app.get("/api/admin/broadcasts")
def admin_broadcasts(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        return [dict(r) for r in c.execute("SELECT id, title, body, sent, devices, created FROM broadcasts ORDER BY id DESC LIMIT 10")]


@app.get("/api/admin/ai-usage")
def admin_ai_usage(authorization: str = Header(None)):
    admin(authorization)
    now = time.time()
    t0 = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    agg = "COUNT(*) calls, COALESCE(SUM(prompt_tokens),0) prompt, COALESCE(SUM(completion_tokens),0) completion, COALESCE(SUM(cost),0) cost"
    out = {"pet_ai": pet_ai_on(), "model": ASSISTANT_MODEL}
    with closing(db()) as c:
        out["periods"] = {k: dict(c.execute(f"SELECT {agg} FROM ai_usage WHERE ts>=?", (since,)).fetchone())
                          for k, since in (("today", t0), ("week", t0 - 6 * 86400), ("month", t0 - 29 * 86400), ("all", 0))}
        since = t0 - 29 * 86400
        out["by_who"] = {r["who"]: {k: r[k] for k in ("calls", "prompt", "completion", "cost")}
                         for r in c.execute(f"SELECT who, {agg} FROM ai_usage WHERE ts>=? GROUP BY who", (since,))}
        out["by_user"] = [dict(r) for r in c.execute(
            f"SELECT COALESCE(u.name, u.username, '?') name, {agg} FROM ai_usage a LEFT JOIN users u ON u.id=a.user_id WHERE a.ts>=? GROUP BY a.user_id ORDER BY cost DESC, prompt DESC", (since,))]
        days = {r["d"]: dict(r) for r in c.execute(
            f"SELECT strftime('%Y-%m-%d', ts, 'unixepoch', 'localtime') d, {agg} FROM ai_usage WHERE ts>=? GROUP BY d", (t0 - 13 * 86400,))}
    series = []
    for i in range(13, -1, -1):
        d = datetime.fromtimestamp(t0 - i * 86400 + 3600).strftime("%Y-%m-%d")
        r = days.get(d) or {}
        series.append({"day": d, "calls": r.get("calls", 0), "tokens": (r.get("prompt", 0) or 0) + (r.get("completion", 0) or 0), "cost": r.get("cost", 0) or 0})
    out["series"] = series
    return out


@app.put("/api/admin/settings")
def admin_settings(body: dict, authorization: str = Header(None)):
    admin(authorization)
    if "pet_ai" in body:
        set_setting("pet_ai", "1" if body.get("pet_ai") else "0")
    return {"pet_ai": pet_ai_on()}


@app.get("/api/admin/stats")
def admin_stats(authorization: str = Header(None)):
    admin(authorization)
    with closing(db()) as c:
        n = lambda q: c.execute(q).fetchone()[0]
        stats = {"users": n("SELECT COUNT(*) FROM users WHERE bot=0"), "online": len(SOCKETS), "chats": n("SELECT COUNT(*) FROM convs WHERE kind='direct'"),
                 "messages": n("SELECT COUNT(*) FROM messages WHERE deleted=0"), "today": c.execute("SELECT COUNT(*) FROM messages WHERE created>?", (time.time() - 86400,)).fetchone()[0],
                 "files": n("SELECT COUNT(*) FROM files"), "files_mb": round((n("SELECT COALESCE(SUM(size),0) FROM files")) / 1048576, 1),
                 "push_devices": n("SELECT COUNT(*) FROM pushes"), "invites_open": n("SELECT COUNT(*) FROM invites WHERE kind='invite' AND used_by IS NULL")}
    stats["db_mb"] = round(DB.stat().st_size / 1048576, 2)
    stats["backups"] = [{"name": f.name, "mb": round(f.stat().st_size / 1048576, 2), "at": f.stat().st_mtime}
                        for f in sorted((DATA / "backups").glob("chat-*.db"), reverse=True)]
    return stats


def _scrub_db(path: Path):
    """v30: empty the private gift wishlist in a COPY of the database before anyone downloads it (the live database keeps it)."""
    with closing(sqlite3.connect(path)) as k:
        k.execute("DELETE FROM wishlist")
        k.commit()
        k.execute("VACUUM")


def _scrubbed_copy(src_path: Path) -> Path:
    fd, name = tempfile.mkstemp(suffix=".db", dir=DATA)
    os.close(fd)
    shutil.copyfile(src_path, name)
    try:
        _scrub_db(Path(name))
    except sqlite3.Error:  # an old backup from before v30 has no wishlist table: nothing to scrub
        pass
    return Path(name)


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
    _scrub_db(tmp)
    data = tmp.read_bytes()
    tmp.unlink()
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="afra-chat-{time.strftime("%Y%m%d-%H%M")}.db"'})


def database_as_json() -> str:
    """The complete database converted to JSON: every table, every column, every row. Login tokens and the phones'
    push keys are left out (they only let someone pretend to be a device); passwords are stored as Base64-encoded text, as in the .db."""
    hidden = {("sessions", "token"), ("pushes", "endpoint"), ("pushes", "sub")}
    private = {"wishlist"}  # v30: one person's gift ideas for the other; no export carries them
    out = {"exported": time.strftime("%Y-%m-%d %H:%M:%S"), "database": "A.F.R.A chat", "tables": {}}
    with closing(db()) as c:
        for (table,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})")]
            rows = []
            for r in ([] if table in private else c.execute(f"SELECT * FROM {table}")):
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
    if cv["kind"] == "bot":
        u = next((users[i] for i in ids if i in users and not users[i]["bot"]), None)
        return f"Assistant - @{u['username'] if u else '?'}"
    if cv["kind"] == "pet":
        pet = c.execute("SELECT name FROM pets WHERE conv_id=?", (cv["id"],)).fetchone()
        return f"Home - {pet['name'] if pet else '?'} - " + " & ".join("@" + users[i]["username"] for i in ids if i in users and not users[i]["bot"])
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
               f'<video controls playsinline src="{hesc(fpath)}"></video>' if att and m["kind"] in ("video", "videonote") and fpath else
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
            z.writestr("assistant.json", json.dumps(_assistant_export(c, uid), ensure_ascii=False, indent=1))
            z.writestr("README.txt", f"A.F.R.A chat: everything about @{u['username']} ({u['name']}).\n"
                       "profile.json - the account (no password). assistant.json - their reminders, notes, lists and saved places.\n"
                       "Each folder is one chat (\"Notes to self\" = their private notes, \"Assistant\" = their chat with the assistant):\n"
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


def _assistant_export(c, uid: int) -> dict:
    tz = _tz(c, uid)
    t = lambda x: _local(x, tz) if x else ""
    return {"reminders": [{**dict(r), "due": t(r["due"]), "created": t(r["created"]), "fired": t(r["fired"]), "done": bool(r["done"])}
                          for r in c.execute("SELECT * FROM reminders WHERE user_id=? ORDER BY id", (uid,))],
            "notes": [{**dict(r), "created": t(r["created"]), "done": bool(r["done"])} for r in c.execute("SELECT * FROM notes WHERE user_id=? ORDER BY list, id", (uid,))],
            "places": [dict(r) for r in c.execute("SELECT * FROM places WHERE user_id=? ORDER BY name", (uid,))], "time_zone": str(tz)}


@app.get("/api/admin/export/assistant")
def export_assistant(t: str = "", authorization: str = Header(None)):
    """Everyone's Assistant: the chat with it plus their reminders, notes, lists and places, one folder per person."""
    admin_q(t, authorization)
    with closing(db()) as c:
        users = _names(c)

        def build(z):
            done = set()
            for cv in c.execute("SELECT * FROM convs WHERE kind='bot' ORDER BY id").fetchall():
                folder = f"{_safe(_chat_label(c, cv, users))}/"
                _chat_bundle(c, cv, users, z, folder, done)
                uid = int(cv["key"].split(":")[1])
                z.writestr(folder + "assistant.json", json.dumps(_assistant_export(c, uid), ensure_ascii=False, indent=1))
            z.writestr("README.txt", "A.F.R.A chat: everyone's Assistant. One folder per person:\n"
                       "  transcript.html / transcript.txt / chat.json - their chat with the assistant\n"
                       "  assistant.json - their reminders, notes and lists, and saved places\n")
        return _zip_response(build, f"assistant - everyone - {time.strftime('%Y%m%d')}.zip")


@app.get("/api/admin/export/pets")
def export_pets(t: str = "", authorization: str = Header(None)):
    """Everyone's pets: each Home chat as a transcript, plus the pet's stats, days of care, and the shared lists and reminders."""
    admin_q(t, authorization)
    with closing(db()) as c:
        users = _names(c)

        def build(z):
            done = set()
            for cv in c.execute("SELECT * FROM convs WHERE kind='pet' ORDER BY id").fetchall():
                folder = f"{_safe(_chat_label(c, cv, users))}/"
                _chat_bundle(c, cv, users, z, folder, done)
                p = c.execute("SELECT * FROM pets WHERE conv_id=?", (cv["id"],)).fetchone()
                if not p:
                    continue
                tz = _pet_tz(c, p)
                z.writestr(folder + "pet.json", json.dumps({
                    "pet": {**dict(p), "born": _local(p["born"], tz)},
                    "now": pet_view(c, p),
                    "days": {r["day"]: json.loads(r["data"] or "{}") for r in c.execute("SELECT * FROM pet_days WHERE pet_id=? ORDER BY day", (p["id"],))},
                    "shared_reminders": [{**dict(r), "due": _local(r["due"], tz) if r["due"] else "", "done": bool(r["done"])}
                                         for r in c.execute("SELECT * FROM reminders WHERE home_id=? ORDER BY id", (cv["id"],))],
                    "shared_notes": [{**dict(r), "done": bool(r["done"])} for r in c.execute("SELECT * FROM notes WHERE home_id=? ORDER BY list, id", (cv["id"],))]},
                    ensure_ascii=False, indent=1))
            z.writestr("README.txt", "A.F.R.A chat: everyone's pets. One folder per Home:\n"
                       "  transcript.html / transcript.txt / chat.json - the Home chat\n"
                       "  pet.json - the pet's stats and streak, each day's care and quests, and the shared lists and reminders\n")
        return _zip_response(build, f"pets - everyone - {time.strftime('%Y%m%d')}.zip")


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
    _scrub_db(tmp)
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
    if f.suffix == ".db":  # v30: the private gift wishlist is not part of any download, not even an admin's
        tmp = _scrubbed_copy(f)
        try:
            return Response(tmp.read_bytes(), media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{name}"'})
        finally:
            tmp.unlink(missing_ok=True)
    return FileResponse(f, media_type="application/octet-stream", filename=name)


# ---------------------------------------------------------------- Touches (v23): hugs, kisses and buzzes between two people
TOUCH_ACTIONS = {"hug": "🫂", "kiss": "💋", "hold": "🤝", "poke": "👉", "tickle": "🤭", "stroke": "🤲", "heartbeat": "💓",
                 "luck": "🍀", "tomato": "🍅", "pillow": "🪶", "punch": "👊"}
TOUCH_WORDS = {"Thinking of you": "💭", "Love you": "💞", "Miss you": "🥹", "Call me": "📞", "Good morning": "☀️",
               "Goodnight": "🌙", "On my way": "🚗", "Hungry?": "🍜"}
TOUCH_LINES = {  # first, second, "won't stop", and the last one of a storm ({c} = how many in all)
    "hug": ["hugged you 🫂", "hugged you again", "won't let go of you 🫂", "×{c} hugs!!"],
    "kiss": ["kissed you 💋", "kissed you again", "won't stop kissing you 💋", "×{c} kisses!!"],
    "hold": ["is holding your hand 🤝", "is still holding your hand", "won't let go of your hand 🤝", "×{c} hand squeezes!!"],
    "poke": ["poked you 👉", "poked you again", "keeps poking you 👉", "×{c} pokes!!"],
    "tickle": ["tickled you 🤭", "is tickling you again", "won't stop tickling you 🤭", "×{c} tickles!!"],
    "stroke": ["is stroking your hair 🤲", "is still stroking your hair", "won't stop stroking your hair 🤲", "×{c} gentle strokes"],
    "heartbeat": ["sent you a heartbeat 💓", "is still thinking of you 💓", "has a racing heart for you 💓", "×{c} heartbeats!!"],
    "luck": ["wished you luck 🍀", "is wishing you even more luck", "is sending you all the luck 🍀", "×{c} lucky charms!!"],
    "tomato": ["threw a tomato at you 🍅", "threw another tomato", "is pelting you with tomatoes 🍅", "×{c} tomatoes!!"],
    "pillow": ["hit you with a pillow 🪶", "hit you with the pillow again", "started a pillow fight 🪶", "×{c} pillow whacks!!"],
    "punch": ["playfully punched you 👊", "punched you again (gently)", "is on a punching spree 👊", "×{c} playful punches!!"]}
TOUCH_STORMS_PER_MIN = 3
TOUCH_PUSHES_PER_HOUR = 200
TOUCH_COIN_CAP = 20
STORM_RUNNING: set = set()


def storm_settings() -> tuple:
    def num(key, default, lo, hi):
        try:
            return max(lo, min(hi, int(float(get_setting(key, str(default))))))
        except ValueError:
            return default
    return num("storm_max", 20, 1, 60), num("storm_gap_ms", 400, 50, 5000)


def touch_line(action: str, word: str, i: int, n: int, count: int) -> str:
    if not action:
        return f"{TOUCH_WORDS.get(word, '💌')} {word}"
    lines = TOUCH_LINES[action]
    k = 0 if i == 0 else 3 if (i == n - 1 and n > 2) else 1 if i == 1 else 2
    return lines[k].format(c=count)


def touch_view(r) -> dict:
    try:
        pat = json.loads(r["pattern"] or "[]")
    except ValueError:
        pat = []
    return {"id": r["id"], "conv": r["conv_id"], "sender": r["sender"], "action": r["action"], "word": r["word"], "count": r["count"],
            "strength": r["strength"], "pattern": pat, "ts": r["ts"]}


def touch_prefs(c, uid: int) -> dict:
    r = c.execute("SELECT * FROM touch_prefs WHERE user_id=?", (uid,)).fetchone()
    if not r:
        return {"mode": "full", "quiet_on": False, "quiet_start": "22:00", "quiet_end": "07:00", "watch": False}
    return {"mode": r["mode"], "quiet_on": bool(r["quiet_on"]), "quiet_start": r["quiet_start"], "quiet_end": r["quiet_end"], "watch": bool(r["watch"])}


def _hhmm(s, default: str) -> str:
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", str(s or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else default


def in_quiet(pr: dict, tz, at: float = 0) -> bool:
    if not pr["quiet_on"]:
        return False
    mins = lambda s: int(s[:2]) * 60 + int(s[3:])
    a, b, now_ = mins(pr["quiet_start"]), mins(pr["quiet_end"]), datetime.fromtimestamp(at, tz) if at else datetime.now(tz)
    t = now_.hour * 60 + now_.minute
    if a == b:
        return False
    return a <= t < b if a < b else (t >= a or t < b)


def endpoint_type(ep: str) -> str:
    h = urlparse(ep).hostname or ""
    return ("Apple" if "apple" in h else "WNS" if "windows" in h else "FCM" if "google" in h else
            "Mozilla" if "mozilla" in h else h or "unknown")


async def push_sub(h, r, payload: dict):
    """One push to one saved subscription. Returns (HTTP status or 0, milliseconds, error text). Dead subscriptions are forgotten."""
    t0 = time.time()
    try:
        sub = json.loads(r["sub"])
        body = encrypt_push(sub, json.dumps(payload).encode()[:3800])
        resp = await h.post(sub["endpoint"], content=body, headers={
            "Authorization": _vapid_header(sub["endpoint"]), "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream", "TTL": "3600", "Urgency": "high"})
        if resp.status_code in (404, 410):
            with closing(db()) as c:
                c.execute("DELETE FROM pushes WHERE endpoint=?", (r["endpoint"],))
                c.commit()
        return resp.status_code, round((time.time() - t0) * 1000), ""
    except Exception as e:
        return 0, round((time.time() - t0) * 1000), repr(e)[:120]


def _buzz(strength: int) -> list:
    s = max(1, min(5, int(strength)))
    return [40 + s * 25, 50, 40 + s * 25] + ([50, 40 + s * 20] if s >= 4 else [])


async def run_storm(tid: int, sender, rid: int, cid: int, n: int, gap_ms: int, action: str, word: str, count: int, strength: int):
    """Send n notifications one after the other to every phone of the receiver (a phone with the app open shows it itself)."""
    try:
        with closing(db()) as c:
            nick = c.execute("SELECT nick FROM nicknames WHERE user_id=? AND other_id=?", (rid, sender["id"])).fetchone()
            rows = c.execute("SELECT * FROM pushes WHERE user_id=?", (rid,)).fetchall()
        title = (nick[0] if nick else None) or sender["name"] or sender["username"]
        icon = f"/api/avatar/{sender['id']}" if sender["avatar"] else "/icon-512.png"
        sent = 0
        async with httpx.AsyncClient(timeout=15) as h:
            for i in range(n):
                t_step = time.time()
                if us_present(cid, rid):
                    break  # they came into the Us screen meanwhile: they feel it live now
                payload = shape_push(rid, {"title": title, "body": touch_line(action, word, i, n, count)[:180], "conv": cid, "touch": tid, "tag": f"touch-{tid}-{i}",
                                           "icon": icon, "vibrate": _buzz(strength), "renotify": True, "k": "touch"})
                devs = SOCKETS.get(rid, {})
                targets = [r for r in rows if not any(s_["visible"] for d, s_ in devs.items() if d == r["device"] or d.startswith(r["device"] + "."))]
                # every phone gets this step at the same moment (a slow service must not delay the others)
                for res in await asyncio.gather(*[push_sub(h, r, payload) for r in targets]):
                    sent += 1 if 200 <= res[0] < 300 else 0
                if i < n - 1:
                    await asyncio.sleep(max(0, gap_ms / 1000 - (time.time() - t_step)))
        with closing(db()) as c:
            c.execute("UPDATE touches SET delivered=? WHERE id=?", (sent, tid))
            c.commit()
    except Exception as e:
        print("storm failed:", repr(e)[:300], flush=True)


@app.get("/api/touch/prefs")
def touch_prefs_get(authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        return touch_prefs(c, u["id"])


@app.put("/api/touch/prefs")
def touch_prefs_put(body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        p = touch_prefs(c, u["id"])
        if "mode" in body:
            if body["mode"] not in ("full", "gentle", "off"):
                raise ValueError("Storm mode must be full, gentle or off")
            p["mode"] = body["mode"]
        if "quiet_on" in body:
            p["quiet_on"] = bool(body["quiet_on"])
        if "quiet_start" in body:
            p["quiet_start"] = _hhmm(body["quiet_start"], p["quiet_start"])
        if "quiet_end" in body:
            p["quiet_end"] = _hhmm(body["quiet_end"], p["quiet_end"])
        if "watch" in body:
            p["watch"] = bool(body["watch"])
        c.execute("INSERT OR REPLACE INTO touch_prefs (user_id, mode, quiet_on, quiet_start, quiet_end, watch) VALUES (?,?,?,?,?,?)",
                  (u["id"], p["mode"], int(p["quiet_on"]), p["quiet_start"], p["quiet_end"], int(p["watch"])))
        c.commit()
    return p


@app.get("/api/touch/unseen")
def touch_unseen(authorization: str = Header(None)):
    """Touches that arrived while the app was closed (or in quiet hours): they replay once on the next open."""
    u = auth(authorization)
    with closing(db()) as c:
        rows = c.execute("""SELECT t.* FROM touches t JOIN members m ON m.conv_id=t.conv_id AND m.user_id=? WHERE t.sender<>? AND t.ts>?
                            AND NOT EXISTS (SELECT 1 FROM touch_seen s WHERE s.touch_id=t.id AND s.user_id=?) ORDER BY t.id DESC LIMIT 5""",
                         (u["id"], u["id"], time.time() - 86400, u["id"])).fetchall()
    return [touch_view(r) for r in rows][::-1]


@app.get("/api/touch/{tid}")
def touch_get(tid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        r = c.execute("SELECT * FROM touches WHERE id=?", (tid,)).fetchone()
        if not r:
            raise HTTPException(404, "Touch not found")
        _member(c, r["conv_id"], u["id"])
    return touch_view(r)


@app.post("/api/touch/{tid}/seen")
def touch_seen(tid: int, authorization: str = Header(None)):
    u = auth(authorization)
    with closing(db()) as c:
        r = c.execute("SELECT conv_id FROM touches WHERE id=?", (tid,)).fetchone()
        if not r:
            raise HTTPException(404, "Touch not found")
        _member(c, r["conv_id"], u["id"])
        c.execute("INSERT OR IGNORE INTO touch_seen (touch_id, user_id, ts) VALUES (?,?,?)", (tid, u["id"], time.time()))
        c.commit()
    return {"ok": True}


def _clean_pattern(p) -> list:
    out = []
    for e in (p if isinstance(p, list) else [])[:150]:
        try:
            t, d, s = float(e[0]), float(e[1]), float(e[2])
        except (TypeError, ValueError, IndexError):
            continue
        if 0 <= t <= 10000:
            out.append([int(t), int(max(0, min(10000, d))), round(max(1, min(5, s)), 1)])
    return out


@app.post("/api/touch/{cid}")
async def touch_send(cid: int, body: dict, authorization: str = Header(None)):
    u = auth(authorization)
    if needs_new_pw(u):
        raise HTTPException(403, "Please choose a stronger password first.")
    action = str(body.get("action") or "")
    word = re.sub(r"\s+", " ", str(body.get("word") or "")).strip()[:40]
    if bool(action) == bool(word) or (action and action not in TOUCH_ACTIONS):
        raise ValueError("Send one touch or one word")
    count = 1 if word else int(max(1, min(999, float(body.get("count") or 1))))
    strength = int(round(max(1, min(5, float(body.get("strength") or 1)))))
    pattern = _clean_pattern(body.get("pattern"))
    now = time.time()
    with closing(db()) as c:
        _member(c, cid, u["id"])
        cv = c.execute("SELECT kind FROM convs WHERE id=?", (cid,)).fetchone()
        peer = c.execute("SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.conv_id=? AND u.id<>?", (cid, u["id"])).fetchone()
        if not cv or cv["kind"] != "direct" or not peer or peer["bot"]:
            raise ValueError("Touches go between two people")
        smax, gap = storm_settings()
        # how many notifications: about one per tap (a bit more for a firm touch), within the limits
        n = 1 if (count <= 1 or word) else max(1, min(smax, math.ceil(count * (0.6 + 0.2 * strength))))
        if quiet_now(peer["id"]):
            n = 1  # their quiet hours (Settings > Notifications): a storm becomes one gentle notification
        pr = touch_prefs(c, peer["id"])
        reason = ""
        live = us_present(cid, peer["id"])  # they are in the Us screen right now: they felt it live, so no storm
        recent = c.execute("SELECT COUNT(*) FROM touches WHERE sender=? AND ts>? AND pushes>1", (u["id"], now - 60)).fetchone()[0]
        used = c.execute("SELECT COALESCE(SUM(pushes),0) FROM touches WHERE sender=? AND ts>?", (u["id"], now - 3600)).fetchone()[0]
        if live:
            n, reason = 0, "live"
        elif pr["mode"] == "off":
            n, reason = 0, "off"
        elif in_quiet(pr, _tz(c, peer["id"])):
            n, reason = 0, "quiet"
        else:
            if pr["mode"] == "gentle" or pr["watch"]:
                n = min(n, 1)
            if n > 1 and recent >= TOUCH_STORMS_PER_MIN:
                n, reason = 1, "limit"
            if used + n > TOUCH_PUSHES_PER_HOUR:
                n, reason = max(0, TOUCH_PUSHES_PER_HOUR - used), "limit"
        rhythm = 0
        if len(pattern) > 1 and count > 1:
            rhythm = int((pattern[-1][0] - pattern[0][0]) / (len(pattern) - 1))
        spacing = max(gap, min(1500, rhythm))
        tid = c.execute("INSERT INTO touches (conv_id, sender, action, word, count, strength, pattern, ts, pushes) VALUES (?,?,?,?,?,?,?,?,?)",
                        (cid, u["id"], action, word, count, strength, json.dumps(pattern), now, n)).lastrowid
        summary = f"{TOUCH_ACTIONS[action]} ×{count}" if action else f"{TOUCH_WORDS.get(word, '💌')} {word}"
        m = _insert_msg(c, cid, u["id"], "touch", summary, {"touch": tid, "action": action, "word": word, "count": count, "strength": strength, **({"live": True} if live else {})})
        c.execute("UPDATE touches SET msg_id=? WHERE id=?", (m["id"], tid))
        coin = False
        pet = _pet_for(c, u["id"], peer["id"])
        if pet:  # +1 pet coin per touch sent, up to 20 a day
            day = _day(_tz(c, u["id"]))
            d = _day_get(c, pet["id"], day)
            if d.get("touch_coins", 0) < TOUCH_COIN_CAP:
                d["touch_coins"] = d.get("touch_coins", 0) + 1
                _day_put(c, pet["id"], day, d)
                _coins(c, pet["id"], 1)
                coin = True
        view = touch_view(c.execute("SELECT * FROM touches WHERE id=?", (tid,)).fetchone())
        c.commit()
    for uid in (u["id"], peer["id"]):
        await send_to(uid, {"t": "msg", "msg": m})
        await send_to(uid, {"t": "touch", "touch": view, "mine": uid == u["id"], "limited": reason == "limit", "live": live})
    if n:
        asyncio.create_task(run_storm(tid, u, peer["id"], cid, n, spacing, action, word, count, strength))
    if coin and pet:
        asyncio.create_task(home_event(pet["conv_id"], by=u["id"]))
    return {"touch": view, "msg": m, "pushes": n, "limited": reason == "limit", "reason": reason, "coin": coin}


# ---- Phase 0: the admin's "touch storm test" (how many pushes really arrive, and how fast phones take them)
@app.get("/api/admin/storm")
def storm_get(authorization: str = Header(None)):
    admin(authorization)
    smax, gap = storm_settings()
    return {"storm_max": smax, "storm_gap_ms": gap}


@app.put("/api/admin/storm")
def storm_put(body: dict, authorization: str = Header(None)):
    admin(authorization)
    if "storm_max" in body:
        set_setting("storm_max", str(max(1, min(60, int(float(body["storm_max"]))))))
    if "storm_gap_ms" in body:
        set_setting("storm_gap_ms", str(max(50, min(5000, int(float(body["storm_gap_ms"]))))))
    smax, gap = storm_settings()
    return {"storm_max": smax, "storm_gap_ms": gap}


async def _storm_test(run: str, uid: int, n: int, gap_ms: int):
    STORM_RUNNING.add(uid)
    try:
        with closing(db()) as c:
            rows = c.execute("SELECT * FROM pushes WHERE user_id=?", (uid,)).fetchall()
        async with httpx.AsyncClient(timeout=15) as h:
            for i in range(1, n + 1):
                for r in rows:
                    sent_at = time.time()
                    status, ms, err = await push_sub(h, r, {"title": "Touch storm test", "body": f"Test buzz {i}/{n}", "conv": 0, "tag": f"storm-{run}-{i}",
                                                           "icon": "/icon-512.png", "vibrate": [120, 60, 120], "renotify": True})
                    with closing(db()) as c:
                        c.execute("INSERT INTO storm_log (run, idx, device, endpoint_type, sent_at, status, ms, err) VALUES (?,?,?,?,?,?,?,?)",
                                  (run, i, r["device"], endpoint_type(json.loads(r["sub"])["endpoint"]), sent_at, status, ms, err))
                        c.commit()
                if i < n:
                    await asyncio.sleep(gap_ms / 1000)
    except Exception as e:
        print("storm test failed:", repr(e)[:300], flush=True)
    finally:
        STORM_RUNNING.discard(uid)


@app.post("/api/admin/storm/test")
async def storm_test(body: dict, authorization: str = Header(None)):
    u = admin(authorization)
    n = int(max(1, min(60, float(body.get("count") or 10))))
    gap = int(max(50, min(5000, float(body.get("gap_ms") or 300))))
    if u["id"] in STORM_RUNNING:
        raise HTTPException(409, "A test is still running. Wait for it to finish.")
    with closing(db()) as c:
        devices = c.execute("SELECT COUNT(*) FROM pushes WHERE user_id=?", (u["id"],)).fetchone()[0]
    if not devices:
        raise ValueError("This account has no phone with notifications on. Turn them on in Settings first.")
    run = secrets.token_hex(4)
    asyncio.create_task(_storm_test(run, u["id"], n, gap))
    return {"run": run, "count": n, "gap_ms": gap, "devices": devices, "expected": n * devices}


@app.get("/api/admin/storm/test/{run}")
def storm_result(run: str, authorization: str = Header(None)):
    u = admin(authorization)
    with closing(db()) as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM storm_log WHERE run=? ORDER BY id", (run,))]
    per: dict = {}
    for r in rows:
        d = per.setdefault(r["endpoint_type"], {"type": r["endpoint_type"], "sent": 0, "accepted": 0, "failed": 0, "statuses": {}, "avg_ms": 0, "max_ms": 0, "_ms": 0})
        d["sent"] += 1
        d["accepted" if 200 <= r["status"] < 300 else "failed"] += 1
        d["statuses"][str(r["status"])] = d["statuses"].get(str(r["status"]), 0) + 1
        d["_ms"] += r["ms"]
        d["max_ms"] = max(d["max_ms"], r["ms"])
    for d in per.values():
        d["avg_ms"] = round(d.pop("_ms") / max(1, d["sent"]))
    first, last = (rows[0]["sent_at"], rows[-1]["sent_at"]) if rows else (0, 0)
    return {"run": run, "running": u["id"] in STORM_RUNNING, "sent": len(rows), "accepted": sum(d["accepted"] for d in per.values()),
            "failed": sum(d["failed"] for d in per.values()), "seconds": round(last - first, 1), "devices": list(per.values()),
            "errors": sorted({r["err"] for r in rows if r["err"]})[:3]}


# ---------------------------------------------------------------- the app itself + housekeeping
@app.get("/api/health")
def health():
    return {"app": "A.F.R.A chat", "ok": True}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/{sub}/{name}")
def web_sub_file(sub: str, name: str):
    """Vendored script and the pet animations: they never change under the same name, so the phone may keep them."""
    if sub not in ("vendor", "pets"):
        raise HTTPException(404)
    f = (WEB / sub / name).resolve()
    if f.parent != (WEB / sub).resolve() or not f.is_file():
        raise HTTPException(404)
    types = {".js": "text/javascript", ".json": "application/json"}
    return FileResponse(f, media_type=types.get(f.suffix), headers={"Cache-Control": "public, max-age=86400"})


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
    asyncio.create_task(_reminders())
    with closing(db()) as c:
        if not c.execute("SELECT 1 FROM users WHERE bot=0").fetchone():
            open_ = c.execute("SELECT code FROM invites WHERE admin=1 AND used_by IS NULL AND kind='invite'").fetchone()
            code = open_["code"] if open_ else make_code(c, "invite", 1, None, "first admin")
            c.commit()
            print(f"\n  No accounts yet. Create the admin account with invite code: {code}\n", flush=True)


if __name__ == "__main__":  # python server.py invite [--admin] [note]
    if len(sys.argv) > 1 and sys.argv[1] == "invite":
        with closing(db()) as c:
            print(make_code(c, "invite", int("--admin" in sys.argv), None, " ".join(a for a in sys.argv[2:] if a != "--admin")))
            c.commit()
