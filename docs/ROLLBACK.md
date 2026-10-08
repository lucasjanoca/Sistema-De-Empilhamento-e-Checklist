# Rollback da candidata 2.2.0

## Referências

- Candidata: branch `integracao-producao-main`, migrations `0001_operational` e `0002_integration_outbox`.
- Versão estática anterior da `main`: tag `checkpoint-main-pre-backend-20260926`.
- Versão integrada anterior: tag `site-selene-2.1.1-main`.
- Sempre registre o digest exato da imagem aprovada; não use `latest` como referência de rollback.

## Aplicação

1. Bloqueie novas operações no proxy/orquestrador e registre o horário.
2. Verifique a outbox; movimentos `PENDING`, `SENDING` ou `FAILED` precisam de decisão operacional antes da troca.
3. Reative a imagem anterior pelo digest aprovado sem executar downgrade de banco.
4. Confirme `/health/ready`, login e um fluxo não destrutivo.
5. Registre incidente, intervalo afetado, IDs de correlação e responsável pela decisão.

A versão estática antiga não oferece persistência central nem código entre aparelhos. Ela serve somente como contingência de interface e não deve receber novos movimentos que precisem ser reconciliados com o banco novo.

## Banco

Não execute downgrade destrutivo. Crie banco vazio, restaure o backup anterior, valide migration, contagens, auditoria e integridade, e então troque a conexão numa janela aprovada. Preserve o banco substituído para perícia. Dados aceitos após o backup e confirmações Selene já entregues precisam de reconciliação; nunca os descarte nem reenvie sem verificar a chave de idempotência.

## Migração Supabase

Durante o corte, mantenha o legado somente leitura. Se o novo ambiente for abortado antes de aceitar operações, reabra o legado com autorização de TI. Se o novo ambiente já aceitou qualquer operação, não faça retorno automático: compare movimentos dos dois lados e obtenha decisão conjunta de Negócio/TI. O projeto Supabase é compartilhado; qualquer limpeza deve atingir somente objetos `emp_` explicitamente revisados.
