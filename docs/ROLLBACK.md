# Rollback

## Referência da versão 2.1.1

- Base anterior estável: `ac2697d`.
- Tag preservada: `checkpoint-pre-visual-homologation-20260926`.
- Esta atualização não possui migration nova; o rollback da aplicação não exige downgrade do schema.
- Arquivos materiais: interface do Checklist, acessibilidade dos dialogs do Empilhadores, service workers, versão, testes, CI e documentação.

## Aplicação

1. Interrompa novas operações no proxy/orquestrador.
2. Reative a imagem anterior pelo digest ou commit aprovado.
3. Confirme readiness, login e fluxo não destrutivo.
4. Registre incidente e intervalo afetado.

Para preparar a imagem anterior sem destruir a árvore atual, use um checkout/worktree separado da tag `checkpoint-pre-visual-homologation-20260926`, construa a imagem e promova-a pelo mesmo processo. Não use `git reset --hard` na cópia operacional. Depois do rollback, confirme que os dois service workers assumiram o cache 2.1.0 e faça o smoke test de login, Empilhadores e Checklist.

## Banco

Não faça downgrade destrutivo. Crie banco vazio, restaure o backup anterior conforme `BACKUP-RESTORE.md`, valide integridade e contagens, aponte a aplicação anterior para ele durante janela aprovada e preserve o banco substituído para perícia. Dados aceitos depois do backup exigem reconciliação operacional; não os descarte silenciosamente.
