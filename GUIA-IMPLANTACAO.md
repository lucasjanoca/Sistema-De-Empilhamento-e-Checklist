# Sistema de Empilhadores — instalação e integração definitiva

Este repositório contém a interface operacional existente (PC/tablet), consulta da API da Selene e uma porta de integração para movimentações reais **que permanece fechada até haver o contrato oficial de escrita**. O site não apresenta movimentações simuladas como reais.

## 1. Abrir no PC

Pré-requisitos: Windows com Node.js 18+ e acesso permitido à rede da Selene.

1. Baixe o repositório e extraia todos os arquivos.
2. Execute **INICIAR-SISTEMA.bat** na pasta principal.
3. Informe o código da empilhadeira que aparece no aplicativo original e a matrícula.
4. Acesse **http://127.0.0.1:8765/empilhadores/**.
5. Faça o login já cadastrado no nosso aplicativo. A senha do servidor local é independente da senha da conta Supabase.
6. Confira a mensagem de integração no cabeçalho: **Selene** mostra os totais efetivamente consultados; na ausência de conexão os paletes não são inventados.

O aplicativo pode receber e exibir as requisições que a API retornar. **Subir/baixar no sistema original ainda não é possível sem fornecer o adaptador real abaixo.**

## 2. Como ativar comandos oficiais (para implantação corporativa)

A API conhecida inclui consultas GET de pendentes e atendimento. **Não temos ainda o endpoint documentado de POST/PUT/PATCH nem o formato da requisição que registra uma descida ou subida.** Não devemos tentar adivinhar essas chamadas em ambiente produtivo.

O responsável pela implantação deve disponibilizar, de forma aprovada, um módulo **privado** JavaScript fora do repositório público, implementando:

\`\`\`js
module.exports = {
  async move({ direction, officialId, address, codGrupo, codEmp, actor, record }) {
    // Enviar a operação ao endpoint de escrita oficial autorizado, com a
    // autenticação de servidor apropriada. Não usar endpoints inventados.
    // Não devolver sucesso se a API não confirmar efetivamente a operação.
    // Retorno exigido:
    // return { confirmed: true, officialId };
    throw new Error('Contrato oficial de escrita ainda não implementado.');
  }
};
\`\`\`

Variáveis de ambiente **somente no servidor**, não no GitHub Pages:

- \`SELENE_API_BASE\`: URL privada da API autorizada para consultar os paletes.
- \`SELENE_COD_GRUPO\` / \`SELENE_COD_EMP\`: parâmetros correspondentes ao operador/empilhadeira.
- \`SELENE_WRITE_ADAPTER_PATH\`: caminho **absoluto**, fora do repositório, para o módulo privado implementado.
- \`SELENE_OFFICIAL_WRITES=1\`: habilita a função **somente se** o módulo privado estiver presente e exportar \`move\`.

O backend realiza nova consulta GET antes de cada comando para confirmar o palete e seu estado. Para subir, exige liberação verde explícita. Envia apenas o identificador real autorizado ao adaptador. Após a confirmação de escrita, consulta novamente a API oficial para verificar que a requisição saiu da lista original. **Uma resposta HTTP isolada não é considerada confirmação suficiente.**

Se houver erro, os botões permanecem bloqueados ou exibem a falha; nenhum movimento aparece como concluído sem confirmação. O recurso de **cancelamento oficial** precisa de seu próprio contrato: o cronômetro de desfazer de 10 segundos do protótipo não é transferido para a produção por suposição.

## 3. Servidor e tablets

Para uso definitivo em múltiplos aparelhos, instale o backend em ambiente gerenciado e exponha **HTTPS com certificado confiável**, autenticação por operador, controles de acesso e auditoria. O aplicativo publicado em GitHub Pages não alcança automaticamente a rede interna da empresa.

**Importante:** com gravação oficial habilitada, o servidor Node se limita ao loopback \`127.0.0.1\`. A publicação para tablets deve passar por um proxy reverso HTTPS da empresa, não por abrir uma porta HTTP de escrita para toda a rede.

Não copie credenciais da API, cookies, tokens ou senhas para o repositório. Não confunda a senha de acesso HTTP da ponte com a senha da conta do nosso aplicativo.

## 4. Checklist de aceite antes de substituir o sistema atual

- Paletes de cada corredor e seus números coincidem com a consulta oficial.
- Requisições novas aparecem e as concluídas desaparecem pela API.
- Apenas paletes realmente verdes podem subir.
- Respostas de erro, bloqueio, lentidão e desconexão **nunca** geram sucesso falso.
- Duas requisições simultâneas para o mesmo palete são rejeitadas.
- Descidas/subidas aparecem também no sistema original após confirmação.
- A operação funciona no tablet pelo HTTPS do servidor instalado.
- Sessão, permissões, auditoria, histórico, disponibilidade e backups estão validados.

**Status atual:** interface e leitura de paletes disponíveis; comandos de escrita oficial pendentes do contrato técnico da API; por isso **não substituir ainda o sistema corporativo em produção**.
