# Pendências externas da TI

- [ ] Definir hostname/origem HTTPS oficial, endereço do proxy e rede privada.
- [ ] Emitir, instalar, renovar e monitorar o certificado TLS corporativo.
- [ ] Criar PostgreSQL 17 gerenciado, conta proprietária de migrations, conta runtime de privilégio mínimo e conta de backup conforme a política.
- [ ] Gerar e guardar `SESSION_SECRET`, senhas do banco e chaves RSA em cofre; montar somente a chave pública de backup na aplicação.
- [ ] Definir diretório, retenção, cópia externa imutável, agenda e alerta dos backups.
- [ ] Fornecer contrato oficial Selene: URL de staging, rotas health/pendentes/em atendimento/movimentação, método de autenticação, `codGrupo`, `codEmp`, schemas JSON, estados/EXP-PIC, timeouts, semântica de `Idempotency-Key` e respostas 2xx/204.
- [ ] Fornecer issuer, client ID/secret, claims e ACR do OIDC/MFA; vincular subjects aprovados.
- [ ] Aprovar matriz final de permissões, política de retenção e eventual regra de aprovação por duas pessoas.
- [ ] Configurar coleta central de logs, métricas, alertas e responsáveis de plantão.
- [ ] Executar homologação de negócio/UAT com operadores, encarregados e TI em tablets e rede corporativa.
- [ ] Tornar privado o repositório corporativo antes de adicionar qualquer dado ou configuração interna.

Estas dependências impedem declarar o ambiente corporativo publicado e homologado. Elas não foram substituídas por valores falsos.
