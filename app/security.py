import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

import sqlalchemy as sa
from argon2 import PasswordHasher, Type
from argon2.exceptions import Argon2Error
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from sqlalchemy.dialects.postgresql import insert

from . import schema as t
from .config import settings
from .db import engine, lock, now, one

PASSWORDS = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, type=Type.ID)
_dummy_hash = PASSWORDS.hash(secrets.token_urlsafe(32))


def fail(status, message):
    raise HTTPException(status, message)


def digest(value, purpose="session"):
    return hmac.new(settings().session_secret.get_secret_value().encode(), (purpose + ":" + value).encode(), hashlib.sha256).hexdigest()


def cipher():
    return Fernet(base64.urlsafe_b64encode(bytes.fromhex(digest("idempotency", "encryption"))))


def password_hash(password):
    if len(password) < 12 or len(password) > 128:
        fail(422, "Use uma senha de 12 a 128 caracteres.")
    return PASSWORDS.hash(password)


def verify(password, encoded):
    try:
        return PASSWORDS.verify(encoded or _dummy_hash, password) and bool(encoded)
    except (Argon2Error, ValueError):
        return False


def audit(conn, action, details=None, actor=None, request=None):
    lock(conn, "audit-chain")
    prev = conn.scalar(sa.select(t.audit_log.c.chain_hash).order_by(t.audit_log.c.id.desc()).limit(1)) or "0" * 64
    payload = dict(
        timestamp=now(conn),
        user_id=actor.user["id"] if actor else None,
        session_id=actor.session["id"] if actor else None,
        device_id=None,
        correlation_id=getattr(request.state, "correlation_id", str(uuid4())) if request else str(uuid4()),
        action=action,
        origin=(request.client.host if request and request.client else "server")[:100],
        details={**(details or {}), **({"actor_role": actor.role} if actor else {})},
        previous_hash=prev,
    )
    if actor:
        payload["device_id"] = conn.scalar(
            sa.select(t.device_assignments.c.device_id)
            .where(t.device_assignments.c.session_id == actor.session["id"], t.device_assignments.c.released_at.is_(None))
            .limit(1)
        )
    canonical = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False, separators=(",", ":"))
    payload["chain_hash"] = digest(canonical, "audit")
    conn.execute(t.audit_log.insert().values(**payload))


def audit_denied(action, request, details=None):
    with engine().begin() as conn:
        try:
            actor = authenticate(conn, request, touch=False)
        except HTTPException:
            actor = None
        audit(conn, action, details, actor, request)


def rate_limit(key, limit, seconds=60):
    """Contador transacional compartilhado por todos os workers; persiste falhas."""
    with engine().begin() as conn:
        at = now(conn)
        hashed = digest(key, "rate")
        lock(conn, "rate:" + hashed)
        old = one(conn, sa.select(t.rate_limits).where(t.rate_limits.c.key == hashed))
        count = 1 if not old or old["reset_at"] <= at else old["count"] + 1
        reset = at + timedelta(seconds=seconds) if not old or old["reset_at"] <= at else old["reset_at"]
        conn.execute(
            insert(t.rate_limits)
            .values(key=hashed, count=count, reset_at=reset)
            .on_conflict_do_update(index_elements=["key"], set_=dict(count=count, reset_at=reset))
        )
    if count > limit:
        fail(429, "Muitas tentativas. Aguarde antes de tentar novamente.")


def grants(conn, user_id):
    join = t.user_roles.join(t.roles).join(t.role_permissions).join(t.permissions)
    perms = set(conn.scalars(sa.select(t.permissions.c.name).select_from(join).where(t.user_roles.c.user_id == user_id)))
    names = set(conn.scalars(sa.select(t.roles.c.name).select_from(t.user_roles.join(t.roles)).where(t.user_roles.c.user_id == user_id)))
    role = "ti" if "ti" in names else "encarregado" if "encarregado" in names else "empilhador"
    return role, perms


@dataclass
class Actor:
    user: dict
    session: dict
    role: str
    permissions: set

    def public(self):
        return dict(
            id=self.user["id"],
            matricula=self.user["matricula"],
            nome=self.user["nome"],
            role=self.role,
            active=self.user["active"],
            permissions=sorted(self.permissions),
        )


def authenticate(conn, request: Request, permission=None, touch=True):
    token = request.cookies.get(settings().cookie_name, "")
    session = one(conn, sa.select(t.sessions).where(t.sessions.c.token_hash == digest(token))) if token else None
    at = now(conn)
    if (
        not session
        or session["revoked_at"]
        or session["expires_at"] <= at
        or session["last_seen"] + timedelta(seconds=settings().idle_seconds) <= at
    ):
        fail(401, "Sessão inválida ou expirada.")
    user = one(conn, sa.select(t.users).where(t.users.c.id == session["user_id"]).with_for_update(read=True))
    if not user or not user["active"]:
        fail(401, "Sessão inválida ou expirada.")
    # A role/reset transaction can revoke the session while the user lock is awaited.
    if conn.scalar(sa.select(t.sessions.c.revoked_at).where(t.sessions.c.id == session["id"])):
        fail(401, "Sessão inválida ou expirada.")
    role, perms = grants(conn, user["id"])
    actor = Actor(dict(user), dict(session), role, perms)
    if permission and permission not in perms:
        fail(403, "Seu acesso não permite esta operação.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session["csrf"]):
            fail(403, "Validação de segurança da sessão falhou.")
    if touch:
        conn.execute(t.sessions.update().where(t.sessions.c.id == session["id"]).values(last_seen=at))
    return actor


def critical(actor):
    if actor.session["scope"] != "empilhamento":
        fail(403, "Ação crítica exige autenticação no Empilhamento.")
    from datetime import datetime, timezone

    if not actor.session["reauth_at"] or actor.session["reauth_at"] + timedelta(minutes=5) < datetime.now(timezone.utc):
        fail(403, "Confirme sua senha em Reautenticar antes desta ação.")
    if settings().require_admin_mfa and not actor.session["mfa"]:
        fail(403, "Esta ação exige MFA corporativo.")


def new_session(conn, user_id, scope="empilhamento", mfa=False):
    at = now(conn)
    token = secrets.token_urlsafe(48)
    values = dict(
        token_hash=digest(token),
        user_id=user_id,
        csrf=secrets.token_urlsafe(32),
        scope=scope,
        created_at=at,
        last_seen=at,
        expires_at=at + timedelta(seconds=settings().absolute_seconds),
        mfa=mfa,
        reauth_at=at if scope == "empilhamento" else None,
    )
    rec = conn.execute(t.sessions.insert().values(**values).returning(t.sessions)).mappings().one()
    return token, dict(rec)


def revoke_user(conn, user_id):
    at = now(conn)
    conn.execute(t.sessions.update().where(t.sessions.c.user_id == user_id, t.sessions.c.revoked_at.is_(None)).values(revoked_at=at))
    conn.execute(
        t.access_codes.update().where(t.access_codes.c.user_id == user_id, t.access_codes.c.used_at.is_(None)).values(revoked_at=at)
    )
    conn.execute(
        t.device_assignments.update()
        .where(t.device_assignments.c.user_id == user_id, t.device_assignments.c.released_at.is_(None))
        .values(released_at=at)
    )


def idempotent(conn, actor, request, body, operation):
    key = request.headers.get("Idempotency-Key", "")
    if len(key) < 16 or len(key) > 128:
        fail(400, "Envie uma chave de idempotência válida.")
    hashed = digest(f"{actor.session['id']}:{key}", "idempotency")
    fingerprint = digest(request.method + request.url.path + json.dumps(body, sort_keys=True, default=str), "request")
    lock(conn, "idempotency:" + hashed)
    prior = one(conn, sa.select(t.idempotency_keys).where(t.idempotency_keys.c.key == hashed))
    if prior:
        if prior["fingerprint"] != fingerprint:
            fail(409, "Chave já utilizada com outra operação.")
        return json.loads(cipher().decrypt(prior["response"]))
    result = operation()
    serialized = json.dumps(result, default=str).encode()
    conn.execute(
        t.idempotency_keys.insert().values(
            key=hashed, session_id=actor.session["id"], fingerprint=fingerprint, response=cipher().encrypt(serialized), created_at=now(conn)
        )
    )
    return result
