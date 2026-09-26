# Banco, endpoints e permissões

## Migration e tabelas

Alembic possui a migration congelada `0001_operational`. Ela cria 33 tabelas:

`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `devices`, `device_assignments`, `production_requests`, `locations`, `pallet_requests`, `pallet_authorizations`, `pallet_movements`, `pallet_locks`, `access_codes`, `equipment`, `checklist_templates`, `checklist_template_versions`, `checklist_records`, `checklist_answers`, `battery_links`, `battery_swaps`, `issues`, `issue_events`, `notifications`, `operational_history`, `audit_log`, `system_settings`, `integration_settings`, `rate_limits`, `idempotency_keys`, `oidc_flows` e `technical_events`.

Índices únicos impedem dois paletes ativos no mesmo endereço, dois movimentos simultâneos, produção aberta duplicada e lease duplicado. Constraints validam estados, tipos e números. Triggers impedem alteração/exclusão dos registros imutáveis.

## Endpoints

- Saúde: `GET /health/live`, `/health/ready`, `/api/site-selene/status`.
- Identidade: login, logout, reauth, activity, sessão atual e OIDC sob `/auth`.
- Administração: usuários, perfis/permissões, dispositivos, settings, segurança, métricas e OpenAPI protegido.
- Operação: estado, produção, paletes/comandos, locais, histórico, auditoria e SSE.
- Checklist: código criar/revogar/resgatar, estado, templates, registros, equipamentos, pendências e trocas de bateria.
- Relatórios: CSV/PDF para histórico, produção, auditoria e Checklist.
- Integração: consultar/configurar/testar; permanece bloqueada sem adaptador homologado.
- Backup: criar, listar e baixar com permissão e reautenticação; restore somente por CLI.

O contrato exato pode ser lido por TI autenticado em `GET /api/site-selene/openapi.json` com `security:view`.

## Perfis

`empilhador` opera sua produção, paletes, dispositivo, histórico próprio, Checklist e códigos. `encarregado` acrescenta autorização, transferência, cancelamento, localização, histórico geral, relatórios, dispositivos, administração não TI, auditoria, templates/equipamentos e resolução de pendências. `ti` recebe todas as permissões, inclusive integração, segurança, backup, perfis e sistema.

Permissões são granulares: `dashboard:view`, grupos `pallet:*`, `location:*`, `production:*`, `history:*`, `reports:*`, `devices:*`, `users:*`, `roles:*`, `audit:view`, `integration:*`, `security:view`, `backup:*`, `system:configure`, `checklist:*`, `equipment:manage`, `issues:*` e `codes:*`. O backend resolve o perfil real no banco.
