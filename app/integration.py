"""Adaptador HTTP JSON fechado por padrão para a integração corporativa homologada."""

from datetime import timedelta
import time
from typing import Protocol
from urllib.parse import urlsplit

import httpx
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert

from . import schema as t
from .config import settings
from .db import engine, now, one
from .security import fail


class SeleneIntegrationAdapter(Protocol):
    def fetch_pallets(self): ...
    def fetch_status(self, external_id: str): ...
    def fetch_authorization(self, external_id: str, action: str): ...
    def synchronize_requests(self): ...
    def confirm_movement(self, external_id: str, action: str, idempotency_key: str): ...
    def fetch_return_release(self, external_id: str): ...
    def detect_conflicts(self): ...
    def map_exp_pic(self, record: dict): ...


def validate_base(url):
    if not url:
        return
    parsed = urlsplit(url)
    allowed = {h.strip().lower() for h in settings().integration_allowed_hosts.split(",") if h.strip()}
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.hostname.lower() not in allowed
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.query
        or parsed.path not in ("", "/")
    ):
        fail(422, "URL não autorizada. A TI deve configurar HTTPS e a allowlist de hosts no servidor.")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1", "169.254.169.254", "metadata.google.internal"}:
        fail(422, "Destino de integração não permitido.")


def validate_route(route, required=False):
    if not route and not required:
        return
    parsed = urlsplit(route)
    if not route.startswith("/") or route.startswith("//") or parsed.scheme or parsed.netloc or parsed.fragment or ".." in parsed.path.split("/"):
        fail(422, "Rota de integração inválida.")


def validate_config(config):
    validate_base(config.get("serverBase", ""))
    for key in ("routePending", "routeAttendance", "routeMovement", "routeHealth"):
        validate_route(config.get(key, ""), required=key in ("routePending", "routeAttendance") and config.get("enabled", False))


class HttpJsonAdapter:
    def __init__(self, config, client=None, runtime=None, sleeper=time.sleep):
        self.config = config
        self.runtime = runtime or settings()
        validate_config(config)
        self.client = client or httpx.Client(
            timeout=float(config.get("timeoutSeconds", 8)),
            follow_redirects=False,
            headers=self._headers(),
        )
        self.sleeper = sleeper

    def _headers(self):
        headers = {"Accept": "application/json", "User-Agent": "site-selene-integration/1"}
        mode = self.runtime.integration_auth_mode
        if mode == "bearer":
            headers["Authorization"] = "Bearer " + self.runtime.integration_bearer_token.get_secret_value()
        elif mode == "api-key":
            headers[self.runtime.integration_api_key_name] = self.runtime.integration_api_key_secret.get_secret_value()
        return headers

    def _auth(self):
        if self.runtime.integration_auth_mode == "basic":
            return httpx.BasicAuth(self.runtime.integration_basic_username, self.runtime.integration_basic_password.get_secret_value())
        return None

    def _url(self, route):
        validate_route(route, required=True)
        return self.config["serverBase"].rstrip("/") + route

    def _request(self, method, route, *, params=None, json=None, idempotency_key=None):
        headers = {"X-Cod-Grupo": self.config.get("codGrupo", ""), "X-Cod-Emp": self.config.get("codEmp", "")}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        attempts = int(self.config.get("retries", 2)) + 1
        for attempt in range(attempts):
            try:
                response = self.client.request(method, self._url(route), params=params, json=json, headers=headers, auth=self._auth())
                if response.status_code >= 500 and attempt + 1 < attempts:
                    self.sleeper(0.2 * (2**attempt))
                    continue
                if response.status_code >= 400:
                    fail(502, f"Integração externa recusou a operação (HTTP {response.status_code}).")
                if response.status_code == 204 or not response.content:
                    return {}
                try:
                    return response.json()
                except ValueError:
                    fail(502, "Integração externa retornou JSON inválido.")
            except httpx.TimeoutException:
                if attempt + 1 == attempts:
                    fail(504, "Tempo limite excedido na integração externa.")
            except httpx.TransportError:
                if attempt + 1 == attempts:
                    fail(502, "Falha de comunicação com a integração externa.")
            self.sleeper(0.2 * (2**attempt))
        fail(502, "Falha de comunicação com a integração externa.")

    def fetch_pallets(self):
        return {
            "pending": self._request("GET", self.config["routePending"]),
            "attendance": self._request("GET", self.config["routeAttendance"]),
        }

    def fetch_status(self, external_id):
        return self._request("GET", self.config["routeAttendance"], params={"externalId": external_id})

    def fetch_authorization(self, external_id, action):
        return self._request("GET", self.config["routeAttendance"], params={"externalId": external_id, "action": action})

    def synchronize_requests(self):
        return self.fetch_pallets()

    def confirm_movement(self, external_id, action, idempotency_key):
        route = self.config.get("routeMovement", "")
        if not route:
            fail(503, "Rota oficial de escrita não homologada.")
        return self._request(
            "POST",
            route,
            json={"externalId": external_id, "action": action, "codGrupo": self.config.get("codGrupo"), "codEmp": self.config.get("codEmp")},
            idempotency_key=idempotency_key,
        )

    def fetch_return_release(self, external_id):
        return self.fetch_authorization(external_id, "raise")

    def detect_conflicts(self):
        return []

    def map_exp_pic(self, record):
        return bool(record.get("expPic") or record.get("area") == "EXP-PIC")

    def health(self):
        route = self.config.get("routeHealth")
        return self._request("GET", route) if route else self.fetch_pallets()


def require_adapter(config=None, client=None):
    runtime = settings()
    if runtime.integration_adapter != "http-json-v1" or not config or not config.get("enabled"):
        fail(503, "INTEGRAÇÃO NÃO CONFIGURADA: contrato oficial e adaptador homologado necessários.")
    validate_config(config)
    return HttpJsonAdapter(config, client=client, runtime=runtime)


def stored_config(conn):
    return conn.scalar(sa.select(t.integration_settings.c.value).where(t.integration_settings.c.key == "config")) or {}


def external_movement_ready(conn):
    config = stored_config(conn)
    runtime = settings()
    ready = bool(
        runtime.integration_adapter == "http-json-v1"
        and config.get("enabled")
        and config.get("serverBase")
        and config.get("routeMovement")
    )
    if ready:
        validate_config(config)
    return ready


def queue_external_movement(conn, pallet, movement, at):
    action = "lower" if movement["direction"] == "LOWER" else "raise"
    key = f"movement-{movement['id']}-{action}"
    payload = {
        "externalId": str(pallet["external_ref"]),
        "action": action,
        "movementId": movement["id"],
        "palletId": pallet["id"],
    }
    conn.execute(
        insert(t.integration_outbox)
        .values(
            movement_id=movement["id"],
            external_ref=str(pallet["external_ref"]),
            action=action,
            idempotency_key=key,
            payload=payload,
            status="PENDING",
            attempts=0,
            next_attempt_at=at,
            created_at=at,
        )
        .on_conflict_do_nothing(index_elements=["movement_id"])
    )
    conn.execute(
        t.pallet_movements.update()
        .where(t.pallet_movements.c.id == movement["id"], t.pallet_movements.c.status == "PENDING")
        .values(status="EXTERNAL_PENDING")
    )
    conn.execute(
        t.technical_events.insert().values(
            created_at=at,
            kind="INTEGRATION",
            details={"status": "QUEUED", "movement_id": movement["id"], "outbox_key": key},
        )
    )


def _claim_outbox():
    with engine().begin() as conn:
        at = now(conn)
        stale = at - timedelta(minutes=5)
        item = one(
            conn,
            sa.select(t.integration_outbox)
            .where(
                sa.or_(
                    sa.and_(
                        t.integration_outbox.c.status.in_(["PENDING", "FAILED"]),
                        t.integration_outbox.c.next_attempt_at <= at,
                    ),
                    sa.and_(
                        t.integration_outbox.c.status == "SENDING",
                        t.integration_outbox.c.locked_at < stale,
                    ),
                )
            )
            .order_by(t.integration_outbox.c.id)
            .with_for_update(skip_locked=True)
            .limit(1),
        )
        if not item:
            return None
        config = stored_config(conn)
        conn.execute(
            t.integration_outbox.update()
            .where(t.integration_outbox.c.id == item["id"])
            .values(status="SENDING", attempts=t.integration_outbox.c.attempts + 1, locked_at=at, last_error_code=None)
        )
        return dict(item), config


def _fail_outbox(item, code):
    with engine().begin() as conn:
        current = one(
            conn,
            sa.select(t.integration_outbox).where(t.integration_outbox.c.id == item["id"]).with_for_update(),
        )
        if not current or current["status"] == "CONFIRMED":
            return
        delay = min(2 ** min(int(current["attempts"]), 8), 300)
        conn.execute(
            t.integration_outbox.update()
            .where(t.integration_outbox.c.id == item["id"])
            .values(status="FAILED", next_attempt_at=now(conn) + timedelta(seconds=delay), locked_at=None, last_error_code=code)
        )
        conn.execute(
            t.technical_events.insert().values(
                created_at=now(conn),
                kind="INTEGRATION",
                details={"status": "FAILED", "movement_id": current["movement_id"], "error_code": code},
            )
        )


def _confirm_outbox(item):
    from .operations import finalize_movement

    with engine().begin() as conn:
        current = one(
            conn,
            sa.select(t.integration_outbox).where(t.integration_outbox.c.id == item["id"]).with_for_update(),
        )
        if not current or current["status"] == "CONFIRMED":
            return
        movement = one(
            conn,
            sa.select(t.pallet_movements).where(t.pallet_movements.c.id == current["movement_id"]).with_for_update(),
        )
        pallet = one(
            conn,
            sa.select(t.pallet_requests).where(t.pallet_requests.c.id == movement["pallet_request_id"]).with_for_update(),
        )
        if movement["status"] != "EXTERNAL_PENDING":
            raise RuntimeError("Movimento externo fora do estado esperado.")
        confirmed = now(conn)
        finalize_movement(conn, pallet, movement, confirmed)
        conn.execute(
            t.integration_outbox.update()
            .where(t.integration_outbox.c.id == current["id"])
            .values(status="CONFIRMED", confirmed_at=confirmed, locked_at=None, last_error_code=None)
        )
        conn.execute(
            t.technical_events.insert().values(
                created_at=confirmed,
                kind="INTEGRATION",
                details={"status": "CONFIRMED", "movement_id": movement["id"]},
            )
        )


def drain_outbox_once(client=None):
    claimed = _claim_outbox()
    if not claimed:
        return None
    item, config = claimed
    try:
        adapter = require_adapter(config, client=client)
        adapter.confirm_movement(item["external_ref"], item["action"], item["idempotency_key"])
    except HTTPException as exc:
        _fail_outbox(item, f"HTTP_{exc.status_code}")
        return "failed"
    except Exception:
        _fail_outbox(item, "UNEXPECTED")
        return "failed"
    _confirm_outbox(item)
    return "confirmed"
