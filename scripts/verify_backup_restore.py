"""Exercício destrutivo somente em banco descartável explicitamente nomeado para restore."""

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import tempfile

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.backup import create, restore  # noqa: E402
from app.maintenance import replicate_immutable  # noqa: E402


TABLES = [
    "users",
    "audit_log",
    "operational_history",
    "pallet_requests",
    "pallet_movements",
    "integration_outbox",
    "checklist_records",
    "checklist_answers",
    "equipment",
    "battery_swaps",
]


def psycopg_url(value):
    return value.replace("postgresql+psycopg:", "postgresql:", 1)


def recreate_database(admin_url, restore_url):
    name = make_url(restore_url).database or ""
    if not name.endswith("_restore_test"):
        raise RuntimeError("O banco descartável deve terminar com _restore_test.")
    with psycopg.connect(psycopg_url(admin_url), autocommit=True) as conn:
        conn.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s", (name,))
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(name)))
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    return name


def counts(url):
    with psycopg.connect(psycopg_url(url)) as conn:
        result = {}
        for table in TABLES:
            result[table] = conn.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))).fetchone()[0]
        result["alembic_version"] = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
        result["audit_head"] = conn.execute("SELECT chain_hash FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
        result["audit_chain_valid"] = verify_chain(conn)
        return result


def verify_chain(conn):
    secret = os.environ["SESSION_SECRET"].encode()
    previous = "0" * 64
    for row in conn.execute(
        "SELECT id,timestamp,user_id,session_id,device_id,correlation_id,action,origin,details,previous_hash,chain_hash "
        "FROM audit_log ORDER BY id"
    ).fetchall():
        data = dict(zip(["id", "timestamp", "user_id", "session_id", "device_id", "correlation_id", "action", "origin", "details", "previous_hash", "chain_hash"], row))
        stored = data.pop("chain_hash")
        data.pop("id")
        canonical = json.dumps(data, sort_keys=True, default=str, ensure_ascii=False, separators=(",", ":"))
        expected = hmac.new(secret, ("audit:" + canonical).encode(), hashlib.sha256).hexdigest()
        if data["previous_hash"] != previous or stored != expected:
            return False
        previous = stored
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", default="EVIDENCIA-BACKUP.json")
    args = parser.parse_args()
    if os.environ.get("ENVIRONMENT") != "test":
        raise RuntimeError("Este exercício exige ENVIRONMENT=test.")
    source = os.environ["DATABASE_URL"]
    restore_url = os.environ["TEST_RESTORE_URL"]
    admin_url = os.environ["TEST_ADMIN_URL"]
    if "test" not in (make_url(source).database or ""):
        raise RuntimeError("A origem precisa ser um banco de teste.")
    database = recreate_database(admin_url, restore_url)
    try:
        with tempfile.TemporaryDirectory(prefix="selene-backup-exercise-") as directory:
            root = Path(directory)
            key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
            private_key = root / "private.pem"
            public_key = root / "public.pem"
            private_key.write_bytes(
                key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            )
            public_key.write_bytes(
                key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
            )
            backup = root / "selene-exercise.selene"
            backup_result = create(source, public_key, backup)
            external = root / "external"
            external.mkdir()
            replicate_immutable(backup, external)
            restore(backup, private_key, restore_url, database)
            source_state = counts(source)
            restored_state = counts(restore_url)
            matches = source_state == restored_state
            refused_nonempty = False
            try:
                restore(backup, private_key, restore_url, database)
            except ValueError as exc:
                refused_nonempty = "banco vazio" in str(exc)
            if not matches or not source_state["audit_chain_valid"] or not refused_nonempty:
                raise RuntimeError("O exercício de backup/restore não passou em todas as verificações.")
            evidence = {
                "backup": backup_result,
                "restore": "verified_in_disposable_database",
                "restoreDatabase": database,
                "tableCounts": {key: value for key, value in source_state.items() if key not in {"audit_head", "audit_chain_valid"}},
                "auditHeadMatches": source_state["audit_head"] == restored_state["audit_head"],
                "auditChainValidAfterRestore": restored_state["audit_chain_valid"],
                "externalCopyMatches": (external / backup.name).read_bytes() == backup.read_bytes(),
                "refusesNonEmptyTarget": refused_nonempty,
            }
            Path(args.evidence).write_text(json.dumps(evidence, indent=2, default=str) + "\n", encoding="utf-8")
            print(json.dumps(evidence, default=str))
    finally:
        with psycopg.connect(psycopg_url(admin_url), autocommit=True) as conn:
            conn.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s", (database,))
            conn.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))


if __name__ == "__main__":
    main()
