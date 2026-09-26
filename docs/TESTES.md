# Validação executada

## Automatizada

- `pytest`: **29 aprovados** em PostgreSQL 17 real; `TEST-RESULTS.xml` guarda o JUnit.
- Ruff em `app`, `tests`, `migrations` e `scripts`: aprovado.
- `scripts/check_public.py`: tipos públicos, sintaxe JavaScript, ausência de credenciais/dados operacionais e fronteira estática aprovados.
- `pip-audit` contra `requirements-runtime.lock`: nenhuma vulnerabilidade conhecida; veja `dependency-audit.json`.
- `app.admin verify-audit` e `app.admin diagnose`: aprovados no banco de validação.

Os testes cobrem login genérico, Argon2id, cookie/sessão/CSRF, RBAC, revogação, última conta TI, rate limit, idempotência/replay, SQL injection, XSS tratado como texto, IDOR/role bypass, transitions inválidas, dispositivos e leases, concorrência real, autorização BAIXAR/SUBIR, movimento único, timer real de 10 segundos, restart, liberação de 90 minutos, EXP-PIC, histórico append-only, código Checklist entre clientes, validade/uso único, versões de templates, Checklist imutável, pendências, troca de bateria, CSV/PDF e limites de exportação.

## Backup e restart

Um dump criptografado foi criado e restaurado em banco separado e vazio. Entidades e cabeça do encadeamento de auditoria foram comparadas; o restore recusou destino não vazio. O teste de restart confirmou que usuário, dispositivo, produção, palete, autorização, movimento, histórico e auditoria permanecem no PostgreSQL.

## Interface

As nove áreas do Empilhamento e o Checklist foram percorridos em navegador, incluindo login, dispositivo, produção, criação/autorização/movimento de palete e persistência após reinício. Não houve erro de console. A folha responsiva foi revisada para tablet, sem dependência de dados locais. Preferências visuais podem usar `sessionStorage`; nenhuma operação corporativa usa armazenamento do navegador.

## Como repetir

1. Prepare PostgreSQL isolado e aplique `python -m alembic upgrade head`.
2. Exporte `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ENVIRONMENT=test` e `SECURE_COOKIES=false`.
3. Execute `python -m pytest --junitxml=TEST-RESULTS.xml`.
4. Execute `python -m ruff check app tests migrations scripts` e `python scripts/check_public.py`.
5. Execute `python -m app.admin verify-audit`, `python -m app.admin diagnose` e `pip-audit -r requirements-runtime.lock`.

Os dados dos testes são sintéticos e ficam somente no banco descartável.
