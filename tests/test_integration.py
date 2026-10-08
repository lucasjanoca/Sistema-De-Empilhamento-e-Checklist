from types import SimpleNamespace
from datetime import timedelta
import json

import httpx
import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy.dialects.postgresql import insert

from app import integration, operations, schema as t
from app.db import engine, now


def runtime(mode="bearer"):
    return SimpleNamespace(
        integration_adapter="http-json-v1",
        integration_allowed_hosts="selene.example.internal",
        integration_auth_mode=mode,
        integration_bearer_token=SecretStr("server-only-token"),
        integration_api_key_name="X-Internal-Key",
        integration_api_key_secret=SecretStr("server-only-key"),
        integration_basic_username="service-user",
        integration_basic_password=SecretStr("server-only-password"),
    )


def config(**changes):
    value = {
        "serverBase": "https://selene.example.internal",
        "routePending": "/api/pending",
        "routeAttendance": "/api/attendance",
        "routeMovement": "/api/movements",
        "routeHealth": "/health",
        "codGrupo": "G1",
        "codEmp": "E1",
        "enabled": True,
        "timeoutSeconds": 3,
        "retries": 2,
    }
    value.update(changes)
    return value


def make_adapter(monkeypatch, handler, **changes):
    cfg = runtime()
    monkeypatch.setattr(integration, "settings", lambda: cfg)
    client = httpx.Client(transport=httpx.MockTransport(handler), headers={"Authorization": "Bearer server-only-token"})
    return integration.HttpJsonAdapter(config(**changes), client=client, runtime=cfg, sleeper=lambda _: None)


def test_adapter_reads_and_confirms_with_server_credentials(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer server-only-token"
        assert request.headers["x-cod-grupo"] == "G1"
        return httpx.Response(200, json={"ok": True})

    adapter = make_adapter(monkeypatch, handler)
    result = adapter.fetch_pallets()
    written = adapter.confirm_movement("PAL-10", "lower", "movement-key-1")

    assert result == {"pending": {"ok": True}, "attendance": {"ok": True}}
    assert written == {"ok": True}
    assert requests[-1].headers["idempotency-key"] == "movement-key-1"
    assert json.loads(requests[-1].content) == {
        "externalId": "PAL-10",
        "action": "lower",
        "codGrupo": "G1",
        "codEmp": "E1",
    }


def test_adapter_retries_transient_upstream_failure(monkeypatch):
    attempts = 0

    def handler(request):
        nonlocal attempts
        attempts += 1
        return httpx.Response(503 if attempts < 3 else 200, json={"ok": attempts == 3})

    adapter = make_adapter(monkeypatch, handler)
    assert adapter.health() == {"ok": True}
    assert attempts == 3


def test_adapter_reports_timeout_without_leaking_destination(monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("secret upstream details", request=request)

    adapter = make_adapter(monkeypatch, handler, retries=0)
    with pytest.raises(HTTPException) as error:
        adapter.health()
    assert error.value.status_code == 504
    assert "secret" not in error.value.detail
    assert "selene.example" not in error.value.detail


@pytest.mark.parametrize("route", ["https://evil.example/x", "//evil.example/x", "/../admin"])
def test_adapter_rejects_absolute_or_traversal_routes(monkeypatch, route):
    cfg = runtime()
    monkeypatch.setattr(integration, "settings", lambda: cfg)
    with pytest.raises(HTTPException) as error:
        integration.validate_config(config(routePending=route))
    assert error.value.status_code == 422


def store_config(value):
    with engine().begin() as conn:
        conn.execute(
            insert(t.integration_settings)
            .values(key="config", value=value)
            .on_conflict_do_update(index_elements=["key"], set_={"value": value})
        )


def external_due_pallet(client):
    client.device()
    client.ok("/production/start")
    pid = client.pallet()
    client.ok(f"/pallets/{pid}/authorize-lower", {"version": 1, "reason": "Integração homologada"})
    with engine().begin() as conn:
        conn.execute(t.pallet_requests.update().where(t.pallet_requests.c.id == pid).values(external_ref=f"SEL-{pid}"))
    response = client.command(pid, "lower")
    assert response.status_code == 200, response.text
    with engine().begin() as conn:
        conn.execute(
            t.pallet_movements.update()
            .where(t.pallet_movements.c.pallet_request_id == pid, t.pallet_movements.c.status == "PENDING")
            .values(confirm_at=now(conn) - timedelta(seconds=1))
        )
        operations.settle(conn, pid)
    return pid


def outbox_record(pid):
    with engine().connect() as conn:
        return conn.execute(
            sa.select(t.integration_outbox)
            .join(t.pallet_movements, t.pallet_movements.c.id == t.integration_outbox.c.movement_id)
            .where(t.pallet_movements.c.pallet_request_id == pid)
        ).mappings().one()


def test_external_movement_is_confirmed_only_after_upstream_ack(monkeypatch, clients):
    monkeypatch.setattr(integration, "settings", runtime)
    store_config(config(retries=0))
    client = clients()
    pid = external_due_pallet(client)

    with engine().connect() as conn:
        pallet = conn.execute(sa.select(t.pallet_requests).where(t.pallet_requests.c.id == pid)).mappings().one()
        movement = conn.execute(
            sa.select(t.pallet_movements).where(t.pallet_movements.c.pallet_request_id == pid)
        ).mappings().one()
    assert pallet["state"] == "LOWERING"
    assert movement["status"] == "EXTERNAL_PENDING"
    assert outbox_record(pid)["status"] == "PENDING"
    visible = next(item for item in client.get("/state").json()["data"]["requests"] if item["id"] == pid)
    assert visible["integrationDeliveryStatus"] == "pending"

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(204)

    upstream = httpx.Client(transport=httpx.MockTransport(handler))
    assert integration.drain_outbox_once(client=upstream) == "confirmed"
    assert calls[0].headers["idempotency-key"] == outbox_record(pid)["idempotency_key"]
    with engine().connect() as conn:
        assert conn.scalar(sa.select(t.pallet_requests.c.state).where(t.pallet_requests.c.id == pid)) == "FLOOR"
        assert conn.scalar(
            sa.select(t.pallet_movements.c.status).where(t.pallet_movements.c.pallet_request_id == pid)
        ) == "CONFIRMED"
    assert outbox_record(pid)["status"] == "CONFIRMED"


def test_external_failure_stays_pending_and_retries_idempotently(monkeypatch, clients):
    monkeypatch.setattr(integration, "settings", runtime)
    store_config(config(retries=0))
    client = clients()
    pid = external_due_pallet(client)
    keys = []

    def unavailable(request):
        keys.append(request.headers["idempotency-key"])
        return httpx.Response(503, json={"ok": False})

    first = httpx.Client(transport=httpx.MockTransport(unavailable))
    assert integration.drain_outbox_once(client=first) == "failed"
    failed = outbox_record(pid)
    assert failed["status"] == "FAILED"
    with engine().connect() as conn:
        assert conn.scalar(sa.select(t.pallet_requests.c.state).where(t.pallet_requests.c.id == pid)) == "LOWERING"

    with engine().begin() as conn:
        conn.execute(
            t.integration_outbox.update()
            .where(t.integration_outbox.c.id == failed["id"])
            .values(next_attempt_at=now(conn) - timedelta(seconds=1))
        )

    def accepted(request):
        keys.append(request.headers["idempotency-key"])
        return httpx.Response(200, json={"ok": True})

    second = httpx.Client(transport=httpx.MockTransport(accepted))
    assert integration.drain_outbox_once(client=second) == "confirmed"
    assert keys == [failed["idempotency_key"], failed["idempotency_key"]]
    assert outbox_record(pid)["attempts"] == 2


def test_external_command_is_blocked_without_homologated_adapter(monkeypatch, clients):
    disabled = runtime()
    disabled.integration_adapter = ""
    monkeypatch.setattr(integration, "settings", lambda: disabled)
    store_config(config(enabled=False))
    client = clients()
    client.device()
    client.ok("/production/start")
    pid = client.pallet()
    client.ok(f"/pallets/{pid}/authorize-lower", {"version": 1, "reason": "Conferido"})
    with engine().begin() as conn:
        conn.execute(t.pallet_requests.update().where(t.pallet_requests.c.id == pid).values(external_ref=f"SEL-{pid}"))
    response = client.command(pid, "lower")
    assert response.status_code == 503
    assert "TI homologar" in response.json()["message"]
