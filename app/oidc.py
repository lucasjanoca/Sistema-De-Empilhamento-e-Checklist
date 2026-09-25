"""OIDC Authorization Code + PKCE. Somente usuários previamente vinculados pela TI."""

import secrets
from datetime import timedelta
from urllib.parse import urlsplit
import httpx
import sqlalchemy as sa
from authlib.integrations.httpx_client import OAuth2Client
from authlib.jose import jwt
from authlib.oidc.core import CodeIDToken
from fastapi import Request
from fastapi.responses import RedirectResponse
from . import schema as t
from .config import settings
from .db import engine, now, one
from .security import Actor, audit, digest, fail, grants, new_session, rate_limit


def metadata():
    cfg = settings()
    if not cfg.oidc_issuer or not cfg.oidc_client_id:
        fail(503, "SSO não configurado.")
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        r = client.get(cfg.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration")
        r.raise_for_status()
        result = r.json()
    if result.get("issuer") != cfg.oidc_issuer:
        fail(503, "Configuração SSO inconsistente.")
    for field in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        parsed = urlsplit(result[field])
        if parsed.scheme != "https" or parsed.hostname != urlsplit(cfg.oidc_issuer).hostname:
            fail(503, "Endpoints SSO exigem homologação de origem.")
    return result


def register_oidc(app):
    @app.get("/auth/oidc/login")
    def login(request: Request):
        rate_limit("oidc:" + request.client.host, 20, 300)
        cfg = settings()
        meta = metadata()
        state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        with engine().begin() as conn:
            conn.execute(
                t.oidc_flows.insert().values(
                    state_hash=digest(state, "oidc"), nonce=nonce, verifier=verifier, expires_at=now(conn) + timedelta(minutes=5)
                )
            )
        with OAuth2Client(
            cfg.oidc_client_id, scope="openid", redirect_uri=cfg.public_origin + "/auth/oidc/callback", code_challenge_method="S256"
        ) as client:
            url, _ = client.create_authorization_url(
                meta["authorization_endpoint"],
                state=state,
                nonce=nonce,
                code_verifier=verifier,
                **({"acr_values": cfg.oidc_mfa_acr} if cfg.oidc_mfa_acr else {}),
            )
        response = RedirectResponse(url)
        response.set_cookie("__Host-SeleneOIDC", state, secure=True, httponly=True, samesite="lax", max_age=300, path="/")
        return response

    @app.get("/auth/oidc/callback")
    def callback(request: Request, state: str = "", code: str = ""):
        import hmac

        cfg = settings()
        if (
            not state
            or len(state) > 200
            or not code
            or len(code) > 4000
            or not hmac.compare_digest(state, request.cookies.get("__Host-SeleneOIDC", ""))
        ):
            fail(403, "Retorno SSO inválido.")
        with engine().begin() as conn:
            flow = one(conn, sa.select(t.oidc_flows).where(t.oidc_flows.c.state_hash == digest(state, "oidc")).with_for_update())
            if not flow or flow["expires_at"] <= now(conn):
                fail(403, "SSO expirado.")
            conn.execute(t.oidc_flows.delete().where(t.oidc_flows.c.state_hash == flow["state_hash"]))
        meta = metadata()
        with OAuth2Client(
            cfg.oidc_client_id,
            cfg.oidc_client_secret.get_secret_value(),
            redirect_uri=cfg.public_origin + "/auth/oidc/callback",
            timeout=10,
        ) as client:
            token = client.fetch_token(meta["token_endpoint"], code=code, code_verifier=flow["verifier"], grant_type="authorization_code")
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.get(meta["jwks_uri"])
            response.raise_for_status()
            key = response.json()
        claims = jwt.decode(
            token["id_token"],
            key,
            claims_cls=CodeIDToken,
            claims_options={"iss": {"essential": True, "value": cfg.oidc_issuer}, "aud": {"essential": True, "value": cfg.oidc_client_id}},
            claims_params={"nonce": flow["nonce"], "client_id": cfg.oidc_client_id, "access_token": token.get("access_token")},
        )
        claims.validate(leeway=30)
        mfa = bool(cfg.oidc_mfa_acr and claims.get("acr") == cfg.oidc_mfa_acr)
        with engine().begin() as conn:
            user = one(conn, sa.select(t.users).where(t.users.c.oidc_subject == claims["sub"], t.users.c.active).with_for_update())
            if not user:
                fail(403, "Identidade ainda não autorizada pela TI.")
            role, permissions = grants(conn, user["id"])
            if role == "ti" and cfg.require_admin_mfa and not mfa:
                fail(403, "MFA corporativo obrigatório.")
            session_token, session = new_session(conn, user["id"], mfa=mfa)
            audit(conn, "OIDC_LOGIN_SUCCESS", actor=Actor(dict(user), session, role, permissions), request=request)
        response = RedirectResponse("/empilhadores/")
        response.delete_cookie("__Host-SeleneOIDC", path="/", secure=True, httponly=True, samesite="lax")
        response.set_cookie(
            cfg.cookie_name, session_token, path="/", secure=True, httponly=True, samesite="strict", max_age=cfg.absolute_seconds
        )
        return response
