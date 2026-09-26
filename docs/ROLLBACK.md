# Rollback

## Referência da versão 2.1.1

- Base anterior da `main`: `183ee22`.
- Tag preservada: `checkpoint-main-pre-backend-20260926`.
- Esta atualização introduz a migration inicial `0001_operational` para instalações que ainda usavam a versão estática. O rollback da aplicação não deve apagar o banco criado.
- Arquivos materiais: interface do Checklist, acessibilidade dos dialogs do Empilhadores, service workers, versão, testes, CI e documentação.

## Aplicação

1. Interrompa novas operações no proxy/orquestrador.
2. Reative a imagem anterior pelo digest ou commit aprovado.
3. Confirme readiness, login e fluxo não destrutivo.
4. Registre incidente e intervalo afetado.

Para preparar a versão anterior sem destruir a árvore atual, use um checkout/worktree separado da tag `checkpoint-main-pre-backend-20260926`. Essa referência é a versão estática anterior e não oferece persistência central ou código entre aparelhos; use-a somente como rollback emergencial de interface. Não use `git reset --hard` na cópia operacional. Depois do rollback, confirme que os service workers antigos foram ativados e faça o smoke test de Empilhadores e Checklist.

## Banco

Não faça downgrade destrutivo. Crie banco vazio, restaure o backup anterior conforme `BACKUP-RESTORE.md`, valide integridade e contagens, aponte a aplicação anterior para ele durante janela aprovada e preserve o banco substituído para perícia. Dados aceitos depois do backup exigem reconciliação operacional; não os descarte silenciosamente.
