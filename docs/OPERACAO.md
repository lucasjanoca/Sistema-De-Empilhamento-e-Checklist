# Operação

## Checagens diárias

- `/health/live` confirma processo; `/health/ready` confirma banco e migration.
- O painel TI e `/api/site-selene/metrics` mostram falhas HTTP, latência, logins falhos, movimentos pendentes, sessões ativas e último evento de backup. O endpoint exige `security:view`.
- Execute `python -m app.admin diagnose`; qualquer contador diferente de zero exige investigação.
- Confirme último backup, espaço livre, certificado e alertas no monitor corporativo.

## Incidentes

Bloqueie a conta pela administração para revogar sessões. Desative um dispositivo após encerrar seu lease. Para inconsistência de palete, não altere o banco manualmente: registre o correlation ID, preserve logs e use cancelar/override autorizado. Verifique a cadeia com `python -m app.admin verify-audit`.

Operações falham fechadas quando API, banco, autorização ou integração não estão disponíveis. O service worker pode abrir a moldura estática, mas não permite ação operacional offline.

## Manutenção, logs e alertas

Agende `python -m app.maintenance backup` e `python -m app.maintenance cleanup`. O cleanup remove artefatos transitórios configurados e revoga sessões expiradas; não apaga auditoria, histórico, Checklist, movimentos ou autorizações. A política de retenção precisa de aprovação de TI/compliance.

Encaminhe stdout/stderr ao coletor corporativo. Alerte para readiness indisponível, 5xx, latência, logins falhos, movimento atrasado, falha/atraso de backup, falha de integridade e certificado próximo do vencimento. Limiares e destinos pertencem à TI.
