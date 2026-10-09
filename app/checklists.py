from decimal import Decimal
import sqlalchemy as sa
from . import schema as t
from .config import settings
from .db import lock, now, one
from .operations import lease
from .policy import operational_day
from .security import audit, fail


def new_template(conn, actor, body, request):
    lock(conn, "template:" + body.type)
    template = one(conn, sa.select(t.checklist_templates).where(t.checklist_templates.c.type == body.type))
    if not template:
        tid = conn.scalar(t.checklist_templates.insert().values(type=body.type, name=body.name).returning(t.checklist_templates.c.id))
        version = 0
    else:
        tid = template["id"]
        version = (
            conn.scalar(
                sa.select(sa.func.max(t.checklist_template_versions.c.version)).where(t.checklist_template_versions.c.template_id == tid)
            )
            or 0
        )
    if version != body.expected_version:
        fail(409, "O modelo foi alterado. Atualize a tela.")
    vid = conn.scalar(
        t.checklist_template_versions.insert()
        .values(template_id=tid, version=version + 1, questions=body.questions, created_by=actor.user["id"], created_at=now(conn))
        .returning(t.checklist_template_versions.c.id)
    )
    audit(conn, "CHECKLIST_TEMPLATE_VERSION_CREATED", {"version_id": vid}, actor, request)
    return {"ok": True, "id": vid}


def create_checklist(conn, actor, body, request):
    assignment = lease(conn, actor)
    eq = one(conn, sa.select(t.equipment).where(t.equipment.c.id == body.equipment_id).with_for_update())
    if not eq or not eq["active"]:
        fail(404, "Equipamento não disponível.")
    if eq["version"] != body.equipment_version:
        fail(409, "Equipamento alterado por outro operador. Atualize a tela.")
    template = one(
        conn,
        sa.select(t.checklist_template_versions, t.checklist_templates.c.type)
        .select_from(t.checklist_template_versions.join(t.checklist_templates))
        .where(t.checklist_template_versions.c.id == body.template_version_id),
    )
    if not template or template["type"] != eq["type"] or len(body.answers) != len(template["questions"]):
        fail(422, "Modelo e respostas não correspondem ao equipamento.")
    result = "crit" if "crit" in body.answers else "warn" if "warn" in body.answers else "ok"
    if eq["type"] == "bateria":
        if body.water is None or body.liters is None:
            fail(422, "Informe nível de água e litros.")
        if body.water == "Vazio":
            result = "crit"
        elif body.water == "Abastecer" and result == "ok":
            result = "warn"
    at = now(conn)
    day, shift = operational_day(at, settings().timezone)
    rid = conn.scalar(
        t.checklist_records.insert()
        .values(
            equipment_id=eq["id"],
            template_version_id=template["id"],
            user_id=actor.user["id"],
            device_id=assignment["device_id"],
            shift=shift,
            operational_date=day,
            started_at=at,
            finished_at=at,
            result=result,
            observation=body.observation,
            water=body.water,
            liters=body.liters,
        )
        .returning(t.checklist_records.c.id)
    )
    conn.execute(
        t.checklist_answers.insert(),
        [dict(record_id=rid, question=q, answer=a) for q, a in zip(template["questions"], body.answers, strict=True)],
    )
    conn.execute(t.equipment.update().where(t.equipment.c.id == eq["id"]).values(status=result, version=eq["version"] + 1))
    if result != "ok":
        conn.execute(
            t.issues.insert().values(
                equipment_id=eq["id"],
                record_id=rid,
                severity=result,
                status="OPEN",
                summary=body.observation or "Checklist requer tratamento.",
            )
        )
    audit(conn, "CHECKLIST_CREATED", {"record_id": rid, "equipment_id": eq["id"], "result": result}, actor, request)
    return {"ok": True, "id": rid}


def update_issue(conn, actor, iid, body, request):
    issue = one(conn, sa.select(t.issues).where(t.issues.c.id == iid).with_for_update())
    if not issue:
        fail(404, "Pendência não encontrada.")
    if issue["version"] != body.version or issue["status"] == "RESOLVED":
        fail(409, "Pendência já alterada ou resolvida.")
    at = now(conn)
    conn.execute(
        t.issues.update()
        .where(t.issues.c.id == iid)
        .values(
            status=body.status,
            resolution=body.reason,
            responsible_id=actor.user["id"],
            resolved_at=at if body.status == "RESOLVED" else None,
            version=issue["version"] + 1,
        )
    )
    conn.execute(
        t.issue_events.insert().values(
            issue_id=iid, user_id=actor.user["id"], created_at=at, previous_state=issue["status"], new_state=body.status, reason=body.reason
        )
    )
    audit(conn, "ISSUE_UPDATED", {"issue_id": iid, "status": body.status}, actor, request)
    return {"ok": True}


def swap_battery(conn, actor, body, request):
    assignment = lease(conn, actor)
    lock(conn, "battery-links")
    forklift = one(conn, sa.select(t.equipment).where(t.equipment.c.id == body.forklift_id).with_for_update())
    installed = one(conn, sa.select(t.equipment).where(t.equipment.c.id == body.installed_id).with_for_update())
    if (
        not forklift
        or forklift["type"] != "empilhadeira"
        or not forklift["active"]
        or not installed
        or installed["type"] != "bateria"
        or not installed["active"]
    ):
        fail(422, "Equipamentos inválidos para troca.")
    if body.installed_id == body.removed_id or body.in_meter < body.out_meter or Decimal(str(body.out_meter)) < forklift["hour_meter"]:
        fail(409, "Troca inválida ou horímetro regressivo.")
    link = one(
        conn, sa.select(t.battery_links).where(t.battery_links.c.forklift_id == body.forklift_id, t.battery_links.c.unlinked_at.is_(None))
    )
    if (link["battery_id"] if link else None) != body.removed_id:
        fail(409, "Bateria retirada não corresponde ao vínculo atual.")
    if conn.scalar(
        sa.select(t.battery_links.c.id).where(t.battery_links.c.battery_id == body.installed_id, t.battery_links.c.unlinked_at.is_(None))
    ):
        fail(409, "Bateria já vinculada a outra empilhadeira.")
    at = now(conn)
    if link:
        conn.execute(t.battery_links.update().where(t.battery_links.c.id == link["id"]).values(unlinked_at=at))
    conn.execute(t.battery_links.insert().values(battery_id=body.installed_id, forklift_id=body.forklift_id, linked_at=at))
    conn.execute(
        t.battery_swaps.insert().values(**body.model_dump(), user_id=actor.user["id"], device_id=assignment["device_id"], created_at=at)
    )
    conn.execute(
        t.equipment.update().where(t.equipment.c.id == body.forklift_id).values(hour_meter=body.in_meter, version=forklift["version"] + 1)
    )
    audit(
        conn,
        "BATTERY_SWAPPED",
        {"forklift_id": body.forklift_id, "installed_id": body.installed_id, "removed_id": body.removed_id},
        actor,
        request,
    )
    return {"ok": True}
