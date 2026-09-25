import asyncio
import json
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlsplit

import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__, schema as t, inputs as inp, operations as ops, checklists, views
from .config import settings
from .db import engine, lock, now, one, rows
from .security import (
    Actor,
    authenticate,
    audit,
    audit_denied,
    critical,
    digest,
    fail,
    grants,
    idempotent,
    new_session,
    password_hash,
    rate_limit,
    revoke_user,
    verify,
)

log = logging.getLogger("selene")
API = "/api/site-selene"
PUBLIC = Path(__file__).resolve().parent.parent / "public"


async def timer_worker():
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception as exc:
            log.error(json.dumps({"event": "TIMER_WORKER_FAILED", "type": type(exc).__name__}))
        await asyncio.sleep(1)


def tick():
    with engine().begin() as conn:
        ops.settle(conn)
        at = now(conn)
        conn.execute(
            t.device_assignments.update()
            .where(t.device_assignments.c.expires_at <= at, t.device_assignments.c.released_at.is_(None))
            .values(released_at=at)
        )
        conn.execute(
            t.access_codes.update()
            .where(t.access_codes.c.expires_at <= at, t.access_codes.c.revoked_at.is_(None), t.access_codes.c.used_at.is_(None))
            .values(revoked_at=at)
        )


@asynccontextmanager
async def lifespan(app):
    cfg = settings()
    with engine().connect() as conn:
        if conn.scalar(sa.text("SELECT version_num FROM alembic_version")) != "0001_operational":
            raise RuntimeError("Aplique as migrations antes de iniciar.")
        if cfg.environment in ("staging", "production"):
            bad = conn.scalar(
                sa.text("SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname=current_user")
            )
            owner = conn.scalar(sa.text("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user)"))
            if bad or owner:
                raise RuntimeError("A aplicação exige credencial PostgreSQL sem privilégios administrativos e sem propriedade das tabelas.")
    worker = asyncio.create_task(timer_worker())
    yield
    worker.cancel()
    try:
        await worker
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Site Selene", version=__version__, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=[urlsplit(settings().public_origin).hostname])


@app.middleware("http")
async def protections(request, call_next):
    request.state.correlation_id = str(uuid4())
    cfg = settings()
    response = None
    if cfg.environment in ("staging", "production") and request.url.scheme != "https":
        response = JSONResponse({"message": "HTTPS obrigatório."}, 403)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if (
            request.headers.get("origin", "").rstrip("/") != cfg.public_origin.rstrip("/")
            or request.headers.get("sec-fetch-site") == "cross-site"
        ):
            response = JSONResponse({"message": "Origem não autorizada."}, 403)
        chunks = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > 128 * 1024:
                response = JSONResponse({"message": "Solicitação muito grande."}, 413)
                break
            chunks.append(chunk)
        if total <= 128 * 1024:
            request._body = b"".join(chunks)
        if not request.headers.get("content-type", "").startswith("application/json"):
            response = JSONResponse({"message": "Use JSON."}, 415)
    if response is None:
        try:
            response = await call_next(request)
        except Exception as exc:
            log.error(json.dumps({"event": "REQUEST_FAILED", "correlation_id": request.state.correlation_id, "type": type(exc).__name__}))
            response = JSONResponse(
                {"message": "Não foi possível concluir a operação.", "correlation_id": request.state.correlation_id}, 500
            )
    response.headers.update(
        {
            "X-Correlation-ID": request.state.correlation_id,
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
            "Cross-Origin-Opener-Policy": "same-origin",
        }
    )
    if cfg.secure_cookies:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    if exc.status_code in (403, 409, 429) and request.url.path.startswith(API):
        try:
            await asyncio.to_thread(audit_denied, "REQUEST_DENIED", request, {"path": request.url.path, "status": exc.status_code})
        except Exception:
            log.error("AUDIT_WRITE_FAILED")
    return JSONResponse({"ok": False, "message": exc.detail, "correlation_id": request.state.correlation_id}, exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid(request, exc):
    return JSONResponse({"ok": False, "message": "Verifique os campos informados.", "correlation_id": request.state.correlation_id}, 422)


@app.exception_handler(IntegrityError)
async def conflict(request, exc):
    return JSONResponse(
        {"ok": False, "message": "Conflito de dados. Atualize e tente novamente.", "correlation_id": request.state.correlation_id}, 409
    )


def run(request, permission, body, operation, sensitive=False):
    with engine().begin() as conn:
        if request.method not in ("GET", "HEAD") and request.url.path.startswith((API + "/users", API + "/roles")):
            lock(conn, "admin-users")
        actor = authenticate(conn, request, permission, touch=request.method not in ("GET", "HEAD"))
        if sensitive:
            critical(actor)
        if request.method in ("GET", "HEAD"):
            return operation(conn, actor)
        rate_limit(f"command:{actor.user['id']}", 120)
        return idempotent(conn, actor, request, body, lambda: operation(conn, actor))


def set_session(response, token):
    response.set_cookie(
        settings().cookie_name,
        token,
        secure=settings().secure_cookies,
        httponly=True,
        samesite="strict",
        path="/",
        max_age=settings().absolute_seconds,
    )


@app.get("/health/live")
def live():
    return {"ok": True}


@app.get("/health/ready")
def ready():
    try:
        with engine().connect() as conn:
            valid = conn.scalar(sa.text("SELECT version_num FROM alembic_version")) == "0001_operational"
            return JSONResponse({"ok": valid}, 200 if valid else 503)
    except Exception:
        return JSONResponse({"ok": False}, 503)


@app.get(API + "/status")
def status():
    return {"ok": True, "version": __version__}


@app.post(API + "/auth/login")
def login(request: Request, body: inp.Login):
    ip = request.client.host
    rate_limit("login-ip:" + ip, 30, 900)
    rate_limit("login-user:" + body.matricula.lower(), 8, 900)
    with engine().begin() as conn:
        user = one(conn, sa.select(t.users).where(t.users.c.matricula == body.matricula.lower()).with_for_update())
        valid = verify(body.senha, user["password_hash"] if user else None)
        if not valid or not user or not user["active"]:
            audit(conn, "LOGIN_FAILED", request=request)
            # Commit failure event before returning the generic response.
            return JSONResponse({"message": "Credenciais inválidas."}, 401)
        role, permissions = grants(conn, user["id"])
        if settings().require_admin_mfa and role == "ti":
            fail(403, "Use a identidade corporativa com MFA.")
        prior = request.cookies.get(settings().cookie_name)
        if prior:
            conn.execute(t.sessions.update().where(t.sessions.c.token_hash == digest(prior)).values(revoked_at=now(conn)))
            prior_id = conn.scalar(sa.select(t.sessions.c.id).where(t.sessions.c.token_hash == digest(prior)))
            if prior_id:
                conn.execute(
                    t.device_assignments.update()
                    .where(t.device_assignments.c.session_id == prior_id, t.device_assignments.c.released_at.is_(None))
                    .values(released_at=now(conn))
                )
        token, session = new_session(conn, user["id"])
        actor = Actor(dict(user), session, role, permissions)
        audit(conn, "LOGIN_SUCCESS", actor=actor, request=request)
        result = JSONResponse({"ok": True, "user": actor.public(), "csrfToken": session["csrf"]})
        set_session(result, token)
        return result


@app.get(API + "/auth/me")
def me(request: Request):
    return run(request, None, {}, lambda c, a: dict(user=a.public(), csrfToken=a.session["csrf"], scope=a.session["scope"]))


@app.post(API + "/auth/logout")
def logout(request: Request):
    def action(conn, actor):
        at = now(conn)
        conn.execute(t.sessions.update().where(t.sessions.c.id == actor.session["id"]).values(revoked_at=at))
        conn.execute(
            t.access_codes.update()
            .where(t.access_codes.c.session_id == actor.session["id"], t.access_codes.c.used_at.is_(None))
            .values(revoked_at=at)
        )
        conn.execute(
            t.device_assignments.update()
            .where(t.device_assignments.c.session_id == actor.session["id"], t.device_assignments.c.released_at.is_(None))
            .values(released_at=at)
        )
        audit(conn, "LOGOUT", actor=actor, request=request)
        return {"ok": True}

    response = JSONResponse(run(request, None, {}, action))
    response.delete_cookie(settings().cookie_name, path="/", secure=settings().secure_cookies, httponly=True, samesite="strict")
    return response


@app.post(API + "/auth/reauth")
def reauth(request: Request, body: inp.Password):
    def action(conn, actor):
        rate_limit("reauth:" + str(actor.user["id"]), 5, 300)
        if actor.session["scope"] != "empilhamento" or not verify(body.senha, actor.user["password_hash"]):
            fail(403, "Reautenticação inválida.")
        conn.execute(t.sessions.update().where(t.sessions.c.id == actor.session["id"]).values(reauth_at=now(conn)))
        audit(conn, "REAUTH_SUCCESS", actor=actor, request=request)
        return {"ok": True}

    # Passwords never enter the idempotency table, even encrypted.
    with engine().begin() as conn:
        return action(conn, authenticate(conn, request))


@app.post(API + "/auth/activity")
def activity(request: Request):
    with engine().begin() as conn:
        authenticate(conn, request)
    return {"ok": True}


@app.get(API + "/users")
def users(request: Request):
    return run(
        request,
        "users:view",
        {},
        lambda c, a: {
            "users": [
                dict(id=u["id"], matricula=u["matricula"], nome=u["nome"], active=u["active"], role=grants(c, u["id"])[0])
                for u in rows(c, sa.select(t.users).order_by(t.users.c.id).limit(500))
            ]
        },
    )


@app.post(API + "/users")
def create_user(request: Request, body: inp.UserCreate):
    def action(conn, actor):
        if body.role == "ti" and actor.role != "ti":
            fail(403, "Somente TI pode criar TI.")
        if body.role == "ti":
            critical(actor)
        uid = conn.scalar(
            t.users.insert()
            .values(matricula=body.matricula.lower(), nome=body.nome, password_hash=password_hash(body.senha))
            .returning(t.users.c.id)
        )
        rid = conn.scalar(sa.select(t.roles.c.id).where(t.roles.c.name == body.role))
        conn.execute(t.user_roles.insert().values(user_id=uid, role_id=rid))
        audit(conn, "USER_CREATED", {"user_id": uid, "role": body.role}, actor, request)
        return {"ok": True, "id": uid}

    return run(request, "users:create", {**body.model_dump(exclude={"senha"}), "password_fingerprint": digest(body.senha, "input")}, action)


@app.patch(API + "/users/{matricula}")
def update_user(matricula: str, request: Request, body: inp.UserUpdate):
    def action(conn, actor):
        lock(conn, "admin-users")
        user = one(conn, sa.select(t.users).where(t.users.c.matricula == matricula.lower()).with_for_update())
        if not user:
            fail(404, "Usuário não encontrado.")
        role, _ = grants(conn, user["id"])
        if actor.role != "ti" and (role == "ti" or body.role == "ti"):
            fail(403, "Somente TI pode alterar contas TI.")
        if body.action == "role" or role == "ti":
            critical(actor)
        if body.action == "active" and "users:disable" not in actor.permissions:
            fail(403, "Seu acesso não permite bloquear usuários.")
        if (
            role == "ti"
            and user["active"]
            and ((body.action == "active" and body.active is False) or (body.action == "role" and body.role != "ti"))
        ):
            count = conn.scalar(
                sa.select(sa.func.count())
                .select_from(t.users.join(t.user_roles).join(t.roles))
                .where(t.users.c.active, t.roles.c.name == "ti")
            )
            if count <= 1:
                fail(409, "A última conta TI ativa deve ser preservada.")
        if body.action == "password" and body.senha is not None:
            rate_limit("reset:" + str(actor.user["id"]), 10, 900)
            conn.execute(t.users.update().where(t.users.c.id == user["id"]).values(password_hash=password_hash(body.senha)))
        elif body.action == "active" and body.active is not None:
            conn.execute(t.users.update().where(t.users.c.id == user["id"]).values(active=body.active))
        elif body.action == "role" and body.role:
            conn.execute(t.user_roles.delete().where(t.user_roles.c.user_id == user["id"]))
            rid = conn.scalar(sa.select(t.roles.c.id).where(t.roles.c.name == body.role))
            conn.execute(t.user_roles.insert().values(user_id=user["id"], role_id=rid))
        else:
            fail(422, "Alteração inválida.")
        revoke_user(conn, user["id"])
        audit(conn, "USER_" + body.action.upper(), {"user_id": user["id"]}, actor, request)
        return {"ok": True, "user": {"active": body.active if body.active is not None else user["active"]}}

    return run(
        request, "users:update", {**body.model_dump(exclude={"senha"}), "password_fingerprint": digest(body.senha or "", "input")}, action
    )


@app.delete(API + "/users/{matricula}")
def disable_user(matricula: str, request: Request):
    with engine().begin() as conn:
        authenticate(conn, request, "users:delete")
    return update_user(matricula, request, inp.UserUpdate(action="active", active=False))


@app.get(API + "/roles")
def role_list(request: Request):
    return run(
        request,
        "roles:view",
        {},
        lambda c, a: {
            "roles": [
                dict(
                    id=r["id"],
                    name=r["name"],
                    permissions=list(
                        c.scalars(
                            sa.select(t.permissions.c.name)
                            .select_from(t.role_permissions.join(t.permissions))
                            .where(t.role_permissions.c.role_id == r["id"])
                        )
                    ),
                )
                for r in rows(c, sa.select(t.roles))
            ],
            "permissions": list(c.scalars(sa.select(t.permissions.c.name))),
        },
    )


@app.put(API + "/roles/{rid}")
def update_role(rid: int, request: Request, body: inp.RoleUpdate):
    def action(c, a):
        lock(c, "admin-users")
        role = one(c, sa.select(t.roles).where(t.roles.c.id == rid))
        if not role or role["name"] == "ti":
            fail(403, "Perfil TI base protegido contra perda do acesso administrativo.")
        ids = rows(c, sa.select(t.permissions).where(t.permissions.c.name.in_(body.permissions)))
        if len(ids) != len(set(body.permissions)):
            fail(422, "Permissão desconhecida.")
        c.execute(t.role_permissions.delete().where(t.role_permissions.c.role_id == rid))
        if ids:
            c.execute(t.role_permissions.insert(), [dict(role_id=rid, permission_id=r["id"]) for r in ids])
        for uid in c.scalars(sa.select(t.user_roles.c.user_id).where(t.user_roles.c.role_id == rid)):
            revoke_user(c, uid)
        audit(c, "PERMISSION_CHANGED", {"role_id": rid, "permissions": body.permissions}, a, request)
        return {"ok": True}

    return run(request, "roles:manage", body.model_dump(), action, True)


@app.get(API + "/state")
def state(request: Request):
    return run(request, None, {}, views.state)


@app.post(API + "/devices")
def create_device(request: Request, body: inp.DeviceCreate):
    def action(c, a):
        did = c.scalar(t.devices.insert().values(**body.model_dump()).returning(t.devices.c.id))
        audit(c, "DEVICE_CREATED", {"device_id": did}, a, request)
        return {"ok": True, "id": did}

    return run(request, "devices:manage", body.model_dump(), action)


@app.delete(API + "/devices/{did}")
def disable_device(did: int, request: Request):
    def action(c, a):
        lock(c, "device-leases")
        if c.scalar(
            sa.select(t.device_assignments.c.id).where(
                t.device_assignments.c.device_id == did,
                t.device_assignments.c.released_at.is_(None),
                t.device_assignments.c.expires_at > now(c),
            )
        ):
            fail(409, "Dispositivo em uso.")
        c.execute(t.devices.update().where(t.devices.c.id == did).values(active=False))
        audit(c, "DEVICE_DISABLED", {"device_id": did}, a, request)
        return {"ok": True}

    return run(request, "devices:manage", {}, action)


@app.post(API + "/devices/select")
def select_device(request: Request, body: inp.DeviceSelect):
    return run(request, "devices:view", body.model_dump(), lambda c, a: ops.select_device(c, a, body.device_id, request))


@app.post(API + "/devices/heartbeat")
def heartbeat(request: Request):
    with engine().begin() as conn:
        actor = authenticate(conn, request, "devices:view", touch=False)
        assignment = ops.lease(conn, actor)
        at = now(conn)
        conn.execute(
            t.device_assignments.update()
            .where(t.device_assignments.c.id == assignment["id"])
            .values(last_seen=at, expires_at=at + timedelta(seconds=settings().lease_seconds))
        )
    return {"ok": True}


@app.post(API + "/production/{action}")
def production(action: str, request: Request):
    if action not in ("start", "close"):
        fail(404, "Ação não encontrada.")
    return run(request, "production:" + action, {}, lambda c, a: ops.production(c, a, action, request))


@app.post(API + "/pallets")
def create_pallet(request: Request, body: inp.PalletCreate):
    return run(request, "pallet:request", body.model_dump(), lambda c, a: ops.create_pallet(c, a, body, request))


@app.post(API + "/pallets/{pid}/{action}")
def pallet_command(pid: int, action: str, request: Request, body: inp.Command):
    permission = ops.ACTION_PERMISSIONS.get(action)
    if not permission:
        fail(404, "Ação não encontrada.")
    return run(request, permission, body.model_dump(), lambda c, a: ops.pallet_command(c, a, pid, action, body, request))


@app.post(API + "/locations/{action}")
def location(action: str, request: Request, body: inp.LocationCommand):
    if action not in ("block", "unlock"):
        fail(404, "Ação não encontrada.")

    def perform(c, a):
        address = body.address.upper()
        lock(c, "address:" + address)
        c.execute(
            insert(t.locations)
            .values(address=address, blocked=action == "block", reason=body.reason)
            .on_conflict_do_update(index_elements=["address"], set_=dict(blocked=action == "block", reason=body.reason))
        )
        audit(c, "LOCATION_" + action.upper(), {"address": address, "reason": body.reason}, a, request)
        return {"ok": True}

    return run(request, "location:" + action, body.model_dump(), perform, action == "unlock")


@app.post(API + "/codes")
def create_code(request: Request):
    def action(c, a):
        if a.session["scope"] != "empilhamento":
            fail(403, "Gere o código a partir do Empilhamento.")
        rate_limit("code-create:" + str(a.session["id"]), 5, 120)
        at = now(c)
        c.execute(
            t.access_codes.update()
            .where(t.access_codes.c.user_id == a.user["id"], t.access_codes.c.used_at.is_(None), t.access_codes.c.revoked_at.is_(None))
            .values(revoked_at=at)
        )
        lock(c, "code-generation")
        for _ in range(30):
            code = f"{secrets.randbelow(1000000):06d}"
            hashed = digest(code, "code")
            if not c.scalar(sa.select(t.access_codes.c.id).where(t.access_codes.c.code_hash == hashed)):
                break
        else:
            fail(503, "Não foi possível gerar código. Procure TI.")
        cid = c.scalar(
            t.access_codes.insert()
            .values(
                user_id=a.user["id"],
                session_id=a.session["id"],
                code_hash=hashed,
                created_at=at,
                expires_at=at + timedelta(minutes=2),
                origin="empilhamento",
            )
            .returning(t.access_codes.c.id)
        )
        audit(c, "CODE_CREATED", {"code_id": cid}, a, request)
        return {"ok": True, "id": cid, "code": code, "expiresAt": views.ms(at + timedelta(minutes=2)), "serverTime": views.ms(at)}

    return run(request, "codes:create", {}, action)


@app.delete(API + "/codes")
def revoke_code(request: Request):
    def action(c, a):
        c.execute(
            t.access_codes.update()
            .where(t.access_codes.c.user_id == a.user["id"], t.access_codes.c.used_at.is_(None))
            .values(revoked_at=now(c))
        )
        audit(c, "CODE_REVOKED", actor=a, request=request)
        return {"ok": True}

    return run(request, "codes:create", {}, action)


@app.post(API + "/codes/redeem")
def redeem(request: Request, body: inp.Redeem):
    rate_limit("code-redeem-ip:" + request.client.host, 5, 60)
    rate_limit("code-redeem-value:" + body.code, 5, 120)
    with engine().begin() as conn:
        code = one(conn, sa.select(t.access_codes).where(t.access_codes.c.code_hash == digest(body.code, "code")).with_for_update())
        at = now(conn)
        invalid = not code or code["used_at"] or code["revoked_at"] or code["expires_at"] <= at
        user = one(conn, sa.select(t.users).where(t.users.c.id == code["user_id"]).with_for_update(read=True)) if code else None
        origin = one(conn, sa.select(t.sessions).where(t.sessions.c.id == code["session_id"])) if code else None
        if (
            invalid
            or not user
            or not user["active"]
            or not origin
            or origin["revoked_at"]
            or origin["expires_at"] <= at
            or origin["last_seen"] + timedelta(seconds=settings().idle_seconds) <= at
        ):
            if code:
                conn.execute(
                    t.access_codes.update().where(t.access_codes.c.id == code["id"]).values(attempt_count=code["attempt_count"] + 1)
                )
            audit(conn, "CODE_FAILED", request=request)
            return JSONResponse({"ok": False, "message": "Código inválido ou indisponível."}, 401)
        role, perms = grants(conn, user["id"])
        if "codes:redeem" not in perms:
            fail(403, "Acesso não autorizado.")
        conn.execute(t.access_codes.update().where(t.access_codes.c.id == code["id"]).values(used_at=at))
        prior = request.cookies.get(settings().cookie_name)
        if prior:
            old = one(conn, sa.select(t.sessions).where(t.sessions.c.token_hash == digest(prior)))
            if old:
                conn.execute(t.sessions.update().where(t.sessions.c.id == old["id"]).values(revoked_at=at))
                conn.execute(
                    t.device_assignments.update()
                    .where(t.device_assignments.c.session_id == old["id"], t.device_assignments.c.released_at.is_(None))
                    .values(released_at=at)
                )
        token, session = new_session(conn, user["id"], "checklist")
        actor = Actor(dict(user), session, role, perms)
        audit(conn, "CODE_REDEEMED", {"code_id": code["id"]}, actor, request)
        result = JSONResponse({"ok": True, "user": actor.public(), "csrfToken": session["csrf"]})
        set_session(result, token)
        return result


@app.get(API + "/checklist/state")
def checklist_state(request: Request):
    return run(request, "checklist:view", {}, views.checklist_state)


@app.post(API + "/checklist/templates")
def template_create(request: Request, body: inp.TemplateCreate):
    return run(request, "checklist:manage", body.model_dump(), lambda c, a: checklists.new_template(c, a, body, request))


@app.post(API + "/checklist/records")
def checklist_create(request: Request, body: inp.ChecklistCreate):
    return run(request, "checklist:create", body.model_dump(), lambda c, a: checklists.create_checklist(c, a, body, request))


@app.post(API + "/equipment")
def equipment_create(request: Request, body: inp.EquipmentCreate):
    def action(c, a):
        eid = c.scalar(t.equipment.insert().values(**body.model_dump()).returning(t.equipment.c.id))
        audit(c, "EQUIPMENT_CREATED", {"equipment_id": eid}, a, request)
        return {"ok": True, "id": eid}

    return run(request, "equipment:manage", body.model_dump(), action)


@app.put(API + "/equipment/{eid}")
def equipment_update(eid: int, request: Request, body: inp.EquipmentUpdate):
    def action(c, a):
        eq = one(c, sa.select(t.equipment).where(t.equipment.c.id == eid).with_for_update())
        if not eq or eq["version"] != body.version or eq["type"] != body.type:
            fail(409, "Equipamento alterado ou tipo incompatível com seu histórico.")
        c.execute(t.equipment.update().where(t.equipment.c.id == eid).values(**{**body.model_dump(), "version": body.version + 1}))
        audit(c, "EQUIPMENT_UPDATED", {"equipment_id": eid}, a, request)
        return {"ok": True}

    return run(request, "equipment:manage", body.model_dump(), action)


@app.patch(API + "/issues/{iid}")
def issue_update(iid: int, request: Request, body: inp.IssueUpdate):
    return run(request, "issues:resolve", body.model_dump(), lambda c, a: checklists.update_issue(c, a, iid, body, request))


@app.post(API + "/battery-swaps")
def battery_swap(request: Request, body: inp.BatterySwap):
    return run(request, "checklist:create", body.model_dump(), lambda c, a: checklists.swap_battery(c, a, body, request))


@app.post(API + "/notifications/{action}")
def notifications(action: str, request: Request):
    if action not in ("read", "dismiss"):
        fail(404, "Ação não encontrada.")

    def perform(c, a):
        c.execute(
            t.notifications.update()
            .where(t.notifications.c.user_id == a.user["id"])
            .values({"read_at" if action == "read" else "dismissed_at": now(c)})
        )
        return {"ok": True}

    return run(request, None, {}, perform)


@app.get(API + "/history")
def history(request: Request, q: str = "", page: int = 1):
    if page < 1 or len(q) > 100:
        fail(422, "Filtro inválido.")

    def read(c, a):
        if not {"history:view_all", "history:view_own"} & a.permissions:
            fail(403, "Consulta não permitida.")
        query = views.history_query(a)
        if q:
            query = query.where(
                sa.or_(
                    t.operational_history.c.address.icontains(q, autoescape=True),
                    t.operational_history.c.action.icontains(q, autoescape=True),
                    t.users.c.nome.icontains(q, autoescape=True),
                    t.production_requests.c.number.icontains(q, autoescape=True),
                )
            )
        result = rows(c, query.order_by(t.operational_history.c.id.desc()).offset((page - 1) * 100).limit(101))
        return {"rows": [views.history_row(r) for r in result[:100]], "hasMore": len(result) > 100, "page": page}

    return run(request, None, {}, read)


@app.get(API + "/audit-secure")
def audit_read(request: Request, page: int = 1, q: str = ""):
    if page < 1 or len(q) > 100:
        fail(422, "Filtro inválido.")

    def read(c, a):
        query = sa.select(t.audit_log, t.users.c.nome, t.users.c.matricula).select_from(t.audit_log.outerjoin(t.users))
        if q:
            query = query.where(t.audit_log.c.action.icontains(q, autoescape=True))
        result = rows(c, query.order_by(t.audit_log.c.id.desc()).offset((page - 1) * 100).limit(101))
        return {
            "events": [
                dict(
                    id=r["id"],
                    time=views.ms(r["timestamp"]),
                    action=r["action"],
                    details=json.dumps(r["details"], ensure_ascii=False),
                    actorName=r["nome"] or "Sistema",
                    actorMatricula=r["matricula"] or "",
                    actorRole=grants(c, r["user_id"])[0] if r["user_id"] else "sistema",
                    source="servidor-seguro",
                    category="seguranca",
                )
                for r in result[:100]
            ],
            "hasMore": len(result) > 100,
        }

    return run(request, "audit:view", {}, read)


@app.get(API + "/settings/{key}")
def get_setting(key: str, request: Request):
    return run(request, "system:configure", {}, lambda c, a: {"value": ops.setting(c, key, {})})


@app.put(API + "/settings/{key}")
def save_setting(key: str, request: Request, body: inp.SettingsUpdate):
    def action(c, a):
        value = body.value
        if key == "corridors":
            if (
                not isinstance(value, list)
                or len(value) > 200
                or any(not isinstance(v, str) or not 1 <= len(v) <= 30 for v in value)
                or "OUTROS" not in value
            ):
                fail(422, "Corredores inválidos.")
        elif key == "rules":
            allowed = {"identified_required", "reference_required", "volumes_required", "stretch_required"}
            if not isinstance(value, dict) or set(value) - allowed or any(type(v) is not bool for v in value.values()):
                fail(422, "Regras inválidas.")
        elif key == "retention":
            if not isinstance(value, dict) or any(
                k not in {"sessions", "codes", "notifications", "history", "audit", "backups", "logs", "reports"}
                or type(v) is not int
                or v < 1
                for k, v in value.items()
            ):
                fail(422, "Retenção inválida.")
        elif key == "ti-notes":
            if not isinstance(value, str) or len(value) > 10000:
                fail(422, "Anotação inválida.")
        else:
            fail(404, "Configuração desconhecida.")
        c.execute(
            insert(t.system_settings).values(key=key, value=value).on_conflict_do_update(index_elements=["key"], set_={"value": value})
        )
        audit(c, "SYSTEM_CONFIG_CHANGED", {"key": key}, a, request)
        return {"ok": True}

    return run(request, "system:configure", body.model_dump(), action, key != "ti-notes")


@app.get(API + "/events")
def events(request: Request):
    with engine().begin() as c:
        authenticate(c, request, touch=False)

    async def stream():
        last = None
        while not await request.is_disconnected():
            try:
                with engine().begin() as c:
                    actor = authenticate(c, request, touch=False)
                    # Only invalidations; no operational payload broadcast to other users.
                    signature = (
                        c.scalar(sa.select(sa.func.max(t.audit_log.c.id))),
                        c.scalar(sa.select(sa.func.max(t.operational_history.c.id))),
                    )
                    if not actor.user["active"]:
                        break
                if signature != last:
                    yield "event: refresh\ndata: {}\n\n"
                    last = signature
                else:
                    yield ": heartbeat\n\n"
            except Exception:
                yield "event: expired\ndata: {}\n\n"
                break
            await asyncio.sleep(3)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


@app.get(API + "/security/status")
def security_status(request: Request):
    return run(
        request,
        "security:view",
        {},
        lambda c, a: {
            "ok": True,
            "version": __version__,
            "database": "PostgreSQL",
            "passwordStorage": "Argon2id",
            "sessionCookie": "Secure / HttpOnly / SameSite=Strict" if settings().secure_cookies else "DEVELOPMENT ONLY",
            "csrf": True,
            "secureAudit": True,
            "securityHeaders": True,
            "staticIsolation": True,
            "rateLimit": True,
            "automaticBackups": False,
            "backupConfigured": bool(settings().backup_directory),
            "sessionIdleMinutes": settings().idle_seconds // 60,
            "integrationConfigured": bool(settings().integration_adapter),
            "counts": {
                "users": c.scalar(sa.select(sa.func.count()).select_from(t.users)),
                "pallets": c.scalar(sa.select(sa.func.count()).select_from(t.pallet_requests)),
            },
        },
    )


@app.get(API + "/openapi.json")
def openapi(request: Request):
    return run(request, "security:view", {}, lambda c, a: app.openapi())


@app.get("/")
def root():
    return RedirectResponse("/empilhadores/", status_code=302)


# Routes for integrations, reporting and OIDC are added before the static mount.
from .extras import register  # noqa: E402

register(app, run)
app.mount("/", StaticFiles(directory=str(PUBLIC), html=True), name="public")
