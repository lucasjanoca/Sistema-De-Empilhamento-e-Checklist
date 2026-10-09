# Integração Selene e OIDC

## Sistema Selene corporativo

`SeleneIntegrationAdapter` implementa leitura, health check e confirmação de movimentos por HTTPS. Movimentos vinculados por `external_ref` somente começam quando o adaptador, hostname e rota de escrita estão habilitados. Depois do timer operacional, a transação local grava uma outbox durável e muda o movimento para `EXTERNAL_PENDING`; o estado final, os contadores e a autorização somente são confirmados após resposta 2xx do Selene.

Falhas de rede ou 5xx não perdem nem duplicam o movimento: a mesma `Idempotency-Key` é reutilizada, o reenvio tem backoff limitado e o operador vê **Sincronizando** ou **Falha de conexão · reenvio automático**. A TI pode visualizar os totais por estado e reenfileirar falhas pela área administrativa. Eventos de fila, falha e confirmação são registrados em `technical_events`.

O contrato de escrita esperado é `POST routeMovement`, com cabeçalhos `X-Cod-Grupo`, `X-Cod-Emp` e `Idempotency-Key`, autenticação configurada somente no servidor e JSON contendo `externalId`, `action`, `codGrupo` e `codEmp`. São aceitas respostas 2xx JSON ou 204. Antes de habilitar escrita, a TI deve validar health e leituras sem alterar dados:

`python scripts/verify_selene_contract.py --config deploy/selene-contract.approved.json`

O arquivo de exemplo é `deploy/selene-contract.example.json`. Ele não deve receber segredos; bearer token, API key ou senha ficam em variáveis protegidas. Como os endpoints reais ainda não foram fornecidos, os testes automatizados usam um servidor HTTP simulado e não afirmam compatibilidade com a API corporativa.

A TI deve fornecer contrato, autenticação, hostname, allowlist, timeouts e evidência de homologação. O destino precisa usar HTTPS e constar em `INTEGRATION_ALLOWED_HOSTS`. A configuração só deve mudar de desabilitada para habilitada depois de um teste de escrita controlado com um palete descartável de homologação.

## OIDC e MFA

Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e ACR aprovado. O fluxo usa discovery, Authorization Code, PKCE, state e nonce; apenas subjects previamente vinculados com `python -m app.admin bind-oidc` entram. Ative `REQUIRE_ADMIN_MFA=true` somente após homologar issuer, claims e ACR.
