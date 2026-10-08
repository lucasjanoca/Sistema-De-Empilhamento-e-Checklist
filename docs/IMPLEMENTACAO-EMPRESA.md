# Implementação na empresa

Este documento transforma a candidata técnica em um projeto implantável. Nenhuma etapa abaixo autoriza publicar na rede corporativa sem o responsável indicado e sua evidência.

## Responsabilidades

| Entrega | Responsável | Evidência de aceite |
|---|---|---|
| Código, migrations, testes e documentação | Desenvolvimento | commit, CI verde e digest da imagem |
| Servidor, DNS, TLS, proxy e firewall | Infraestrutura/TI | URL de staging, certificado válido e regra documentada |
| PostgreSQL, contas owner/runtime e cofre | DBA/TI | preflight aprovado e contas sem privilégios excessivos |
| Contrato, credencial e allowlist Selene | Dono do Selene/TI | contrato versionado e teste controlado assinado |
| Dados iniciais e eventual migração Supabase | Negócio + TI | contagens reconciliadas e relatório sem dados rejeitados |
| Tablets, rede fabril e fluxo real | Operação + Segurança do Trabalho | UAT assinado por turno/dispositivo |
| Backup, monitoramento e resposta | Operações/TI | restauração medida, alertas recebidos e runbook exercitado |

## Gates de staging

1. Aprovar o PR e publicar uma imagem GHCR; registrar o digest, nunca usar apenas `latest`.
2. Criar banco staging, conta proprietária separada e conta runtime sem ownership; guardar segredos no cofre.
3. Executar `migrate`, reaplicar `deploy/grant-runtime.sql` e rodar `scripts/preflight.py`.
4. Exportar privadamente o snapshot/perfis legados e executar `scripts/plan_supabase_migration.py`; resolver todos os bloqueios e obter aceite antes de importar no staging.
5. Configurar proxy TLS e executar `scripts/smoke_deployment.py` pela mesma URL usada nos tablets.
6. Criar o primeiro administrador, cadastrar dispositivos e dados mestres mínimos.
7. Receber o contrato Selene e preencher uma cópia privada de `deploy/selene-contract.example.json` sem segredos.
8. Executar `scripts/verify_selene_contract.py` em staging. Conferir o mapeamento de identificadores antes de qualquer escrita.
9. Habilitar a integração e testar um palete de homologação: sucesso, indisponibilidade temporária e reenvio sem duplicidade.
10. Executar `scripts/homologate.py --verify-backup-restore` e guardar os resultados junto ao digest.
11. Fazer o piloto de `PILOTO-CONTROLADO.md` em todos os modelos de tablet, turnos e áreas aplicáveis.

## Critério objetivo de aprovação

- `/health/ready` está verde e a migration é `0002_integration_outbox`.
- CI, homologação, auditoria de dependências, backup/restore e smoke test estão verdes.
- Nenhuma credencial está no Git, log, navegador ou arquivo de contrato.
- Uma queda do Selene mantém o palete em sincronização, bloqueia o fechamento da requisição e confirma exatamente uma vez após retorno.
- Monitoramento alerta integração pendente por mais de 15 minutos, backup vencido, indisponibilidade e falha de login anormal.
- O UAT foi assinado e contém rollback, contato de plantão, janela e responsável pela decisão de abortar.

## Produção e pós-implantação

Produção deve repetir os mesmos artefatos e comandos de staging, trocando somente configuração e segredos. Faça backup validado antes da migration; implante na janela; rode preflight, smoke e uma movimentação sintética aprovada; acompanhe erros, outbox e latência por pelo menos um turno. Rollback da aplicação não executa downgrade destrutivo: siga `ROLLBACK.md` e restaure em banco separado quando necessário.

## Bloqueios externos atuais

Ainda são indispensáveis: URL e contrato oficial do Selene, credencial de serviço, staging corporativo, domínio/TLS interno, cofre, provedor OIDC/MFA se exigido, destino externo de backup, monitoramento e UAT na rede/tablets reais. O repositório entrega os mecanismos e testes para esses gates, mas não pode fabricar essas decisões nem credenciais.
