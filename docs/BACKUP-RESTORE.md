# Backup e restauração

`python -m app.maintenance backup` executa `pg_dump --format=custom` em streaming. O dump nunca é gravado em claro: AES-256-GCM cifra o fluxo e RSA-OAEP-SHA256 envolve a chave aleatória. O manifesto JSON registra tamanho, SHA-256, formato e data. O job grava sucesso/falha na auditoria e em `technical_events`.

## Rotina

1. Configure `BACKUP_DIRECTORY` em volume privado, `BACKUP_EXTERNAL_DIRECTORY` em armazenamento externo/imutável e `BACKUP_PUBLIC_KEY` com RSA pública de no mínimo 3072 bits.
2. Use uma conta dedicada de leitura quando a política corporativa exigir.
3. Agende `python -m app.maintenance backup`; o job grava o backup local e replica arquivo e manifesto usando criação exclusiva, sem sobrescrever o destino externo.
4. Agende `python -m app.maintenance cleanup`; `BACKUP_RETENTION_DAYS` vale apenas para cópias locais. O destino externo não é apagado pela aplicação.
5. Defina `BACKUP_SCHEDULE_MANAGED=true` somente depois de instalar o agendamento e alerte quando `backupOverdue=true` ou a idade superar `BACKUP_MAX_AGE_HOURS`. Teste restore periodicamente.

## Restore controlado

1. Crie banco PostgreSQL vazio e isolado com nome explícito.
2. Disponibilize backup, chave privada do cofre e `RESTORE_DATABASE_URL`; configure `PG_BIN` se necessário.
3. Execute `python -m app.backup restore --input ARQUIVO.selene --private-key CHAVE.pem --confirm-database NOME_EXATO`.
4. O programa autentica GCM antes de escrever, recusa banco não vazio e usa uma transação.
5. Verifique contagens, constraints, usuários, movimentos, Checklist e cabeça da auditoria; registre o ensaio.

Esta entrega restaurou o backup num segundo banco e comparou entidades e cabeça da auditoria. `EVIDENCIA-BACKUP.json` contém a evidência; chaves e dumps de teste não entram no pacote.
