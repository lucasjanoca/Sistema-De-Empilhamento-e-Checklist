# Sistema de Empilhadores e Checklist — InfoTech.io

Interface de operação de paletes, com login, seleção de equipamento, corredores, dashboard, histórico e integração com o Checklist.

**Instalação no PC:** consulte [GUIA-IMPLANTACAO.md](GUIA-IMPLANTACAO.md) e execute **INICIAR-SISTEMA.bat**.

## Integração com a Selene

A leitura de requisições é feita a partir das consultas oficiais de pendentes e em atendimento, quando o computador consegue acessar a API na rede interna. Nenhum palete fictício é inserido para completar o painel.

A versão para implantação **não utiliza movimentos de simulação**. Uma descida/subida só será aceita após configuração do **adaptador de escrita oficial privado**, validação do estado do palete e confirmação posterior pela API.

**Ainda não temos o contrato e o endpoint de escrita oficial da Selene. Sem eles, os movimentos permanecem bloqueados e o site não substitui o sistema corporativo.** O [guia](GUIA-IMPLANTACAO.md) detalha os requisitos exatos para concluir isso de forma segura e implantar por HTTPS nos tablets.

## Links

- [Sistema de Empilhadores (interface pública)](https://lucasjanoca.github.io/Sistema-De-Empilhamento-e-Checklist/empilhadores/)
- [Checklist](https://lucasjanoca.github.io/Sistema-De-Empilhamento-e-Checklist/checklist/)

A hospedagem estática em GitHub Pages não possui acesso automático à API da rede interna.
