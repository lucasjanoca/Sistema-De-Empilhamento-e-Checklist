from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.exc import DBAPIError
from app.main import app
from app.config import settings
from app.db import engine, now
from app import schema as t
from app.security import digest


def test_auth_csrf_origin_cookie_and_no_secrets(clients):
    a = clients()
    r = a.get("/auth/me")
    assert r.status_code == 200
    assert not {"password_hash", "token_hash", "senha"} & r.json()["user"].keys()
    assert a.send("/production/start", headers={"X-CSRF-Token": ""}).status_code == 403
    assert a.send("/production/start", headers={"Origin": "https://evil.invalid"}).status_code == 403
    cookie = a.client.cookies.get(settings().cookie_name)
    with engine().connect() as c:
        assert c.scalar(sa.select(t.sessions.c.token_hash).where(t.sessions.c.token_hash == cookie)) is None
        assert c.scalar(sa.select(t.sessions.c.token_hash).where(t.sessions.c.token_hash == digest(cookie)))
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    a.ok("/auth/logout")
    assert a.get("/state").status_code == 401


@pytest.mark.parametrize("path", ["/users", "/audit-secure", "/security/status", "/roles", "/integration/config", "/reports/audit.csv"])
def test_emp_denied_critical_reads(clients, path):
    assert clients("empilhador").get(path).status_code == 403


def test_static_private_paths_and_snapshots_unavailable():
    with TestClient(app, base_url=settings().public_origin) as c:
        for path in ["/app/config.py", "/.env", "/.git/config", "/requirements.lock", "/private/users.json", "/api/site-selene/snapshot"]:
            assert c.get(path).status_code in (404, 401), path


def test_idle_not_kept_alive_by_read_or_heartbeat(clients):
    a = clients()
    a.device()
    with engine().begin() as c:
        c.execute(
            t.sessions.update()
            .where(t.sessions.c.user_id == a.uid)
            .values(last_seen=now(c) - timedelta(seconds=settings().idle_seconds + 1))
        )
    assert a.get("/state").status_code == 401
    assert a.send("/devices/heartbeat").status_code == 401


def test_block_revokes_sessions_and_codes(clients):
    admin = clients()
    emp = clients("empilhador")
    code = emp.ok("/codes")["code"]
    admin.ok("/users/" + emp.name, {"action": "active", "active": False}, "PATCH")
    assert emp.get("/state").status_code == 401
    with TestClient(app, base_url=settings().public_origin) as other:
        assert (
            other.post("/api/site-selene/codes/redeem", json={"code": code}, headers={"Origin": settings().public_origin}).status_code
            == 401
        )


def test_codes_single_use_concurrent_and_no_plaintext(clients):
    a = clients("empilhador")
    result = a.ok("/codes")
    code = result["code"]
    assert len(code) == 6

    def redeem(_):
        with TestClient(app, base_url=settings().public_origin) as c:
            return c.post("/api/site-selene/codes/redeem", json={"code": code}, headers={"Origin": settings().public_origin}).status_code

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(redeem, range(2))) == [200, 401]
    with engine().connect() as c:
        row = c.execute(sa.select(t.access_codes).where(t.access_codes.c.id == result["id"])).mappings().one()
        assert row["code_hash"] != code and row["used_at"] is not None
        assert code not in str(list(c.execute(sa.select(t.audit_log.c.details).where(t.audit_log.c.user_id == a.uid))))


def test_expired_code_rate_limit(clients):
    a = clients()
    r = a.ok("/codes")
    with engine().begin() as c:
        c.execute(t.access_codes.update().where(t.access_codes.c.id == r["id"]).values(expires_at=now(c) - timedelta(seconds=1)))
    with TestClient(app, base_url=settings().public_origin) as client:
        statuses = [
            client.post("/api/site-selene/codes/redeem", json={"code": r["code"]}, headers={"Origin": settings().public_origin}).status_code
            for _ in range(6)
        ]
    assert statuses == [401] * 5 + [429]


def test_permission_change_revokes_session(clients):
    a = clients()
    b = clients("empilhador")
    a.ok("/users/" + b.name, {"action": "role", "role": "encarregado"}, "PATCH")
    assert b.get("/auth/me").status_code == 401


def test_append_only_database_and_runtime_not_superuser(clients):
    clients()
    with engine().connect() as c:
        assert c.scalar(sa.text("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")) is False
    for table in [t.audit_log, t.operational_history, t.checklist_records]:
        with pytest.raises(DBAPIError):
            with engine().begin() as c:
                c.execute(table.delete())


def test_idempotency_exact_and_conflicting_payload(clients):
    a = clients()
    key = str(uuid4())
    body = {"address": "A-" + uuid4().hex, "operator": a.name}
    r = a.send("/pallets", body, key=key)
    assert r.status_code == 200
    assert a.send("/pallets", body, key=key).json() == r.json()
    assert a.send("/pallets", {**body, "operator": "changed"}, key=key).status_code == 409


def test_checklist_code_scope_cannot_change_ti(clients):
    a = clients()
    code = a.ok("/codes")["code"]
    with TestClient(app, base_url=settings().public_origin) as c:
        r = c.post("/api/site-selene/codes/redeem", json={"code": code}, headers={"Origin": settings().public_origin})
        assert r.status_code == 200
        r = c.patch(
            "/api/site-selene/users/" + a.name,
            json={"action": "password", "senha": "Long-new-test-secret"},
            headers={"Origin": settings().public_origin, "X-CSRF-Token": r.json()["csrfToken"], "Idempotency-Key": str(uuid4())},
        )
        assert r.status_code == 403


def test_login_failures_session_restore_and_logout(clients):
    user = clients("empilhador")
    with TestClient(app, base_url=settings().public_origin) as browser:
        headers = {"Origin": settings().public_origin}
        assert browser.post(
            "/api/site-selene/auth/login", json={"matricula": user.name, "senha": "senha-incorreta"}, headers=headers
        ).status_code == 401
        assert browser.post(
            "/api/site-selene/auth/login", json={"matricula": "usuario-inexistente", "senha": "senha-incorreta"}, headers=headers
        ).status_code == 401
        login = browser.post(
            "/api/site-selene/auth/login", json={"matricula": user.name, "senha": user.password}, headers=headers
        )
        assert login.status_code == 200
        csrf = login.json()["csrfToken"]
        assert browser.get("/api/site-selene/auth/me").status_code == 200
        assert (
            browser.post(
                "/api/site-selene/auth/logout",
                json={},
                headers={**headers, "X-CSRF-Token": csrf, "Idempotency-Key": str(uuid4())},
            ).status_code
            == 200
        )
        assert browser.get("/api/site-selene/auth/me").status_code == 401


def test_new_code_revokes_previous_and_rejects_incomplete(clients):
    user = clients("empilhador")
    first = user.ok("/codes")["code"]
    second = user.ok("/codes")["code"]
    with TestClient(app, base_url=settings().public_origin) as browser:
        headers = {"Origin": settings().public_origin}
        assert browser.post("/api/site-selene/codes/redeem", json={"code": "123"}, headers=headers).status_code == 422
        assert browser.post("/api/site-selene/codes/redeem", json={"code": first}, headers=headers).status_code == 401
        assert browser.post("/api/site-selene/codes/redeem", json={"code": second}, headers=headers).status_code == 200


def test_encarregado_cannot_administer_ti(clients):
    supervisor = clients("encarregado")
    assert supervisor.send(
        "/users",
        {"nome": "TI indevido", "matricula": "ti-" + uuid4().hex[:12], "senha": "Senha-temporaria-forte", "role": "ti"},
    ).status_code == 403
    assert supervisor.get("/integration/config").status_code == 403


def test_last_active_ti_cannot_be_disabled(clients):
    admin = clients("ti")
    with engine().begin() as conn:
        ti_ids = sa.select(t.user_roles.c.user_id).join(t.roles).where(t.roles.c.name == "ti")
        conn.execute(t.users.update().where(t.users.c.id.in_(ti_ids), t.users.c.id != admin.uid).values(active=False))
    admin.ok("/auth/reauth", {"senha": admin.password})
    assert admin.send("/users/" + admin.name, method="DELETE").status_code == 409
