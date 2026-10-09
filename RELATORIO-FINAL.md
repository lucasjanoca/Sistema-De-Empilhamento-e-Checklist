# Relatório final — Sistema de Empilhadores 2.2.0 RC4

Data da revisão: 08/10/2026. Branch candidata: `integracao-producao-main`.

## Conclusão

O código está consistente e pronto para revisão independente e implantação em **staging privado**. Não é correto declará-lo publicado ou homologado em produção: faltam decisões, credenciais e infraestrutura da empresa, além do contrato oficial do Selene e do UAT na rede/tablets reais. Esses itens não podem ser fabricados no repositório.

GitHub continua adequado para código, CI e imagem. GitHub Pages não hospeda esta aplicação operacional, porque ela exige FastAPI, PostgreSQL, cookies seguros, workers e rede privada.

## O que funciona

- Login local seguro, sessões revogáveis, CSRF, rate limit, RBAC e três perfis.
- OIDC Authorization Code + PKCE e exigência configurável de MFA, aguardando parâmetros corporativos.
- Dispositivos exclusivos, produção, requisições, autorizações, BAIXAR/SUBIR, EXP-PIC, bloqueios, timer no servidor e recuperação após restart.
- Concorrência com locks reais, idempotência, fechamento de aba e repetição segura após falha de rede.
- Checklist entre aparelhos, código de uso único, templates versionados, equipamentos, pendências e troca de bateria.
- Histórico/auditoria imutáveis, relatórios CSV/PDF, métricas, correlation ID e diagnóstico operacional.
- Adaptador HTTP Selene com TLS, allowlist, credencial apenas no servidor, timeout/retry e outbox transacional. Ele permanece desativado até a homologação do contrato real.
- Backup cifrado, cópia externa exclusiva e restauração em banco vazio já exercitados.
- Docker/Compose, migrations Alembic, CI, imagem imutável GHCR, SBOM, preflight, smoke test e runbooks.

## Melhorias desta revisão

- O healthcheck do contêiner deixou de validar apenas a porta TCP e agora consulta `/health/ready`, incluindo aplicação, banco e migration.
- Foi criado `scripts/plan_supabase_migration.py`: inventaria o export legado, não escreve em banco, não inclui dados pessoais no relatório, recusa sobrescrita e bloqueia a migração quando houver informação de negócio ausente.
- Foram adicionados testes para o planejador, proteção contra vazamento de nomes e healthcheck real do Compose.
- Documentação de arquitetura, banco, implementação, migração e pendências foi reconciliada com a versão 2.2.0 e o head `0002_integration_outbox`.
- Um preview público descartável foi preparado como Blueprint Render: HTTPS, Docker, PostgreSQL 17 privado, senha inicial fora do Git, migrations automáticas e integração externa desativada. A criação dos recursos depende do login do proprietário no Render.

## Supabase legado verificado

O projeto conectado está saudável em PostgreSQL 17, porém é compartilhado com outras aplicações. Foram inspecionados apenas metadados e contagens dos objetos `emp_`, sem copiar nomes, matrículas ou conteúdo operacional para o Git.

- 2 perfis, 32 eventos de auditoria, 1 snapshot e 1 backup legado.
- 3 paletes em estado `ready`, 1 produção fechada, 10 itens de histórico, 6 tablets e 2 atribuições.
- Tabelas de códigos, sessões/registros de Checklist e locks estão vazias.
- RLS está habilitado; as duas funções privilegiadas do módulo já aceitam execução somente pela `service_role`.
- Três funções Edge antigas de bootstrap/teste são tombstones inertes (HTTP 410), mas devem ser removidas depois do corte.
- O snapshot não contém quantidade, referência, observação ou área exigidas pelo modelo novo. A migração fica corretamente bloqueada até Negócio e TI preencherem e aprovarem o mapeamento dos três paletes.

## Evidências executadas

- **56/56 testes aprovados** em PostgreSQL 17 real.
- Ruff, contratos públicos/JavaScript, acessibilidade/PWA e scanner de segredos aprovados.
- `alembic check`: nenhuma operação pendente; migration atual `0002_integration_outbox`.
- Cadeia de auditoria válida em 5.332 eventos do banco descartável acumulado.
- Diagnóstico: zero lock em item finalizado, produção fechada com movimento pendente, confirmação vencida ou entrega externa parada.
- Auditoria atual de dependências: nenhuma vulnerabilidade conhecida nas versões runtime fixadas.
- Evidência anterior preservada: backup cifrado/restauração real e interface verificada de 320 a 1920 px sem overflow ou erro de console.

## O que ainda impede produção

Prioridade P0 — indispensável:

1. Contrato, URL, autenticação, schemas e credencial de homologação do Selene.
2. Staging corporativo, domínio interno, TLS, proxy/firewall, PostgreSQL gerenciado e cofre.
3. Mapeamento dos três paletes legados, importação ensaiada e reconciliação assinada.
4. OIDC/MFA corporativo, se exigido pela TI, com claims e ACR homologados.
5. Coletor de logs/métricas, alertas, plantão e agendamento real do backup externo.
6. UAT assinado por TI, operação e segurança nos tablets, turnos e rede da empresa.
7. Revisor independente da PR; hoje o repositório possui somente o próprio administrador.

Prioridade P1 — antes da expansão:

- Tornar o repositório privado antes de incluir qualquer informação interna.
- Remover as Edge Functions tombstone e revogar chaves do legado após o prazo de retenção.
- Planejar a migração futura dos usos depreciados `httpx`/`authlib.jose`; hoje são avisos, não falhas dos testes.
- Definir retenção, dupla aprovação e capacidade/alta disponibilidade conforme a política corporativa.

## Decisão de promoção

Não habilitar `INTEGRATION_ADAPTER`, não marcar `BACKUP_SCHEDULE_MANAGED=true`, não importar dados reais e não publicar em produção antes de todos os P0 terem evidência. A sequência oficial está em `docs/IMPLEMENTACAO-EMPRESA.md`, `docs/HOMOLOGACAO-2.2.0.md` e `docs/PILOTO-CONTROLADO.md`.
