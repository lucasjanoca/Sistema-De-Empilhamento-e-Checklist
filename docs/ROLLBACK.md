# Rollback

## Aplicação

1. Interrompa novas operações no proxy/orquestrador.
2. Reative a imagem anterior pelo digest ou commit aprovado.
3. Confirme readiness, login e fluxo não destrutivo.
4. Registre incidente e intervalo afetado.

## Banco

Não faça downgrade destrutivo. Crie banco vazio, restaure o backup anterior conforme `BACKUP-RESTORE.md`, valide integridade e contagens, aponte a aplicação anterior para ele durante janela aprovada e preserve o banco substituído para perícia. Dados aceitos depois do backup exigem reconciliação operacional; não os descarte silenciosamente.
