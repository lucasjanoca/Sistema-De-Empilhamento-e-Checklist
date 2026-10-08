# Homologação técnica 2.2.0 RC1

Data: 08/10/2026. Branch candidata: `integracao-producao-main`, reconciliada com a `main` sem publicar em produção e sem mesclar a PR.

## Resultado atual

A candidata está pronta para CI e para implantação em staging privado. Produção permanece bloqueada até contrato da integração oficial, infraestrutura corporativa, restauração periódica e UAT assinada. GitHub Pages não atende esta arquitetura porque os fluxos dependem de FastAPI, PostgreSQL, cookies seguros, transações e workers.

| Gate | Estado no código | Condição externa antes de produção |
|---|---|---|
| PostgreSQL autoritativo | Implementado; sem fallback operacional no navegador | Banco 17 gerenciado, contas owner/runtime e migração de dados aprovada |
| Autenticação e RBAC | Argon2id, sessão HttpOnly, CSRF, revogação e permissões no servidor | OIDC/MFA, domínio e TLS da TI |
| Movimentação de paletes | Transações, locks, versão, idempotência e timers no servidor | UAT com dois usuários, dois endereços e perda de rede |
| Checklist | Persistente, histórico imutável, pendências e troca de bateria | Templates e processo de manutenção aprovados |
| Integração oficial | Adaptador HTTP JSON, allowlist, TLS, timeout, retry e idempotência; desativado por padrão | Contrato, endpoints, credencial em cofre e escrita controlada homologados |
| Backup/restore | Dump cifrado, manifesto, restore em banco vazio, retenção local e cópia externa exclusiva | Agendador, volume imutável, alertas e ensaio recorrente da TI |
| CI | Lint, PostgreSQL real, testes, migration check, UI/PWA, segredos e `pip-audit` | Proteção de branch exigindo o workflow e revisão |
| Observabilidade | Health, métricas, correlation ID, auditoria encadeada e indicador de backup atrasado | Coletor/SIEM, alertas e painéis corporativos |

## Checklist de promoção

- [ ] CI verde no commit exato da PR e `alembic check` sem diferença.
- [ ] Revisão independente e proteção da `main` contra push direto/merge sem checks.
- [ ] Staging HTTPS acessível apenas à equipe autorizada.
- [ ] Segredos fornecidos por cofre; nenhum valor real no repositório ou no frontend.
- [ ] Migração Supabase reconciliada conforme `MIGRACAO-SUPABASE.md`.
- [ ] Integração de leitura e escrita validada com API falsa e ambiente oficial de homologação.
- [ ] Backup criado, copiado externamente e restaurado em segundo banco vazio.
- [ ] Piloto de `PILOTO-CONTROLADO.md` concluído e assinado por TI, operação e segurança.
- [ ] Plano de rollback, janela, comunicação e responsáveis confirmados.

## Evidência automática desta candidata

- 43 cenários aprovados em PostgreSQL 17, incluindo concorrência, restart, integração HTTP e cópia externa de backup.
- Ruff, fronteira pública, sintaxe JavaScript, contratos de interface/PWA, scanner de segredos e `git diff --check` aprovados.
- `alembic check`: nenhuma nova operação; cadeia de auditoria íntegra com 3.204 eventos; diagnóstico sem lock órfão, produção fechada com movimento ou confirmação vencida.
- `pip-audit`: nenhuma vulnerabilidade conhecida nas dependências runtime fixadas.

## Não autorizar ainda

Não habilitar `INTEGRATION_ADAPTER`, não marcar `BACKUP_SCHEDULE_MANAGED=true`, não promover staging para produção e não mesclar na `main` até que as dependências externas acima tenham evidência. Testes com `MockTransport` validam o contrato do adaptador, mas não comprovam a API corporativa real.
