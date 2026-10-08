"""Outbox transacional para confirmação oficial de movimentos externos."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_integration_outbox"
down_revision = "0001_operational"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("pallet_requests", "created_by", existing_type=sa.BigInteger(), nullable=True)
    op.drop_constraint("pallet_movements_status_check", "pallet_movements", type_="check")
    op.create_check_constraint(
        "pallet_movements_status_check",
        "pallet_movements",
        "status IN ('PENDING','EXTERNAL_PENDING','CONFIRMED','CANCELLED')",
    )
    op.drop_index("uq_pallet_moving", table_name="pallet_movements")
    op.create_index(
        "uq_pallet_moving",
        "pallet_movements",
        ["pallet_request_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDING','EXTERNAL_PENDING')"),
    )
    op.create_table(
        "integration_outbox",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("movement_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("external_ref", sa.String(200), nullable=False),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_code", sa.String(40)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("action IN ('lower','raise')"),
        sa.CheckConstraint("status IN ('PENDING','SENDING','FAILED','CONFIRMED')"),
        sa.ForeignKeyConstraint(["movement_id"], ["pallet_movements.id"], ondelete="RESTRICT"),
    )
    op.create_index(
        "ix_integration_outbox_delivery",
        "integration_outbox",
        ["status", "next_attempt_at"],
    )


def downgrade():
    raise RuntimeError("Rollback destrutivo bloqueado. Restaurar backup aprovado em banco separado; consultar BACKUP-RESTORE.md.")
