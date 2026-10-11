# Contrato de reserva exclusiva de equipamentos — backend pendente

> **Não habilitar em produção sem implementar e homologar este contrato no servidor.**
> A interface do PR de exclusividade recusa a seleção no modo Supabase caso
> o servidor ainda não ofereça as ações documentadas aqui.
> O repositório não contém a Edge Function privada nem seu esquema de banco.

## Regra aprovada

Cada equipamento físico pode estar reservado por **um funcionário e uma sessão por vez**.
Outro usuário deve receber conflito, mesmo que o snapshot local do PC/tablet
esteja desatualizado. A mesma matrícula em outro aparelho **não deve roubar**
uma reserva vigente; é necessário um token válido daquela concessão.
Não existe transferência forçada por TI/Encarregado neste contrato.

## Ações exigidas na função `empilhadores-api`

O cliente usa POST autenticado e envia um `action` distinto para cada caso.
Todas as respostas devem usar `Cache-Control: no-store`.
A identidade do funcionário deve vir **somente do JWT validado pelo servidor**.

### `device-claim`

Entrada: `{action:"device-claim",deviceId,previousDeviceId?,previousLeaseId?}`.

Em uma **única transação no banco**, o servidor deve:
1. Validar JWT, conta ativa e autorização para usar o equipamento.
2. Confirmar dispositivo cadastrado, ativo e não bloqueado.
3. Bloquear a linha do equipamento (ou usar constraint/lock transacional equivalente).
4. Rejeitar com **HTTP 409** se houver outra concessão não expirada, mesmo
   para a mesma matrícula que esteja em outra sessão.
5. Se houver transferência, validar `previousLeaseId` contra a sessão dona,
   reservar o novo equipamento e liberar o anterior atomicamente; se a nova
   reserva falhar, manter a anterior.
6. Gerar `leaseId` criptograficamente aleatório e armazenar somente hash
   no banco, junto com matrícula, sessão, equipamento e vencimento.
7. Retornar os dados da reserva recém-gravada somente após commit:
   `{ok:true,deviceId,matricula,leaseId,expiresAt}`,
   onde `expiresAt` é **epoch em milissegundos** do relógio do servidor.

### `device-renew`

Entrada: `{action:"device-renew",deviceId,leaseId}`.

Validar JWT, matrícula, sessão, token, equipamento ativo e prazo da reserva.
Renovar somente a própria concessão, em operação atômica. Retornar
`{ok:true,deviceId,matricula,leaseId,expiresAt}`.
A interface renova a cada 60 segundos. Usar TTL de pelo menos 120 segundos,
com política de tolerância definida/monitorada no servidor; jamais depender
de `Date.now()` do cliente para determinar ocupação real.

### `device-release`

Entrada: `{action:"device-release",deviceId,leaseId}`.

Liberar apenas a reserva cujo token e identidade foram validados. Uma liberação
antiga **não** pode liberar concessão assumida por outro usuário. Retornar `{ok:true}`
após confirmação; ausência de conexão deverá ser resolvida pelo vencimento
controlado pelo servidor.

## Impedir bypass do contrato

A simples reserva no navegador não é uma autorização operacional.

- `state-save`/snapshots devem ter controles de autorização e rejeitar
  mudanças arbitrárias em `tabletAssignments` que contradigam a tabela de
  reservas. Não aceitar dados de ocupação fornecidos apenas pelo navegador
  como prova de posse.
- Cada comando de operação oficial deve exigir autenticação de operador,
  equipamento e lease válida **no servidor**, além do adaptador de escrita
  corporativo aprovado. Não habilitar escrita oficial com esse PR.
- RLS/grants devem impedir acesso direto dos clientes a criar, sobrescrever
  ou remover concessões de terceiros.
- A UI pode mostrar ocupação atual, mas os nomes e horários de ocupação
  para outros usuários só podem vir de dados autorizados pelo backend.
- A situação de um dispositivo `Computador Mesa` ou `Computador TI`
  precisa seguir a mesma reserva ou ter uma política formal e separada
  aprovada antes de entrar no seletor.

## Critérios mínimos de homologação

1. Duas matrículas tentam reservar o mesmo equipamento simultaneamente:
   **exatamente uma** deve receber sucesso, a outra HTTP 409.
2. Mesmo funcionário em duas sessões com o mesmo equipamento: segunda
   sessão não assume a reserva sem token autorizado.
3. Senha/JWT inválido, usuário bloqueado ou equipamento inativo:
   nenhuma reserva é criada ou renovada.
4. Release com token antigo não solta reserva atual.
5. Fechar o navegador, perder rede, desligar tablet: expiração e nova
   reserva ocorrem conforme prazo configurado no servidor.
6. Acompanhamento de 2 dispositivos no ambiente de homologação:
   seleção, renovação, troca, logout, perda de conexão, recarga da página,
   disputa e reconexão.
7. A leitura e a movimentação real de paletes continuam dependentes do
   contrato corporativo de escrita e dos respectivos testes autorizados.

**Status:** a integração de UI + mocks é implementável no repositório público;
a garantia de exclusividade em PC/tablet **não está comprovada até a Edge Function
transacional e a verificação server-side serem implantadas e testadas**.
