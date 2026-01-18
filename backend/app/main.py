"""
United Hacks V6
Solo dev: jayvenma (Jayven Mason)
Date: 1/16/2026
"""

# ------------------
# Imports
# ------------------
import os
import json
import sqlite3
import traceback
import warnings
from uuid import uuid4
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build

from .core.schemas import NormalizedEvent, EventType
from .core.scoring import score_event

# OpenAI SDK (used to call Hugging Face OpenAI-compatible router)
try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore


# ------------------
# ENV / CONFIG
# ------------------
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DB_PATH = BASE_DIR / "social_energy.db"

load_dotenv(BASE_DIR / ".env")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
    raise RuntimeError("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET")

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
]

# ---- Hugging Face (LLM scoring) config ----
USE_LLM_SCORING = os.getenv("USE_LLM_SCORING", "1").strip().lower() not in ("0", "false", "no", "off")
HF_TOKEN = os.getenv("HF_TOKEN")
HF_BASE_URL = os.getenv("HF_BASE_URL", "https://router.huggingface.co/v1")
HF_MODEL = os.getenv("HF_MODEL", "google/gemma-2-2b-it")
LLM_TIMEOUT_SECONDS = int(os.getenv("LLM_TIMEOUT_SECONDS", "20"))

_hf_client = None
if USE_LLM_SCORING and HF_TOKEN and OpenAI is not None:
    _hf_client = OpenAI(base_url=HF_BASE_URL, api_key=HF_TOKEN)


# ------------------
# DB
# ------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _try_add_column(conn: sqlite3.Connection, table: str, coldef: str):
    """
    SQLite doesn't support IF NOT EXISTS on ADD COLUMN in older versions, so we try/catch.
    coldef example: "impact_score REAL"
    """
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {coldef}")
    except sqlite3.OperationalError:
        pass


def init_db():
    conn = get_db()

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_profile (
            user_id TEXT PRIMARY KEY,
            personality_score INTEGER,
            label TEXT,
            raw_score INTEGER
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            source TEXT NOT NULL,                -- 'google' or 'local'
            title TEXT NOT NULL,
            start TEXT NOT NULL,                 -- ISO datetime (prefer offset-aware)
            end TEXT NOT NULL,                   -- ISO datetime (prefer offset-aware)
            event_type TEXT NOT NULL,
            attendee_count INTEGER DEFAULT 0,
            has_video INTEGER DEFAULT 0,
            has_conference_link INTEGER DEFAULT 0,
            modifiers_json TEXT DEFAULT NULL,    -- optional JSON string
            updated_at TEXT NOT NULL             -- ISO datetime
        )
        """
    )

    # ✅ NEW: per-user overrides for google events (local-only)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS google_overrides (
            user_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            event_type TEXT,
            attendee_count INTEGER,
            has_video INTEGER,
            has_conference_link INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, event_id)
        )
        """
    )

    # Persisted scoring fields (cache LLM output)
    _try_add_column(conn, "events", "impact_score REAL")
    _try_add_column(conn, "events", "impact_label TEXT")
    _try_add_column(conn, "events", "reasons_json TEXT")
    _try_add_column(conn, "events", "scored_at TEXT")
    _try_add_column(conn, "events", "scoring_source TEXT")  # 'llm' or 'local'
    _try_add_column(conn, "events", "scoring_model TEXT")

    conn.commit()
    conn.close()


# ------------------
# APP + MIDDLEWARE
# ------------------
app = FastAPI(title="Social Battery Forecaster")
init_db()

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------
# DEBUG EXCEPTION HANDLER
# ------------------
@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    print("\n--- EXCEPTION ---\n", tb)
    return PlainTextResponse(tb, status_code=500)


# ------------------
# HEALTH
# ------------------
@app.get("/health")
def health():
    return {
        "status": "ok",
        "llm_enabled": bool(USE_LLM_SCORING),
        "hf_configured": bool(_hf_client),
        "hf_base_url": HF_BASE_URL if _hf_client else None,
        "hf_model": HF_MODEL if _hf_client else None,
    }


@app.get("/debug/cors")
def debug_cors():
    return {"cors": "ok"}


# ------------------
# HELPERS
# ------------------
def _require_user_id(request: Request) -> str:
    user = request.session.get("user")
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user["sub"]


def _parse_dt(dt_str: str) -> datetime:
    if dt_str.endswith("Z"):
        dt_str = dt_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _to_utc_iso(dt_str: str) -> str:
    dt = _parse_dt(dt_str).astimezone(timezone.utc)
    return dt.isoformat()


def _row_has(row: sqlite3.Row, key: str) -> bool:
    try:
        return key in row.keys()
    except Exception:
        return False


def _row_get(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    return row[key] if _row_has(row, key) else default


def _row_to_eventdict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "start": row["start"],
        "end": row["end"],
        "location": None,
        "event_type": row["event_type"],
        "attendee_count": int(row["attendee_count"] or 0),
        "has_video": bool(row["has_video"]),
        "has_conference_link": bool(row["has_conference_link"]),
        "source": row["source"],
    }


def _flow(state: Optional[str] = None) -> Flow:
    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }

    flow = Flow.from_client_config(
        client_config=client_config,
        scopes=SCOPES,
        state=state,
    )
    flow.redirect_uri = f"{BASE_URL}/auth/callback"
    return flow


def _get_google_creds_from_session(request: Request) -> Optional[Credentials]:
    data = request.session.get("credentials")
    if not data:
        return None

    creds = Credentials(
        token=data["token"],
        refresh_token=data.get("refresh_token"),
        token_uri=data["token_uri"],
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=data["scopes"],
    )

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        request.session["credentials"]["token"] = creds.token

    return creds


def _event_datetime(evt: dict, key: str):
    data = evt.get(key, {}) or {}
    return data.get("dateTime"), data.get("date")


def _infer_event_type(attendee_count: int, summary: str, has_conference: bool) -> EventType:
    s = (summary or "").lower()

    if has_conference or any(x in s for x in ["zoom", "meet", "video", "call", "teams"]):
        return EventType.call

    if attendee_count <= 0:
        return EventType.solo
    if attendee_count == 1:
        return EventType.one_on_one
    return EventType.meeting


def compute_personality_profile(answers: list[int]) -> dict:
    if len(answers) != 15:
        raise ValueError("Expected 15 answers")

    for a in answers:
        if not isinstance(a, int) or a < 1 or a > 5:
            raise ValueError("Answers must be integers between 1 and 5")

    positive = {1, 3, 5, 7, 8, 10, 12, 14, 15}

    raw = 0
    for i, ans in enumerate(answers, start=1):
        if i in positive:
            raw += ans
        else:
            raw += (6 - ans)

    personality_score = round(((raw - 15) / 60) * 100)

    if personality_score < 34:
        label = "Introvert"
    elif personality_score < 67:
        label = "Omnivert"
    else:
        label = "Extrovert"

    return {
        "personality_score": personality_score,
        "label": label,
        "raw_score": raw,
        "modifiers": {},
    }


# ------------------
# SCORING (HF LLM + FALLBACK)
# ------------------
_ALLOWED_LABELS = {"Low", "Medium", "High", "Extreme"}


def _normalize_label(lbl: Any) -> str:
    s = str(lbl or "").strip()
    return s if s in _ALLOWED_LABELS else "Low"


def _fallback_local_score(ne: NormalizedEvent, personality_score: int) -> dict:
    s = score_event(ne, personality_score=personality_score).model_dump()
    return {
        "impact_score": float(s.get("impact_score", 0.0) or 0.0),
        "impact_label": _normalize_label(s.get("impact_label", "Low")),
        "reasons": s.get("reasons", []) or [],
        "scoring_source": "local",
        "scoring_model": None,
    }


def _extract_json_object(text: str) -> dict:
    if text is None:
        raise ValueError("No text to parse")

    s = text.strip()

    if s.startswith("```"):
        s = s.strip("`")
        s = s.replace("json\n", "", 1).strip()

    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Could not find JSON object in: {s[:200]!r}")

    candidate = s[start : end + 1].strip()
    return json.loads(candidate)


def _llm_score_event(ne: NormalizedEvent, profile: dict) -> dict:
    personality_score = int(profile.get("personality_score", 30) or 30)

    if not _hf_client:
        return _fallback_local_score(ne, personality_score)

    payload = {
        "event": {
            "title": ne.title,
            "start": ne.start.isoformat(),
            "end": ne.end.isoformat(),
            "event_type": ne.event_type.value,
            "attendee_count": int(ne.attendee_count or 0),
            "has_video": bool(ne.has_video),
            "has_conference_link": bool(ne.has_conference_link),
        },
        "personality": {
            "score": personality_score,
            "label": profile.get("label", "Introvert"),
            "modifiers": profile.get("modifiers", {}) or {},
        },
        "output_contract": {
            "impact_score": "Signed float: negative = drain, positive = boost.",
            "impact_label": "One of: Low, Medium, High, Extreme (intensity of |impact_score|).",
            "reasons": "2-5 short strings.",
        },
    }

    system = (
        "Return ONLY a JSON object (no markdown, no commentary, no code fences). "
        "Schema:\n"
        '{"impact_score": number, "impact_label": "Low"|"Medium"|"High"|"Extreme", "reasons": string[]}\n'
        "If unsure, still output valid JSON."
    )

    try:
        client = _hf_client
        if hasattr(client, "with_options"):
            client = client.with_options(timeout=LLM_TIMEOUT_SECONDS)

        resp = client.chat.completions.create(
            model=HF_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload)},
            ],
            temperature=0.2,
        )

        content = resp.choices[0].message.content if resp and resp.choices else None
        if not content:
            raise RuntimeError("No content returned from HF model")

        data = _extract_json_object(content)

        impact_score = float(data.get("impact_score", 0.0) or 0.0)
        impact_label = _normalize_label(data.get("impact_label", "Low"))
        reasons = data.get("reasons", []) or []
        if not isinstance(reasons, list):
            reasons = [str(reasons)]
        reasons = [str(r) for r in reasons][:6]
        if len(reasons) == 0:
            reasons = ["No reasons returned"]

        return {
            "impact_score": impact_score,
            "impact_label": impact_label,
            "reasons": reasons,
            "scoring_source": "llm",
            "scoring_model": HF_MODEL,
        }
    except Exception as e:
        print("HF LLM scoring failed; falling back to local:", repr(e))
        return _fallback_local_score(ne, personality_score)


def _needs_rescore(row: sqlite3.Row) -> bool:
    if _row_get(row, "scored_at") is None:
        return True
    try:
        scored_dt = _parse_dt(row["scored_at"])
        updated_dt = _parse_dt(row["updated_at"])
        return updated_dt > scored_dt
    except Exception:
        return True


def _persist_score(conn: sqlite3.Connection, event_id: str, user_id: str, score: dict):
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        UPDATE events
        SET impact_score=?,
            impact_label=?,
            reasons_json=?,
            scored_at=?,
            scoring_source=?,
            scoring_model=?
        WHERE id=? AND user_id=?
        """,
        (
            float(score.get("impact_score", 0.0) or 0.0),
            _normalize_label(score.get("impact_label", "Low")),
            json.dumps(score.get("reasons", []) or []),
            now_iso,
            score.get("scoring_source"),
            score.get("scoring_model"),
            event_id,
            user_id,
        ),
    )


def _read_score_from_row(row: sqlite3.Row) -> Optional[dict]:
    if _row_get(row, "impact_score") is None or _row_get(row, "impact_label") is None:
        return None
    try:
        reasons = json.loads(_row_get(row, "reasons_json") or "[]")
        if not isinstance(reasons, list):
            reasons = [str(reasons)]
        return {
            "impact_score": float(_row_get(row, "impact_score") or 0.0),
            "impact_label": _normalize_label(_row_get(row, "impact_label")),
            "reasons": reasons,
        }
    except Exception:
        return None


# ------------------
# AUTH ROUTES
# ------------------
@app.get("/auth/login")
def auth_login(request: Request):
    flow = _flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    request.session["oauth_state"] = state
    return RedirectResponse(auth_url)


@app.get("/auth/callback")
def auth_callback(request: Request):
    state = request.session.get("oauth_state")
    if not state:
        return JSONResponse(
            {"error": "Missing OAuth state in session. Try /auth/login again."},
            status_code=400,
        )

    flow = _flow(state=state)
    authorization_response = str(request.url)

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=r"Scope has changed.*")
        flow.fetch_token(authorization_response=authorization_response)

    credentials = flow.credentials

    from google.oauth2 import id_token
    from google.auth.transport.requests import Request as GoogleRequest2

    idinfo = id_token.verify_oauth2_token(
        credentials.id_token,
        GoogleRequest2(),
        GOOGLE_CLIENT_ID,
        clock_skew_in_seconds=60,
    )

    request.session["user"] = {
        "sub": idinfo.get("sub"),
        "email": idinfo.get("email"),
        "name": idinfo.get("name"),
    }

    conn = get_db()
    row = conn.execute(
        "SELECT personality_score, label, raw_score FROM user_profile WHERE user_id = ?",
        (idinfo.get("sub"),),
    ).fetchone()
    conn.close()

    if row:
        request.session["profile"] = {
            "personality_score": row["personality_score"],
            "label": row["label"],
            "raw_score": row["raw_score"],
            "modifiers": {},
        }

    request.session["credentials"] = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": credentials.scopes,
    }

    return RedirectResponse(url=FRONTEND_URL)


@app.get("/auth/status")
def auth_status(request: Request):
    return {"connected": bool(request.session.get("credentials"))}


@app.get("/auth/logout")
def auth_logout(request: Request):
    request.session.pop("credentials", None)
    request.session.pop("user", None)
    request.session.pop("profile", None)
    return RedirectResponse(url=FRONTEND_URL)


# ------------------
# ME + ONBOARDING
# ------------------
@app.get("/api/me")
def me(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse({"authenticated": False}, status_code=401)

    profile = request.session.get("profile", {})
    return {
        "authenticated": True,
        "user": user,
        "profile": profile,
        "onboarded": "personality_score" in profile,
    }


@app.post("/api/onboarding")
def api_onboarding(request: Request, payload: dict = Body(...)):
    if not request.session.get("credentials"):
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    answers = payload.get("answers")

    if answers == []:
        request.session.pop("profile", None)
        user_id = request.session["user"]["sub"]
        conn = get_db()
        conn.execute("DELETE FROM user_profile WHERE user_id = ?", (user_id,))
        conn.commit()
        conn.close()
        return {"cleared": True}

    if not isinstance(answers, list):
        return JSONResponse({"error": "Expected JSON body: { answers: number[] }"}, status_code=400)

    try:
        profile = compute_personality_profile([int(x) for x in answers])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    request.session["profile"] = profile

    user_id = request.session["user"]["sub"]
    conn = get_db()
    conn.execute(
        """
        INSERT INTO user_profile (user_id, personality_score, label, raw_score)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            personality_score=excluded.personality_score,
            label=excluded.label,
            raw_score=excluded.raw_score
        """,
        (user_id, profile["personality_score"], profile["label"], profile["raw_score"]),
    )
    conn.commit()
    conn.close()
    return profile


# ------------------
# DB-BACKED EVENTS (MAIN API)
# ------------------
def _merged_event_row(conn: sqlite3.Connection, user_id: str, row: sqlite3.Row) -> dict:
    """
    Merge google_overrides (if any) on top of the stored google event row.
    For local events, returns the row as-is.
    """
    base = _row_to_eventdict(row)

    if base.get("source") != "google":
        return base

    ov = conn.execute(
        """
        SELECT event_type, attendee_count, has_video, has_conference_link
        FROM google_overrides
        WHERE user_id=? AND event_id=?
        """,
        (user_id, row["id"]),
    ).fetchone()

    if not ov:
        return base

    # Only override when a column is non-null in overrides
    if ov["event_type"] is not None:
        base["event_type"] = ov["event_type"]
    if ov["attendee_count"] is not None:
        base["attendee_count"] = int(ov["attendee_count"] or 0)
    if ov["has_video"] is not None:
        base["has_video"] = bool(ov["has_video"])
    if ov["has_conference_link"] is not None:
        base["has_conference_link"] = bool(ov["has_conference_link"])

    return base


@app.get("/api/events")
def get_events_db(request: Request, hours: int = 24):
    user_id = _require_user_id(request)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(hours=hours)).isoformat()

    conn = get_db()
    rows = conn.execute(
        """
        SELECT * FROM events
        WHERE user_id = ?
          AND start < ?
          AND end > ?
        ORDER BY start ASC
        """,
        (user_id, time_max, time_min),
    ).fetchall()

    profile = request.session.get("profile") or {}

    out = []
    for r in rows:
        merged = _merged_event_row(conn, user_id, r)

        cached = _read_score_from_row(r)
        if cached is None or _needs_rescore(r):
            ne = NormalizedEvent(
                id=r["id"],
                title=r["title"],
                start=_parse_dt(r["start"]),
                end=_parse_dt(r["end"]),
                event_type=EventType(merged["event_type"]),
                attendee_count=int(merged.get("attendee_count") or 0),
                has_video=bool(merged.get("has_video")),
                has_conference_link=bool(merged.get("has_conference_link")),
            )
            score = _llm_score_event(ne, profile)
            _persist_score(conn, r["id"], user_id, score)
            cached = {
                "impact_score": float(score.get("impact_score", 0.0) or 0.0),
                "impact_label": _normalize_label(score.get("impact_label", "Low")),
                "reasons": score.get("reasons", []) or [],
            }

        out.append({**merged, **cached})

    conn.commit()
    conn.close()
    return {"count": len(out), "window_hours": hours, "events": out}


@app.post("/api/events")
def create_event_db(request: Request, payload: dict = Body(...)):
    user_id = _require_user_id(request)

    title = payload.get("title") or "New Event"
    start = payload.get("start")
    end = payload.get("end")
    if not start or not end:
        return JSONResponse({"error": "start and end are required (ISO datetime strings)"}, status_code=400)

    start_iso = _to_utc_iso(start)
    end_iso = _to_utc_iso(end)

    event_type = payload.get("event_type") or "meeting"
    attendee_count = int(payload.get("attendee_count") or 0)
    has_video = bool(payload.get("has_video") or False)
    has_conference_link = bool(payload.get("has_conference_link") or False)

    event_id = payload.get("id") or f"local_{uuid4().hex}"
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_db()
    conn.execute(
        """
        INSERT INTO events (
            id, user_id, source, title, start, end, event_type,
            attendee_count, has_video, has_conference_link, modifiers_json, updated_at
        ) VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            user_id,
            title,
            start_iso,
            end_iso,
            event_type,
            attendee_count,
            int(has_video),
            int(has_conference_link),
            json.dumps(payload.get("modifiers")) if payload.get("modifiers") is not None else None,
            now_iso,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM events WHERE id = ? AND user_id = ?", (event_id, user_id)).fetchone()

    profile = request.session.get("profile") or {}

    ne = NormalizedEvent(
        id=row["id"],
        title=row["title"],
        start=_parse_dt(row["start"]),
        end=_parse_dt(row["end"]),
        event_type=EventType(row["event_type"]),
        attendee_count=int(row["attendee_count"] or 0),
        has_video=bool(row["has_video"]),
        has_conference_link=bool(row["has_conference_link"]),
    )

    score = _llm_score_event(ne, profile)
    _persist_score(conn, row["id"], user_id, score)
    conn.commit()
    conn.close()

    return {
        "event": {
            **_row_to_eventdict(row),
            "impact_score": float(score.get("impact_score", 0.0) or 0.0),
            "impact_label": _normalize_label(score.get("impact_label", "Low")),
            "reasons": score.get("reasons", []) or [],
        }
    }


@app.put("/api/events/{event_id}")
def update_event_db(event_id: str, request: Request, payload: dict = Body(...)):
    user_id = _require_user_id(request)

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM events WHERE id = ? AND user_id = ?",
        (event_id, user_id),
    ).fetchone()

    if not row:
        conn.close()
        return JSONResponse({"error": "Event not found"}, status_code=404)

    title = payload.get("title", row["title"])
    start = payload.get("start", row["start"])
    end = payload.get("end", row["end"])
    event_type = payload.get("event_type", row["event_type"])

    start_iso = _to_utc_iso(start) if payload.get("start") else row["start"]
    end_iso = _to_utc_iso(end) if payload.get("end") else row["end"]

    attendee_count = int(payload.get("attendee_count", row["attendee_count"] or 0))
    has_video = int(bool(payload.get("has_video", bool(row["has_video"]))))
    has_conference_link = int(bool(payload.get("has_conference_link", bool(row["has_conference_link"]))))

    now_iso = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """
        UPDATE events
        SET title=?, start=?, end=?, event_type=?, attendee_count=?,
            has_video=?, has_conference_link=?, updated_at=?,
            scored_at=NULL, impact_score=NULL, impact_label=NULL, reasons_json=NULL,
            scoring_source=NULL, scoring_model=NULL
        WHERE id=? AND user_id=?
        """,
        (
            title,
            start_iso,
            end_iso,
            event_type,
            attendee_count,
            has_video,
            has_conference_link,
            now_iso,
            event_id,
            user_id,
        ),
    )
    conn.commit()

    row2 = conn.execute("SELECT * FROM events WHERE id = ? AND user_id = ?", (event_id, user_id)).fetchone()

    profile = request.session.get("profile") or {}

    ne = NormalizedEvent(
        id=row2["id"],
        title=row2["title"],
        start=_parse_dt(row2["start"]),
        end=_parse_dt(row2["end"]),
        event_type=EventType(row2["event_type"]),
        attendee_count=int(row2["attendee_count"] or 0),
        has_video=bool(row2["has_video"]),
        has_conference_link=bool(row2["has_conference_link"]),
    )

    score = _llm_score_event(ne, profile)
    _persist_score(conn, row2["id"], user_id, score)
    conn.commit()
    conn.close()

    return {
        "event": {
            **_row_to_eventdict(row2),
            "impact_score": float(score.get("impact_score", 0.0) or 0.0),
            "impact_label": _normalize_label(score.get("impact_label", "Low")),
            "reasons": score.get("reasons", []) or [],
        }
    }


@app.delete("/api/events/{event_id}")
def delete_event_db(event_id: str, request: Request):
    user_id = _require_user_id(request)

    conn = get_db()
    cur = conn.execute(
        "DELETE FROM events WHERE id = ? AND user_id = ?",
        (event_id, user_id),
    )
    conn.commit()
    conn.close()

    if cur.rowcount == 0:
        return JSONResponse({"error": "Event not found"}, status_code=404)

    return {"deleted": True}


# ------------------
# ✅ Part B: Google Overrides endpoint
# ------------------
@app.put("/api/events/google_overrides/{event_id}")
def update_google_overrides(event_id: str, request: Request, payload: dict = Body(...)):
    user_id = _require_user_id(request)

    # Values we allow overriding
    event_type = payload.get("event_type")
    attendee_count = payload.get("attendee_count")
    has_video = payload.get("has_video")
    has_conference_link = payload.get("has_conference_link")

    # Basic validation
    if event_type is not None:
        try:
            # ensure it matches EventType enum values
            EventType(str(event_type))
        except Exception:
            return JSONResponse({"error": f"Invalid event_type: {event_type}"}, status_code=400)

    if attendee_count is not None:
        try:
            attendee_count = int(attendee_count)
            if attendee_count < 0:
                attendee_count = 0
        except Exception:
            return JSONResponse({"error": "attendee_count must be an integer"}, status_code=400)

    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_db()

    # Ensure the event exists and belongs to user and is google
    row = conn.execute(
        "SELECT * FROM events WHERE id=? AND user_id=?",
        (event_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return JSONResponse({"error": "Event not found"}, status_code=404)
    if row["source"] != "google":
        conn.close()
        return JSONResponse({"error": "Overrides are only for google events"}, status_code=400)

    # Upsert overrides (store NULLs if omitted -> but we only want to update provided fields)
    # We'll read current overrides first, then merge.
    cur_ov = conn.execute(
        """
        SELECT event_type, attendee_count, has_video, has_conference_link
        FROM google_overrides
        WHERE user_id=? AND event_id=?
        """,
        (user_id, event_id),
    ).fetchone()

    merged_event_type = event_type if event_type is not None else (cur_ov["event_type"] if cur_ov else None)
    merged_attendee_count = attendee_count if attendee_count is not None else (cur_ov["attendee_count"] if cur_ov else None)
    merged_has_video = None
    merged_has_conference_link = None

    if has_video is not None:
        merged_has_video = int(bool(has_video))
    else:
        merged_has_video = cur_ov["has_video"] if cur_ov else None

    if has_conference_link is not None:
        merged_has_conference_link = int(bool(has_conference_link))
    else:
        merged_has_conference_link = cur_ov["has_conference_link"] if cur_ov else None

    conn.execute(
        """
        INSERT INTO google_overrides (user_id, event_id, event_type, attendee_count, has_video, has_conference_link, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, event_id) DO UPDATE SET
            event_type=excluded.event_type,
            attendee_count=excluded.attendee_count,
            has_video=excluded.has_video,
            has_conference_link=excluded.has_conference_link,
            updated_at=excluded.updated_at
        """,
        (
            user_id,
            event_id,
            merged_event_type,
            merged_attendee_count,
            merged_has_video,
            merged_has_conference_link,
            now_iso,
        ),
    )

    # ✅ Force rescore by updating the events.updated_at + clearing cached score
    conn.execute(
        """
        UPDATE events
        SET updated_at=?,
            scored_at=NULL, impact_score=NULL, impact_label=NULL, reasons_json=NULL,
            scoring_source=NULL, scoring_model=NULL
        WHERE id=? AND user_id=?
        """,
        (now_iso, event_id, user_id),
    )

    conn.commit()

    # Return merged event snapshot (so frontend can refresh, but we still recommend loadEvents())
    row2 = conn.execute(
        "SELECT * FROM events WHERE id=? AND user_id=?",
        (event_id, user_id),
    ).fetchone()

    merged = _merged_event_row(conn, user_id, row2)
    conn.close()

    return {"ok": True, "event": merged}


# ------------------
# GOOGLE SYNC -> DB
# ------------------
@app.post("/api/google/sync")
def sync_google_into_db(request: Request, hours: int = 24):
    user_id = _require_user_id(request)
    creds = _get_google_creds_from_session(request)
    if not creds:
        return JSONResponse({"error": "Not authenticated, go to /auth/login"}, status_code=401)

    service = build("calendar", "v3", credentials=creds)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(hours=hours)).isoformat()

    resp = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            maxResults=250,
        )
        .execute()
    )

    items = resp.get("items", [])
    now_iso = datetime.now(timezone.utc).isoformat()

    profile = request.session.get("profile") or {}

    conn = get_db()
    upserted = 0

    for evt in items:
        start_dt, _ = _event_datetime(evt, "start")
        end_dt, _ = _event_datetime(evt, "end")

        if not start_dt or not end_dt:
            continue

        attendees = evt.get("attendees") or []
        attendees_count = max(0, len(attendees))
        summary = evt.get("summary") or "No Title"
        has_conference = bool(evt.get("conferenceData")) or bool(evt.get("hangoutLink"))
        etype = _infer_event_type(attendees_count, summary, has_conference)

        event_id = evt.get("id", "")
        if not event_id:
            continue

        start_iso = _to_utc_iso(start_dt)
        end_iso = _to_utc_iso(end_dt)

        conn.execute(
            """
            INSERT INTO events (
              id, user_id, source, title, start, end, event_type,
              attendee_count, has_video, has_conference_link, modifiers_json, updated_at
            )
            VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,
              start=excluded.start,
              end=excluded.end,
              event_type=excluded.event_type,
              attendee_count=excluded.attendee_count,
              has_video=excluded.has_video,
              has_conference_link=excluded.has_conference_link,
              updated_at=excluded.updated_at,
              scored_at=NULL,
              impact_score=NULL,
              impact_label=NULL,
              reasons_json=NULL,
              scoring_source=NULL,
              scoring_model=NULL
            """,
            (
                event_id,
                user_id,
                summary,
                start_iso,
                end_iso,
                etype.value,
                attendees_count,
                int(has_conference),
                int(has_conference),
                now_iso,
            ),
        )
        upserted += 1

    conn.commit()

    # Score all events in the window missing scores
    rows = conn.execute(
        """
        SELECT * FROM events
        WHERE user_id = ?
          AND start < ?
          AND end > ?
        ORDER BY start ASC
        """,
        (user_id, time_max, time_min),
    ).fetchall()

    for r in rows:
        merged = _merged_event_row(conn, user_id, r)
        if _read_score_from_row(r) is None or _needs_rescore(r):
            ne = NormalizedEvent(
                id=r["id"],
                title=r["title"],
                start=_parse_dt(r["start"]),
                end=_parse_dt(r["end"]),
                event_type=EventType(merged["event_type"]),
                attendee_count=int(merged.get("attendee_count") or 0),
                has_video=bool(merged.get("has_video")),
                has_conference_link=bool(merged.get("has_conference_link")),
            )
            score = _llm_score_event(ne, profile)
            _persist_score(conn, r["id"], user_id, score)

    conn.commit()
    conn.close()

    return {"synced": upserted, "window_hours": hours}


# ------------------
# (Optional) Legacy Calendar Routes
# ------------------
@app.get("/api/calendar/events")
def get_calendar_events(request: Request, hours: int = 24):
    creds = _get_google_creds_from_session(request)
    if not creds:
        return JSONResponse({"error": "Not authenticated, go to /auth/login"}, status_code=401)

    profile = request.session.get("profile") or {}
    personality_score = int(profile.get("personality_score", 30) or 30)

    service = build("calendar", "v3", credentials=creds)
    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(hours=hours)).isoformat()

    resp = service.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
        maxResults=250,
    ).execute()

    items = resp.get("items", [])
    events_flat = []

    for evt in items:
        start_dt, _ = _event_datetime(evt, "start")
        end_dt, _ = _event_datetime(evt, "end")
        if start_dt is None or end_dt is None:
            continue

        attendees = evt.get("attendees") or []
        attendees_count = max(0, len(attendees))
        summary = evt.get("summary") or "No Title"
        has_conference = bool(evt.get("conferenceData")) or bool(evt.get("hangoutLink"))

        etype = _infer_event_type(attendees_count, summary, has_conference)

        ne = NormalizedEvent(
            id=evt.get("id", ""),
            title=summary,
            start=_parse_dt(start_dt),
            end=_parse_dt(end_dt),
            event_type=etype,
            attendee_count=attendees_count,
            has_conference_link=has_conference,
            has_video=has_conference,
        )

        s = score_event(ne, personality_score=personality_score).model_dump()
        impact_score = float(s.get("impact_score", 0.0) or 0.0)
        impact_label = _normalize_label(s.get("impact_label", "Low"))
        reasons = s.get("reasons", []) or []

        events_flat.append(
            {
                "id": ne.id,
                "title": ne.title,
                "start": ne.start.isoformat(),
                "end": ne.end.isoformat(),
                "location": None,
                "event_type": ne.event_type.value,
                "impact_score": impact_score,
                "impact_label": impact_label,
                "reasons": reasons,
            }
        )

    return {"count": len(events_flat), "window_hours": hours, "events": events_flat}


# ------------------
# STATIC FRONTEND
# ------------------
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
