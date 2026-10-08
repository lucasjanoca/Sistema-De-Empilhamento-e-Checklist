# Validação executada

## Automatizada

- `pytest`: **53 aprovados** em PostgreSQL 17 real; `TEST-RESULTS.xml` guarda o JUnit.
- Ruff em `app`, `tests`, `migrations` e `scripts`: aprovado.
- `scripts/check_public.py`: tipos públicos, sintaxe JavaScript, ausência de credenciais/dados operacionais e fronteira estática aprovados.
- `scripts/check_ui_contract.py`: IDs, labels, dialogs, contratos JavaScript/HTML, manifestos, escopos e caches PWA aprovados.
- `pip-audit` contra `requirements-runtime.lock`: nenhuma vulnerabilidade conhecida; veja `dependency-audit.json`.
- `app.admin verify-audit` e `app.admin diagnose`: aprovados no banco de validação.

Os testes cobrem login genérico, Argon2id, cookie/sessão/CSRF, RBAC, revogação, última conta TI, rate limit, idempotência/replay, SQL injection, XSS tratado como texto, IDOR/role bypass, transições inválidas, dispositivos e leases, dois operadores em endereços distintos sob concorrência real, autorização BAIXAR/SUBIR, movimento único, timer real de 10 segundos independente do cliente, fechamento da aba, restart, liberação de 90 minutos, EXP-PIC, histórico append-only e filtros, código Checklist entre clientes, validade/uso único, versões de templates, Checklist imutável e visível por outro usuário autorizado, pendências, troca de bateria, CSV/PDF, limites de exportação, rotas públicas, readiness HTTP no Compose, falha verdadeira de backup sem infraestrutura, cópia externa sem sobrescrita, perda de resposta com repetição idempotente, adaptador HTTP com autenticação/retry/timeout/rotas e análise agregada do snapshot Supabase sem vazamento de dados pessoais ou sobrescrita de arquivos.

## Backup e restart

Um dump criptografado foi criado e restaurado em banco separado e vazio. Entidades e cabeça do encadeamento de auditoria foram comparadas; o restore recusou destino não vazio. O teste de restart confirmou que usuário, dispositivo, produção, palete, autorização, movimento, histórico e auditoria permanecem no PostgreSQL.

## Interface

A RC 2.2.0 foi percorrida em navegador local real: Operação, Meus Paletes, Histórico e acesso ao Checklist. Operação, Histórico e Checklist foram medidos nos breakpoints 320, 375, 430, 768, 1024, 1280, 1366, 1440 e 1920 px, sem overflow da página e sem erro de console. A tabela de Histórico exibiu os seis campos esperados e filtros ativos. `EVIDENCIA-UAT-VISUAL.json` registra o escopo. O UAT de negócio ainda deve ser repetido no staging corporativo e assinado antes da promoção. Preferências visuais podem usar `sessionStorage`; nenhuma operação corporativa usa armazenamento do navegador.

## Como repetir

1. Prepare PostgreSQL isolado e aplique `python -m alembic upgrade head`.
2. Exporte `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ENVIRONMENT=test` e `SECURE_COOKIES=false`.
3. Execute `python scripts/homologate.py`. O comando agrega lint, contratos estáticos, scanner, pytest, `pip-audit`, `alembic check`, cadeia de auditoria e diagnóstico.
4. Para incluir o ensaio destrutivo controlado de recovery, forneça `TEST_ADMIN_URL` e `TEST_RESTORE_URL` para um banco cujo nome termine em `_restore_test` e use `--verify-backup-restore`.
5. Use `--skip-dependency-audit` apenas quando o ambiente estiver sem acesso ao PyPI e registre essa limitação.
6. Use `--skip-runtime` apenas para uma verificação estática; ele não substitui a homologação com PostgreSQL.

Os dados dos testes são sintéticos e ficam somente no banco descartável.
