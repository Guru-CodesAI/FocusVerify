import json
import os
import sqlite3
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest
import psycopg
from psycopg import sql
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import config
from backend.app import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATABASE_URL", f"sqlite:///{tmp_path / 'focusverify-test.db'}")
    main.initialize_database()


def create_candidate_session() -> tuple[str, dict[str, str]]:
    response = client.post("/api/sessions", json={})
    assert response.status_code == 200
    created = response.json()
    headers = {"Authorization": f"Bearer {created['candidate_access_token']}"}
    return created["id"], headers


def start_candidate_session(session_id: str, headers: dict[str, str]) -> None:
    response = client.post(f"/api/sessions/{session_id}/start", headers=headers)
    assert response.status_code == 200


def post_browser_event(
    session_id: str,
    headers: dict[str, str],
    event_type: str,
    **payload_overrides,
):
    observed_state = {
        "CAMERA_INTERRUPTION": "ended",
        "VIDEO_STREAM_DEGRADED": "muted",
        "WINDOW_FOCUS_LOST": "unfocused",
        "WINDOW_FOCUS_RESTORED": "focused",
        "PAGE_VISIBILITY_CHANGED": "hidden",
        "FULLSCREEN_EXITED": "exited",
    }.get(event_type, "unfocused")
    payload = {
        "event_type": event_type,
        "client_event_id": str(uuid.uuid4()),
        "signal_quality": 1,
        "observed_state": observed_state,
        "evidence": ["Browser event observed"],
    }
    payload.update(payload_overrides)
    return client.post(f"/api/sessions/{session_id}/events", headers=headers, json=payload)


def reviewer_headers() -> dict[str, str]:
    login = client.post(
        "/api/auth/login",
        json={"email": main.REVIEWER_EMAIL, "password": main.REVIEWER_PASSWORD},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_health_check_verifies_database_readiness():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"

    main.DATABASE_URL = "postgresql://unsupported"
    unavailable = client.get("/api/health")
    assert unavailable.status_code == 503


def test_production_api_responses_enable_hsts(monkeypatch):
    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setattr(main, "AUTH_SECRET", "test-production-signing-key-that-is-long-enough")
    monkeypatch.setattr(main, "REVIEWER_EMAIL", "reviewer@focusverify.example")
    monkeypatch.setattr(main, "REVIEWER_PASSWORD", "test-production-reviewer-password")
    monkeypatch.setattr(main, "WEB_ORIGIN", "https://focusverify.example")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000"


def test_health_check_fails_when_production_auth_configuration_is_unsafe(monkeypatch):
    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setattr(main, "AUTH_SECRET", "change-me-in-production")
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["detail"] == "Authentication configuration is not ready"


def test_session_lifecycle_is_candidate_scoped_and_retry_safe():
    session_id, headers = create_candidate_session()
    assert client.post(f"/api/sessions/{session_id}/start").status_code == 401
    start_candidate_session(session_id, headers)

    event_payload = {
        "event_type": "CAMERA_INTERRUPTION",
        "client_event_id": str(uuid.uuid4()),
        "signal_quality": 0,
        "observed_state": "ended",
        "evidence": ["Camera video track ended in the browser."],
    }
    event_url = f"/api/sessions/{session_id}/events"
    event = client.post(event_url, headers=headers, json=event_payload)
    assert event.status_code == 200
    assert event.json()["event"]["severity"] == "REVIEW"
    assert "confidence" not in event.json()["event"]

    retry = client.post(event_url, headers=headers, json=event_payload)
    assert retry.status_code == 200
    assert retry.json()["duplicate"] is True
    assert retry.json()["event"]["id"] == event.json()["event"]["id"]

    report = client.get(f"/api/sessions/{session_id}/report", headers=headers)
    assert report.status_code == 200
    assert report.json()["review_events"] == 1
    assert len(report.json()["events"]) == 1
    assert "confidence" not in report.json()["events"][0]
    assert report.json()["events"][0]["metadata_json"]["evidence"] == event_payload["evidence"]
    assert report.json()["signal_quality_average"] == pytest.approx(0)

    ended = client.post(f"/api/sessions/{session_id}/end", headers=headers)
    assert ended.status_code == 200
    assert client.get(f"/api/sessions/{session_id}", headers=headers).json()["status"] == "completed"
    assert post_browser_event(session_id, headers, "WINDOW_FOCUS_LOST").status_code == 409


def test_candidate_token_cannot_read_or_write_another_session():
    first_id, first_headers = create_candidate_session()
    second_id, _ = create_candidate_session()
    start_candidate_session(first_id, first_headers)

    assert client.get(f"/api/sessions/{second_id}", headers=first_headers).status_code == 403
    assert client.get(f"/api/sessions/{second_id}/report", headers=first_headers).status_code == 403
    assert client.post(f"/api/sessions/{second_id}/start", headers=first_headers).status_code == 403
    assert post_browser_event(second_id, first_headers, "WINDOW_FOCUS_LOST").status_code == 403

    reviewer = reviewer_headers()
    assert client.get(f"/api/sessions/{first_id}/report", headers=reviewer).status_code == 403


def test_client_idempotency_keys_are_scoped_to_each_session():
    first_id, first_headers = create_candidate_session()
    second_id, second_headers = create_candidate_session()
    start_candidate_session(first_id, first_headers)
    start_candidate_session(second_id, second_headers)
    client_event_id = str(uuid.uuid4())

    first = post_browser_event(
        first_id,
        first_headers,
        "WINDOW_FOCUS_LOST",
        client_event_id=client_event_id,
    ).json()["event"]
    second = post_browser_event(
        second_id,
        second_headers,
        "WINDOW_FOCUS_LOST",
        client_event_id=client_event_id,
    ).json()["event"]

    assert first["client_event_id"] == second["client_event_id"] == client_event_id
    assert first["id"] != second["id"]


def test_browser_signals_are_correlated_only_inside_five_second_window(monkeypatch):
    session_id, headers = create_candidate_session()
    start_candidate_session(session_id, headers)
    timestamps = iter(
        [
            "2026-10-04T10:00:00+00:00",
            "2026-10-04T10:00:04+00:00",
            "2026-10-04T10:00:05+00:00",
            "2026-10-04T10:00:10.001+00:00",
        ]
    )
    monkeypatch.setattr(main, "utc_now", lambda: next(timestamps))

    focus = post_browser_event(session_id, headers, "WINDOW_FOCUS_LOST").json()["event"]
    hidden = post_browser_event(session_id, headers, "PAGE_VISIBILITY_CHANGED").json()["event"]
    restored = post_browser_event(session_id, headers, "WINDOW_FOCUS_RESTORED").json()["event"]
    fullscreen = post_browser_event(session_id, headers, "FULLSCREEN_EXITED").json()["event"]
    assert focus["correlation_id"] == hidden["correlation_id"]
    assert restored["correlation_id"] == focus["correlation_id"]
    assert fullscreen["correlation_id"] != focus["correlation_id"]


def test_correlated_events_cannot_extend_an_incident_beyond_five_seconds(monkeypatch):
    session_id, headers = create_candidate_session()
    start_candidate_session(session_id, headers)
    timestamps = iter(
        [
            "2026-10-04T10:00:00+00:00",
            "2026-10-04T10:00:04+00:00",
            "2026-10-04T10:00:08+00:00",
            "2026-10-04T10:00:12+00:00",
        ]
    )
    monkeypatch.setattr(main, "utc_now", lambda: next(timestamps))

    focus = post_browser_event(session_id, headers, "WINDOW_FOCUS_LOST").json()["event"]
    hidden = post_browser_event(session_id, headers, "PAGE_VISIBILITY_CHANGED").json()["event"]
    fullscreen = post_browser_event(session_id, headers, "FULLSCREEN_EXITED").json()["event"]
    camera = post_browser_event(session_id, headers, "CAMERA_INTERRUPTION").json()["event"]

    assert hidden["correlation_id"] == focus["correlation_id"]
    assert fullscreen["correlation_id"] != focus["correlation_id"]
    assert camera["correlation_id"] != fullscreen["correlation_id"]


def test_postgres_urls_enable_ssl_and_qmark_placeholders_are_adapted():
    normalized = main.normalize_postgres_url(
        "postgres://focusverify:secret@db.example/focusverify"
    )
    assert normalized.startswith("postgresql://")
    assert "sslmode=require" in normalized
    weakened_ssl = main.normalize_postgres_url(
        "postgresql://focusverify:secret@db.example/focusverify?sslmode=disable"
    )
    assert "sslmode=require" in weakened_ssl
    verified_ssl = main.normalize_postgres_url(
        "postgresql://focusverify:secret@db.example/focusverify?sslmode=verify-full"
    )
    assert "sslmode=verify-full" in verified_ssl

    class DriverConnection:
        statement = ""
        parameters = ()

        def execute(self, statement, parameters):
            self.statement = statement
            self.parameters = parameters

    driver = DriverConnection()
    connection = main.PostgresConnection(driver)
    connection.execute("SELECT * FROM sessions WHERE id = ?", ("session-id",))
    assert driver.statement == "SELECT * FROM sessions WHERE id = %s"
    assert driver.parameters == ("session-id",)


def test_postgres_schema_initializes_with_migrations_and_append_only_guards(monkeypatch):
    statements = []

    class DriverConnection:
        def execute(self, statement, parameters=()):
            statements.append(statement)
            return self

        def commit(self):
            pass

        def rollback(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(main, "APP_ENV", "development")
    monkeypatch.setattr(main, "DATABASE_URL", "postgresql://user:pass@localhost/focusverify")
    monkeypatch.setattr(
        main.psycopg,
        "connect",
        lambda *args, **kwargs: DriverConnection(),
    )

    main.initialize_database()

    joined_statements = "\n".join(statements)
    assert "CREATE TABLE IF NOT EXISTS events" in joined_statements
    assert "BIGSERIAL PRIMARY KEY" in joined_statements
    assert "ADD COLUMN IF NOT EXISTS client_event_id" in joined_statements
    assert "prevent_review_audit_mutation" in joined_statements
    assert "AUTOINCREMENT" not in joined_statements


@pytest.mark.skipif(
    not os.getenv("FOCUSVERIFY_TEST_POSTGRES_URL"),
    reason="Set FOCUSVERIFY_TEST_POSTGRES_URL to run isolated PostgreSQL integration coverage.",
)
def test_postgres_session_and_review_lifecycle(monkeypatch):
    database_url = os.environ["FOCUSVERIFY_TEST_POSTGRES_URL"]
    schema_name = f"focusverify_test_{uuid.uuid4().hex}"
    normalized_url = main.normalize_postgres_url(database_url)
    parsed_url = urlsplit(normalized_url)
    query = dict(parse_qsl(parsed_url.query, keep_blank_values=True))

    with psycopg.connect(normalized_url, connect_timeout=10) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))

    try:
        query["options"] = f"-csearch_path={schema_name}"
        isolated_url = urlunsplit(parsed_url._replace(query=urlencode(query)))
        monkeypatch.setattr(main, "DATABASE_URL", isolated_url)
        main.initialize_database()

        session_id, candidate_headers = create_candidate_session()
        start_candidate_session(session_id, candidate_headers)
        event_response = post_browser_event(
            session_id,
            candidate_headers,
            "CAMERA_INTERRUPTION",
        )
        assert event_response.status_code == 200
        stored_event = event_response.json()["event"]
        event_id = stored_event["id"]
        duplicate_response = post_browser_event(
            session_id,
            candidate_headers,
            "CAMERA_INTERRUPTION",
            client_event_id=stored_event["client_event_id"],
        )
        assert duplicate_response.status_code == 200
        assert duplicate_response.json()["duplicate"] is True
        assert duplicate_response.json()["event"]["id"] == event_id

        reviewer = reviewer_headers()
        reviewed = client.put(
            f"/api/reviewer/events/{event_id}/review",
            headers=reviewer,
            json={"disposition": "confirmed", "note": "PostgreSQL integration check"},
        )
        assert reviewed.status_code == 200
        detail = client.get(
            f"/api/reviewer/sessions/{session_id}",
            headers=reviewer,
        )
        assert detail.status_code == 200
        event = detail.json()["events"][0]
        assert event["review"] == "confirmed"
        assert event["review_history"][0]["note"] == "PostgreSQL integration check"
        with main.database(write=True) as connection:
            with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
                connection.execute(
                    "DELETE FROM review_audit WHERE event_id = ?",
                    (event_id,),
                )
    finally:
        with psycopg.connect(normalized_url, connect_timeout=10, autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema_name))
            )


def test_production_requires_durable_postgres_persistence(monkeypatch):
    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setattr(main, "DATABASE_URL", "sqlite:///./focusverify.db")
    with pytest.raises(RuntimeError, match="require PostgreSQL"):
        main.validate_database_configuration()


def test_reviewer_login_throttle_role_checks_and_append_only_audit(monkeypatch):
    session_id, candidate = create_candidate_session()
    start_candidate_session(session_id, candidate)
    event = post_browser_event(session_id, candidate, "CAMERA_INTERRUPTION").json()["event"]

    assert client.get("/api/reviewer/sessions").status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"email": main.REVIEWER_EMAIL, "password": "incorrect"},
    ).status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"email": "réviewer@example.local", "password": "incorrect"},
    ).status_code == 401
    assert client.get("/api/reviewer/sessions", headers=candidate).status_code == 403
    reviewer = reviewer_headers()

    sessions = client.get("/api/reviewer/sessions", headers=reviewer).json()["sessions"]
    assert any(item["id"] == session_id for item in sessions)

    for disposition, note in [
        ("confirmed", "Browser state checked"),
        ("dismissed", "Not relevant to assessment"),
    ]:
        reviewed = client.put(
            f"/api/reviewer/events/{event['id']}/review",
            headers=reviewer,
            json={"disposition": disposition, "note": note},
        )
        assert reviewed.status_code == 200

    audit = client.get(f"/api/reviewer/events/{event['id']}/audit", headers=reviewer)
    assert [item["disposition"] for item in audit.json()["audit"]] == ["confirmed", "dismissed"]
    detail = client.get(f"/api/reviewer/sessions/{session_id}", headers=reviewer).json()
    reviewed_event = next(item for item in detail["events"] if item["id"] == event["id"])
    assert [item["disposition"] for item in reviewed_event["review_history"]] == [
        "confirmed",
        "dismissed",
    ]

    with main.database(write=True) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM review_audit WHERE event_id = ?", (event["id"],))

    monkeypatch.setattr(main, "AUTH_RATE_LIMIT", 2)
    for _ in range(2):
        assert client.post(
            "/api/auth/login",
            json={"email": main.REVIEWER_EMAIL, "password": "wrong"},
        ).status_code == 401
    limited = client.post(
        "/api/auth/login",
        json={"email": main.REVIEWER_EMAIL, "password": main.REVIEWER_PASSWORD},
    )
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "900"


def test_reviewer_password_rotation_invalidates_existing_tokens(monkeypatch):
    reviewer = reviewer_headers()
    assert client.get("/api/reviewer/sessions", headers=reviewer).status_code == 200

    monkeypatch.setattr(main, "REVIEWER_PASSWORD", "rotated-reviewer-password")

    assert client.get("/api/reviewer/sessions", headers=reviewer).status_code == 403
    refreshed_reviewer = reviewer_headers()
    assert client.get("/api/reviewer/sessions", headers=refreshed_reviewer).status_code == 200


def test_event_schema_rejects_inferred_signals_extra_fields_and_oversized_body():
    session_id, headers = create_candidate_session()
    start_candidate_session(session_id, headers)

    unsupported = post_browser_event(
        session_id,
        headers,
        "MULTIPLE_FACES",
    )
    assert unsupported.status_code == 422
    spoofed = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        severity="HIGH_REVIEW",
        confidence=1,
    )
    assert spoofed.status_code == 422
    raw_frame = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        frame_base64="A" * 100,
    )
    assert raw_frame.status_code == 422
    long_evidence = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        evidence=["x" * 241],
    )
    assert long_evidence.status_code == 422
    mismatched_state = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        observed_state="hidden",
    )
    assert mismatched_state.status_code == 422
    missing_evidence = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        evidence=[],
    )
    assert missing_evidence.status_code == 422

    too_large = client.post(
        f"/api/sessions/{session_id}/events",
        headers={**headers, "Content-Type": "application/json"},
        content=json.dumps({"padding": "x" * main.MAX_REQUEST_BYTES}),
    )
    assert too_large.status_code == 413


def test_bad_or_tampered_candidate_token_is_rejected():
    session_id, headers = create_candidate_session()
    token = headers["Authorization"].removeprefix("Bearer ")
    tampered = {"Authorization": f"Bearer {token[:-1]}x"}
    assert client.get(f"/api/sessions/{session_id}", headers=tampered).status_code == 401


def test_session_and_event_ingestion_limits(monkeypatch):
    monkeypatch.setattr(main, "SESSION_CREATE_LIMIT", 1)
    session_id, headers = create_candidate_session()
    assert client.post("/api/sessions", json={}).status_code == 429

    start_candidate_session(session_id, headers)
    monkeypatch.setattr(main, "EVENT_INGESTION_LIMIT", 1)
    client_event_id = str(uuid.uuid4())
    first = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        client_event_id=client_event_id,
    )
    assert first.status_code == 200
    duplicate = post_browser_event(
        session_id,
        headers,
        "WINDOW_FOCUS_LOST",
        client_event_id=client_event_id,
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    limited = post_browser_event(session_id, headers, "PAGE_VISIBILITY_CHANGED")
    assert limited.status_code == 429


def test_production_rejects_weak_authentication_configuration(monkeypatch):
    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setattr(main, "AUTH_SECRET", "sufficiently-long-test-secret-value")
    monkeypatch.setattr(main, "REVIEWER_PASSWORD", "short")
    response = client.post(
        "/api/auth/login",
        json={"email": main.REVIEWER_EMAIL, "password": "short"},
    )
    assert response.status_code == 503
    with pytest.raises(HTTPException) as auth_error:
        main.create_access_token("test-candidate", "candidate", "test-candidate")
    assert auth_error.value.status_code == 503


@pytest.mark.parametrize(
    "web_origin",
    [
        "https://reviewer:secret@focusverify.example",
        "https://focusverify.example/path",
        "https://focusverify.example?unexpected=1",
        "https://focusverify.example#fragment",
        "https://focusverify.example:invalid",
    ],
)
def test_production_rejects_malformed_web_origin(monkeypatch, web_origin):
    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setattr(main, "AUTH_SECRET", "sufficiently-long-test-secret-value")
    monkeypatch.setattr(main, "REVIEWER_EMAIL", "reviewer@focusverify.example")
    monkeypatch.setattr(main, "REVIEWER_PASSWORD", "sufficiently-long-test-password")
    monkeypatch.setattr(main, "WEB_ORIGIN", web_origin)

    with pytest.raises(HTTPException) as auth_error:
        main.validate_auth_configuration()

    assert auth_error.value.status_code == 503


def test_render_host_value_is_normalized_for_production_cors():
    assert (
        config.normalize_web_origin("focusverify-web.onrender.com", "production")
        == "https://focusverify-web.onrender.com"
    )
    assert (
        config.normalize_web_origin("https://custom.example", "production")
        == "https://custom.example"
    )
    assert (
        config.normalize_web_origin("localhost:3000", "development")
        == "localhost:3000"
    )


def test_database_migrates_existing_event_table_columns(tmp_path, monkeypatch):
    path = tmp_path / "legacy-focusverify.db"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
                started_at TEXT, ended_at TEXT, signal_quality_average REAL NOT NULL DEFAULT 0,
                duration REAL NOT NULL DEFAULT 0, candidate_id TEXT, assessment_id TEXT
            );
            CREATE TABLE events (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL, severity TEXT NOT NULL, confidence REAL NOT NULL,
                signal_quality REAL NOT NULL, duration_seconds REAL NOT NULL,
                metadata_json TEXT NOT NULL, model_version TEXT NOT NULL,
                algorithm_version TEXT NOT NULL, correlation_id TEXT NOT NULL
            );
            """
        )
    monkeypatch.setattr(main, "DATABASE_URL", f"sqlite:///{path}")
    main.initialize_database()

    with main.database() as connection:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(events)")}
        index_names = {
            row["name"] for row in connection.execute("PRAGMA index_list(events)")
        }
    assert {"client_event_id", "correlated_event_id"} <= columns
    assert "events_client_event_id" in index_names
