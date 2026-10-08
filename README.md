# Site Selene 2.2.0-rc.1

Aplicação operacional do Empilhamento e Checklist, preparada para homologação com uma única fonte de verdade em PostgreSQL. O backend FastAPI decide autenticação, permissões, transições, autorizações, locks, timers, códigos temporários e auditoria. O navegador não armazena dados corporativos nem possui fallback operacional local.

Desenvolvimento inicial: **Lucas Janoca / InfoTech.io**. A evolução técnica mantém o crédito, os fluxos e a identidade visual do Site 2.0.

## Conteúdo

- `app/`: API, regras operacionais, segurança, backup, manutenção e observabilidade.
- `migrations/`: migrations Alembic e política de integridade PostgreSQL.
- `public/empilhadores/` e `public/checklist/`: interfaces conectadas exclusivamente à API.
- `tests/`: testes em PostgreSQL real, sem SQLite ou mocks de persistência.
- `deploy/`, `Dockerfile`, `compose.yaml`: base reproduzível para homologação da TI.
- `docs/`: arquitetura, instalação, operação, segurança, backup, API e validação.

## Estado da entrega

Esta branch reconciliou a arquitetura transacional da PR #2 com a evolução posterior da `main`, mantendo o backend autoritativo e as melhorias de interface compatíveis. O software deve ser validado com PostgreSQL 17 antes de cada entrega.

A entrada em produção corporativa depende dos valores e da homologação listados em [PENDENCIAS-TI.md](PENDENCIAS-TI.md). Nenhum hostname, certificado, segredo, endpoint interno ou credencial foi inventado.

Comece por [docs/INSTALACAO.md](docs/INSTALACAO.md) e execute `python scripts/homologate.py` no ambiente configurado. O roteiro operacional está em [docs/PILOTO-CONTROLADO.md](docs/PILOTO-CONTROLADO.md), e os gates desta candidata estão em [docs/HOMOLOGACAO-2.2.0.md](docs/HOMOLOGACAO-2.2.0.md).

## Limites deliberados

- GitHub Pages não é um ambiente suportado para esta versão: autenticação, concorrência, Checklist e dados operacionais dependem do FastAPI e do PostgreSQL.
- A integração oficial Selene/EXP-PIC permanece desabilitada até a TI fornecer e homologar o contrato real.
- Dados do snapshot Supabase não são importados automaticamente; consulte [docs/MIGRACAO-SUPABASE.md](docs/MIGRACAO-SUPABASE.md).
