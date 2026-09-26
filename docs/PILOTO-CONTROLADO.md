# Piloto controlado

Execute em banco, URL HTTPS e rede de homologação, com dados descartáveis e responsáveis da operação presentes.

## Preparação

- [ ] Fixar a imagem/commit aprovado e registrar o digest.
- [ ] Confirmar backup válido, responsável pelo rollback e janela do piloto.
- [ ] Validar `/health/live`, `/health/ready`, logs, horário e conectividade PostgreSQL.
- [ ] Cadastrar 1 computador, 1 tablet, 1 usuário Emp, 1 Encarregado e 1 TI.
- [ ] Cadastrar ao menos 1 bateria, 1 empilhadeira e 1 tablet operacional.
- [ ] Publicar e conferir os três modelos de checklist.

## Roteiro

- [ ] Entrar como Emp; confirmar somente funções permitidas.
- [ ] Selecionar o tablet; tentar o mesmo tablet em outra sessão e confirmar bloqueio.
- [ ] Iniciar produção e solicitar palete normal.
- [ ] Autorizar como Encarregado, baixar, aguardar confirmação e subir.
- [ ] Repetir com EXP-PIC e conferir mensagens, prioridade e histórico.
- [ ] Gerar código de Checklist; consumir em outro cliente; rejeitar reuso e expirado.
- [ ] Registrar checklist OK de bateria com nível de água e litros.
- [ ] Registrar um item em Atenção e outro Crítico; conferir pendências.
- [ ] Tratar e resolver a pendência; confirmar auditoria e histórico anterior preservado.
- [ ] Registrar checklist de empilhadeira e de tablet.
- [ ] Registrar troca de bateria e validar horímetros.
- [ ] Pesquisar, filtrar e abrir Histórico; exportar CSV e PDF.
- [ ] Atualizar a página, abrir nova aba e confirmar restauração esperada da sessão.
- [ ] Simular perda e retorno de rede; conferir bloqueio, banner e recuperação sem duplicidade.
- [ ] Fazer logout; confirmar retorno ao login e revogação da sessão/códigos.
- [ ] Entrar como Encarregado e TI; validar matriz administrativa e proteção da última conta TI.
- [ ] Conferir instalação/atualização PWA e ausência de cache antigo.

## Critérios de aceite

- [ ] Nenhum erro crítico ou erro de console relevante.
- [ ] Nenhuma operação duplicada, histórico perdido ou permissão indevida.
- [ ] Layout legível no computador e tablet do piloto.
- [ ] Código temporário previsível dentro da validade e do uso único.
- [ ] Relatórios, auditoria, backup e rollback conferidos pelos responsáveis.
- [ ] Pendências externas possuem dono e prazo.

Se qualquer critério falhar, interrompa a expansão do piloto, preserve logs/correlation IDs e siga `ROLLBACK.md`.
