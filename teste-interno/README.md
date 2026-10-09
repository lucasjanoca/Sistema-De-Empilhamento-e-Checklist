# Servidor local de consulta da Selene

**Inicie a aplicação pelo arquivo \`INICIAR-SISTEMA.bat\` na pasta principal.**

O servidor Node.js em \`server.js\` recupera as requisições oficiais quando a rede interna permitir. Ele **não simula nem grava movimentações** sem um adaptador de escrita oficial habilitado.

A integração de escrita exige uma implementação privada do contrato descrito no [Guia de implantação](../GUIA-IMPLANTACAO.md).

O antigo iniciador desta pasta oferece acesso temporário de leitura pela rede local para avaliação de telas. **HTTP LAN não é adequado para operação definitiva**, pois não criptografa credenciais ou dados; para tablets de produção use hospedagem corporativa com HTTPS confiável.

Se o sistema estiver sem conexão ou os filtros estiverem ocultando resultados, confira o indicador da interface e as mensagens do console do servidor. O sistema não mostra paletes fictícios.
