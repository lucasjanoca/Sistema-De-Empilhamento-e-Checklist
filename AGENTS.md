# AGENTS.md — Sistema de Empilhadores e Checklist

Instruções para Codex, outros agentes de IA e colaboradores. Este projeto tem **impacto operacional**: informações erradas sobre requisições/paletes podem causar movimentos indevidos. Nunca confunda interface, simulação, dados locais ou sucesso HTTP com confirmação da Selene.

## 1. Leia antes de editar

- `README.md` — escopo e estado atual.
- `GUIA-IMPLANTACAO.md` — requisitos de integração **real** e aceite operacional.
- `teste-interno/README.md` — limitações do servidor local/LAN.
- `tests/` e `.github/workflows/test.yml` — contratos e regressões existentes.

**O contrato de escrita oficial não existe neste repositório.** Não invente endpoints POST/PUT/PATCH, credenciais, payloads de baixa/subida, confirmações, permissões nem leituras da rede da empresa. Não declare sistema pronto para substituir o corporativo sem teste no ambiente autorizado e validação da API original.

## 2. Arquitetura e limites de cada módulo

- `empilhadores/index.html`, `empilhadores/assets/app.bundle.js` e arquivos `pallet-*.js/css`: tela, painel, seleção, arrastar/soltar e interação com requisições.
- `checklist/index.html` e `shared/`: Checklist, código temporário e cliente Supabase. Uma sessão no navegador NÃO equivale à permissão de escrever na API da Selene.
- `teste-interno/server.js`: servidor Node do PC, leitura da API interna e fornecimento de arquivos. Em acesso LAN por HTTP, não transportar senhas ou dados reais de produção; uso definitivo em tablets exige HTTPS corporativo.
- `teste-interno/official-operations.js`: porta de escrita oficial **desligada por padrão**. Sem adaptador privado e autenticador de operadores, nenhum movimento pode ser confirmado.
- `tests/`: testes sintéticos; nunca usar paletes ou matrículas reais neles.
- `.site-import/` e `.github/workflows/import-original-site.yml`: mecanismo de importação que pode substituir arquivos da interface. Não alterar ou disparar sem revisar seus efeitos.

## 3. Regras de segurança inegociáveis

1. Fazer toda alteração em branch própria, com Pull Request, revisão e testes; **não fazer merge ou publicar na `main` sem autorização explícita**.
2. Não alterar banco Supabase, Edge Functions, políticas RLS ou variáveis corporativas sem identificação e autorização expressas. O código público sozinho não comprova o estado do backend.
3. Não registrar tokens, senhas, cookies, chaves privadas, dados de funcionários ou requisições operacionais nos commits, testes, logs ou PRs.
4. Leitura de paletes: **somente** a API oficial pode alimentar a operação. Não criar listas fictícias, fallback local ou dados de demonstração apresentados como produção.
5. Falha de rede, formato inesperado, resposta explícita de erro (`Success:false`, `Error:true` ou variantes), ausência de identificação e estado duvidoso devem **bloquear** a operação e mostrar erro, não limpar o painel como se não houvesse requisições.
6. Escrita de paletes: exigir identidade/permissão verificada no servidor, estado correto, liberação verde quando necessária, trava contra concorrência, confirmação do adaptador autorizado **e leitura posterior comprovando o resultado**.
7. Não tornar a porta de escrita acessível por HTTP LAN. Para tablets, apenas infraestrutura HTTPS autorizada e autenticação individual.
8. Não considerar `localStorage`, `sessionStorage`, códigos de seis dígitos ou seleção visual de equipamento como autorização corporativa.
9. Alterar senhas, perfis, matrícula, equipamentos ou formato das requisições somente com exigência clara e sem inserir valores sensíveis no código.

## 4. Fluxo para cada tarefa

1. Identificar problema reproduzível, arquivos afetados, origem dos dados e risco.
2. Fazer a **menor** correção que resolve o problema, preservando layout e funcionalidades em uso.
3. Criar/ajustar teste de regressão com dados falsos; testar falhas e casos de sucesso.
4. Verificar JavaScript com `node --check` e executar os testes da pasta `tests/` com Node 18+ (preferir a versão usada no CI).
5. Conferir os resultados de `.github/workflows/test.yml`. Não afirmar que o sistema operou com paletes reais se testes usaram mocks.
6. Abrir PR explicando escopo, risco, validação, pendências da API corporativa e rollback. Manter produção inalterada até aprovação.

## 5. Critérios de aceite para uso real

- Paletes e estados correspondem aos resultados efetivos da API interna no PC e tablet, sob conexão autorizada.
- Toda falha de consulta, autenticação, escrita ou confirmação bloqueia o comando e gera mensagem clara.
- Comandos de descer/subir são verificados no **sistema oficial**, não apenas no frontend ou em dados Supabase.
- Concorrência, permissões, histórico, perda de conexão, reconexão e HTTPS são testados com a equipe responsável.
- **A implantação depende do contrato e do adaptador oficial de escrita** descritos em `GUIA-IMPLANTACAO.md`; a aprovação dos testes sintéticos por si só não libera produção.
