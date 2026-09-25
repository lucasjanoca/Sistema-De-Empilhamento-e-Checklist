import csv
import io
import json
import sqlalchemy as sa
from fastapi import Request
from fastapi.responses import Response
from sqlalchemy.dialects.postgresql import insert
from . import schema as t, inputs as inp, views
from .db import rows
from .security import audit, fail, rate_limit
from .integration import validate_base, require_adapter


def safe_cell(value):
    text = str(value if value is not None else "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else text


def register(app, run):
    base = "/api/site-selene"

    @app.get(base + "/integration/config")
    def config(request: Request):
        return run(
            request,
            "integration:view",
            {},
            lambda c, a: {
                "config": c.scalar(sa.select(t.integration_settings.c.value).where(t.integration_settings.c.key == "config")) or {},
                "configured": False,
            },
        )

    @app.put(base + "/integration/config")
    def configure(request: Request, body: inp.IntegrationConfig):
        def action(c, a):
            validate_base(body.serverBase)
            if body.enabled:
                require_adapter()
            value = body.model_dump()
            c.execute(
                insert(t.integration_settings)
                .values(key="config", value=value)
                .on_conflict_do_update(index_elements=["key"], set_={"value": value})
            )
            audit(c, "INTEGRATION_CONFIG_CHANGED", {"enabled": False}, a, request)
            return {"ok": True, "config": value}

        return run(request, "integration:configure", body.model_dump(), action, True)

    @app.post(base + "/integration/test")
    def test_integration(request: Request):
        return run(request, "integration:view", {}, lambda c, a: require_adapter())

    @app.get(base + "/reports/{kind}.{format}")
    def report(
        kind: str, format: str, request: Request, q: str = "", date_from: str = "", date_to: str = "", user: str = "", status: str = ""
    ):
        if (
            kind not in {"history", "production", "audit", "checklist"}
            or format not in {"csv", "pdf"}
            or max(map(len, [q, date_from, date_to, user, status])) > 100
        ):
            fail(422, "Relatório inválido.")

        def export(c, a):
            rate_limit("export:" + str(a.user["id"]), 5, 300)
            if kind == "audit":
                if "audit:view" not in a.permissions:
                    fail(403, "Auditoria não autorizada.")
                query = sa.select(t.audit_log.c.timestamp, t.audit_log.c.action, t.audit_log.c.details)
                if q:
                    query = query.where(t.audit_log.c.action.icontains(q, autoescape=True))
                data = [list(r.values()) for r in rows(c, query.order_by(t.audit_log.c.id.desc()).limit(10000))]
                heads = ["Data", "Ação", "Detalhes"]
            elif kind == "production":
                result = views.production_rows(c, a)
                result = [
                    r
                    for r in result
                    if (not q or q.lower() in r["number"].lower())
                    and (not user or user == r["userMatricula"])
                    and (not status or status == r["status"])
                ]
                data = [[r["number"], r["userName"], r["tabletName"], r["status"], r["downCount"], r["upCount"]] for r in result]
                heads = ["Requisição", "Operador", "Dispositivo", "Status", "Desceu", "Subiu"]
            elif kind == "checklist":
                records = views.checklist_state(c, a)["history"]
                data = [
                    [r["createdAt"], r["equipment"], r["operator"], r["status"], r["obs"]]
                    for r in records
                    if not q or q.lower() in json.dumps(r).lower()
                ]
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
                records = rows(c, query.order_by(t.operational_history.c.id.desc()).limit(10000))
                data = [[r["timestamp"], r["number"], r["address"], r["action"], r["nome"], r["device_name"]] for r in records]
                heads = ["Data", "Requisição", "Endereço", "Ação", "Operador", "Dispositivo"]
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
            tbl = Table(cells, repeatRows=1, colWidths=[740 / len(heads)] * len(heads))
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
                "open_movements": c.scalar(
                    sa.select(sa.func.count()).select_from(t.pallet_movements).where(t.pallet_movements.c.status == "PENDING")
                ),
                "active_sessions": c.scalar(
                    sa.select(sa.func.count())
                    .select_from(t.sessions)
                    .where(t.sessions.c.revoked_at.is_(None), t.sessions.c.expires_at > sa.func.now())
                ),
                "integration_configured": False,
            },
        )

    from .oidc import register_oidc

    register_oidc(app)
