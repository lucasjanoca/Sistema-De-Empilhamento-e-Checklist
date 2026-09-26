# Homologação técnica 2.1.1

Data: 26/09/2026. Base anterior: commit `ac2697d`, preservado na tag `checkpoint-pre-visual-homologation-20260926`. A versão 2.1.1 não altera o schema do banco.

## Resultado executivo

O código está apto para piloto controlado. A publicação corporativa continua condicionada aos itens de infraestrutura e UAT de `PENDENCIAS-TI.md`. GitHub Pages não se aplica a esta arquitetura: login, código temporário, concorrência, auditoria e dados operacionais dependem do FastAPI e do PostgreSQL.

| Área | Status | Evidência e resultado | Pendência |
|---|---|---|---|
| Visual do Checklist | PASSOU | Interface clara alinhada aos tokens, painéis, botões, topbar e cards do Empilhadores | Validação de marca pela operação no piloto |
| Responsividade | PASSOU | Checklist e Empilhadores medidos em 320, 375, 430, 768, 1024, 1280, 1366, 1440 e 1920 px; sem overflow da página | Tabelas usam rolagem interna em telas estreitas |
| Modal do Checklist | PASSOU | Campos, itens e botões visíveis; corpo rolável e rodapé acessível em 320 px | Nenhuma |
| Login, sessão e logout | PASSOU | Login válido/inválido, usuário inexistente, restauração, expiração e logout cobertos por teste e navegador | OIDC/MFA corporativo depende da TI |
| Matriz de permissões | PASSOU | Emp bloqueado em leituras críticas; Encarregado impedido de administrar TI; escopo Checklist não executa ação crítica | UAT dos nomes finais dos perfis |
| Código de 6 dígitos | PASSOU | Validade, formato, renovação, uso único, consumo concorrente, expiração, tentativas e rate limit cobertos | Nenhuma no backend atual |
| Paletes e concorrência | PASSOU | Solicitação, autorização, baixar, subir, undo, idempotência, conflito simultâneo e persistência | Integração Selene externa não configurada |
| Regras temporais e EXP-PIC | PASSOU | Confirmação única, alerta de 10 min, liberação de 90 min, prioridade EXP-PIC e ausência de movimento automático indevido | UAT em turno real |
| Dispositivos | PASSOU | Tipo, exclusividade, lease, heartbeat, troca e retomada validados | Cadastro dos ativos corporativos |
| Usuários | PASSOU | Criação, bloqueio, revogação, perfil, senha e preservação da última conta TI | Provisionamento real pela TI |
| Checklist e histórico | PASSOU | Bateria, empilhadeira e tablet usam templates; novo registro atualiza o estado sem apagar histórico; registro real feito pelo navegador | Conteúdo final dos templates pela operação |
| Pendências | PASSOU | Criação por alerta/crítico, tratamento, resolução, versionamento e auditoria | UAT do processo de manutenção |
| Relatórios | PASSOU | CSV/PDF reais e proteção contra formula injection | Identidade visual final dos relatórios, se exigida |
| Estados de interface | PASSOU | Loading, vazio, offline, erros, expiração, sucesso e falha possuem tratamento; botão Atualizar testado | Teste de perda de rede na infraestrutura final |
| Acessibilidade | PASSOU | Labels, nomes acessíveis, foco visível, tabs com `aria-selected`, dialogs nomeados e status textual | Auditoria assistiva com usuários, se exigida |
| Segurança | PASSOU | CSRF, CSP, cookies, RBAC, rate limit, idempotência, XSS textual, acesso direto, segredos e audit log verificados | TLS, OIDC, cofre e SIEM corporativos |
| Dependências | PASSOU | `pip-audit` sem vulnerabilidades conhecidas em `requirements-runtime.lock` | Acompanhar avisos de depreciação antes de upgrades principais |
| PostgreSQL/migrations | PASSOU | PostgreSQL 17 real, `alembic check` sem operações novas, runtime sem superuser | Banco gerenciado e contas corporativas |
| PWA e cache | PASSOU | Escopos `/checklist/` e `/empilhadores/` separados; caches 2.1.1; API nunca armazenada; ativação imediata | Validar instalação nos tablets gerenciados |
| Performance | PASSOU | Auditoria passou a carregar somente ao abrir sua página; cards e tabelas grandes revisados | Medição na rede corporativa |
| Backup/restore | PASSOU | Evidência existente em `EVIDENCIA-BACKUP.json`; restore em banco vazio validado | Cofre, retenção e armazenamento externo |
| Integração Selene externa | DEPENDÊNCIA EXTERNA | Adaptador falha fechado com 503 e informa que não está configurado | Contrato, endpoint e credencial da Selene/TI |
| GitHub Pages | NÃO APLICÁVEL | A versão de produção requer backend e banco; armazenamento do navegador não é usado como banco compartilhado | Hospedagem de aplicação definida pela TI |

## Correções desta etapa

- Tema escuro do Checklist substituído por fundo claro, superfícies brancas e verde do Empilhadores.
- Operação organizada em conteúdo principal e painel lateral de controles, com adaptação para tablet e celular.
- Cards, abas, modais, tabelas e área ADM padronizados sem alterar IDs funcionais.
- Overflow horizontal do cabeçalho em 320/375/430 px corrigido.
- Rodapé do modal, que podia deixar `Salvar checklist` fora da tela em 320 px, corrigido.
- Botão `Atualizar` conectado a dados reais com bloqueio durante a requisição e feedback de sucesso/erro.
- Labels, nomes de dialogs e semântica das tabs corrigidos.
- Auditoria administrativa carregada sob demanda para reduzir DOM e trabalho a cada atualização.
- Cache PWA incrementado e service workers passam a assumir a versão nova imediatamente.
- Contratos de UI/PWA e cenários adicionais de segurança incluídos na automação.

## Evidências executadas

- `python scripts/homologate.py`: lint, fronteira pública, contratos de UI/PWA, segredos, 33 testes, dependências, migrations, cadeia de auditoria e diagnóstico.
- `33 passed` em PostgreSQL 17; resultado em `TEST-RESULTS.xml`.
- `pip-audit`: nenhuma vulnerabilidade conhecida; resultado em `dependency-audit.json`.
- `alembic check`: nenhuma operação de upgrade nova.
- Cadeia de auditoria íntegra e diagnóstico sem lock órfão, produção fechada com movimento ou confirmação vencida.
- Navegador: fluxo Empilhadores para Checklist, dispositivo, checklist real, histórico, abas, área ADM, console e nove larguras.

Os avisos de depreciação de Starlette/Authlib permanecem não bloqueantes e sem vulnerabilidade conhecida. A migração para `httpx2`/`joserfc` deve acompanhar uma futura atualização principal, sem ser misturada a esta correção visual.
