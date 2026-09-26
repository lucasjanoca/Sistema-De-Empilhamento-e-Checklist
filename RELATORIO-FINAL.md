# Relatório final - Site Selene 2.1.1

## ATUALIZAÇÃO 2.1.1

O Checklist agora usa a mesma linguagem visual clara do Empilhadores, com topbar, cards, abas, painel lateral, área ADM, tabelas e dialogs consistentes. A revisão em 320 a 1920 px corrigiu overflow do cabeçalho móvel e o rodapé do modal em 320 px. A auditoria administrativa passou a carregar sob demanda, os caches PWA foram versionados e a homologação ganhou um comando único e contratos automáticos de UI/PWA. A matriz completa está em `docs/HOMOLOGACAO-2.1.1.md` e o piloto em `docs/PILOTO-CONTROLADO.md`.

## STATUS GERAL

**Implementação concluída e validada localmente; pronta para homologação corporativa.** O software executa com PostgreSQL real e passou a suíte técnica. O ambiente corporativo ainda não está publicado nem homologado porque hostname, TLS, banco gerenciado, OIDC e contrato da integração pertencem à TI e não foram fornecidos. A lista exata está em `PENDENCIAS-TI.md`.

## FUNCIONANDO

- Empilhamento 2.0 e Checklist com a identidade visual e o fluxo original preservados.
- Login, sessão revogável, três perfis, seleção exclusiva de dispositivo e produção.
- Solicitação, aceite, transferência, autorização, BAIXAR, SUBIR, cancelamento, override, EXP-PIC, corredores e endereços bloqueados.
- Timer de movimento de 10 segundos e liberação de 90 minutos no servidor.
- Histórico, dashboards, filtros paginados, auditoria, CSV e PDF com dados reais.
- Código de Checklist entre clientes/dispositivos, validade de 2 minutos e uso único.
- Templates versionados, equipamentos, Checklist por turno, pendências e troca de bateria.
- Restart sem perda e sincronização por invalidação SSE.

## IMPLEMENTADO

Arquitetura FastAPI + PostgreSQL 17; migration Alembic; transações e locks; máquina de estados; autorização explícita; idempotência; rate limit; RBAC; PWA segura; relatórios; observabilidade; backup cifrado/restore; Docker/Compose; CI; comandos administrativos; documentação de operação, instalação, segurança, integração e rollback.

As partes de demonstração foram removidas: usuários/senhas fictícios, dados pré-carregados, persistência operacional em navegador, GitHub Pages e o ZIP duplicado dentro do repositório. Preferências estritamente visuais permanecem na sessão do navegador.

## ARQUITETURA IMPLEMENTADA

As duas interfaces chamam a mesma API e compartilham usuários, perfis, banco e auditoria. O backend é a autoridade sobre identidade, dispositivo, estado, autorização e tempo. PostgreSQL guarda todo dado corporativo. Worker servidor conclui timers. Service workers armazenam somente estáticos e falham fechados para operação. Consulte `docs/ARQUITETURA.md`.

## TESTES

- 35/35 testes pytest aprovados em PostgreSQL 17 real.
- Concorrência com clientes/sessões simultâneos e locks reais: aprovada.
- Timer real de 10 segundos e restart: aprovados.
- Código Checklist entre clientes, expiração, replay e brute force: aprovados.
- RBAC, CSRF, IDOR, role bypass, SQL injection, XSS textual, session fixation, transição inválida e double submit: aprovados.
- Migration do zero: 34 tabelas físicas incluindo `alembic_version`, zero usuários, versão `0001_operational`.
- Backup cifrado e restore num segundo banco: aprovados; restore em banco não vazio recusado.
- Cadeia de auditoria: íntegra em 2.268 eventos no banco final de validação da versão 2.1.1.
- Diagnóstico: zero locks órfãos, movimentos pendentes em produção fechada ou confirmações vencidas.
- Ruff, sintaxe JS, fronteira pública, CSP estática e scanner de segredos: aprovados.
- `pip-audit`: nenhuma vulnerabilidade conhecida nas versões travadas.
- Fluxo visual das nove áreas, Empilhamento + Checklist e viewport de tablet: verificados sem erro de console.

Evidências: `TEST-RESULTS.xml`, `EVIDENCIA-BACKUP.json`, `dependency-audit.json` e `docs/TESTES.md`.

## SEGURANÇA

Argon2id; cookie `__Host-` Secure/HttpOnly/SameSite Strict; token opaco com hash no banco; timeouts; revogação; reautenticação; OIDC/PKCE preparado; MFA configurável; CSRF; CSP estrita; Trusted Host; HSTS; validação Pydantic; SQL parametrizado; rate limit persistente; idempotência; autorização backend; erros com correlation ID; audit log HMAC append-only; runtime PostgreSQL de mínimo privilégio; backup AES-256-GCM/RSA-OAEP. Detalhes e fronteiras estão em `docs/SEGURANCA.md`.

## BANCO

Migration `0001_operational`, schema congelado na migration e 33 tabelas da aplicação: identidade/RBAC/sessões, dispositivos, produção, locais, paletes, autorizações, movimentos/locks, códigos, equipamentos, templates/registros/respostas de Checklist, baterias, pendências/eventos, notificações, histórico, auditoria, configurações, rate limits, idempotência, OIDC e eventos técnicos. Índices, constraints e triggers protegem concorrência e imutabilidade. Lista em `docs/BANCO-E-API.md`.

## ENDPOINTS

Saúde/status; login/me/logout/reauth/activity/OIDC; usuários/perfis; estado; dispositivos; produção; paletes/comandos; locais; códigos; Checklist/templates/registros; equipamentos; pendências; baterias; notificações; histórico; auditoria; settings; SSE; segurança; métricas; relatórios CSV/PDF; integração; backup; OpenAPI autenticado. O agrupamento está em `docs/BANCO-E-API.md`; o contrato completo é `GET /api/site-selene/openapi.json` com permissão TI.

## PERMISSÕES

- `empilhador`: operação própria, paletes, produção, dispositivo, histórico próprio, Checklist e códigos.
- `encarregado`: acrescenta autorizações, transferência/cancelamento, localização, histórico geral, relatórios, dispositivos, administração não TI, auditoria, templates/equipamentos e resolução de pendências.
- `ti`: todas as permissões, integração, backup, segurança, perfis e configurações.

O backend aplica permissões granulares por ação; ocultar botão é apenas apresentação.

## INTEGRAÇÕES

O contrato interno do adaptador Selene está definido, com allowlist HTTPS e falha segura. Como a API oficial não foi fornecida, o recurso retorna 503 e mostra “INTEGRAÇÃO NÃO CONFIGURADA”; não existe mock. OIDC usa discovery, Authorization Code, PKCE, state e nonce, mas precisa dos valores corporativos e homologação de claims/ACR. Veja `docs/INTEGRACAO.md`.

## PROBLEMAS ENCONTRADOS E RESOLVIDOS

- O Site 2.0 guardava identidade, códigos e dados no navegador: substituído por API/PostgreSQL.
- Havia credenciais e dados de demonstração no frontend: removidos.
- BAIXAR/SUBIR e timers dependiam do cliente: movidos para transações e worker servidor.
- Autorização era visual: transformada em RBAC e autorizações persistentes no backend.
- Código Checklist funcionava na mesma origem/navegador: movido para banco, hash, validade e uso único.
- Arquivos originais duplicados e workflow de importação poderiam republicar a versão insegura: removidos; checkpoint Git preserva o original.
- O estado não sobrevivia a restart e não havia restore validado: PostgreSQL, backup cifrado e ensaio de restore implementados.
- A inspeção final encontrou uma variável de aba não inicializada no carregamento autenticado do Checklist: o estado inicial foi declarado, e o fluxo PC → código → Checklist → seleção de dispositivo → relatório foi repetido sem erro de console.
- A última execução inicialmente encontrou o PostgreSQL portátil de teste parado; a instância isolada foi reiniciada e toda a suíte passou.
- A suíte emite avisos de depreciação futura do adaptador `httpx` do Starlette/Authlib e de `authlib.jose`; eles não causam falha nem vulnerabilidade conhecida, mas devem ser migrados para `httpx2`/`joserfc` antes de uma futura atualização principal dessas bibliotecas.

## PENDÊNCIAS DA TI

Hostname/origem, certificado e proxy; PostgreSQL gerenciado e contas; cofre/segredos/chaves; política e armazenamento externo de backup; contrato/credencial da integração Selene; OIDC/MFA; aprovação de permissões/retenção/dupla aprovação; monitoramento; UAT em rede e tablets corporativos; repositório privado. Veja `PENDENCIAS-TI.md`.

## ARQUIVOS CRIADOS E ALTERADOS

- Backend: `app/*.py`, incluindo `main`, operações, Checklist, segurança, OIDC, queries, integração, backup, manutenção e monitoramento.
- Banco: `migrations/`, `alembic.ini`, `deploy/grant-runtime.sql`.
- Interfaces: `public/empilhadores`, `public/checklist`, `public/shared`.
- Entrega: `Dockerfile`, `compose.yaml`, `.env.example`, locks de dependência e CI.
- Qualidade: `tests/`, `scripts/check_public.py`, `scripts/scan_secrets.py` e evidências.
- Documentação: `README.md`, `docs/`, `PENDENCIAS-TI.md`, este relatório e `INVENTARIO-ORIGINAL.md`.

Os antigos arquivos estáticos da raiz, o ZIP duplicado e o workflow de importação foram removidos da versão ativa. O estado original está preservado na tag `checkpoint-original-20260925`.

## COMMITS

- `fb37126` — PostgreSQL, migrations, configuração segura e inventário original.
- `8ed2cb8` — Argon2id, sessões revogáveis, RBAC e auditoria encadeada.
- `8ddf76d` — movimentos, autorizações, dispositivos, Checklist e testes PostgreSQL.
- `82f442d` — frontend integrado, backup, observabilidade, implantação e validações.
- `c12fe09` — relatório, runbooks e pendências externas da TI.
- Commit final de inspeção visual — inicialização autenticada do Checklist e evidência JUnit atualizada.

## COMO INSTALAR

Siga `docs/INSTALACAO.md`: configure o arquivo privado a partir de `.env.example`, suba PostgreSQL, aplique Alembic com a conta proprietária, conceda o mínimo à conta runtime, configure proxy TLS e backup, suba a aplicação, valide health/readiness e execute `python -m app.admin create-initial-admin`. Não coloque o arquivo de ambiente no Git.

## COMO CRIAR O PRIMEIRO TI

Com migration aplicada, banco sem usuários e `DATABASE_URL` runtime configurada, execute `python -m app.admin create-initial-admin`. Informe matrícula, nome e senha forte duas vezes. O comando trava o bootstrap, recusa segunda execução e não cria dados operacionais.

## COMO CONFIGURAR POSTGRESQL E HTTPS

Use PostgreSQL 17 em rede privada. Separe conta proprietária de migration e conta runtime; aplique `deploy/grant-runtime.sql`. No proxy, force HTTPS, mantenha a aplicação inacessível externamente, encaminhe Host/X-Forwarded-Proto somente de IPs confiáveis e faça `PUBLIC_ORIGIN` coincidir com a URL oficial. Veja `docs/INSTALACAO.md`.

## COMO TESTAR

Em banco descartável: migration, `python -m pytest --junitxml=TEST-RESULTS.xml`, `python -m ruff check app tests migrations scripts`, `python scripts/check_public.py`, `python scripts/scan_secrets.py`, `python -m app.admin verify-audit`, `python -m app.admin diagnose` e `pip-audit -r requirements-runtime.lock`. Instruções em `docs/TESTES.md`.

## COMO FAZER BACKUP E ROLLBACK

Agende `python -m app.maintenance backup`, copie o artefato cifrado para armazenamento externo e teste restore periodicamente. Restore exige banco vazio, chave privada e confirmação do nome. Para rollback de aplicação, reative a imagem anterior; para banco, restaure em banco novo e faça a troca controlada. Veja `docs/BACKUP-RESTORE.md` e `docs/ROLLBACK.md`.

## COMO ATUALIZAR

Crie backup, fixe a nova imagem pelo digest/commit, revise e aplique migrations em janela controlada, suba a aplicação, valide readiness e fluxos, verifique auditoria e monitore. Nunca aplique downgrade destrutivo diretamente no banco operacional.
