# Teste interno no PC e no tablet — paletes oficiais da Selene

**Objetivo:** exibir no nosso layout os endereços e requisições que o sistema original retorna, sem paletes de teste e **sem escrever/subir/baixar dados no servidor original**.

O PC mantém uma pequena ponte de consulta de leitura e disponibiliza **o mesmo site para tablets conectados à rede interna que conseguem alcançar o computador**. O endereço público no GitHub Pages não é usado para consultar dados internos.

## Como iniciar no PC (Windows)

1. No repositório GitHub, use **Code → Download ZIP** e extraia todos os arquivos numa pasta permitida do computador.
2. É necessário ter **Node.js 18 ou superior** instalado nesse computador. Não são necessários pacotes npm.
3. Abra a pasta `teste-interno` e dê dois cliques em **`INICIAR-PC-E-TABLETS.bat`**.
   - Digite **a mesma empilhadeira selecionada no sistema original** (`emp1`, `emp2` etc.). Se for `emp1`, basta pressionar Enter.
4. O iniciador solicita sua **matrícula (somente números)** e, em seguida, uma **senha escolhida por você (mínimo 12 caracteres)**. Ela será digitada sem aparecer na tela; para reutilizar a mesma senha em outro teste, digite-a novamente ao iniciar. A senha **não é gravada nos arquivos do GitHub** nem exibida na janela.
5. A janela preta mostrará os endereços do PC e tablets. No PC, abra `http://127.0.0.1:8765/empilhadores/`. O navegador solicitará **usuário igual à **matrícula digitada ao iniciar** e a senha que você escolheu**.
6. No tablet, usando a mesma rede interna e com conexão permitida ao PC, abra o **endereço IP exibido na janela**: `http://IP-DO-PC:8765/empilhadores/`. O tablet pedirá o mesmo usuário **igual à matrícula digitada ao iniciar** e a mesma senha escolhida no PC.
7. Depois do controle de acesso, faça o login normal no Sistema de Empilhadores. A aplicação deverá mostrar o aviso **Selene ao vivo** quando conseguir ler a API original.

**Mantenha o PC ligado, a janela do servidor aberta e o acesso à rede ativo.** O PC funciona como ponte; se desligar ou perder conexão, os tablets ficarão sem a leitura. Se o tablet não conseguir abrir o endereço do PC, a rede pode isolar tablets de computadores ou impedir a porta. Não tente contornar essas restrições; é necessário um caminho de rede permitido.

### O que é compartilhado

As consultas são feitas pela ponte local, não por cada tablet diretamente. A atualização ocorre aproximadamente a cada 5 segundos; a página compara as duas listas oficiais. Quando não consegue consultar a API, **não mostra paletes inventados ou obsoletos**.

Consultas de leitura já identificadas:
- Pendentes: `GET api/Requisicao/ObtemRequisicoesPendente`, `situacao=1`.
- Em atendimento: `GET api/Requisicao/ObtemRequisicoesAtendimento`, `situacao=3`.
- Feedback: `GET api/Requisicao/ObtemFeedBack`.
- Endereços pendentes: `GET api/Enderecos/ObtemEnderecosPendentes`.

Por padrão: grupo 1 e empilhadeira `emp1`. Isso foi observado nas imagens e poderá não representar todas as empilhadeiras. Antes de executar o servidor, é possível alterar variáveis `SELENE_COD_GRUPO`, `SELENE_COD_EMP` e `SELENE_API_BASE`. A ponte não leva senhas, cookies nem tokens da sessão oficial.

### Segurança e limites

- **A ponte é somente leitura**. Todos os métodos diferentes de GET/HEAD são rejeitados; a interação por arraste não envia comandos à Selene.
- Ativar acesso LAN é **uma ação explícita** do arquivo `.bat`. Sem `SELENE_ALLOW_LAN=1`, o servidor escuta somente `127.0.0.1`.
- Em modo LAN, a ponte exige uma **senha aleatória temporária** para arquivos e consultas, limita clientes a endereços privados e bloqueia chamadas de outras origens.
- **HTTP em rede local não é criptografado.** O código temporário e os dados consultados podem ser observados por equipamentos com acesso à rede. Use apenas numa rede de testes isolada e aprovada para esses dados. Se o ambiente exigir confidencialidade, interrompa o teste até haver HTTPS com certificado confiável no tablet.
- Android/Chrome podem limitar algumas funções avançadas em páginas HTTP de IP privado, incluindo PWA e APIs que exigem contexto seguro. Login no Supabase ou outros recursos poderão precisar de HTTPS confiável.
- Não instale software nem altere regras de firewall sem permissão para o equipamento. Não exponha a porta 8765 à internet nem use roteadores públicos.
- O modo LAN não supre autenticação, autorização nem permissões das APIs de empresa; se o computador não conseguir consultar a API original, a tela continua sem dados.

### Diagnóstico rápido

Na janela preta do PC aparece um resumo como `[Consulta Selene] emp1 · 10 aguardando, 7 em atendimento`, ou um erro de leitura `HTTP 404/401/403`. Isso ajuda a diferenciar API incorreta de empilhadeira diferente.

No site, a barra superior agora informa a empilhadeira, o grupo, a quantidade de requisições e eventual erro de leitura. Se a consulta trouxe requisições mas não aparecem cartões, confira **filtros de status**, **corredores** e se está usando o endereço do servidor local.

**Não use o endereço público do GitHub Pages para este teste**, porque ele não consulta a ponte interna. No computador use `127.0.0.1:8765`; no tablet use o endereço LAN que aparece na janela do PC.

### Diagnóstico rápido

- **Tablet não abre a página:** verificar se o IP mostrado pertence à rede alcançável pelo tablet e se a porta local está permitida.
- **Login da ponte não funciona:** usuário igual à **matrícula digitada ao iniciar**, senha = senha escolhida no momento da inicialização, não é a senha do sistema original.
- **A página abre, mas não aparecem paletes reais:** conferir status na barra superior; a API pode estar indisponível, exigir autenticação ou retornar estrutura que precise mapeamento.
- **Paletes em atendimento aparecem vermelhos, mas deveriam verdes:** a cor só é confirmada quando a fonte de dados informa liberação; não inferimos a autorização pela idade do palete.
- **Arrastar não altera o sistema da Selene:** é intencional; somente leitura. O fluxo oficial de escrita não foi integrado.

Para encerrar, pressione Ctrl+C na janela do servidor no PC.
