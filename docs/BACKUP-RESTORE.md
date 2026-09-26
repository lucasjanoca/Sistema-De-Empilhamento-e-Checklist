# Backup e restauração

`python -m app.maintenance backup` executa `pg_dump --format=custom` em streaming. O dump nunca é gravado em claro: AES-256-GCM cifra o fluxo e RSA-OAEP-SHA256 envolve a chave aleatória. O manifesto JSON registra tamanho, SHA-256, formato e data. O job grava sucesso/falha na auditoria e em `technical_events`.

## Rotina

1. Configure `BACKUP_DIRECTORY` em volume privado e `BACKUP_PUBLIC_KEY` com RSA pública de no mínimo 3072 bits.
2. Use uma conta dedicada de leitura quando a política corporativa exigir.
3. Agende `python -m app.maintenance backup`; copie arquivo e manifesto para armazenamento externo imutável.
4. Monitore ausência, falha, tamanho anormal e idade. Teste restore periodicamente.

## Restore controlado

1. Crie banco PostgreSQL vazio e isolado com nome explícito.
2. Disponibilize backup, chave privada do cofre e `RESTORE_DATABASE_URL`; configure `PG_BIN` se necessário.
3. Execute `python -m app.backup restore --input ARQUIVO.selene --private-key CHAVE.pem --confirm-database NOME_EXATO`.
4. O programa autentica GCM antes de escrever, recusa banco não vazio e usa uma transação.
5. Verifique contagens, constraints, usuários, movimentos, Checklist e cabeça da auditoria; registre o ensaio.

Esta entrega restaurou o backup num segundo banco e comparou entidades e cabeça da auditoria. `EVIDENCIA-BACKUP.json` contém a evidência; chaves e dumps de teste não entram no pacote.
