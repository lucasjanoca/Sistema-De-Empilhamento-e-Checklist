# Migração do protótipo Supabase para PostgreSQL autoritativo

## Decisão

A versão 2.2.0 não usa o navegador como fonte de verdade e não acessa Supabase diretamente. Todo login, autorização, leitura e escrita operacional passa pelo FastAPI; o PostgreSQL acessível somente pela rede privada é a fonte autoritativa. O frontend não contém URL, chave publicável, `service_role`, senha de banco nem fallback local.

Esta decisão evita manter dois bancos ativos e elimina divergência silenciosa. As migrations preservadas da antiga `main` são referência histórica; não devem ser aplicadas junto com `migrations/`/Alembic desta arquitetura.

## Inventário real verificado em 08/10/2026

O projeto conectado `Sites De Clientes!` está saudável em PostgreSQL 17, mas é compartilhado com outras aplicações. A migração deve consultar e alterar somente objetos com prefixo `emp_`; a implantação corporativa nova deve usar banco dedicado.

Sem ler nomes, matrículas ou conteúdo operacional, a inspeção encontrou:

- `emp_profiles`: 2; `emp_audit_log`: 32; `emp_operational_state`: 1; `emp_operational_backups`: 1;
- `emp_access_codes`, `emp_checklist_sessions`, `emp_checklist_records` e `emp_pallet_locks`: vazias;
- snapshot: 3 paletes em estado `ready`, 1 produção fechada, 10 eventos históricos, 6 tablets, 2 atribuições e 5 notificações;
- o snapshot antigo não possui `quantity`, `reference`, `note` nem `area`, hoje obrigatórios. Esses valores não podem ser inventados pelo migrador;
- RLS está habilitado em todas as tabelas `emp_`. `emp_operational_backups` e `emp_pallet_locks` não têm policy e, portanto, ficam fechadas ao cliente; as duas funções `SECURITY DEFINER` do módulo permitem execução somente a `service_role`;
- três Edge Functions antigas de bootstrap/teste continuam publicadas, porém são tombstones inertes que respondem HTTP 410. Devem ser removidas no encerramento do legado: `emp-bootstrap-once`, `emp-create-ti-temp-once` e `emp-password-length-test`.

## Inventário e exportação segura

1. Congele escrita no sistema antigo durante uma janela aprovada.
2. No SQL Editor do Supabase, exporte para arquivos privados somente o resultado de `select snapshot, revision, updated_at from public.emp_operational_state order by updated_at desc limit 1` e `select user_id, matricula, nome, role, active from public.emp_profiles`. Nunca coloque esses arquivos, credenciais ou dumps no Git.
3. Registre contagens e hashes por tabela de origem. Inclua usuários, perfis, dispositivos, requisições, movimentos, histórico e Checklist existentes.
4. Rode o planejador somente leitura. O relatório não inclui nomes, matrículas ou conteúdo dos registros:

   `python scripts/plan_supabase_migration.py --snapshot C:\caminho-privado\estado.json --profiles C:\caminho-privado\perfis.json --report C:\caminho-privado\relatorio.json --mapping-template C:\caminho-privado\mapeamento.json --require-ready`

   O código 2 é esperado enquanto existirem bloqueios. O comando recusa sobrescrever os arquivos de saída e limita o JSON a 50 MiB.
5. Preencha o arquivo privado de mapeamento com quantidade, referência, área, estado de corte e vínculo externo de cada palete. Negócio e TI devem assiná-lo. O modelo nunca solicita senha, token ou chave.
6. Transforme os dados num job versionado e repetível depois da aprovação. Senhas não podem ser copiadas em texto claro; hashes incompatíveis exigem redefinição controlada. Sessões, códigos temporários e leases não são migrados.
7. Importe primeiro em banco vazio de homologação usando a conta de migration, nunca a credencial runtime.

## Reconciliação

- Mapear os papéis antigos para `empilhador`, `encarregado` e `ti` e revisar exceções manualmente.
- Normalizar matrícula/crachá sem perder zeros à esquerda.
- Rejeitar endereços duplicados ativos, duas produções abertas para o mesmo usuário, movimentos sem requisição e referências externas duplicadas.
- Preservar histórico importado como evidência somente leitura e iniciar a cadeia de auditoria da aplicação com evento de migração contendo contagens, origem e responsável.
- Comparar contagens, amostras, constraints, última movimentação e totais por requisição antes da liberação.
- Guardar o relatório agregado, o hash do export e o aceite; manter os arquivos com dados pessoais fora do Git e do artefato da aplicação.

## Segurança

RLS do Supabase não substitui o RBAC da API. Se o projeto Supabase permanecer acessível durante a transição, mantenha RLS em todas as tabelas expostas, não use `service_role` no frontend e revogue as chaves após o aceite. Como o projeto é compartilhado, nunca faça limpeza por prefixo genérico nem altere objetos de outras aplicações. A documentação oficial vigente deve ser revalidada na data da migração: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) e [API keys](https://supabase.com/docs/guides/api/api-keys).

## Corte e rollback

1. Executar ensaio completo e UAT no staging.
2. Fazer backup verificável dos dois lados e registrar os responsáveis.
3. Bloquear escrita antiga, repetir exportação incremental, importar e reconciliar.
4. Alterar o endereço oficial somente após os gates de `HOMOLOGACAO-2.2.0.md`.
5. Manter o sistema antigo somente leitura pelo prazo aprovado. Rollback aponta a aplicação anterior para seus próprios dados; nunca mescla bancos automaticamente nem descarta movimentos aceitos depois do corte.
6. Após aceite e retenção aprovados, remover as três Edge Functions tombstone, revogar chaves antigas e arquivar somente os objetos `emp_`; preservar os demais sistemas do projeto compartilhado.
