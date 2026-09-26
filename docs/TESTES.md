# Validação executada

## Automatizada

- `pytest`: **33 aprovados** em PostgreSQL 17 real; `TEST-RESULTS.xml` guarda o JUnit.
- Ruff em `app`, `tests`, `migrations` e `scripts`: aprovado.
- `scripts/check_public.py`: tipos públicos, sintaxe JavaScript, ausência de credenciais/dados operacionais e fronteira estática aprovados.
- `scripts/check_ui_contract.py`: IDs, labels, dialogs, contratos JavaScript/HTML, manifestos, escopos e caches PWA aprovados.
- `pip-audit` contra `requirements-runtime.lock`: nenhuma vulnerabilidade conhecida; veja `dependency-audit.json`.
- `app.admin verify-audit` e `app.admin diagnose`: aprovados no banco de validação.

Os testes cobrem login genérico, Argon2id, cookie/sessão/CSRF, RBAC, revogação, última conta TI, rate limit, idempotência/replay, SQL injection, XSS tratado como texto, IDOR/role bypass, transitions inválidas, dispositivos e leases, concorrência real, autorização BAIXAR/SUBIR, movimento único, timer real de 10 segundos, restart, liberação de 90 minutos, EXP-PIC, histórico append-only, código Checklist entre clientes, validade/uso único, versões de templates, Checklist imutável, pendências, troca de bateria, CSV/PDF e limites de exportação.

## Backup e restart

Um dump criptografado foi criado e restaurado em banco separado e vazio. Entidades e cabeça do encadeamento de auditoria foram comparadas; o restore recusou destino não vazio. O teste de restart confirmou que usuário, dispositivo, produção, palete, autorização, movimento, histórico e auditoria permanecem no PostgreSQL.

## Interface

As nove áreas do Empilhamento e o Checklist foram percorridos em navegador. O Checklist foi validado em 320, 375, 430, 768, 1024, 1280, 1366, 1440 e 1920 px, incluindo área ADM, tabelas e modal. Um checklist real foi salvo e reencontrado no histórico. O Empilhadores passou pelos mesmos breakpoints. Não houve erro de console. Preferências visuais podem usar `sessionStorage`; nenhuma operação corporativa usa armazenamento do navegador.

## Como repetir

1. Prepare PostgreSQL isolado e aplique `python -m alembic upgrade head`.
2. Exporte `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ENVIRONMENT=test` e `SECURE_COOKIES=false`.
3. Execute `python scripts/homologate.py`. O comando agrega lint, contratos estáticos, scanner, pytest, `pip-audit`, `alembic check`, cadeia de auditoria e diagnóstico.
4. Use `--skip-dependency-audit` apenas quando o ambiente estiver sem acesso ao PyPI e registre essa limitação.
5. Use `--skip-runtime` apenas para uma verificação estática; ele não substitui a homologação com PostgreSQL.

Os dados dos testes são sintéticos e ficam somente no banco descartável.
