from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")
    environment: Literal["development", "test", "staging", "production"] = "production"
    database_url: SecretStr
    session_secret: SecretStr
    public_origin: str
    secure_cookies: bool = True
    timezone: str = "America/Sao_Paulo"
    idle_seconds: int = 900
    absolute_seconds: int = 28800
    lease_seconds: int = 180
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: SecretStr = SecretStr("")
    oidc_mfa_acr: str = ""
    require_admin_mfa: bool = False
    integration_adapter: str = ""
    integration_allowed_hosts: str = ""
    backup_directory: str = ""
    backup_public_key: str = ""

    @model_validator(mode="after")
    def validate_runtime(self):
        if not self.database_url.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL deve usar PostgreSQL/psycopg.")
        if len(self.session_secret.get_secret_value()) < 32:
            raise ValueError("SESSION_SECRET deve conter pelo menos 32 caracteres aleatórios.")
        origin = urlsplit(self.public_origin)
        if not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
            raise ValueError("PUBLIC_ORIGIN inválido.")
        if self.environment in ("staging", "production"):
            if origin.scheme != "https" or not self.secure_cookies:
                raise ValueError("Ambiente operacional exige HTTPS e cookies Secure.")
        elif origin.scheme != "https" and origin.hostname not in ("localhost", "127.0.0.1", "testserver"):
            raise ValueError("HTTP somente em loopback/teste.")
        if self.idle_seconds < 60 or self.absolute_seconds < self.idle_seconds or self.lease_seconds < 30:
            raise ValueError("Política de sessão inválida.")
        ZoneInfo(self.timezone)
        if self.oidc_issuer and not self.oidc_issuer.startswith("https://"):
            raise ValueError("OIDC exige HTTPS.")
        oidc_values = (self.oidc_issuer, self.oidc_client_id, self.oidc_client_secret.get_secret_value())
        if any(oidc_values) and not all(oidc_values):
            raise ValueError("OIDC exige issuer, client ID e client secret completos.")
        if self.require_admin_mfa and not (self.oidc_issuer and self.oidc_mfa_acr):
            raise ValueError("MFA administrativo exige OIDC e ACR homologados.")
        return self

    @property
    def cookie_name(self):
        return "__Host-SiteSeleneSession" if self.secure_cookies else "SiteSeleneDevSession"


@lru_cache
def settings():
    return Settings()
