# Integração Selene e OIDC

## Sistema Selene corporativo

`SeleneIntegrationAdapter` define busca de paletes/status/autorizações, sincronização, confirmação idempotente, liberação de retorno, conflitos e EXP-PIC. Como nenhum endpoint corporativo foi fornecido, nenhuma chamada foi simulada. O teste retorna HTTP 503 e a interface mostra **INTEGRAÇÃO NÃO CONFIGURADA**.

A TI deve fornecer contrato, autenticação, hostname, allowlist, timeouts, retry/idempotência e homologação. O destino precisa usar HTTPS e constar em `INTEGRATION_ALLOWED_HOSTS`.

## OIDC e MFA

Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e ACR aprovado. O fluxo usa discovery, Authorization Code, PKCE, state e nonce; apenas subjects previamente vinculados com `python -m app.admin bind-oidc` entram. Ative `REQUIRE_ADMIN_MFA=true` somente após homologar issuer, claims e ACR.
