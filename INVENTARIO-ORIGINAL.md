# Inventário antes das alterações

Base oficial: Site 2.0.zip, SHA-256 `b690663e0050662426b85de38b60ccb8deee8512a2eb1b5becd855e35c823c46`.
Repositório consultado: lucasjanoca/Sistema-De-Empilhamento-e-Checklist, commit 1915f60.
Checkpoint: tag checkpoint-original-20260925; trabalho na branch production-hardening. ZIP original mantido separado e intacto.

Todos os 16 arquivos do ZIP foram inventariados. Foram lidos HTML, scripts, estilos, servidor, lançadores e os documentos de instalação, segurança, integração, versão e autoria. O servidor original foi executado em loopback. Login, painel, operação, requisições, usuários, histórico, indicadores, auditoria, configurações e Painel TI foram abertos no navegador com conta exclusivamente de teste.

## Funcionalidades preserváveis

- Identidade E2 verde, sidebar, topbar, cards, modal Pedir Palet, telas e CSS responsivo.
- Operação com rolagem única, busca, corredores, estados, confirmação de 10 segundos.
- EXP-PIC roxo com alerta vermelho imediato; retorno de 10 minutos; normal em 90 minutos.
- Histórico, produção, dispositivos, notificações, usuários, relatórios e diagnóstico TI.
- Checklist original no repositório: baterias, empilhadeiras, tablets, histórico, pendências, equipamentos, usuários, modelos, relatórios e administração.

## Riscos encontrados

- AppState grava usuários, hashes SHA-256, paletes, histórico e auditoria em localStorage; sessionStorage mantém identidade e CSRF.
- Seeds de quatro paletes, contas de avaliação, 12 tablets e dois computadores; indicadores animados fictícios no login.
- Backend http.server com JSON como banco; PUT snapshot permite substituir estado operacional enviado pelo navegador.
- Sessões, rate limit e locks somente em memória; reinício perde controles.
- Regras de movimentação, contagem e autorização no JavaScript; não há entidade de autorização.
- Última conta TI protegida só na exclusão; alteração de perfil e bloqueio podem remover último acesso.
- Interpolação de nomes/endereço em innerHTML sem escape; exportações e cópias sem autorização granular.
- Integração aceita URL arbitrária e tem caminho browser → API; não há contrato oficial fornecido.
- Checklist mantém equipamentos, usuários e senhas de avaliação em arrays; várias ações apenas mostram toast.
- Código Checklist persiste em texto puro no navegador e funciona somente na mesma origem/dispositivo.
- Não existem migrations PostgreSQL, testes automatizados, backup PostgreSQL ou restore validado.

## Direção

Manter HTML/CSS e funções de renderização úteis. Substituir decisões e persistência locais por comandos autorizados no servidor. Não importar dados demonstrativos nem fornecer compatibilidade com gravação de snapshots. Integrações externas sem contrato permanecem bloqueadas. Backup/restore ficam no servidor, fora da pasta pública.
