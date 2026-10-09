"""Fixtures somente em PostgreSQL de teste explicitamente configurado."""

import secrets
from uuid import uuid4
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from app.main import app
from app.db import engine
from app import schema as t
from app.security import password_hash
from app.config import settings


@pytest.fixture(autouse=True)
def test_only():
    assert settings().environment == "test", "Testes exigem ENVIRONMENT=test."
    assert "test" in engine().url.database, "Use banco isolado de teste."
    with engine().begin() as c:
        c.execute(t.rate_limits.delete())


class Client:
    def __init__(self, role):
        self.client = TestClient(app, base_url=settings().public_origin)
        self.name = "test-" + uuid4().hex[:15]
        self.password = secrets.token_urlsafe(20)
        with engine().begin() as c:
            self.uid = c.scalar(
                t.users.insert()
                .values(matricula=self.name, nome=self.name, password_hash=password_hash(self.password))
                .returning(t.users.c.id)
            )
            rid = c.scalar(sa.select(t.roles.c.id).where(t.roles.c.name == role))
            c.execute(t.user_roles.insert().values(user_id=self.uid, role_id=rid))
        self.headers = {"Origin": settings().public_origin}
        result = self.client.post(
            "/api/site-selene/auth/login", json={"matricula": self.name, "senha": self.password}, headers=self.headers
        )
        assert result.status_code == 200, result.text
        self.headers["X-CSRF-Token"] = result.json()["csrfToken"]

    def get(self, path):
        return self.client.get("/api/site-selene" + path)

    def send(self, path, body=None, method="POST", key=None, headers=None):
        return self.client.request(
            method,
            "/api/site-selene" + path,
            json=body or {},
            headers={**self.headers, "Idempotency-Key": key or str(uuid4()), **(headers or {})},
        )

    def ok(self, path, body=None, method="POST"):
        r = self.send(path, body, method)
        assert r.status_code == 200, r.text
        return r.json()

    def device(self, kind="TABLET"):
        with engine().begin() as c:
            did = c.scalar(t.devices.insert().values(name="test-device-" + uuid4().hex, type=kind).returning(t.devices.c.id))
        self.ok("/devices/select", {"device_id": did})
        return did

    def pallet(self, pic=False):
        return self.ok("/pallets", {"address": "A-" + uuid4().hex[:12], "operator": self.name, "area": "EXP-PIC" if pic else "NORMAL"})[
            "id"
        ]

    def command(self, pid, action, **kw):
        with engine().connect() as c:
            version = c.scalar(sa.select(t.pallet_requests.c.version).where(t.pallet_requests.c.id == pid))
        return self.send(f"/pallets/{pid}/{action}", {"version": version, **kw})


@pytest.fixture
def clients():
    created = []

    def make(role="ti"):
        client = Client(role)
        created.append(client)
        return client

    yield make
    for client in created:
        client.client.close()
