-- Execute por psql como proprietário das migrations.
-- Forneça -v runtime_role=nome_aprovado; a conta deve ser criada por TI com senha própria.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, operational_history, checklist_records,
  checklist_answers, checklist_template_versions, issue_events, battery_swaps FROM :"runtime_role";
REVOKE INSERT, UPDATE, DELETE ON alembic_version FROM :"runtime_role";
-- Não conceda ownership, superuser, createdb, createrole, bypassrls ou EXECUTE genérico.
