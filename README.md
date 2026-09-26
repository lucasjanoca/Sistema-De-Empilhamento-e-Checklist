# Site Selene 2.1

Aplicação operacional do Empilhamento 2.0 e Checklist, com a identidade visual original preservada e uma única fonte de verdade em PostgreSQL. O backend FastAPI decide autenticação, permissões, transições, autorizações, locks, timers, códigos temporários e auditoria. O navegador não armazena dados corporativos.

Desenvolvimento inicial: **Lucas Janoca / InfoTech.io**. A evolução técnica 2.1 mantém o crédito, os fluxos e as telas do Site 2.0.

## Conteúdo

- `app/`: API, regras operacionais, segurança, backup, manutenção e observabilidade.
- `migrations/`: migration Alembic congelada e política de integridade PostgreSQL.
- `public/empilhadores/` e `public/checklist/`: interfaces preservadas, conectadas à API.
- `tests/`: testes reais em PostgreSQL, sem SQLite ou mocks de persistência.
- `deploy/`, `Dockerfile`, `compose.yaml`: base reproduzível para homologação da TI.
- `docs/`: arquitetura, instalação, operação, segurança, backup, API e validação.

## Estado da entrega

O software está implementado e validado localmente com PostgreSQL 17. A entrada em produção corporativa depende dos valores e da homologação listados em [PENDENCIAS-TI.md](PENDENCIAS-TI.md). Nenhum hostname, certificado, segredo, endpoint interno ou credencial foi inventado.

Comece por [docs/INSTALACAO.md](docs/INSTALACAO.md), depois execute a validação descrita em [docs/TESTES.md](docs/TESTES.md). O relatório completo está em [RELATORIO-FINAL.md](RELATORIO-FINAL.md).
