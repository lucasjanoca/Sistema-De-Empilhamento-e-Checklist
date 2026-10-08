"""Manutenção administrativa explícita, adequada ao agendador interno da TI."""

import argparse
import json
import hashlib
import os
import shutil
from datetime import timedelta, datetime, timezone
from pathlib import Path
from .config import settings
from .db import engine, now
from . import schema as t
from .security import audit
from .operations import setting
from .backup import create


def replicate_immutable(source, directory):
    source = Path(source)
    target_dir = Path(directory).resolve()
    if not target_dir.is_dir():
        raise RuntimeError("Destino externo de backup ausente.")
    copied = []
    for item in (source, source.with_suffix(source.suffix + ".json")):
        destination = target_dir / item.name
        with item.open("rb") as origin, destination.open("xb") as target:
            os.chmod(destination, 0o600)
            shutil.copyfileobj(origin, target, 1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        copied.append(destination)
    if hashlib.file_digest(copied[0].open("rb"), "sha256").hexdigest() != hashlib.file_digest(source.open("rb"), "sha256").hexdigest():
        raise RuntimeError("Cópia externa de backup não passou na verificação de integridade.")
    return str(copied[0])


def backup_job(job_id=None):
    cfg = settings()
    if not cfg.backup_directory or not cfg.backup_public_key:
        raise RuntimeError("Backup não configurado pela TI.")
    name = "selene-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".selene"
    try:
        local_file = Path(cfg.backup_directory) / name
        result = create(cfg.database_url.get_secret_value(), cfg.backup_public_key, local_file)
        if cfg.backup_external_directory:
            result["externalCopy"] = replicate_immutable(local_file, cfg.backup_external_directory)
        with engine().begin() as c:
            at = now(c)
            if job_id:
                c.execute(
                    t.technical_events.update().where(t.technical_events.c.id == job_id).values(details={"status": "COMPLETED", **result})
                )
            else:
                c.execute(t.technical_events.insert().values(created_at=at, kind="BACKUP", details={"status": "COMPLETED", **result}))
            audit(c, "BACKUP_COMPLETED", {"file": name, "sha256": result["sha256"]})
        return result
    except Exception:
        with engine().begin() as c:
            if job_id:
                c.execute(t.technical_events.update().where(t.technical_events.c.id == job_id).values(details={"status": "FAILED"}))
            audit(c, "BACKUP_FAILED")
        raise


def cleanup():
    # Long-lived evidence remains immutable. Cleanup handles transient artifacts only.
    cfg = settings()
    if cfg.backup_directory:
        cutoff = datetime.now(timezone.utc) - timedelta(days=cfg.backup_retention_days)
        for item in Path(cfg.backup_directory).glob("selene-*"):
            if item.is_file() and datetime.fromtimestamp(item.stat().st_mtime, timezone.utc) < cutoff:
                item.unlink()
    with engine().begin() as c:
        at = now(c)
        policy = setting(c, "retention", {})
        counts = {}
        counts["rate_limits"] = c.execute(t.rate_limits.delete().where(t.rate_limits.c.reset_at < at)).rowcount
        counts["oidc_flows"] = c.execute(t.oidc_flows.delete().where(t.oidc_flows.c.expires_at < at)).rowcount
        if policy.get("codes"):
            counts["codes"] = c.execute(
                t.access_codes.delete().where(t.access_codes.c.expires_at < at - timedelta(days=policy["codes"]))
            ).rowcount
        if policy.get("notifications"):
            counts["notifications"] = c.execute(
                t.notifications.delete().where(t.notifications.c.created_at < at - timedelta(days=policy["notifications"]))
            ).rowcount
        counts["idempotency"] = c.execute(
            t.idempotency_keys.delete().where(t.idempotency_keys.c.created_at < at - timedelta(days=7))
        ).rowcount
        # Session rows referenced by immutable audit/history are retained; remove only tokens' validity.
        counts["expired_sessions"] = c.execute(
            t.sessions.update().where(t.sessions.c.expires_at < at, t.sessions.c.revoked_at.is_(None)).values(revoked_at=at)
        ).rowcount
        audit(c, "RETENTION_APPLIED", counts)
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["backup", "cleanup"])
    args = parser.parse_args()
    print(json.dumps(backup_job() if args.command == "backup" else cleanup()))


if __name__ == "__main__":
    main()
