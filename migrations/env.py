import os
from alembic import context
from sqlalchemy import create_engine, pool
from app.schema import metadata

url = os.environ.get("MIGRATION_DATABASE_URL") or os.environ["DATABASE_URL"]
engine = create_engine(url, poolclass=pool.NullPool, hide_parameters=True)
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()
