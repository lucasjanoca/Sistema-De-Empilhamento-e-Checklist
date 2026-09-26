# Instalação e atualização

## Pré-requisitos

Docker Engine com Compose, reverse proxy corporativo com TLS, hostname aprovado, PostgreSQL 17 e armazenamento privado para backup. A TI deve gerar todos os segredos; `.env.example` não contém padrões utilizáveis.

## Primeira instalação

1. Mantenha este repositório em área privada e faça checkout do commit aprovado.
2. Copie `.env.example` para um arquivo fora do Git. Preencha banco, origem HTTPS, URLs das contas proprietária e runtime, `SESSION_SECRET` aleatório com no mínimo 32 caracteres, caminhos de backup e IPs exatos do proxy.
3. Gere uma chave RSA de backup de no mínimo 3072 bits. Monte somente a chave pública na aplicação; guarde a privada cifrada no cofre de recuperação.
4. Suba o banco: `docker compose up -d db`.
5. Num job administrativo efêmero com `MIGRATION_DATABASE_URL`, execute `python -m alembic upgrade head`.
6. Crie a conta PostgreSQL runtime sem privilégios administrativos e aplique `deploy/grant-runtime.sql` via `psql -v runtime_role=NOME`. Confira que ela não possui tabelas.
7. Execute `python -m app.admin diagnose`, suba a aplicação com `docker compose up -d app` e teste `/health/live` e `/health/ready` pelo proxy HTTPS.
8. Em console privado com `DATABASE_URL` runtime, execute `python -m app.admin create-initial-admin`. Informe matrícula, nome e senha forte. O bootstrap funciona somente sem usuários.
9. Cadastre dispositivos, usuários, equipamentos e templates pela interface. Nenhum dado operacional é criado automaticamente.

## HTTPS e proxy

O proxy termina TLS, redireciona HTTP para HTTPS e preserva `Host` e `X-Forwarded-Proto`. Configure `FORWARDED_ALLOW_IPS` somente com os IPs do proxy e mantenha a porta da aplicação em loopback/rede privada. `PUBLIC_ORIGIN` deve coincidir exatamente com a origem externa. Certificado, renovação e alerta de expiração pertencem à infraestrutura corporativa.

## Atualização

1. Crie e valide um backup; teste a restauração quando a mudança for material.
2. Fixe a imagem pelo digest/commit aprovado e revise as migrations.
3. Em janela controlada, execute `alembic upgrade head` com a conta proprietária e inicie a nova imagem.
4. Verifique readiness, login, dispositivo, produção, Empilhamento, Checklist, métricas e cadeia de auditoria.
5. Para falha, siga [ROLLBACK.md](ROLLBACK.md); não execute downgrade destrutivo no banco operacional.

Antes de promover a versão 2.1.1, execute `python scripts/homologate.py`, percorra `PILOTO-CONTROLADO.md` e registre o commit/digest aprovado. Os service workers usam caches separados `selene-checklist-2.1.1` e `selene-empilhadores-2.1.1`, ativam a nova versão e removem somente caches antigos do próprio módulo.

## Teste local

Use PostgreSQL descartável e `ENVIRONMENT=test`, `SECURE_COOKIES=false`, `PUBLIC_ORIGIN=http://127.0.0.1:PORT`. Instale `requirements.lock`, aplique a migration, crie a conta runtime e execute pytest. Esses relaxamentos são recusados fora de loopback/teste.
