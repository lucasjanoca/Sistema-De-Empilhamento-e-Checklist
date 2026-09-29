# Sistema de Empilhamento e Checklist

Sistema operacional da InfoTech.io para gestão de paletes e acesso integrado ao Checklist.

## Empilhadores

- Login por número do crachá + senha usando Supabase Auth.
- Perfis Emp, Encarregado e TI.
- Usuários centralizados no Supabase.
- Nome do operador usado nas requisições, movimentações, histórico e auditoria.
- Seleção manual de equipamento cadastrado a cada sessão.
- Paletes para baixar e subir, confirmação de movimentação, cancelamento e histórico.
- EXP-PIC com tratamento prioritário e regra operacional de retorno.
- Requisições de produção por usuário.
- Corredores, busca, filtros, relatórios e exportações.
- Locks centrais para impedir movimentação simultânea do mesmo palete.
- Estado operacional sincronizado pelo Supabase entre computadores/tablets.
- Auditoria administrativa central.
- Backup diário do snapshot operacional anterior no Supabase.

## Checklist

O acesso ao Checklist usa código de 6 dígitos gerado no Sistema de Empilhadores, válido por 2 minutos e de uso único. A validação é feita pelo backend Supabase, permitindo gerar em um aparelho e usar em outro.

## Integração com o sistema oficial da empresa

O Site Selene funciona como aplicação operacional independente. A integração automática com a API/sistema interno da empresa continua protegida até a TI fornecer e homologar:
- URL/servidor oficial;
- autenticação/sessão;
- rotas de leitura;
- rota de escrita para descer/subir;
- parâmetros/payloads e retornos;
- origem oficial do EXP-PIC.

Nenhuma credencial corporativa deve ser colocada no frontend público.

## Publicação

Empilhadores:
https://lucasjanoca.github.io/Sistema-De-Empilhamento-e-Checklist/empilhadores/

Checklist:
https://lucasjanoca.github.io/Sistema-De-Empilhamento-e-Checklist/checklist/
