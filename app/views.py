from datetime import timedelta
from zoneinfo import ZoneInfo
import sqlalchemy as sa
from . import schema as t
from .config import settings
from .db import now, one, rows
from .operations import setting
from .policy import operational_day
from .security import grants


def ms(value):
    return int(value.timestamp() * 1000) if value else None


def history_query(actor):
    query = sa.select(
        t.operational_history, t.users.c.nome, t.users.c.matricula, t.devices.c.name.label("device_name"), t.production_requests.c.number
    ).select_from(t.operational_history.outerjoin(t.users).outerjoin(t.devices).outerjoin(t.production_requests))
    if "history:view_all" not in actor.permissions:
        query = query.where(t.operational_history.c.user_id == actor.user["id"])
    return query


def history_row(r):
    return dict(
        id=r["id"],
        time=ms(r["timestamp"]),
        address=r["address"],
        action=r["action"],
        operator=r["nome"] or "Sistema",
        operatorMatricula=r["matricula"] or "",
        tabletName=r["device_name"] or "",
        requestNumber=r["number"] or "",
        direction="down" if r["action"] == "LOWER_CONFIRMED" else "up" if r["action"] == "RAISE_CONFIRMED" else None,
    )


def production_rows(conn, actor):
    query = sa.select(t.production_requests, t.users.c.nome, t.users.c.matricula, t.devices.c.name).select_from(
        t.production_requests.join(t.users).join(t.devices)
    )
    if "history:view_all" not in actor.permissions:
        query = query.where(t.production_requests.c.user_id == actor.user["id"])
    return [
        dict(
            id=r["id"],
            number=r["number"],
            userName=r["nome"],
            userMatricula=r["matricula"],
            tabletName=r["name"],
            startedAt=ms(r["started_at"]),
            endedAt=ms(r["ended_at"]),
            status=r["status"].lower(),
            downCount=r["down_count"],
            upCount=r["up_count"],
        )
        for r in rows(conn, query.order_by(t.production_requests.c.id.desc()).limit(200))
    ]


def metrics(conn, actor):
    at = now(conn)
    counts = dict(conn.execute(sa.select(t.pallet_requests.c.state, sa.func.count()).group_by(t.pallet_requests.c.state)).all())
    h = t.operational_history
    condition = sa.true() if "history:view_all" in actor.permissions else h.c.user_id == actor.user["id"]
    local = at.astimezone(ZoneInfo(settings().timezone))
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    days = []
    for i in range(6, -1, -1):
        start = day_start - timedelta(days=i)
        totals = dict(
            conn.execute(
                sa.select(h.c.action, sa.func.count())
                .where(
                    condition,
                    h.c.timestamp >= start,
                    h.c.timestamp < start + timedelta(days=1),
                    h.c.action.in_(["LOWER_CONFIRMED", "RAISE_CONFIRMED"]),
                )
                .group_by(h.c.action)
            ).all()
        )
        down, up = totals.get("LOWER_CONFIRMED", 0), totals.get("RAISE_CONFIRMED", 0)
        days.append(dict(label=start.strftime("%d/%m"), down=down, up=up, total=down + up))
    totals = dict(conn.execute(sa.select(h.c.action, sa.func.count()).where(condition).group_by(h.c.action)).all())
    avg = conn.scalar(
        sa.select(sa.func.avg(sa.extract("epoch", at - t.pallet_requests.c.created_at) / 60)).where(
            t.pallet_requests.c.state.in_(["WAITING", "ASSIGNED", "LOWER_AUTHORIZED"])
        )
    )
    ranking = rows(
        conn,
        sa.select(t.users.c.nome, sa.func.count().label("total"))
        .select_from(h.join(t.users))
        .where(condition, h.c.action.in_(["LOWER_CONFIRMED", "RAISE_CONFIRMED"]))
        .group_by(t.users.c.id)
        .order_by(sa.desc("total"))
        .limit(50),
    )
    return dict(
        waiting=sum(counts.get(s, 0) for s in ["WAITING", "ASSIGNED", "LOWER_AUTHORIZED"]),
        floor=counts.get("FLOOR", 0),
        ready=counts.get("READY", 0) + counts.get("RAISE_AUTHORIZED", 0),
        moving=counts.get("LOWERING", 0) + counts.get("RETURNING", 0),
        today=days[-1]["total"],
        days=days,
        averageWait=float(avg or 0),
        activeOperators=conn.scalar(
            sa.select(sa.func.count()).select_from(t.production_requests).where(t.production_requests.c.status == "OPEN")
        )
        if "history:view_all" in actor.permissions
        else sum(1 for r in production_rows(conn, actor) if r["status"] == "open"),
        down=totals.get("LOWER_CONFIRMED", 0),
        up=totals.get("RAISE_CONFIRMED", 0),
        cancelled=totals.get("PALLET_CANCEL", 0) + totals.get("PALLET_UNDO", 0),
        ranking=[dict(r) for r in ranking],
    )


def state(conn, actor):
    at = now(conn)
    data = dict(
        version="2.1.1",
        requests=[],
        history=[],
        productionRequests=[],
        auditLog=[],
        notifications=[],
        registeredDevices=[],
        tabletAssignments=[],
        settings={},
        selectedCorridors=setting(conn, "corridors", []),
        metrics={},
    )
    if "pallet:view" in actor.permissions:
        for r in rows(
            conn,
            sa.select(t.pallet_requests)
            .where(t.pallet_requests.c.state.not_in(["COMPLETED", "CANCELLED"]))
            .order_by(t.pallet_requests.c.id)
            .limit(2000),
        ):
            m = one(
                conn,
                sa.select(t.pallet_movements, t.users.c.nome, t.users.c.matricula, t.devices.c.name)
                .select_from(t.pallet_movements.join(t.users).join(t.devices))
                .where(t.pallet_movements.c.pallet_request_id == r["id"])
                .order_by(t.pallet_movements.c.id.desc())
                .limit(1),
            )
            status = {
                "WAITING": "waiting",
                "ASSIGNED": "waiting",
                "LOWER_AUTHORIZED": "waiting",
                "LOWERING": "lowering",
                "FLOOR": "floor",
                "READY": "ready",
                "RAISE_AUTHORIZED": "ready",
                "RETURNING": "returning",
            }[r["state"]]
            data["requests"].append(
                dict(
                    id=r["id"],
                    address=r["address"],
                    operator=r["operator"],
                    corridor=r["corridor"],
                    status=status,
                    state=r["state"],
                    version=r["version"],
                    isPic=r["area"] == "EXP-PIC",
                    createdAt=ms(r["created_at"]),
                    loweredAt=ms(r["lowered_at"]),
                    unlockedAt=ms(r["ready_at"]),
                    dueAt=ms(r["due_at"]),
                    external=bool(r["external_ref"]),
                    assignedTo=r["assigned_to"],
                    lastHandledByName=m["nome"] if m else "",
                    lastHandledByMatricula=m["matricula"] if m else "",
                    lastHandledTablet=m["name"] if m else "",
                    confirmAt=ms(m["confirm_at"]) if m and m["status"] == "PENDING" else None,
                )
            )
    if {"history:view_own", "history:view_all"} & actor.permissions:
        data["history"] = [history_row(r) for r in rows(conn, history_query(actor).order_by(t.operational_history.c.id.desc()).limit(100))]
    if "production:view" in actor.permissions:
        data["productionRequests"] = production_rows(conn, actor)
    if "dashboard:view" in actor.permissions:
        data["metrics"] = metrics(conn, actor)
    if "devices:view" in actor.permissions:
        data["registeredDevices"] = [
            dict(id=d["id"], name=d["name"], type=d["type"].lower(), active=d["active"])
            for d in rows(conn, sa.select(t.devices).where(t.devices.c.active).order_by(t.devices.c.name))
        ]
        leases = (
            sa.select(t.device_assignments, t.devices.c.name, t.users.c.nome, t.users.c.matricula)
            .select_from(t.device_assignments.join(t.devices).join(t.users))
            .order_by(t.device_assignments.c.id.desc())
            .limit(500)
        )
        if "devices:manage" not in actor.permissions:
            leases = leases.where(t.device_assignments.c.user_id == actor.user["id"])
        for d in rows(conn, leases):
            data["tabletAssignments"].append(
                dict(
                    deviceId=d["device_id"],
                    tabletName=d["name"],
                    userName=d["nome"],
                    userMatricula=d["matricula"],
                    userRole=grants(conn, d["user_id"])[0],
                    lastSeen=ms(d["last_seen"]),
                    active=d["released_at"] is None and d["expires_at"] > at,
                )
            )
    data["notifications"] = [
        dict(
            id=r["id"],
            title=r["title"],
            message=r["message"],
            time=ms(r["created_at"]),
            read=bool(r["read_at"]),
            type="info",
            link="operacao",
        )
        for r in rows(
            conn,
            sa.select(t.notifications)
            .where(t.notifications.c.user_id == actor.user["id"], t.notifications.c.dismissed_at.is_(None))
            .order_by(t.notifications.c.id.desc())
            .limit(50),
        )
    ]
    if "security:view" in actor.permissions:
        data["settings"]["tiIntegrationNotes"] = setting(conn, "ti-notes", "")
    assignment = one(
        conn,
        sa.select(t.device_assignments, t.devices.c.name)
        .select_from(t.device_assignments.join(t.devices))
        .where(
            t.device_assignments.c.session_id == actor.session["id"],
            t.device_assignments.c.released_at.is_(None),
            t.device_assignments.c.expires_at > at,
        ),
    )
    return dict(
        data=data,
        serverTime=ms(at),
        user=actor.public(),
        csrfToken=actor.session["csrf"],
        tablet=dict(id=assignment["device_id"], name=assignment["name"]) if assignment else None,
    )


def checklist_state(conn, actor):
    equipment = []
    for e in rows(conn, sa.select(t.equipment).order_by(t.equipment.c.code).limit(2000)):
        last = one(
            conn,
            sa.select(t.checklist_records, t.users.c.nome)
            .select_from(t.checklist_records.join(t.users))
            .where(t.checklist_records.c.equipment_id == e["id"])
            .order_by(t.checklist_records.c.id.desc())
            .limit(1),
        )
        equipment.append(
            dict(
                e,
                id=str(e["id"]),
                water=last["water"] if last else None,
                liters=float(last["liters"] or 0) if last else None,
                operator=last["nome"] if last else "",
                obs=last["observation"] if last else "",
                lastCheck=last["finished_at"].isoformat() if last else None,
            )
        )
    versions = []
    for tmp in rows(conn, sa.select(t.checklist_templates)):
        v = one(
            conn,
            sa.select(t.checklist_template_versions)
            .where(t.checklist_template_versions.c.template_id == tmp["id"])
            .order_by(t.checklist_template_versions.c.version.desc())
            .limit(1),
        )
        if v:
            versions.append(dict(id=v["id"], type=tmp["type"], name=tmp["name"], version=v["version"], questions=v["questions"]))
    query = sa.select(t.checklist_records, t.equipment.c.code, t.equipment.c.name, t.users.c.nome).select_from(
        t.checklist_records.join(t.equipment).join(t.users)
    )
    if "history:view_all" not in actor.permissions:
        query = query.where(t.checklist_records.c.user_id == actor.user["id"])
    records = [
        dict(
            id=str(r["id"]),
            kind="checklist",
            equipmentId=str(r["equipment_id"]),
            equipment=f"{r['code']} · {r['name']}",
            status=r["result"],
            operator=r["nome"],
            obs=r["observation"],
            details=f"{r['shift']} · {r['operational_date']} · versão {r['template_version_id']}",
            createdAt=r["finished_at"].isoformat(),
        )
        for r in rows(conn, query.order_by(t.checklist_records.c.id.desc()).limit(100))
    ]
    issues = (
        [
            dict(r, id=str(r["id"]), equipmentId=str(r["equipment_id"]), status=r["status"].lower())
            for r in rows(
                conn,
                sa.select(t.issues, t.equipment.c.code, t.equipment.c.name)
                .select_from(t.issues.join(t.equipment))
                .order_by(t.issues.c.id.desc())
                .limit(200),
            )
        ]
        if "issues:view" in actor.permissions
        else []
    )
    day, shift = operational_day(now(conn), settings().timezone)
    return dict(
        equipment=equipment,
        history=records,
        issues=issues,
        templates=versions,
        serverTime=ms(now(conn)),
        operationalDate=str(day),
        shift=shift,
        user=actor.public(),
    )
