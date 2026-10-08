# Homologação técnica 2.2.0 RC3

Data: 08/10/2026. Branch candidata: `integracao-producao-main`, reconciliada com a `main` sem publicar em produção e sem mesclar a PR.

## Resultado atual

A candidata está pronta para revisão e implantação em staging privado. Produção permanece bloqueada até contrato da integração oficial, infraestrutura corporativa e UAT assinada. GitHub Pages não atende esta arquitetura porque os fluxos dependem de FastAPI, PostgreSQL, cookies seguros, transações e workers.

| Gate | Estado no código | Condição externa antes de produção |
|---|---|---|
| PostgreSQL autoritativo | Implementado; sem fallback operacional no navegador | Banco 17 gerenciado, contas owner/runtime e migração de dados aprovada |
| Autenticação e RBAC | Argon2id, sessão HttpOnly, CSRF, revogação e permissões no servidor | OIDC/MFA, domínio e TLS da TI |
| Movimentação de paletes | Transações, locks, versão, idempotência e timers no servidor; concorrência, fechamento de aba e retry incerto cobertos | UAT com operadores e rede corporativa |
| Checklist | Persistente, histórico imutável, pendências e troca de bateria | Templates e processo de manutenção aprovados |
| Integração oficial | Adaptador HTTP JSON, outbox transacional, allowlist, TLS, timeout, backoff, reprocessamento e idempotência; desativado por padrão | Contrato, endpoints, credencial em cofre e escrita controlada homologados |
| Backup/restore | Dump cifrado, manifesto, cópia externa exclusiva e restore automatizado em banco descartável com integridade e recusa de destino não vazio | Agendador, volume imutável, alertas e ensaio recorrente da TI |
| CI e entrega | Lint, PostgreSQL real, testes, migration check, UI/PWA, segredos, `pip-audit`, imagem imutável e SBOM | Aprovação do workflow de release e do digest |
| Observabilidade | Health, métricas, correlation ID, auditoria encadeada e indicador de backup atrasado | Coletor/SIEM, alertas e painéis corporativos |

## Checklist de promoção

- [x] CI 2/2 verde no commit candidato e validação local completa; exigir o mesmo no commit final antes da aprovação.
- [x] Proteção da `main` contra push direto, force-push, exclusão ou merge sem o check obrigatório.
- [ ] Revisão independente; hoje o repositório possui somente o próprio administrador.
- [ ] Staging HTTPS acessível apenas à equipe autorizada.
- [ ] Segredos fornecidos por cofre; nenhum valor real no repositório ou no frontend.
- [x] Inventário estrutural e de segurança do Supabase executado sem copiar dados pessoais; planejador de migração somente leitura implementado.
- [ ] Mapeamento dos 3 paletes legados, ensaio em staging e reconciliação assinada conforme `MIGRACAO-SUPABASE.md`.
- [x] Integração, falha de rede, reenvio idempotente e bloqueio sem configuração validados com servidor HTTP simulado.
- [ ] Contrato e escrita validados no ambiente oficial de homologação.
- [x] Backup criado, copiado externamente e restaurado em segundo banco vazio descartável; evidência em `EVIDENCIA-BACKUP.json`.
- [ ] Piloto de `PILOTO-CONTROLADO.md` concluído e assinado por TI, operação e segurança.
- [ ] Plano de rollback, janela, comunicação e responsáveis confirmados.

## Evidência automática desta candidata

- 53 cenários aprovados em PostgreSQL 17, incluindo dois operadores concorrentes em endereços distintos, fechamento de aba, restart, retry idempotente após resposta incerta, outbox da integração HTTP, readiness real do Compose e planejamento seguro da migração Supabase.
- Ruff, fronteira pública, sintaxe JavaScript, contratos de interface/PWA, scanner de segredos e `git diff --check` aprovados.
- Restore real automatizado: backup cifrado de 2.301.348 bytes, réplica externa idêntica, 10 entidades comparadas (incluindo 12 entregas da outbox), migration `0002_integration_outbox`, cadeia de auditoria válida após restauração e segunda restauração recusada por destino não vazio.
- UAT visual local: Operação, Meus Paletes, Histórico e Checklist; nove larguras de 320 a 1920 px sem overflow e sem erro de console. Repetição no staging corporativo continua obrigatória.
- `alembic check`: nenhuma nova operação; preflight confirma revision, conta runtime sem ownership e privilégios mínimos sobre a outbox.
- `pip-audit`: nenhuma vulnerabilidade conhecida nas dependências runtime fixadas.

## Não autorizar ainda

Não habilitar `INTEGRATION_ADAPTER`, não marcar `BACKUP_SCHEDULE_MANAGED=true`, não promover staging para produção e não mesclar na `main` até que as dependências externas acima tenham evidência. Testes com `MockTransport` validam o contrato do adaptador, mas não comprovam a API corporativa real.
