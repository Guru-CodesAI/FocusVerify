import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Generator, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import psycopg
from psycopg.rows import dict_row

from backend.app.config import (
    APP_ENV,
    AUTH_SECRET,
    DATABASE_URL,
    MODEL_CONFIG,
    REVIEWER_EMAIL,
    REVIEWER_PASSWORD,
    AUTH_RATE_LIMIT,
    AUTH_RATE_WINDOW_SECONDS,
    EVENT_INGESTION_LIMIT,
    SESSION_CREATE_LIMIT,
    WEB_ORIGIN,
)

app = FastAPI(title="FocusVerify API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[WEB_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

MAX_REQUEST_BYTES = 32 * 1024


class RequestBodyLimitMiddleware:
    def __init__(self, application: Any, max_bytes: int) -> None:
        self.application = application
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.application(scope, receive, send)
            return

        content_length = next(
            (value for key, value in scope.get("headers", []) if key.lower() == b"content-length"),
            None,
        )
        if content_length:
            try:
                declared_size = int(content_length)
            except ValueError:
                await self._respond(send, 400, b'{"detail":"Invalid Content-Length"}')
                return
            if declared_size > self.max_bytes:
                await self._respond(send, 413, b'{"detail":"Request body is too large"}')
                return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._respond(send, 413, b'{"detail":"Request body is too large"}')
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        delivered = False

        async def replay_body() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        await self.application(scope, replay_body, send)

    async def _respond(self, send: Any, status: int, body: bytes) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})


app.add_middleware(RequestBodyLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)


@app.middleware("http")
async def add_security_headers(request: Request, call_next: Any) -> Any:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if APP_ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


BrowserEventType = Literal[
    "CAMERA_INTERRUPTION",
    "VIDEO_STREAM_DEGRADED",
    "WINDOW_FOCUS_LOST",
    "WINDOW_FOCUS_RESTORED",
    "PAGE_VISIBILITY_CHANGED",
    "FULLSCREEN_EXITED",
]
BrowserObservedState = Literal[
    "visible",
    "hidden",
    "focused",
    "unfocused",
    "exited",
    "muted",
    "ended",
    "frames_unavailable",
]
EvidenceText = Annotated[str, Field(min_length=1, max_length=240)]


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionCreatePayload(StrictPayload):
    candidate_id: str | None = Field(default=None, max_length=128)
    assessment_id: str | None = Field(default=None, max_length=128)


class EventCreatePayload(StrictPayload):
    event_type: BrowserEventType
    client_event_id: uuid.UUID
    signal_quality: float = Field(ge=0.0, le=1.0)
    observed_state: BrowserObservedState
    evidence: list[EvidenceText] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_event_state_pair(self) -> "EventCreatePayload":
        allowed_states: dict[BrowserEventType, set[str]] = {
            "CAMERA_INTERRUPTION": {"ended"},
            "VIDEO_STREAM_DEGRADED": {"muted", "frames_unavailable"},
            "WINDOW_FOCUS_LOST": {"unfocused"},
            "WINDOW_FOCUS_RESTORED": {"focused"},
            "PAGE_VISIBILITY_CHANGED": {"visible", "hidden"},
            "FULLSCREEN_EXITED": {"exited"},
        }
        if self.observed_state not in allowed_states[self.event_type]:
            raise ValueError("observed_state does not match event_type")
        return self

    @field_validator("evidence")
    @classmethod
    def validate_evidence_total_size(cls, evidence: list[str]) -> list[str]:
        if sum(len(item.encode("utf-8")) for item in evidence) > 1024:
            raise ValueError("Evidence text must total no more than 1024 bytes")
        return evidence


class LoginPayload(StrictPayload):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class ReviewPayload(StrictPayload):
    disposition: str = Field(pattern="^(confirmed|dismissed)$")
    note: str = Field(default="", max_length=2000)


def is_postgres_url(url: str | None = None) -> bool:
    if url is None:
        url = DATABASE_URL
    return url.startswith(("postgres://", "postgresql://", "postgresql+psycopg://"))


def normalize_postgres_url(url: str | None = None) -> str:
    if url is None:
        url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    elif url.startswith("postgresql+psycopg://"):
        url = "postgresql://" + url[len("postgresql+psycopg://"):]
    if not url.startswith("postgresql://"):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL or SQLite URL.")
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if parsed.hostname and parsed.hostname not in {"localhost", "127.0.0.1"}:
        if query.get("sslmode") not in {"require", "verify-ca", "verify-full"}:
            query["sslmode"] = "require"
    return urlunsplit(parsed._replace(query=urlencode(query)))


def validate_database_configuration() -> None:
    if APP_ENV == "production" and not is_postgres_url():
        raise RuntimeError("Production deployments require PostgreSQL persistence.")


def database_path() -> Path:
    prefix = "sqlite:///"
    if not DATABASE_URL.startswith(prefix):
        raise RuntimeError("database_path is only available for SQLite DATABASE_URL values.")
    configured_path = DATABASE_URL[len(prefix):]
    if not configured_path:
        raise RuntimeError("DATABASE_URL must include a SQLite database path.")
    return Path(configured_path).resolve()


class PostgresConnection:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self.connection = connection

    def execute(self, statement: str, parameters: tuple[Any, ...] = ()) -> Any:
        return self.connection.execute(statement.replace("?", "%s"), parameters)

    def commit(self) -> None:
        self.connection.commit()

    def rollback(self) -> None:
        self.connection.rollback()

    def close(self) -> None:
        self.connection.close()


@contextmanager
def database(write: bool = False) -> Generator[Any, None, None]:
    postgres = is_postgres_url()
    if postgres:
        connection = PostgresConnection(
            psycopg.connect(
                normalize_postgres_url(),
                connect_timeout=10,
                row_factory=dict_row,
            )
        )
    else:
        path = database_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
    try:
        if write:
            if postgres:
                connection.execute("SELECT pg_advisory_xact_lock(729104321)")
            else:
                connection.execute("BEGIN IMMEDIATE")
        yield connection
        if postgres or connection.in_transaction:
            connection.commit()
    except Exception:
        if postgres or connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    validate_database_configuration()
    postgres = is_postgres_url()
    with database(write=postgres) as connection:
        if not postgres:
            connection.execute("PRAGMA journal_mode = WAL")
        schema = """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                signal_quality_average REAL NOT NULL DEFAULT 0,
                duration REAL NOT NULL DEFAULT 0,
                candidate_id TEXT,
                assessment_id TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                confidence REAL NOT NULL,
                signal_quality REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                metadata_json TEXT NOT NULL,
                model_version TEXT NOT NULL,
                algorithm_version TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                client_event_id TEXT,
                correlated_event_id TEXT
            );
            CREATE INDEX IF NOT EXISTS events_session_timestamp
                ON events(session_id, timestamp);
            CREATE TABLE IF NOT EXISTS event_reviews (
                event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
                disposition TEXT NOT NULL CHECK(disposition IN ('confirmed', 'dismissed')),
                note TEXT NOT NULL,
                reviewer_email TEXT NOT NULL,
                reviewed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS review_audit (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                disposition TEXT NOT NULL CHECK(disposition IN ('confirmed', 'dismissed')),
                note TEXT NOT NULL,
                reviewer_email TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_hash TEXT NOT NULL,
                attempted_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session_creations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS session_creations_source_time
                ON session_creations(source_hash, created_at);
            CREATE INDEX IF NOT EXISTS login_failures_source_time
                ON login_failures(source_hash, attempted_at);
            """
        if postgres:
            for statement in schema.split(";"):
                statement = statement.strip()
                if statement:
                    connection.execute(
                        statement.replace(
                            "INTEGER PRIMARY KEY AUTOINCREMENT",
                            "BIGSERIAL PRIMARY KEY",
                        )
                    )
            connection.execute(
                "ALTER TABLE events ADD COLUMN IF NOT EXISTS client_event_id TEXT"
            )
            connection.execute(
                "ALTER TABLE events ADD COLUMN IF NOT EXISTS correlated_event_id TEXT"
            )
            connection.execute(
                """
                CREATE OR REPLACE FUNCTION prevent_review_audit_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'review audit entries are append-only';
                END;
                $$
                """
            )
            for operation in ("UPDATE", "DELETE"):
                trigger_name = f"review_audit_no_{operation.lower()}"
                connection.execute(
                    f"DROP TRIGGER IF EXISTS {trigger_name} ON review_audit"
                )
                connection.execute(
                    f"""CREATE TRIGGER {trigger_name} BEFORE {operation} ON review_audit
                        FOR EACH ROW EXECUTE FUNCTION prevent_review_audit_mutation()"""
                )
        else:
            connection.executescript(schema)
            event_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(events)").fetchall()
            }
            if "client_event_id" not in event_columns:
                connection.execute("ALTER TABLE events ADD COLUMN client_event_id TEXT")
            if "correlated_event_id" not in event_columns:
                connection.execute("ALTER TABLE events ADD COLUMN correlated_event_id TEXT")
            connection.execute(
                """CREATE TRIGGER IF NOT EXISTS review_audit_no_update
                   BEFORE UPDATE ON review_audit BEGIN
                       SELECT RAISE(ABORT, 'review audit entries are append-only');
                   END"""
            )
            connection.execute(
                """CREATE TRIGGER IF NOT EXISTS review_audit_no_delete
                   BEFORE DELETE ON review_audit BEGIN
                       SELECT RAISE(ABORT, 'review audit entries are append-only');
                   END"""
            )
        connection.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS events_client_event_id
               ON events(session_id, client_event_id)
               WHERE client_event_id IS NOT NULL"""
        )


initialize_database()


def encode_segment(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_segment(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def validate_auth_configuration() -> None:
    origin = urlsplit(WEB_ORIGIN)
    try:
        origin_port = origin.port
        valid_origin = (
            origin.scheme == "https"
            and bool(origin.hostname)
            and origin.path in {"", "/"}
            and not origin.query
            and not origin.fragment
            and origin.username is None
            and origin.password is None
            and (origin_port is None or 1 <= origin_port <= 65535)
        )
    except ValueError:
        valid_origin = False
    if APP_ENV == "production" and (
        AUTH_SECRET in {"change-me-in-production", "replace-me"}
        or AUTH_SECRET.startswith("development-only")
        or len(AUTH_SECRET) < 32
        or REVIEWER_PASSWORD in {"focusverify-demo", "replace-this-demo-password"}
        or len(REVIEWER_PASSWORD) < 16
        or REVIEWER_EMAIL.casefold() == "reviewer@focusverify.local"
        or not valid_origin
    ):
        raise HTTPException(
            status_code=503,
            detail="Production authentication or origin configuration is not secure",
        )


def create_access_token(subject: str, role: str, session_id: str | None = None) -> str:
    validate_auth_configuration()
    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=8)).timestamp())
    claims: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "aud": "focusverify-api",
        "exp": expires_at,
    }
    if role == "reviewer":
        claims["credential_version"] = hmac.new(
            AUTH_SECRET.encode("utf-8"),
            REVIEWER_PASSWORD.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    if session_id:
        claims["sid"] = session_id
    payload = encode_segment(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    signature = encode_segment(
        hmac.new(AUTH_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{payload}.{signature}"


def decode_access_token(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication required")
    token = authorization.removeprefix("Bearer ")
    if len(token) > 2048:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    try:
        payload_segment, signature_segment = token.split(".", 1)
        expected_signature = encode_segment(
            hmac.new(
                AUTH_SECRET.encode("utf-8"),
                payload_segment.encode("ascii"),
                hashlib.sha256,
            ).digest()
        )
        if not hmac.compare_digest(signature_segment, expected_signature):
            raise ValueError("Invalid signature")
        claims = json.loads(decode_segment(payload_segment))
        if not isinstance(claims, dict) or not isinstance(claims.get("exp"), int):
            raise ValueError("Malformed claims")
        if claims["exp"] <= int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Expired token")
        if claims.get("aud") != "focusverify-api":
            raise ValueError("Invalid audience")
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc
    return claims


def require_reviewer(authorization: str | None = Header(default=None)) -> str:
    claims = decode_access_token(authorization)
    email = claims.get("sub")
    if (
        claims.get("role") != "reviewer"
        or not isinstance(email, str)
        or not secrets.compare_digest(
            email.casefold().encode("utf-8"), REVIEWER_EMAIL.casefold().encode("utf-8")
        )
        or not isinstance(claims.get("credential_version"), str)
        or not secrets.compare_digest(
            claims["credential_version"],
            hmac.new(
                AUTH_SECRET.encode("utf-8"),
                REVIEWER_PASSWORD.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest(),
        )
    ):
        raise HTTPException(status_code=403, detail="Reviewer access required")
    return email


def require_candidate(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> str:
    claims = decode_access_token(authorization)
    if (
        claims.get("role") != "candidate"
        or claims.get("sid") != session_id
        or claims.get("sub") != session_id
    ):
        raise HTTPException(status_code=403, detail="Session access required")
    return session_id


def row_to_event(row: Any) -> dict[str, Any]:
    review = row["disposition"] if "disposition" in row.keys() else None
    metadata = json.loads(row["metadata_json"])
    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "event_type": row["event_type"],
        "severity": row["severity"],
        "signal_quality": row["signal_quality"],
        "duration_seconds": row["duration_seconds"],
        "metadata_json": metadata,
        "observed_state": metadata.get("observed_state"),
        "model_version": row["model_version"],
        "algorithm_version": row["algorithm_version"],
        "correlation_id": row["correlation_id"],
        "client_event_id": row["client_event_id"],
        "review": review,
    }


def related_event_types(event_type: BrowserEventType) -> tuple[str, ...]:
    relationships = {
        "WINDOW_FOCUS_LOST": (
            "PAGE_VISIBILITY_CHANGED",
            "WINDOW_FOCUS_RESTORED",
            "FULLSCREEN_EXITED",
        ),
        "WINDOW_FOCUS_RESTORED": (
            "WINDOW_FOCUS_LOST",
            "PAGE_VISIBILITY_CHANGED",
            "FULLSCREEN_EXITED",
        ),
        "PAGE_VISIBILITY_CHANGED": (
            "WINDOW_FOCUS_LOST",
            "WINDOW_FOCUS_RESTORED",
            "PAGE_VISIBILITY_CHANGED",
            "FULLSCREEN_EXITED",
        ),
        "FULLSCREEN_EXITED": ("WINDOW_FOCUS_LOST", "WINDOW_FOCUS_RESTORED", "PAGE_VISIBILITY_CHANGED"),
        "CAMERA_INTERRUPTION": ("VIDEO_STREAM_DEGRADED",),
        "VIDEO_STREAM_DEGRADED": ("CAMERA_INTERRUPTION",),
    }
    return relationships.get(event_type, ())


def correlation_for(
    connection: Any,
    session_id: str,
    event_type: BrowserEventType,
    timestamp: str,
) -> tuple[str, str | None]:
    related_types = related_event_types(event_type)
    if related_types:
        placeholders = ",".join("?" for _ in related_types)
        recent = connection.execute(
            f"""SELECT id, correlation_id
                FROM events
                WHERE session_id = ? AND event_type IN ({placeholders})
                  AND timestamp >= ? AND timestamp <= ?
                  AND NOT EXISTS (
                      SELECT 1 FROM events AS anchor
                      WHERE anchor.session_id = events.session_id
                        AND anchor.correlation_id = events.correlation_id
                        AND anchor.timestamp < ?
                  )
                ORDER BY timestamp DESC, id DESC LIMIT 1""",
            (
                session_id,
                *related_types,
                (datetime.fromisoformat(timestamp) - timedelta(seconds=5)).isoformat(),
                timestamp,
                (datetime.fromisoformat(timestamp) - timedelta(seconds=5)).isoformat(),
            ),
        ).fetchone()
        if recent:
            return recent["correlation_id"], recent["id"]
    return str(uuid.uuid4()), None


@app.get("/api/health")
def health_check() -> dict[str, str]:
    try:
        validate_auth_configuration()
    except HTTPException as exc:
        raise HTTPException(
            status_code=503,
            detail="Authentication configuration is not ready",
        ) from exc
    try:
        with database() as connection:
            connection.execute("SELECT 1").fetchone()
    except (sqlite3.Error, psycopg.Error, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ok", "app": "focusverify", "environment": APP_ENV}


@app.post("/api/auth/login")
def reviewer_login(payload: LoginPayload, request: Request) -> dict[str, Any]:
    validate_auth_configuration()
    if AUTH_RATE_LIMIT < 1 or AUTH_RATE_WINDOW_SECONDS < 1:
        raise HTTPException(status_code=503, detail="Authentication rate limit is misconfigured")
    source = request.client.host if request.client else "unknown-client"
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    attempted_after = (
        datetime.now(timezone.utc) - timedelta(seconds=AUTH_RATE_WINDOW_SECONDS)
    ).isoformat()
    email_matches = secrets.compare_digest(
        payload.email.casefold().encode("utf-8"),
        REVIEWER_EMAIL.casefold().encode("utf-8"),
    )
    password_matches = secrets.compare_digest(
        payload.password.encode("utf-8"),
        REVIEWER_PASSWORD.encode("utf-8"),
    )
    credentials_match = email_matches and password_matches
    too_many_attempts = False
    with database(write=True) as connection:
        failure_count = connection.execute(
            "SELECT COUNT(*) AS count FROM login_failures WHERE source_hash = ? AND attempted_at >= ?",
            (source_hash, attempted_after),
        ).fetchone()["count"]
        if failure_count >= AUTH_RATE_LIMIT:
            too_many_attempts = True
        elif not credentials_match:
            connection.execute(
                "INSERT INTO login_failures (source_hash, attempted_at) VALUES (?, ?)",
                (source_hash, utc_now()),
            )
            connection.execute(
                "DELETE FROM login_failures WHERE attempted_at < ?",
                ((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),),
            )
        else:
            connection.execute("DELETE FROM login_failures WHERE source_hash = ?", (source_hash,))
    if too_many_attempts:
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts. Try again later.",
            headers={"Retry-After": str(AUTH_RATE_WINDOW_SECONDS)},
        )
    if not credentials_match:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {
        "access_token": create_access_token(REVIEWER_EMAIL, "reviewer"),
        "token_type": "bearer",
        "expires_in": 28800,
        "role": "reviewer",
    }


@app.post("/api/sessions")
def create_session(payload: SessionCreatePayload, request: Request) -> dict[str, Any]:
    if SESSION_CREATE_LIMIT < 1:
        raise HTTPException(status_code=503, detail="Session creation limit is misconfigured")
    source = request.client.host if request.client else "unknown-client"
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    session_id = str(uuid.uuid4())
    candidate_access_token = create_access_token(session_id, "candidate", session_id)
    now = utc_now()
    with database(write=True) as connection:
        created_after = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        recent_count = connection.execute(
            "SELECT COUNT(*) AS count FROM session_creations WHERE source_hash = ? AND created_at >= ?",
            (source_hash, created_after),
        ).fetchone()["count"]
        if recent_count >= SESSION_CREATE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many sessions created from this client. Try again later.",
                headers={"Retry-After": "3600"},
            )
        connection.execute(
            """INSERT INTO sessions
               (id, status, created_at, candidate_id, assessment_id)
               VALUES (?, 'created', ?, ?, ?)""",
            (session_id, now, payload.candidate_id, payload.assessment_id),
        )
        connection.execute(
            "INSERT INTO session_creations (source_hash, created_at) VALUES (?, ?)",
            (source_hash, now),
        )
        connection.execute(
            "DELETE FROM session_creations WHERE created_at < ?",
            ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),),
        )
    return {
        "id": session_id,
        "candidate_access_token": candidate_access_token,
        "status": "created",
        "created_at": now,
        "started_at": None,
        "ended_at": None,
        "signal_quality_average": 0.0,
        "duration": 0.0,
    }


@app.post("/api/sessions/{session_id}/start")
def start_session(
    session_id: str,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, str]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    with database(write=True) as connection:
        result = connection.execute(
            """UPDATE sessions SET status = 'monitoring', started_at = ?
               WHERE id = ? AND status = 'created'""",
            (utc_now(), session_id),
        )
        if result.rowcount == 0:
            exists = connection.execute("SELECT status FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Session not found")
            raise HTTPException(status_code=409, detail=f"Cannot start a session in state '{exists['status']}'")
    return {"status": "ok", "session_id": session_id}


@app.post("/api/sessions/{session_id}/end")
def end_session(
    session_id: str,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, str]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    with database(write=True) as connection:
        session = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session["status"] != "monitoring":
            raise HTTPException(status_code=409, detail=f"Cannot end a session in state '{session['status']}'")
        ended_at = utc_now()
        duration = calculate_duration(session["started_at"], ended_at)
        connection.execute(
            "UPDATE sessions SET status = 'completed', ended_at = ?, duration = ? WHERE id = ?",
            (ended_at, duration, session_id),
        )
    return {"status": "ok", "session_id": session_id}


@app.post("/api/sessions/{session_id}/events")
def create_event(
    session_id: str,
    payload: EventCreatePayload,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, Any]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    if EVENT_INGESTION_LIMIT < 1:
        raise HTTPException(status_code=503, detail="Event ingestion limit is misconfigured")
    client_event_id = str(payload.client_event_id)
    event_id = str(uuid.uuid4())
    timestamp = utc_now()
    severity = "REVIEW" if payload.event_type == "CAMERA_INTERRUPTION" else "INFO"
    with database(write=True) as connection:
        session = connection.execute("SELECT status FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session["status"] != "monitoring":
            raise HTTPException(status_code=409, detail="Events can only be recorded while monitoring")
        duplicate = connection.execute(
            "SELECT * FROM events WHERE session_id = ? AND client_event_id = ?",
            (session_id, client_event_id),
        ).fetchone()
        if duplicate:
            return {"status": "ok", "event": row_to_event(duplicate), "duplicate": True}

        rate_limit_after = (
            datetime.fromisoformat(timestamp) - timedelta(hours=1)
        ).isoformat()
        recent_count = connection.execute(
            "SELECT COUNT(*) AS count FROM events WHERE session_id = ? AND timestamp >= ?",
            (session_id, rate_limit_after),
        ).fetchone()["count"]
        if recent_count >= EVENT_INGESTION_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Session event rate limit reached.",
                headers={"Retry-After": "3600"},
            )

        correlation_id, related_event_id = correlation_for(
            connection, session_id, payload.event_type, timestamp
        )
        metadata: dict[str, Any] = {"evidence": payload.evidence}
        metadata["observed_state"] = payload.observed_state
        if related_event_id:
            metadata["correlated_with"] = related_event_id
            metadata["correlation_window_seconds"] = 5
            connection.execute(
                "UPDATE events SET correlated_event_id = ? WHERE id = ?",
                (event_id, related_event_id),
            )
        connection.execute(
            """INSERT INTO events
               (id, session_id, timestamp, event_type, severity, confidence,
                signal_quality, duration_seconds, metadata_json, model_version,
                algorithm_version, correlation_id, client_event_id, correlated_event_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event_id,
                session_id,
                timestamp,
                payload.event_type,
                severity,
                0.0,
                payload.signal_quality,
                0.0,
                json.dumps(metadata),
                MODEL_CONFIG,
                "browser-instrumentation-v2",
                correlation_id,
                client_event_id,
                related_event_id,
            ),
        )
        connection.execute(
            """UPDATE sessions SET signal_quality_average = (
                SELECT AVG(signal_quality) FROM events WHERE session_id = ?
            ) WHERE id = ?""",
            (session_id, session_id),
        )
        event_row = connection.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    return {"status": "ok", "event": row_to_event(event_row)}


@app.get("/api/sessions/{session_id}")
def get_session(
    session_id: str,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, Any]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    with database() as connection:
        session = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return dict(session)


@app.get("/api/sessions/{session_id}/events")
def list_events(
    session_id: str,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, Any]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    with database() as connection:
        exists = connection.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Session not found")
        events = connection.execute(
            """SELECT e.*, r.disposition FROM events e
               LEFT JOIN event_reviews r ON r.event_id = e.id
               WHERE e.session_id = ? ORDER BY e.timestamp""",
            (session_id,),
        ).fetchall()
    return {"session_id": session_id, "events": [row_to_event(event) for event in events]}


@app.get("/api/sessions/{session_id}/report")
def session_report(
    session_id: str,
    authorized_session_id: str = Depends(require_candidate),
) -> dict[str, Any]:
    if authorized_session_id != session_id:
        raise HTTPException(status_code=403, detail="Session access required")
    with database() as connection:
        session = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        events = connection.execute(
            """SELECT e.*, r.disposition FROM events e
               LEFT JOIN event_reviews r ON r.event_id = e.id
               WHERE e.session_id = ? ORDER BY e.timestamp""",
            (session_id,),
        ).fetchall()
    serialized_events = [row_to_event(event) for event in events]
    review_groups = {
        event["correlation_id"]
        for event in serialized_events
        if event["severity"] in {"REVIEW", "HIGH_REVIEW"}
    }
    duration = session["duration"]
    if session["status"] == "monitoring" and session["started_at"]:
        duration = calculate_duration(session["started_at"], utc_now())
    return {
        "session_id": session_id,
        "status": session["status"],
        "duration": duration,
        "signal_quality_average": session["signal_quality_average"],
        "review_events": len(review_groups),
        "events": serialized_events,
    }


@app.get("/api/reviewer/sessions")
def list_reviewer_sessions(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000000),
    reviewer: str = Depends(require_reviewer),
) -> dict[str, Any]:
    del reviewer
    with database() as connection:
        total = connection.execute(
            "SELECT COUNT(*) AS count FROM sessions"
        ).fetchone()["count"]
        rows = connection.execute(
            """SELECT s.*,
                COUNT(e.id) AS event_count,
                COUNT(DISTINCT CASE WHEN e.severity IN ('REVIEW', 'HIGH_REVIEW')
                    THEN e.correlation_id END) AS review_event_count
               FROM sessions s LEFT JOIN events e ON e.session_id = s.id
               GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
    next_offset = offset + len(rows) if offset + len(rows) < total else None
    return {
        "sessions": [dict(row) for row in rows],
        "total": total,
        "next_offset": next_offset,
    }


@app.get("/api/reviewer/sessions/{session_id}")
def get_reviewer_session(
    session_id: str, reviewer: str = Depends(require_reviewer)
) -> dict[str, Any]:
    del reviewer
    with database() as connection:
        session = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        events = connection.execute(
            """SELECT e.*, r.disposition, r.note AS review_note,
                      r.reviewer_email, r.reviewed_at
               FROM events e LEFT JOIN event_reviews r ON r.event_id = e.id
               WHERE e.session_id = ? ORDER BY e.timestamp""",
            (session_id,),
        ).fetchall()
        audit_rows = connection.execute(
            """SELECT a.id, a.event_id, a.disposition, a.note,
                      a.reviewer_email, a.created_at
               FROM review_audit a JOIN events e ON e.id = a.event_id
               WHERE e.session_id = ? ORDER BY a.created_at, a.id""",
            (session_id,),
        ).fetchall()
    review_history: dict[str, list[dict[str, Any]]] = {}
    for audit_row in audit_rows:
        review_history.setdefault(audit_row["event_id"], []).append(dict(audit_row))
    return {
        "session": dict(session),
        "events": [
            {
                **row_to_event(event),
                "review_note": event["review_note"],
                "reviewed_at": event["reviewed_at"],
                "review_history": review_history.get(event["id"], []),
            }
            for event in events
        ],
    }


@app.put("/api/reviewer/events/{event_id}/review")
def review_event(
    event_id: str,
    payload: ReviewPayload,
    reviewer: str = Depends(require_reviewer),
) -> dict[str, Any]:
    reviewed_at = utc_now()
    with database(write=True) as connection:
        event = connection.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        connection.execute(
            """INSERT INTO event_reviews (event_id, disposition, note, reviewer_email, reviewed_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(event_id) DO UPDATE SET
                 disposition = excluded.disposition, note = excluded.note,
                 reviewer_email = excluded.reviewer_email, reviewed_at = excluded.reviewed_at""",
            (event_id, payload.disposition, payload.note, reviewer, reviewed_at),
        )
        connection.execute(
            """INSERT INTO review_audit
               (id, event_id, disposition, note, reviewer_email, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), event_id, payload.disposition, payload.note, reviewer, reviewed_at),
        )
    return {
        "status": "ok",
        "event_id": event_id,
        "disposition": payload.disposition,
        "reviewed_at": reviewed_at,
    }


@app.get("/api/reviewer/events/{event_id}/audit")
def get_event_audit(
    event_id: str, reviewer: str = Depends(require_reviewer)
) -> dict[str, Any]:
    del reviewer
    with database() as connection:
        exists = connection.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Event not found")
        rows = connection.execute(
            "SELECT * FROM review_audit WHERE event_id = ? ORDER BY created_at",
            (event_id,),
        ).fetchall()
    return {"event_id": event_id, "audit": [dict(row) for row in rows]}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def calculate_duration(started_at: str | None, ended_at: str | None) -> float:
    if not started_at or not ended_at:
        return 0.0
    start = datetime.fromisoformat(started_at)
    end = datetime.fromisoformat(ended_at)
    return max((end - start).total_seconds(), 0.0)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=bool(os.getenv("APP_ENV") == "development"),
    )
