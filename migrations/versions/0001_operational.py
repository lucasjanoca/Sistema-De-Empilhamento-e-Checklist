"""Schema inicial e metadados de autorização; nenhum seed operacional."""

from alembic import op
import sqlalchemy as sa
from app.schema import metadata, roles, permissions, role_permissions, system_settings
from app.policy import ALL_PERMISSIONS, ROLE_GRANTS, CORRIDORS

revision = "0001_operational"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    metadata.create_all(conn)
    ids = {p: conn.scalar(permissions.insert().values(name=p).returning(permissions.c.id)) for p in ALL_PERMISSIONS}
    for name, granted in ROLE_GRANTS.items():
        role = conn.scalar(roles.insert().values(name=name).returning(roles.c.id))
        conn.execute(role_permissions.insert(), [{"role_id": role, "permission_id": ids[p]} for p in sorted(granted)])
    conn.execute(
        system_settings.insert(),
        [{"key": "corridors", "value": CORRIDORS}, {"key": "rules", "value": {}}, {"key": "retention", "value": {}}],
    )
    op.execute("""CREATE FUNCTION prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'immutable record'; END $$""")
    for name in (
        "audit_log",
        "operational_history",
        "checklist_records",
        "checklist_answers",
        "checklist_template_versions",
        "issue_events",
        "battery_swaps",
    ):
        op.execute(
            sa.text(
                f"CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON {name} FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation()"
            )
        )
    op.execute("""CREATE FUNCTION protect_used_code() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
      RAISE EXCEPTION 'used code is immutable'; END IF; RETURN NEW; END $$""")
    op.execute("CREATE TRIGGER code_once BEFORE UPDATE ON access_codes FOR EACH ROW EXECUTE FUNCTION protect_used_code()")


def downgrade():
    raise RuntimeError("Rollback destrutivo bloqueado. Restaurar backup aprovado em banco separado; consultar BACKUP-RESTORE.md.")
