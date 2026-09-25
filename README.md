# Sistema de Empilhamento e Checklist

Repositório integrado dos sistemas operacionais desenvolvidos pela InfoTech.io.

## Estrutura

- `index.html` — Checklist Operacional com acesso por código.
- `checklist/index.html` — cópia do Checklist para testes.
- `empilhadores/index.html` — gerador de código do Sistema de Empilhadores.
- `shared/access-code.js` — regras compartilhadas do código temporário.

## Fluxo de acesso integrado

1. O operador abre o Sistema de Empilhadores.
2. Informa matrícula/nome e gera um código numérico de 6 dígitos.
3. O código fica válido por 2 minutos.
4. No Checklist, o operador digita o código.
5. O Checklist recebe a identidade e o perfil.
6. O código é marcado como utilizado e não pode ser usado novamente.
7. Tentativas repetidas incorretas recebem bloqueio temporário.

## Estado atual do teste online

Nesta etapa o armazenamento compartilhado usa o navegador/origem do site para permitir validação imediata durante os testes. Isso funciona quando gerador e Checklist são usados no mesmo navegador/origem.

A próxima etapa de integração substituirá apenas essa camada por Supabase/backend compartilhado, preservando as telas e as regras, para o código funcionar entre dispositivos diferentes (por exemplo, código gerado em um terminal e digitado em outro tablet).

> Ambiente de desenvolvimento/testes. Perfis e emissão de códigos administrativos devem ser controlados pelo backend antes do uso real em produção.
