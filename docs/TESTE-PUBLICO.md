# Preview público para testes

## Finalidade

O `render.yaml` cria um preview temporário com aplicação Docker e PostgreSQL 17 no Render. O endereço será HTTPS em `onrender.com`; o código e o histórico continuam no GitHub. GitHub Pages não executa Python/FastAPI e, por isso, não pode hospedar a aplicação completa.

Este preview é aberto na internet para permitir testes. Não use dados reais, nomes reais, credenciais corporativas nem a integração Selene. O adaptador externo e o agendamento de backup permanecem desativados.

## Publicar

1. Abra o botão **Deploy to Render** no `README.md` e entre na sua conta Render.
2. Revise os dois recursos gratuitos: web service e PostgreSQL.
3. No campo privado `PREVIEW_ADMIN_PASSWORD`, informe uma senha exclusiva de 12 a 128 caracteres. Não reutilize senha pessoal ou corporativa.
4. Confirme a criação. O primeiro deploy aplica as migrations e cria somente `ti-preview`.
5. Aguarde `/health/ready` ficar verde e abra a URL `onrender.com` mostrada pelo painel.
6. Entre com matrícula `ti-preview` e a senha escolhida. Crie contas individuais de teste para que a auditoria identifique cada pessoa; não compartilhe a conta TI.
7. Execute o roteiro de `PILOTO-CONTROLADO.md` usando apenas dados fictícios.

## Limites obrigatórios

- O plano gratuito pode adormecer e demorar para responder na primeira abertura.
- O PostgreSQL gratuito possui 1 GB e expira 30 dias após a criação. O Render informa um prazo adicional antes da exclusão, mas este preview não é armazenamento corporativo.
- O preview usa a conta proprietária do banco para migrations e runtime. Isso é aceito somente neste ambiente descartável; staging corporativo e produção exigem contas separadas e o `preflight` do projeto.
- Não existe backup corporativo, alta disponibilidade, OIDC/MFA, monitoramento central nem SLA neste preview.
- Antes do vencimento, exporte somente evidências sintéticas necessárias e apague os recursos no painel. Nunca migre dados reais deste preview para produção.

## Aceite do teste

Registre a URL, commit implantado, data de expiração, participantes, navegador/tablet, resultado por fluxo e problemas encontrados. O preview demonstra usabilidade e comportamento; ele não substitui a homologação Selene nem a implantação na rede da empresa.
