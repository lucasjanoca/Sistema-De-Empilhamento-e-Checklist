"""Inicializa o preview publico efemero no Render.

Este caminho existe somente para avaliacao. Producao continua usando contas de
banco separadas, backup e os gates descritos nos runbooks corporativos.
"""

from __future__ import annotations

import os
import subprocess
import sys


def normalize_database_url(value: str) -> str:
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value.removeprefix("postgresql://")
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value.removeprefix("postgres://")
    return value


def configure_environment(environ: dict[str, str]) -> None:
    if environ.get("ENVIRONMENT") != "preview":
        raise RuntimeError("Inicializador Render permitido somente com ENVIRONMENT=preview.")
    database_url = normalize_database_url(environ.get("DATABASE_URL", ""))
    if not database_url.startswith("postgresql+psycopg://"):
        raise RuntimeError("DATABASE_URL PostgreSQL ausente ou invalida.")
    hostname = environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip().lower()
    if not hostname or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-." for char in hostname):
        raise RuntimeError("Hostname externo do Render ausente ou invalido.")
    environ["DATABASE_URL"] = database_url
    environ["MIGRATION_DATABASE_URL"] = database_url
    environ["PUBLIC_ORIGIN"] = f"https://{hostname}"
    environ["SECURE_COOKIES"] = "true"


def bootstrap_admin(password: str) -> bool:
    import sqlalchemy as sa

    from app import schema as t
    from app.db import engine
    from app.security import audit, password_hash

    identifier = os.environ.get("PREVIEW_ADMIN_ID", "ti-preview").strip().lower()
    name = os.environ.get("PREVIEW_ADMIN_NAME", "Administrador do preview").strip()
    with engine().begin() as conn:
        if conn.scalar(sa.select(sa.func.count()).select_from(t.users)):
            return False
        if not 1 <= len(identifier) <= 80 or not 1 <= len(name) <= 160:
            raise RuntimeError("Identidade inicial do preview invalida.")
        if not password:
            raise RuntimeError("Defina PREVIEW_ADMIN_PASSWORD no painel privado do Render.")
        user_id = conn.scalar(
            t.users.insert()
            .values(matricula=identifier, nome=name, password_hash=password_hash(password))
            .returning(t.users.c.id)
        )
        role_id = conn.scalar(sa.select(t.roles.c.id).where(t.roles.c.name == "ti"))
        conn.execute(t.user_roles.insert().values(user_id=user_id, role_id=role_id))
        audit(conn, "PREVIEW_INITIAL_ADMIN_CREATED", {"user_id": user_id})
    return True


def main() -> None:
    configure_environment(os.environ)
    password = os.environ.pop("PREVIEW_ADMIN_PASSWORD", "")
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    created = bootstrap_admin(password)
    print("Preview preparado; administrador inicial criado." if created else "Preview preparado; usuarios existentes preservados.", flush=True)
    port = os.environ.get("PORT", "10000")
    os.execvp(
        "uvicorn",
        [
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            port,
            "--no-access-log",
            "--proxy-headers",
            "--forwarded-allow-ips=*",
        ],
    )


if __name__ == "__main__":
    main()
