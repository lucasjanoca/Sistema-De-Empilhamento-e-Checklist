"""Contrato interno para adaptador homologado. Não presume rotas da Selene."""

from typing import Protocol
from urllib.parse import urlsplit
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
    ):
        fail(422, "URL não autorizada. A TI deve configurar HTTPS e a allowlist de hosts no servidor.")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "169.254.169.254", "metadata.google.internal"}:
        fail(422, "Destino de integração não permitido.")


def require_adapter():
    fail(503, "INTEGRAÇÃO NÃO CONFIGURADA: contrato oficial e adaptador homologado necessários.")
