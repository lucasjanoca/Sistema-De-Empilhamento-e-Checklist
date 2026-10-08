"""Adaptador HTTP JSON fechado por padrão para a integração corporativa homologada."""

import time
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from .config import settings
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
