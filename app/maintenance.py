"""Manutenção administrativa explícita, adequada ao agendador interno da TI."""

import argparse
import json
from datetime import timedelta, datetime, timezone
from pathlib import Path
from .config import settings
from .db import engine, now
from . import schema as t
from .security import audit
from .operations import setting
from .backup import create


def backup_job(job_id=None):
    cfg = settings()
    if not cfg.backup_directory or not cfg.backup_public_key:
        raise RuntimeError("Backup não configurado pela TI.")
    name = "selene-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".selene"
    try:
        result = create(cfg.database_url.get_secret_value(), cfg.backup_public_key, Path(cfg.backup_directory) / name)
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
