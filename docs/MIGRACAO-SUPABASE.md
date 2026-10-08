# Migração do protótipo Supabase para PostgreSQL autoritativo

## Decisão

A versão 2.2.0 não usa o navegador como fonte de verdade e não acessa Supabase diretamente. Todo login, autorização, leitura e escrita operacional passa pelo FastAPI; o PostgreSQL acessível somente pela rede privada é a fonte autoritativa. O frontend não contém URL, chave publicável, `service_role`, senha de banco nem fallback local.

Esta decisão evita manter dois bancos ativos e elimina divergência silenciosa. As migrations preservadas da antiga `main` são referência histórica; não devem ser aplicadas junto com `migrations/`/Alembic desta arquitetura.

## Inventário e exportação

1. Congele escrita no sistema antigo durante uma janela aprovada.
2. Exporte schema e dados do projeto Supabase com ferramentas PostgreSQL compatíveis, mantendo IDs e timestamps. Nunca coloque credenciais ou o dump no Git.
3. Registre contagens e hashes por tabela de origem. Inclua usuários, perfis, dispositivos, requisições, movimentos, histórico e Checklist existentes.
4. Transforme os dados num job versionado e repetível. Senhas não podem ser copiadas em texto claro; hashes incompatíveis exigem redefinição controlada.
5. Importe primeiro em banco vazio de homologação usando a conta de migration, nunca a credencial runtime.

## Reconciliação

- Mapear os papéis antigos para `empilhador`, `encarregado` e `ti` e revisar exceções manualmente.
- Normalizar matrícula/crachá sem perder zeros à esquerda.
- Rejeitar endereços duplicados ativos, duas produções abertas para o mesmo usuário, movimentos sem requisição e referências externas duplicadas.
- Preservar histórico importado como evidência somente leitura e iniciar a cadeia de auditoria da aplicação com evento de migração contendo contagens, origem e responsável.
- Comparar contagens, amostras, constraints, última movimentação e totais por requisição antes da liberação.

## Segurança

RLS do Supabase não substitui o RBAC da API. Se o projeto Supabase permanecer acessível durante a transição, mantenha RLS em todas as tabelas expostas, não use `service_role` no frontend e revogue as chaves após o aceite. A documentação oficial vigente deve ser revalidada na data da migração: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) e [API keys](https://supabase.com/docs/guides/api/api-keys).

## Corte e rollback

1. Executar ensaio completo e UAT no staging.
2. Fazer backup verificável dos dois lados e registrar os responsáveis.
3. Bloquear escrita antiga, repetir exportação incremental, importar e reconciliar.
4. Alterar o endereço oficial somente após os gates de `HOMOLOGACAO-2.2.0.md`.
5. Manter o sistema antigo somente leitura pelo prazo aprovado. Rollback aponta a aplicação anterior para seus próprios dados; nunca mescla bancos automaticamente nem descarta movimentos aceitos depois do corte.
