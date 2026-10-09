from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import sqlalchemy as sa
from fastapi import Request
from . import schema as t, views
from .config import settings
from .db import rows
from .security import fail


def audit_category(action):
    if action.startswith(("LOGIN", "LOGOUT", "OIDC", "CODE")):
        return "acesso"
    if action.startswith(("PALLET", "MOVEMENT", "AUTO", "WAITING", "EXP_PIC")):
        return "operacao"
    if action.startswith("PRODUCTION"):
        return "requisicao"
    if action.startswith("USER"):
        return "usuario"
    if action.startswith("REPORT"):
        return "relatorio"
    if action.startswith("INTEGRATION"):
        return "integracao"
    if action.startswith(("DEVICE", "SYSTEM", "BACKUP", "RETENTION", "CHECKLIST", "BATTERY", "ISSUE", "EQUIPMENT")):
        return "sistema"
    return "seguranca"


def audit_query(q="", user="", role="", category="", event="", date_from="", date_to=""):
    query = sa.select(t.audit_log, t.users.c.nome, t.users.c.matricula).select_from(t.audit_log.outerjoin(t.users))
    if q:
        query = query.where(
            sa.or_(
                t.audit_log.c.action.icontains(q, autoescape=True),
                t.users.c.nome.icontains(q, autoescape=True),
                t.users.c.matricula.icontains(q, autoescape=True),
                t.audit_log.c.details.cast(sa.Text).icontains(q, autoescape=True),
            )
        )
    if user:
        query = query.where(t.users.c.matricula == user)
    if role:
        query = query.where(t.audit_log.c.details["actor_role"].astext == role if role != "sistema" else t.audit_log.c.user_id.is_(None))
    groups = {
        "acesso": ["LOGIN", "LOGOUT", "OIDC", "CODE"],
        "operacao": ["PALLET", "MOVEMENT", "AUTO", "WAITING", "EXP_PIC"],
        "requisicao": ["PRODUCTION"],
        "usuario": ["USER"],
        "relatorio": ["REPORT"],
        "integracao": ["INTEGRATION"],
        "sistema": ["DEVICE", "SYSTEM", "BACKUP", "RETENTION", "CHECKLIST", "BATTERY", "ISSUE", "EQUIPMENT"],
    }
    events = {
        "login": ["LOGIN", "OIDC_LOGIN"],
        "logout": ["LOGOUT"],
        "movimentacao": groups["operacao"],
        "dispositivo": ["DEVICE", "EQUIPMENT"],
        "usuarios": ["USER"],
        "integracao": ["INTEGRATION"],
        "relatorio": ["REPORT"],
        "seguranca": ["REQUEST_DENIED", "PERMISSION", "REAUTH"],
        "outros": ["CHECKLIST", "BATTERY", "ISSUE", "RETENTION", "BACKUP", "SYSTEM"],
    }
    if category:
        condition = sa.or_(*[t.audit_log.c.action.startswith(p, autoescape=True) for prefixes in groups.values() for p in prefixes])
        query = query.where(
            ~condition
            if category == "seguranca"
            else sa.or_(*[t.audit_log.c.action.startswith(p, autoescape=True) for p in groups.get(category, [])])
            if category in groups
            else sa.false()
        )
    if event:
        query = query.where(
            sa.or_(*[t.audit_log.c.action.startswith(p, autoescape=True) for p in events.get(event, [])]) if event in events else sa.false()
        )
    return date_filter(query, t.audit_log.c.timestamp, date_from, date_to)


def date_filter(query, column, start, end):
    try:
        zone = ZoneInfo(settings().timezone)
        if start:
            query = query.where(column >= datetime.combine(date.fromisoformat(start), time(), zone))
        if end:
            query = query.where(column < datetime.combine(date.fromisoformat(end) + timedelta(days=1), time(), zone))
    except ValueError:
        fail(422, "Data inválida.")
    return query


def production_query(actor, q="", user="", status="", date_from="", date_to=""):
    query = sa.select(t.production_requests, t.users.c.nome, t.users.c.matricula, t.devices.c.name).select_from(
        t.production_requests.join(t.users).join(t.devices)
    )
    if "history:view_all" not in actor.permissions:
        query = query.where(t.production_requests.c.user_id == actor.user["id"])
    if q:
        query = query.where(t.production_requests.c.number.icontains(q, autoescape=True))
    if user:
        query = query.where(t.users.c.matricula == user)
    if status:
        query = query.where(t.production_requests.c.status == status.upper())
    return date_filter(query, t.production_requests.c.started_at, date_from, date_to)


def production_row(r):
    return dict(
        id=r["id"],
        number=r["number"],
        userName=r["nome"],
        userMatricula=r["matricula"],
        tabletName=r["name"],
        startedAt=views.ms(r["started_at"]),
        endedAt=views.ms(r["ended_at"]),
        status=r["status"].lower(),
        downCount=r["down_count"],
        upCount=r["up_count"],
    )


def checklist_query(actor, q="", status="", user="", date_from="", date_to=""):
    query = sa.select(t.checklist_records, t.equipment.c.code, t.equipment.c.name, t.users.c.nome).select_from(
        t.checklist_records.join(t.equipment).join(t.users)
    )
    if "history:view_all" not in actor.permissions:
        query = query.where(t.checklist_records.c.user_id == actor.user["id"])
    if q:
        query = query.where(
            sa.or_(
                t.equipment.c.code.icontains(q, autoescape=True),
                t.equipment.c.name.icontains(q, autoescape=True),
                t.checklist_records.c.observation.icontains(q, autoescape=True),
                t.users.c.nome.icontains(q, autoescape=True),
            )
        )
    if status:
        query = query.where(t.checklist_records.c.result == status)
    if user:
        query = query.where(t.users.c.matricula == user)
    return date_filter(query, t.checklist_records.c.finished_at, date_from, date_to)


def checklist_row(r):
    return dict(
        id=str(r["id"]),
        kind="checklist",
        equipmentId=str(r["equipment_id"]),
        equipment=f"{r['code']} · {r['name']}",
        status=r["result"],
        operator=r["nome"],
        obs=r["observation"],
        details=f"{r['shift']} · {r['operational_date']} · modelo {r['template_version_id']}",
        createdAt=r["finished_at"].isoformat(),
    )


def register_queries(app, run):
    @app.get("/api/site-selene/production")
    def production(request: Request, page: int = 1, q: str = "", user: str = "", status: str = "", date_from: str = "", date_to: str = ""):
        if page < 1 or max(map(len, [q, user, status, date_from, date_to])) > 100:
            fail(422, "Filtro inválido.")

        def read(c, a):
            query = production_query(a, q, user, status, date_from, date_to)
            sub = query.subquery()
            totals = (
                c.execute(
                    sa.select(
                        sa.func.count().label("count"),
                        sa.func.coalesce(sa.func.sum(sub.c.down_count), 0).label("down"),
                        sa.func.coalesce(sa.func.sum(sub.c.up_count), 0).label("up"),
                    )
                )
                .mappings()
                .one()
            )
            result = rows(c, query.order_by(t.production_requests.c.id.desc()).offset((page - 1) * 100).limit(101))
            return dict(rows=[production_row(r) for r in result[:100]], hasMore=len(result) > 100, totals=dict(totals))

        return run(request, "production:view", {}, read)

    @app.get("/api/site-selene/checklist/history")
    def checklist_history(
        request: Request, page: int = 1, q: str = "", status: str = "", user: str = "", date_from: str = "", date_to: str = ""
    ):
        if page < 1 or max(map(len, [q, user, status, date_from, date_to])) > 100:
            fail(422, "Filtro inválido.")

        def read(c, a):
            result = rows(
                c,
                checklist_query(a, q, status, user, date_from, date_to)
                .order_by(t.checklist_records.c.id.desc())
                .offset((page - 1) * 100)
                .limit(101),
            )
            return dict(rows=[checklist_row(r) for r in result[:100]], hasMore=len(result) > 100)

        return run(request, "checklist:view", {}, read)

    @app.get("/api/site-selene/battery-swaps")
    def swaps(request: Request, page: int = 1):
        if page < 1:
            fail(422, "Página inválida.")

        def read(c, a):
            installed = t.equipment.alias("installed")
            removed = t.equipment.alias("removed")
            fork = t.equipment.alias("fork")
            query = sa.select(
                t.battery_swaps,
                installed.c.code.label("installed"),
                removed.c.code.label("removed"),
                fork.c.code.label("fork"),
                t.users.c.nome,
            ).select_from(
                t.battery_swaps.join(installed, t.battery_swaps.c.installed_id == installed.c.id)
                .outerjoin(removed, t.battery_swaps.c.removed_id == removed.c.id)
                .join(fork, t.battery_swaps.c.forklift_id == fork.c.id)
                .join(t.users)
            )
            if "history:view_all" not in a.permissions:
                query = query.where(t.battery_swaps.c.user_id == a.user["id"])
            result = rows(c, query.order_by(t.battery_swaps.c.id.desc()).offset((page - 1) * 100).limit(101))
            return dict(
                rows=[
                    dict(
                        id="swap-" + str(r["id"]),
                        kind="swap",
                        equipmentId=str(r["forklift_id"]),
                        equipment=f"{r['fork']} · {r['removed'] or '—'} → {r['installed']}",
                        status="ok",
                        operator=r["nome"],
                        obs=r["observation"],
                        details=f"Horímetros {r['out_meter']} / {r['in_meter']}",
                        createdAt=r["created_at"].isoformat(),
                    )
                    for r in result[:100]
                ],
                hasMore=len(result) > 100,
            )

        return run(request, "checklist:view", {}, read)
