from pathlib import Path
import sqlalchemy as sa
from fastapi import Request, BackgroundTasks
from fastapi.responses import FileResponse
from .config import settings
from .db import now, rows, lock
from . import schema as t
from .security import audit, fail
from .maintenance import backup_job


def register_backups(app, run):
    @app.post("/api/site-selene/backups")
    def start(request: Request, background: BackgroundTasks):
        def command(c, a):
            lock(c, "backup-job")
            cfg = settings()
            if not cfg.backup_directory or not cfg.backup_public_key:
                fail(503, "TI precisa configurar diretório privado e chave pública de backup.")
            root = Path(cfg.backup_directory).resolve()
            public = Path(__file__).resolve().parent.parent / "public"
            if root.is_relative_to(public.resolve()):
                fail(503, "Diretório de backup inválido.")
            running = c.scalar(
                sa.select(t.technical_events.c.id)
                .where(t.technical_events.c.kind == "BACKUP", t.technical_events.c.details["status"].astext == "RUNNING")
                .limit(1)
            )
            if running:
                fail(409, "Backup em execução. Consulte o resultado antes de solicitar outro.")
            job = c.scalar(
                t.technical_events.insert()
                .values(created_at=now(c), kind="BACKUP", details={"status": "RUNNING"})
                .returning(t.technical_events.c.id)
            )
            audit(c, "BACKUP_REQUESTED", {"job_id": job}, a, request)
            background.add_task(backup_job, job)
            return {"ok": True, "job_id": job, "status": "RUNNING"}

        return run(request, "backup:create", {}, command, True)

    @app.get("/api/site-selene/backups")
    def list_backups(request: Request):
        return run(
            request,
            "backup:create",
            {},
            lambda c, a: {
                "jobs": [
                    dict(id=r["id"], createdAt=r["created_at"].isoformat(), **r["details"])
                    for r in rows(
                        c,
                        sa.select(t.technical_events)
                        .where(t.technical_events.c.kind == "BACKUP")
                        .order_by(t.technical_events.c.id.desc())
                        .limit(50),
                    )
                ]
            },
        )

    @app.get("/api/site-selene/backups/{job_id}/download")
    def download(job_id: int, request: Request):
        def read(c, a):
            record = (
                c.execute(sa.select(t.technical_events).where(t.technical_events.c.id == job_id, t.technical_events.c.kind == "BACKUP"))
                .mappings()
                .first()
            )
            if not record or record["details"].get("status") != "COMPLETED":
                fail(404, "Backup concluído não encontrado.")
            name = record["details"]["file"]
            directory = Path(settings().backup_directory).resolve()
            path = (directory / name).resolve()
            if path.parent != directory or not path.is_file():
                fail(404, "Arquivo não disponível na retenção atual.")
            audit(c, "BACKUP_DOWNLOADED", {"job_id": job_id}, a, request)
            return FileResponse(path, filename=name, media_type="application/octet-stream")

        return run(request, "backup:create", {}, read, True)
