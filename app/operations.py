from datetime import timedelta
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from . import schema as t
from .config import settings
from .db import lock, now, one, rows
from .policy import can_transition, corridor_for, operational_day
from .security import audit, fail, grants, critical


def setting(conn, key, default):
    value = conn.scalar(sa.select(t.system_settings.c.value).where(t.system_settings.c.key == key))
    return value if value is not None else default


def lease(conn, actor):
    at = now(conn)
    row = one(
        conn,
        sa.select(t.device_assignments)
        .where(
            t.device_assignments.c.session_id == actor.session["id"],
            t.device_assignments.c.released_at.is_(None),
            t.device_assignments.c.expires_at > at,
        )
        .with_for_update(),
    )
    if not row:
        fail(409, "Selecione um dispositivo cadastrado para continuar.")
    device = one(conn, sa.select(t.devices).where(t.devices.c.id == row["device_id"]))
    if not device or not device["active"] or (actor.role == "empilhador" and device["type"] != "TABLET"):
        fail(403, "Dispositivo não autorizado.")
    return row


def select_device(conn, actor, device_id, request):
    lock(conn, "device-leases")
    at = now(conn)
    device = one(conn, sa.select(t.devices).where(t.devices.c.id == device_id).with_for_update())
    if not device or not device["active"] or (actor.role == "empilhador" and device["type"] != "TABLET"):
        fail(403, "Dispositivo não autorizado.")
    conn.execute(
        t.device_assignments.update()
        .where(t.device_assignments.c.expires_at <= at, t.device_assignments.c.released_at.is_(None))
        .values(released_at=at)
    )
    occupied = one(
        conn,
        sa.select(t.device_assignments).where(t.device_assignments.c.device_id == device_id, t.device_assignments.c.released_at.is_(None)),
    )
    if occupied and occupied["session_id"] != actor.session["id"]:
        fail(409, "Este dispositivo já está em uso. Encerre a sessão anterior.")
    pending = conn.scalar(
        sa.select(sa.func.count())
        .select_from(t.pallet_movements)
        .where(t.pallet_movements.c.user_id == actor.user["id"], t.pallet_movements.c.status == "PENDING")
    )
    if pending:
        fail(409, "Conclua a movimentação antes de trocar de equipamento.")
    conn.execute(
        t.device_assignments.update()
        .where(t.device_assignments.c.session_id == actor.session["id"], t.device_assignments.c.released_at.is_(None))
        .values(released_at=at)
    )
    conn.execute(
        t.device_assignments.insert().values(
            device_id=device_id,
            user_id=actor.user["id"],
            session_id=actor.session["id"],
            assigned_at=at,
            last_seen=at,
            expires_at=at + timedelta(seconds=settings().lease_seconds),
        )
    )
    audit(conn, "DEVICE_ASSIGNED", {"device_id": device_id}, actor, request)
    return {"ok": True}


def history(conn, action, pallet=None, actor=None, movement=None, previous=None, new=None, meta=None):
    at = now(conn)
    day, _ = operational_day(at, settings().timezone)
    conn.execute(
        t.operational_history.insert().values(
            timestamp=at,
            operational_date=day,
            user_id=actor.user["id"] if actor else movement["user_id"] if movement else None,
            device_id=movement["device_id"] if movement else None,
            request_id=movement["production_id"] if movement else None,
            pallet_id=pallet["id"] if pallet else None,
            authorization_id=movement["authorization_id"] if movement else None,
            address=pallet["address"] if pallet else "",
            corridor=pallet["corridor"] if pallet else "",
            action=action,
            previous_state=previous,
            new_state=new,
            metadata=meta or {},
        )
    )


def notify(conn, title, message):
    ids = conn.scalars(sa.select(t.users.c.id).where(t.users.c.active)).all()
    recipients = [uid for uid in ids if "pallet:view" in grants(conn, uid)[1]]
    if recipients:
        conn.execute(
            t.notifications.insert(), [dict(user_id=uid, title=title, message=message, created_at=now(conn)) for uid in recipients]
        )


def update_state(conn, pallet, state, **kw):
    conn.execute(
        t.pallet_requests.update().where(t.pallet_requests.c.id == pallet["id"]).values(state=state, version=pallet["version"] + 1, **kw)
    )


def authorize(conn, pallet, action, actor=None, reason="", source="INTERNAL"):
    at = now(conn)
    conn.execute(
        t.pallet_authorizations.update()
        .where(
            t.pallet_authorizations.c.pallet_request_id == pallet["id"],
            t.pallet_authorizations.c.action == action,
            t.pallet_authorizations.c.used_at.is_(None),
            t.pallet_authorizations.c.status == "APPROVED",
        )
        .values(status="REVOKED")
    )
    aid = conn.scalar(
        t.pallet_authorizations.insert()
        .values(
            pallet_request_id=pallet["id"],
            action=action,
            status="APPROVED",
            source=source,
            authorized_by=actor.user["id"] if actor else None,
            authorized_at=at,
            expires_at=at + timedelta(hours=8),
            reason=reason,
            metadata={},
        )
        .returning(t.pallet_authorizations.c.id)
    )
    audit(
        conn,
        "PALLET_AUTHORIZATION_CREATED",
        {"pallet_id": pallet["id"], "authorization_id": aid, "action": action, "source": source},
        actor,
    )
    return aid


def create_pallet(conn, actor, body, request):
    address = body.address.upper()
    lock(conn, "address:" + address)
    rules = setting(conn, "rules", {})
    for field in ("identified", "reference", "volumes", "stretch"):
        if rules.get(field + "_required") and not getattr(body, field):
            fail(422, f"A regra ativa exige: {field}.")
    if body.area == "EXP-PIC" and "pallet:exp_pic_manage" not in actor.permissions:
        fail(403, "Seu acesso não permite cadastrar EXP-PIC.")
    conn.execute(insert(t.locations).values(address=address, blocked=False).on_conflict_do_nothing(index_elements=["address"]))
    loc = one(conn, sa.select(t.locations).where(t.locations.c.address == address).with_for_update())
    if loc["blocked"]:
        fail(409, "Local bloqueado.")
    if conn.scalar(
        sa.select(t.pallet_requests.c.id).where(
            t.pallet_requests.c.address == address, t.pallet_requests.c.state.not_in(["COMPLETED", "CANCELLED"])
        )
    ):
        fail(409, "Esse endereço já possui palete em operação.")
    record = (
        conn.execute(
            t.pallet_requests.insert()
            .values(
                location_id=loc["id"],
                address=address,
                corridor=corridor_for(address, setting(conn, "corridors", [])),
                operator=body.operator,
                quantity=body.quantity,
                reference=body.reference,
                volumes=body.volumes,
                note=body.note,
                area=body.area,
                state="WAITING",
                created_by=actor.user["id"],
                created_at=now(conn),
            )
            .returning(t.pallet_requests)
        )
        .mappings()
        .one()
    )
    history(conn, "PALLET_REQUESTED", record, actor, new="WAITING")
    audit(conn, "PALLET_REQUESTED", {"pallet_id": record["id"]}, actor, request)
    notify(conn, "EXP-PIC · AVISAR ARMAZENISTA" if body.area == "EXP-PIC" else "Novo palete", address)
    return {"ok": True, "id": record["id"]}


def production(conn, actor, action, request):
    lock(conn, "production:" + str(actor.user["id"]))
    assignment = lease(conn, actor)
    current = one(
        conn,
        sa.select(t.production_requests)
        .where(t.production_requests.c.user_id == actor.user["id"], t.production_requests.c.status == "OPEN")
        .with_for_update(),
    )
    at = now(conn)
    if action == "start":
        if current:
            fail(409, "Já existe uma requisição aberta.")
        rid = conn.scalar(
            t.production_requests.insert()
            .values(user_id=actor.user["id"], device_id=assignment["device_id"], started_at=at, status="OPEN")
            .returning(t.production_requests.c.id)
        )
        day, _ = operational_day(at, settings().timezone)
        conn.execute(t.production_requests.update().where(t.production_requests.c.id == rid).values(number=f"REQ-{day:%Y%m%d}-{rid:04d}"))
    else:
        if not current:
            fail(409, "Não há requisição aberta.")
        rid = current["id"]
        if conn.scalar(
            sa.select(t.pallet_movements.c.id)
            .where(t.pallet_movements.c.production_id == rid, t.pallet_movements.c.status == "PENDING")
            .limit(1)
        ):
            fail(409, "Aguarde a confirmação das movimentações.")
        conn.execute(t.production_requests.update().where(t.production_requests.c.id == rid).values(status="CLOSED", ended_at=at))
    audit(conn, "PRODUCTION_" + action.upper(), {"request_id": rid}, actor, request)
    history(conn, "PRODUCTION_" + action.upper(), actor=actor, meta={"request_id": rid})
    return {"ok": True, "id": rid}


ACTION_PERMISSIONS = {
    "accept": "pallet:accept",
    "authorize-lower": "pallet:authorize_lower",
    "lower": "pallet:lower",
    "authorize-raise": "pallet:authorize_raise",
    "raise": "pallet:raise",
    "undo": "pallet:lower",
    "cancel": "pallet:cancel",
    "transfer": "pallet:transfer",
    "override": "pallet:override",
}


def pallet_command(conn, actor, pid, action, body, request):
    lock(conn, "pallet:" + str(pid))
    settle(conn, pid)
    p = one(conn, sa.select(t.pallet_requests).where(t.pallet_requests.c.id == pid).with_for_update())
    if not p:
        fail(404, "Palete não encontrado.")
    if p["version"] != body.version:
        fail(409, "O estado deste palete foi alterado. Atualize a tela.")
    if p["external_ref"]:
        fail(409, "Movimentação externa exige integração homologada.")
    at = now(conn)
    if action in ("lower", "raise"):
        assignment = lease(conn, actor)
        if p["assigned_to"] and p["assigned_to"] != actor.user["id"]:
            fail(409, "Este palete já está sendo movimentado por outro operador.")
        if conn.scalar(sa.select(t.locations.c.blocked).where(t.locations.c.id == p["location_id"])):
            fail(409, "Local bloqueado.")
        prod = one(
            conn,
            sa.select(t.production_requests)
            .where(t.production_requests.c.user_id == actor.user["id"], t.production_requests.c.status == "OPEN")
            .with_for_update(),
        )
        if not prod:
            fail(409, "Inicie uma requisição antes de movimentar.")
        direction = "LOWER" if action == "lower" else "RAISE"
        auth = one(
            conn,
            sa.select(t.pallet_authorizations)
            .where(
                t.pallet_authorizations.c.pallet_request_id == pid,
                t.pallet_authorizations.c.action == direction,
                t.pallet_authorizations.c.status == "APPROVED",
                t.pallet_authorizations.c.used_at.is_(None),
                t.pallet_authorizations.c.expires_at > at,
            )
            .order_by(t.pallet_authorizations.c.id.desc())
            .with_for_update()
            .limit(1),
        )
        if not auth:
            fail(
                403,
                "Palete ainda não está autorizado para subir." if action == "raise" else "Palete ainda não está autorizado para baixar.",
            )
        state = "LOWERING" if action == "lower" else "RETURNING"
        if not can_transition(p["state"], state, dict(authorized=True, device=True, lock=True, permission=True)):
            fail(409, "Estado não permite esta movimentação.")
        mid = conn.scalar(
            t.pallet_movements.insert()
            .values(
                pallet_request_id=pid,
                user_id=actor.user["id"],
                device_id=assignment["device_id"],
                production_id=prod["id"],
                authorization_id=auth["id"],
                direction=direction,
                previous_state=p["state"],
                started_at=at,
                confirm_at=at + timedelta(seconds=10),
                status="PENDING",
            )
            .returning(t.pallet_movements.c.id)
        )
        conn.execute(
            t.pallet_locks.insert().values(
                pallet_request_id=pid, user_id=actor.user["id"], device_id=assignment["device_id"], movement_id=mid, acquired_at=at
            )
        )
        update_state(conn, p, state, assigned_to=actor.user["id"])
    elif action == "undo":
        move = one(
            conn,
            sa.select(t.pallet_movements)
            .where(t.pallet_movements.c.pallet_request_id == pid, t.pallet_movements.c.status == "PENDING")
            .with_for_update(),
        )
        if not move or move["user_id"] != actor.user["id"] or move["confirm_at"] <= at:
            fail(409, "A janela de cancelamento terminou ou pertence a outro operador.")
        needed = "pallet:lower" if move["direction"] == "LOWER" else "pallet:raise"
        if needed not in actor.permissions:
            fail(403, "Ação não permitida.")
        conn.execute(t.pallet_movements.update().where(t.pallet_movements.c.id == move["id"]).values(status="CANCELLED", finished_at=at))
        conn.execute(t.pallet_locks.delete().where(t.pallet_locks.c.pallet_request_id == pid))
        state = move["previous_state"]
        update_state(conn, p, state, assigned_to=None)
    elif action in ("authorize-lower", "authorize-raise"):
        lower = action == "authorize-lower"
        allowed = ("WAITING", "ASSIGNED", "LOWER_AUTHORIZED") if lower else ("FLOOR", "READY", "RAISE_AUTHORIZED")
        if p["state"] not in allowed:
            fail(409, "Estado não permite autorização.")
        if not lower and len(body.reason) < 3:
            fail(422, "Informe o motivo da liberação.")
        authorize(conn, p, "LOWER" if lower else "RAISE", actor, body.reason)
        state = "LOWER_AUTHORIZED" if lower else "READY"
        update_state(conn, p, state, **({"ready_at": at} if not lower else {}))
    elif action == "accept":
        lease(conn, actor)
        if p["assigned_to"] or p["state"] not in ("WAITING", "LOWER_AUTHORIZED", "READY", "RAISE_AUTHORIZED"):
            fail(409, "Este palete já está sendo movimentado por outro operador.")
        state = "ASSIGNED" if p["state"] == "WAITING" else p["state"]
        update_state(conn, p, state, assigned_to=actor.user["id"])
    elif action == "transfer":
        if len(body.reason) < 3 or not body.target_user_id:
            fail(422, "Informe operador e motivo.")
        if p["state"] in ("LOWERING", "RETURNING", "COMPLETED", "CANCELLED"):
            fail(409, "Não é possível transferir neste estado.")
        target = one(conn, sa.select(t.users).where(t.users.c.id == body.target_user_id, t.users.c.active))
        if not target or "pallet:accept" not in grants(conn, target["id"])[1]:
            fail(403, "Operador de destino não autorizado.")
        state = p["state"]
        update_state(conn, p, state, assigned_to=target["id"])
    elif action == "cancel":
        if len(body.reason) < 3:
            fail(422, "Informe o motivo.")
        state = "CANCELLED"
        if not can_transition(p["state"], state, {}):
            fail(409, "Movimentação física exige correção auditada.")
        update_state(conn, p, state, assigned_to=None)
        conn.execute(
            t.pallet_authorizations.update()
            .where(t.pallet_authorizations.c.pallet_request_id == pid, t.pallet_authorizations.c.used_at.is_(None))
            .values(status="REVOKED")
        )
    elif action == "override":
        critical(actor)
        if (
            len(body.reason) < 10
            or body.target_state not in ("FLOOR", "COMPLETED", "CANCELLED")
            or p["state"] in ("LOWERING", "RETURNING", "COMPLETED", "CANCELLED")
        ):
            fail(422, "Correção exige motivo detalhado e estado físico conciliável.")
        state = body.target_state
        update_state(conn, p, state, assigned_to=None, lowered_at=at if state == "FLOOR" else p["lowered_at"])
        conn.execute(
            t.pallet_authorizations.update()
            .where(t.pallet_authorizations.c.pallet_request_id == pid, t.pallet_authorizations.c.used_at.is_(None))
            .values(status="REVOKED")
        )
    else:
        fail(404, "Ação não encontrada.")
    history(
        conn,
        "PALLET_" + action.upper().replace("-", "_"),
        p,
        actor,
        previous=p["state"],
        new=state,
        meta={"reason": body.reason, "previous_operator": p["assigned_to"], "target_operator": body.target_user_id},
    )
    audit(
        conn,
        "PALLET_" + action.upper().replace("-", "_"),
        {"pallet_id": pid, "previous": p["state"], "new": state, "reason": body.reason},
        actor,
        request,
    )
    return {"ok": True, "id": pid, "state": state, "version": p["version"] + 1}


def settle(conn, pid=None):
    at = now(conn)
    query = sa.select(t.pallet_requests).where(t.pallet_requests.c.state.not_in(["COMPLETED", "CANCELLED"]))
    if pid:
        query = query.where(t.pallet_requests.c.id == pid)
    for p in rows(conn, query.with_for_update(skip_locked=True)):
        move = one(
            conn,
            sa.select(t.pallet_movements).where(
                t.pallet_movements.c.pallet_request_id == p["id"],
                t.pallet_movements.c.status == "PENDING",
                t.pallet_movements.c.confirm_at <= at,
            ),
        )
        if move:
            lower = move["direction"] == "LOWER"
            confirmed = move["confirm_at"]
            state = ("READY" if p["area"] == "EXP-PIC" else "FLOOR") if lower else "COMPLETED"
            values = {"assigned_to": None}
            if lower:
                values.update(lowered_at=confirmed, due_at=confirmed + timedelta(minutes=10 if p["area"] == "EXP-PIC" else 90))
                if p["area"] == "EXP-PIC":
                    authorize(conn, p, "RAISE", source="EXP_PIC")
                    values["ready_at"] = confirmed
            update_state(conn, p, state, **values)
            conn.execute(
                t.pallet_movements.update().where(t.pallet_movements.c.id == move["id"]).values(status="CONFIRMED", finished_at=confirmed)
            )
            conn.execute(
                t.pallet_authorizations.update().where(t.pallet_authorizations.c.id == move["authorization_id"]).values(used_at=confirmed)
            )
            conn.execute(t.pallet_locks.delete().where(t.pallet_locks.c.pallet_request_id == p["id"]))
            counter = t.production_requests.c.down_count if lower else t.production_requests.c.up_count
            conn.execute(
                t.production_requests.update()
                .where(t.production_requests.c.id == move["production_id"])
                .values({counter.name: counter + 1})
            )
            history(conn, "LOWER_CONFIRMED" if lower else "RAISE_CONFIRMED", p, movement=move, previous=p["state"], new=state)
            audit(conn, "MOVEMENT_CONFIRMED", {"pallet_id": p["id"], "movement_id": move["id"], "state": state})
            notify(conn, "Movimentação concluída", p["address"])
        elif p["state"] == "FLOOR" and p["lowered_at"] and (p["area"] == "EXP-PIC" or p["lowered_at"] + timedelta(minutes=90) <= at):
            authorize(conn, p, "RAISE", source="EXP_PIC" if p["area"] == "EXP-PIC" else "TIMER")
            update_state(conn, p, "READY", ready_at=at)
            history(conn, "AUTO_RELEASE", p, previous="FLOOR", new="READY")
            notify(conn, "Palete liberado", p["address"])
        elif (
            p["state"] in ("WAITING", "ASSIGNED", "LOWER_AUTHORIZED")
            and p["created_at"] + timedelta(minutes=10) <= at
            and not p["waiting_alerted"]
        ):
            conn.execute(t.pallet_requests.update().where(t.pallet_requests.c.id == p["id"]).values(waiting_alerted=True))
            notify(conn, "ALERTA · +10 MIN", p["address"])
            history(conn, "WAITING_OVERDUE", p)
        elif (
            p["area"] == "EXP-PIC"
            and p["state"] in ("FLOOR", "READY", "RAISE_AUTHORIZED")
            and p["due_at"]
            and p["due_at"] <= at
            and not p["pic_alerted"]
        ):
            conn.execute(t.pallet_requests.update().where(t.pallet_requests.c.id == p["id"]).values(pic_alerted=True))
            notify(conn, "EXP-PIC ATRASADO · AVISAR ARMAZENISTA", p["address"])
            history(conn, "EXP_PIC_OVERDUE", p)
