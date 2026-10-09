"""Valida os gates locais antes de iniciar ou promover o Site Selene."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import sqlalchemy as sa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import SCHEMA_REVISION  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import engine  # noqa: E402


def result(name, passed, detail):
    return {"check": name, "ok": bool(passed), "detail": detail}


def static_checks():
    cfg = settings()
    migration = ROOT / "migrations" / "versions" / f"{SCHEMA_REVISION}.py"
    return [
        result("environment", cfg.environment in {"test", "staging", "production"}, cfg.environment),
        result("origin", bool(cfg.public_origin), "configured"),
        result("migration_file", migration.is_file(), SCHEMA_REVISION),
        result(
            "integration_allowlist",
            not cfg.integration_adapter or bool(cfg.integration_allowed_hosts.strip()),
            "configured" if cfg.integration_adapter else "disabled",
        ),
    ]


def live_checks():
    cfg = settings()
    checks = []
    with engine().connect() as conn:
        revision = conn.scalar(sa.text("SELECT version_num FROM alembic_version"))
        checks.append(result("database_revision", revision == SCHEMA_REVISION, str(revision)))
        owner_count = conn.scalar(
            sa.text(
                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE n.nspname='public' AND c.relkind IN ('r','S') AND pg_get_userbyid(c.relowner)=current_user"
            )
        )
        checks.append(result("runtime_not_owner", owner_count == 0, f"owned_objects={owner_count}"))
        privileges = conn.scalar(
            sa.text(
                "SELECT has_table_privilege(current_user, 'integration_outbox', 'SELECT,INSERT,UPDATE,DELETE')"
            )
        )
        checks.append(result("runtime_outbox_privileges", privileges, "required CRUD grants"))

    backup = Path(cfg.backup_directory).resolve() if cfg.backup_directory else None
    external = Path(cfg.backup_external_directory).resolve() if cfg.backup_external_directory else None
    backup_ok = bool(backup and backup.is_dir() and os.access(backup, os.W_OK))
    external_ok = bool(external and external.is_dir() and os.access(external, os.W_OK) and external != backup)
    checks.append(result("backup_directory", backup_ok, "available" if backup_ok else "missing or not writable"))
    checks.append(
        result(
            "external_backup_directory",
            external_ok,
            "available and distinct" if external_ok else "missing, not writable, or same as local",
        )
    )
    try:
        key = serialization.load_pem_public_key(Path(cfg.backup_public_key).read_bytes())
        valid_key = isinstance(key, rsa.RSAPublicKey) and key.key_size >= 3072
    except (OSError, ValueError, TypeError):
        valid_key = False
    checks.append(result("backup_public_key", valid_key, "RSA >= 3072 bits"))
    return checks


def main():
    parser = argparse.ArgumentParser(description="Preflight de implantação do Site Selene")
    parser.add_argument("--static", action="store_true", help="Valida somente configuração e artefatos")
    args = parser.parse_args()
    checks = static_checks()
    if not args.static:
        checks.extend(live_checks())
    passed = all(item["ok"] for item in checks)
    print(json.dumps({"ok": passed, "checks": checks}, ensure_ascii=False))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
