import csv
import io
import sqlalchemy as sa
from fastapi import Request
from fastapi.responses import Response
from sqlalchemy.dialects.postgresql import insert
from . import schema as t, inputs as inp, views
from .db import rows
from .security import audit, fail, rate_limit
from .config import settings
from .integration import validate_config, require_adapter
from .queries import production_query, production_row, checklist_query, checklist_row, audit_query
from .monitoring import snapshot


def safe_cell(value):
    text = str(value if value is not None else "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else text


def register(app, run):
    base = "/api/site-selene"

    @app.get(base + "/integration/config")
    def config(request: Request):
        def read(c, a):
            value = c.scalar(sa.select(t.integration_settings.c.value).where(t.integration_settings.c.key == "config")) or {}
            configured = bool(value.get("enabled") and value.get("serverBase") and settings().integration_adapter == "http-json-v1")
            outbox = {
                status: count
                for status, count in c.execute(
                    sa.select(t.integration_outbox.c.status, sa.func.count())
                    .group_by(t.integration_outbox.c.status)
                    .order_by(t.integration_outbox.c.status)
                )
            }
            return {"config": value, "configured": configured, "outbox": outbox}

        return run(
            request,
            "integration:view",
            {},
            read,
        )

    @app.put(base + "/integration/config")
    def configure(request: Request, body: inp.IntegrationConfig):
        def action(c, a):
            value = body.model_dump()
            validate_config(value)
            if body.enabled:
                require_adapter(value)
            c.execute(
                insert(t.integration_settings)
                .values(key="config", value=value)
                .on_conflict_do_update(index_elements=["key"], set_={"value": value})
            )
            audit(c, "INTEGRATION_CONFIG_CHANGED", {"enabled": body.enabled}, a, request)
            return {"ok": True, "config": value}

        return run(request, "integration:configure", body.model_dump(), action, True)

    @app.post(base + "/integration/test")
    def test_integration(request: Request):
        def test(c, a):
            value = c.scalar(sa.select(t.integration_settings.c.value).where(t.integration_settings.c.key == "config")) or {}
            adapter = require_adapter(value)
            health = adapter.health()
            reads = adapter.fetch_pallets() if value.get("routeHealth") else health
            audit(c, "INTEGRATION_TESTED", {"ok": True}, a, request)
            return {
                "ok": True,
                "healthResponseType": type(health).__name__,
                "pendingResponseType": type(reads["pending"]).__name__,
                "attendanceResponseType": type(reads["attendance"]).__name__,
            }

        return run(request, "integration:view", {}, test)

    @app.post(base + "/integration/retry")
    def retry_integration(request: Request):
        def retry(c, a):
            at = c.scalar(sa.text("SELECT clock_timestamp()"))
            result = c.execute(
                t.integration_outbox.update()
                .where(t.integration_outbox.c.status == "FAILED")
                .values(status="PENDING", next_attempt_at=at, locked_at=None, last_error_code=None)
            )
            audit(c, "INTEGRATION_RETRY_REQUESTED", {"queued": result.rowcount}, a, request)
            return {"ok": True, "queued": result.rowcount}

        return run(request, "integration:configure", {}, retry, True)

    @app.get(base + "/reports/{kind}.{format}")
    def report(
        kind: str,
        format: str,
        request: Request,
        q: str = "",
        date_from: str = "",
        date_to: str = "",
        user: str = "",
        status: str = "",
        role: str = "",
        category: str = "",
        event: str = "",
    ):
        if (
            kind not in {"history", "production", "audit", "checklist"}
            or format not in {"csv", "pdf"}
            or max(map(len, [q, date_from, date_to, user, status, role, category, event])) > 100
        ):
            fail(422, "Relatório inválido.")

        def export(c, a):
            rate_limit("export:" + str(a.user["id"]), 5, 300)
            if kind == "audit":
                if "audit:view" not in a.permissions:
                    fail(403, "Auditoria não autorizada.")
                query = audit_query(q, user, role, category, event, date_from, date_to)
                data = [[r["timestamp"], r["action"], r["details"]] for r in rows(c, query.order_by(t.audit_log.c.id.desc()).limit(10001))]
                heads = ["Data", "Ação", "Detalhes"]
            elif kind == "production":
                result = [
                    production_row(r)
                    for r in rows(
                        c, production_query(a, q, user, status, date_from, date_to).order_by(t.production_requests.c.id.desc()).limit(10001)
                    )
                ]
                data = [[r["number"], r["userName"], r["tabletName"], r["status"], r["downCount"], r["upCount"]] for r in result]
                heads = ["Requisição", "Operador", "Dispositivo", "Status", "Desceu", "Subiu"]
            elif kind == "checklist":
                records = [
                    checklist_row(r)
                    for r in rows(
                        c, checklist_query(a, q, status, user, date_from, date_to).order_by(t.checklist_records.c.id.desc()).limit(10001)
                    )
                ]
                data = [[r["createdAt"], r["equipment"], r["operator"], r["status"], r["obs"]] for r in records]
                heads = ["Data", "Equipamento", "Operador", "Resultado", "Observação"]
            else:
                query = views.history_query(a)
                if q:
                    query = query.where(
                        sa.or_(t.operational_history.c.address.icontains(q, autoescape=True), t.users.c.nome.icontains(q, autoescape=True))
                    )
                from datetime import date

                try:
                    if date_from:
                        query = query.where(t.operational_history.c.operational_date >= date.fromisoformat(date_from))
                    if date_to:
                        query = query.where(t.operational_history.c.operational_date <= date.fromisoformat(date_to))
                except ValueError:
                    fail(422, "Data inválida.")
                if user:
                    query = query.where(t.users.c.matricula == user)
                records = rows(c, query.order_by(t.operational_history.c.id.desc()).limit(10001))
                data = [[r["timestamp"], r["number"], r["address"], r["action"], r["nome"], r["device_name"]] for r in records]
                heads = ["Data", "Requisição", "Endereço", "Ação", "Operador", "Dispositivo"]
            if len(data) > 10000:
                fail(422, "Mais de 10.000 registros. Restrinja o período ou o filtro antes de exportar.")
            audit(c, "REPORT_EXPORTED", {"kind": kind, "format": format, "rows": len(data)}, a, request)
            if format == "csv":
                output = io.StringIO()
                writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_ALL)
                writer.writerow(heads)
                writer.writerows([[safe_cell(v) for v in r] for r in data])
                return Response(
                    "\ufeff" + output.getvalue(),
                    media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="selene-{kind}.csv"'},
                )
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
            from reportlab.lib import colors
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.lib.pagesizes import A4, landscape
            from xml.sax.saxutils import escape

            output = io.BytesIO()
            styles = getSampleStyleSheet()
            style = styles["BodyText"]
            style.fontSize = 8
            cells = [[Paragraph(escape(str(v or "")), style) for v in r] for r in [heads, *data]]
            tbl = Table(cells, repeatRows=1, splitInRow=1, colWidths=[690 / len(heads)] * len(heads))
            tbl.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d5eee5")),
                        ("GRID", (0, 0), (-1, -1), 0.3, colors.lightgrey),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]
                )
            )
            SimpleDocTemplate(output, pagesize=landscape(A4)).build(
                [Paragraph("Site Selene · " + kind, styles["Title"]), Spacer(1, 12), tbl]
            )
            return Response(
                output.getvalue(),
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="selene-{kind}.pdf"'},
            )

        return run(request, "reports:export", {}, export)

    @app.get(base + "/metrics")
    def metrics(request: Request):
        return run(
            request,
            "security:view",
            {},
            lambda c, a: {
                **snapshot(),
                "login_failures_15m": c.scalar(
                    sa.select(sa.func.count())
                    .select_from(t.audit_log)
                    .where(
                        t.audit_log.c.action == "LOGIN_FAILED", t.audit_log.c.timestamp > sa.func.now() - sa.text("interval '15 minutes'")
                    )
                ),
                "last_backup": c.scalar(
                    sa.select(t.technical_events.c.details)
                    .where(t.technical_events.c.kind == "BACKUP")
                    .order_by(t.technical_events.c.id.desc())
                    .limit(1)
                ),
                "open_movements": c.scalar(
                    sa.select(sa.func.count())
                    .select_from(t.pallet_movements)
                    .where(t.pallet_movements.c.status.in_(["PENDING", "EXTERNAL_PENDING"]))
                ),
                "active_sessions": c.scalar(
                    sa.select(sa.func.count())
                    .select_from(t.sessions)
                    .where(t.sessions.c.revoked_at.is_(None), t.sessions.c.expires_at > sa.func.now())
                ),
                "integration_configured": bool(settings().integration_adapter),
            },
        )

    from .oidc import register_oidc
    from .queries import register_queries
    from .backup_routes import register_backups

    register_oidc(app)
    register_queries(app, run)
    register_backups(app, run)
