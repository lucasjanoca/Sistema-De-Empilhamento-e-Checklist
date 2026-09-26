# Segurança

- Argon2id com 64 MiB, 3 iterações e paralelismo 1; senha mínima de 12 caracteres, letras, número e símbolo.
- Token de sessão opaco; somente o hash fica no banco. Cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`; 15 minutos de inatividade e 8 horas absolutas.
- Revogação no logout, troca de senha, bloqueio e mudança de perfil; sessão nova impede fixation.
- CSRF por origem exata, `Sec-Fetch-Site`, token por sessão e método. Não há CORS amplo.
- RBAC consultado no banco em toda operação. IDs, papéis, status e botões enviados pelo cliente não concedem acesso.
- Rate limit persistente para login, reautenticação, código, comandos, reset e exportação.
- Idempotency key com fingerprint e resposta cifrada impede replay e double submit divergente.
- SQLAlchemy parametrizado, Pydantic com campos extras proibidos, limites e estados fechados.
- CSP sem `unsafe-inline`/`unsafe-eval`, frame denial, nosniff, referrer/permissions policy, COOP e HSTS.
- Erros não expõem traceback, SQL, paths ou configuração; retornam correlation ID.
- Integração aceita somente HTTPS e host permitido; destinos locais/metadata são recusados.
- Runtime PostgreSQL não pode ser proprietário, superuser, createdb, createrole ou bypassrls; staging/produção verifica isso no startup.
- Backup AES-256-GCM com chave envolvida por RSA-OAEP-SHA256 de no mínimo 3072 bits.

`DATABASE_URL`, `SESSION_SECRET`, OIDC e chaves privadas entram pelo ambiente/cofre da TI. A chave privada de backup fica fora do servidor de aplicação e só participa do restore controlado. Torne o repositório corporativo privado antes de inserir qualquer configuração interna.

Mudança de perfis, configuração, desbloqueio e backup exigem permissão e reautenticação recente. MFA pode ser obrigatório com `REQUIRE_ADMIN_MFA=true` depois da homologação OIDC. Restore é CLI, confirma o banco e recusa destino não vazio.

Verifique com `python -m app.admin verify-audit`, `python scripts/check_public.py`, Ruff, pytest e `pip-audit -r requirements-runtime.lock`.
