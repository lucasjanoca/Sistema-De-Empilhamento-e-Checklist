from types import SimpleNamespace
import json

import httpx
import pytest
from fastapi import HTTPException
from pydantic import SecretStr

from app import integration


def runtime(mode="bearer"):
    return SimpleNamespace(
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
