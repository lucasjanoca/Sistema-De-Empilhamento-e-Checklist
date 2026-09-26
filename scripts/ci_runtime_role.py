"""Somente CI: credenciais efêmeras e banco descartável; nunca usado em produção."""

import os
import psycopg
from psycopg import sql

assert os.environ["ENVIRONMENT"] == "test"
url = os.environ["MIGRATION_DATABASE_URL"].replace("postgresql+psycopg:", "postgresql:")
assert "selene_ci_test" in url
with psycopg.connect(url) as c:
    c.execute(sql.SQL("CREATE ROLE test_app LOGIN PASSWORD {}").format(sql.Literal(os.environ["RUNTIME_DATABASE_PASSWORD"])))
    c.execute("GRANT USAGE ON SCHEMA public TO test_app")
    c.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO test_app")
    c.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO test_app")
