"""Schema explícito; migrations são o único caminho de criação em produção."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

metadata = sa.MetaData()
T = sa.DateTime(timezone=True)


def col(name, typ=sa.Text, **kw):
    return sa.Column(name, typ, **kw)


def fk(name, target, nullable=False, **kw):
    return sa.Column(name, sa.BigInteger, sa.ForeignKey(target, ondelete="RESTRICT"), nullable=nullable, **kw)


def table(name, *fields):
    return sa.Table(name, metadata, sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True), *fields)


users = table(
    "users",
    col("matricula", sa.String(80), nullable=False, unique=True),
    col("nome", sa.String(160), nullable=False),
    col("password_hash"),
    col("active", sa.Boolean, nullable=False, server_default=sa.true()),
    col("oidc_subject", unique=True),
    col("created_at", T, nullable=False, server_default=sa.func.now()),
)
roles = table("roles", col("name", sa.String(40), nullable=False, unique=True))
permissions = table("permissions", col("name", sa.String(80), nullable=False, unique=True))
role_permissions = sa.Table(
    "role_permissions", metadata, fk("role_id", "roles.id", primary_key=True), fk("permission_id", "permissions.id", primary_key=True)
)
user_roles = sa.Table("user_roles", metadata, fk("user_id", "users.id", primary_key=True), fk("role_id", "roles.id", primary_key=True))
sessions = table(
    "sessions",
    col("token_hash", sa.String(64), nullable=False, unique=True),
    fk("user_id", "users.id"),
    col("csrf", nullable=False),
    col("scope", sa.String(20), nullable=False),
    col("created_at", T, nullable=False),
    col("last_seen", T, nullable=False),
    col("expires_at", T, nullable=False),
    col("revoked_at", T),
    col("reauth_at", T),
    col("mfa", sa.Boolean, nullable=False, server_default=sa.false()),
)
devices = table(
    "devices",
    col("name", sa.String(100), nullable=False, unique=True),
    col("type", sa.String(20), nullable=False),
    col("active", sa.Boolean, nullable=False, server_default=sa.true()),
    col("created_at", T, nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("type IN ('TABLET','COMPUTADOR','TOTEM')"),
)
device_assignments = table(
    "device_assignments",
    fk("device_id", "devices.id"),
    fk("user_id", "users.id"),
    fk("session_id", "sessions.id"),
    col("assigned_at", T, nullable=False),
    col("last_seen", T, nullable=False),
    col("expires_at", T, nullable=False),
    col("released_at", T),
)
sa.Index("uq_device_live", device_assignments.c.device_id, unique=True, postgresql_where=device_assignments.c.released_at.is_(None))
sa.Index("uq_session_device", device_assignments.c.session_id, unique=True, postgresql_where=device_assignments.c.released_at.is_(None))
production_requests = table(
    "production_requests",
    col("number", sa.String(50), unique=True),
    fk("user_id", "users.id"),
    fk("device_id", "devices.id"),
    col("started_at", T, nullable=False),
    col("ended_at", T),
    col("status", sa.String(20), nullable=False),
    col("down_count", sa.Integer, nullable=False, server_default="0"),
    col("up_count", sa.Integer, nullable=False, server_default="0"),
    sa.CheckConstraint("status IN ('OPEN','CLOSED')"),
)
sa.Index("uq_user_open_production", production_requests.c.user_id, unique=True, postgresql_where=production_requests.c.status == "OPEN")
locations = table(
    "locations",
    col("address", sa.String(100), nullable=False, unique=True),
    col("blocked", sa.Boolean, nullable=False, server_default=sa.false()),
    col("reason", sa.String(500)),
)
pallet_requests = table(
    "pallet_requests",
    fk("location_id", "locations.id"),
    col("address", sa.String(100), nullable=False),
    col("corridor", sa.String(30), nullable=False),
    col("operator", sa.String(160), nullable=False),
    col("quantity", sa.Integer, nullable=False),
    col("reference", sa.String(100), nullable=False),
    col("volumes", sa.Integer),
    col("note", sa.String(1000), nullable=False),
    col("area", sa.String(20), nullable=False),
    col("state", sa.String(30), nullable=False),
    col("version", sa.Integer, nullable=False, server_default="1"),
    fk("created_by", "users.id"),
    fk("assigned_to", "users.id", nullable=True),
    col("created_at", T, nullable=False),
    col("lowered_at", T),
    col("ready_at", T),
    col("due_at", T),
    col("external_ref", unique=True),
    col("waiting_alerted", sa.Boolean, nullable=False, server_default=sa.false()),
    col("pic_alerted", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.CheckConstraint("quantity > 0 AND quantity <= 1000"),
    sa.CheckConstraint("volumes IS NULL OR volumes >= 0"),
    sa.CheckConstraint("area IN ('NORMAL','EXP-PIC')"),
    sa.CheckConstraint(
        "state IN ('WAITING','ASSIGNED','LOWER_AUTHORIZED','LOWERING','FLOOR','RAISE_AUTHORIZED','READY','RETURNING','COMPLETED','CANCELLED')"
    ),
)
sa.Index(
    "uq_address_active", pallet_requests.c.address, unique=True, postgresql_where=pallet_requests.c.state.not_in(["COMPLETED", "CANCELLED"])
)
pallet_authorizations = table(
    "pallet_authorizations",
    fk("pallet_request_id", "pallet_requests.id"),
    col("action", sa.String(30), nullable=False),
    col("status", sa.String(20), nullable=False),
    col("source", sa.String(30), nullable=False),
    fk("authorized_by", "users.id", nullable=True),
    col("authorized_at", T, nullable=False),
    col("expires_at", T, nullable=False),
    col("used_at", T),
    col("reason", sa.String(500), nullable=False),
    col("metadata", JSONB, nullable=False),
    sa.CheckConstraint("action IN ('LOWER','RAISE','CANCEL','OVERRIDE','LOCATION_UNLOCK')"),
    sa.CheckConstraint("status IN ('PENDING','APPROVED','DENIED','REVOKED','EXPIRED')"),
)
pallet_movements = table(
    "pallet_movements",
    fk("pallet_request_id", "pallet_requests.id"),
    fk("user_id", "users.id"),
    fk("device_id", "devices.id"),
    fk("production_id", "production_requests.id"),
    fk("authorization_id", "pallet_authorizations.id"),
    col("direction", sa.String(10), nullable=False),
    col("previous_state", sa.String(30), nullable=False),
    col("started_at", T, nullable=False),
    col("confirm_at", T, nullable=False),
    col("finished_at", T),
    col("status", sa.String(20), nullable=False),
    sa.CheckConstraint("direction IN ('LOWER','RAISE')"),
    sa.CheckConstraint("status IN ('PENDING','CONFIRMED','CANCELLED')"),
)
sa.Index("uq_pallet_moving", pallet_movements.c.pallet_request_id, unique=True, postgresql_where=pallet_movements.c.status == "PENDING")
pallet_locks = sa.Table(
    "pallet_locks",
    metadata,
    fk("pallet_request_id", "pallet_requests.id", primary_key=True),
    fk("user_id", "users.id"),
    fk("device_id", "devices.id"),
    fk("movement_id", "pallet_movements.id"),
    col("acquired_at", T, nullable=False),
)
access_codes = table(
    "access_codes",
    fk("user_id", "users.id"),
    fk("session_id", "sessions.id"),
    col("code_hash", sa.String(64), nullable=False, unique=True),
    col("created_at", T, nullable=False),
    col("expires_at", T, nullable=False),
    col("used_at", T),
    col("revoked_at", T),
    col("origin", sa.String(30), nullable=False),
    col("attempt_count", sa.Integer, nullable=False, server_default="0"),
)
equipment = table(
    "equipment",
    col("code", sa.String(40), nullable=False, unique=True),
    col("name", sa.String(100), nullable=False),
    col("type", sa.String(30), nullable=False),
    col("active", sa.Boolean, nullable=False, server_default=sa.true()),
    col("status", sa.String(20), nullable=False, server_default="unchecked"),
    col("version", sa.Integer, nullable=False, server_default="1"),
    col("hour_meter", sa.Numeric(12, 2), nullable=False, server_default="0"),
    sa.CheckConstraint("type IN ('bateria','empilhadeira','tablet')"),
    sa.CheckConstraint("status IN ('unchecked','ok','warn','crit')"),
    sa.CheckConstraint("hour_meter >= 0"),
)
checklist_templates = table(
    "checklist_templates", col("type", sa.String(30), nullable=False, unique=True), col("name", sa.String(100), nullable=False)
)
checklist_template_versions = table(
    "checklist_template_versions",
    fk("template_id", "checklist_templates.id"),
    col("version", sa.Integer, nullable=False),
    col("questions", JSONB, nullable=False),
    fk("created_by", "users.id"),
    col("created_at", T, nullable=False),
    sa.UniqueConstraint("template_id", "version"),
)
checklist_records = table(
    "checklist_records",
    fk("equipment_id", "equipment.id"),
    fk("template_version_id", "checklist_template_versions.id"),
    fk("user_id", "users.id"),
    fk("device_id", "devices.id"),
    col("shift", sa.String(2), nullable=False),
    col("operational_date", sa.Date, nullable=False),
    col("started_at", T, nullable=False),
    col("finished_at", T, nullable=False),
    col("result", sa.String(10), nullable=False),
    col("observation", sa.String(1000), nullable=False),
    col("water", sa.String(20)),
    col("liters", sa.Numeric(10, 2)),
    sa.CheckConstraint("result IN ('ok','warn','crit')"),
    sa.CheckConstraint("liters IS NULL OR liters >= 0"),
)
checklist_answers = table(
    "checklist_answers",
    fk("record_id", "checklist_records.id"),
    col("question", sa.String(500), nullable=False),
    col("answer", sa.String(10), nullable=False),
    sa.CheckConstraint("answer IN ('ok','warn','crit')"),
)
battery_links = table(
    "battery_links",
    fk("battery_id", "equipment.id"),
    fk("forklift_id", "equipment.id"),
    col("linked_at", T, nullable=False),
    col("unlinked_at", T),
)
for field in ("battery_id", "forklift_id"):
    sa.Index("uq_current_" + field, battery_links.c[field], unique=True, postgresql_where=battery_links.c.unlinked_at.is_(None))
battery_swaps = table(
    "battery_swaps",
    fk("removed_id", "equipment.id", nullable=True),
    fk("installed_id", "equipment.id"),
    fk("forklift_id", "equipment.id"),
    fk("user_id", "users.id"),
    fk("device_id", "devices.id"),
    col("out_meter", sa.Numeric(12, 2), nullable=False),
    col("in_meter", sa.Numeric(12, 2), nullable=False),
    col("observation", sa.String(1000), nullable=False),
    col("created_at", T, nullable=False),
    sa.CheckConstraint("in_meter >= out_meter AND out_meter >= 0"),
)
issues = table(
    "issues",
    fk("equipment_id", "equipment.id"),
    fk("record_id", "checklist_records.id"),
    col("severity", sa.String(10), nullable=False),
    col("status", sa.String(20), nullable=False),
    col("summary", sa.String(1000), nullable=False),
    fk("responsible_id", "users.id", nullable=True),
    col("resolution", sa.String(1000)),
    col("resolved_at", T),
    col("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("status IN ('OPEN','IN_PROGRESS','RESOLVED')"),
)
issue_events = table(
    "issue_events",
    fk("issue_id", "issues.id"),
    fk("user_id", "users.id"),
    col("created_at", T, nullable=False),
    col("previous_state", sa.String(20), nullable=False),
    col("new_state", sa.String(20), nullable=False),
    col("reason", sa.String(1000), nullable=False),
)
notifications = table(
    "notifications",
    fk("user_id", "users.id"),
    col("title", sa.String(100), nullable=False),
    col("message", sa.String(1000), nullable=False),
    col("created_at", T, nullable=False),
    col("read_at", T),
    col("dismissed_at", T),
)
operational_history = table(
    "operational_history",
    col("timestamp", T, nullable=False),
    col("operational_date", sa.Date, nullable=False),
    fk("user_id", "users.id", nullable=True),
    fk("device_id", "devices.id", nullable=True),
    fk("request_id", "production_requests.id", nullable=True),
    fk("pallet_id", "pallet_requests.id", nullable=True),
    fk("authorization_id", "pallet_authorizations.id", nullable=True),
    col("address", sa.String(100), nullable=False),
    col("corridor", sa.String(30), nullable=False),
    col("action", sa.String(80), nullable=False),
    col("previous_state", sa.String(30)),
    col("new_state", sa.String(30)),
    col("metadata", JSONB, nullable=False),
)
audit_log = table(
    "audit_log",
    col("timestamp", T, nullable=False),
    fk("user_id", "users.id", nullable=True),
    fk("session_id", "sessions.id", nullable=True),
    fk("device_id", "devices.id", nullable=True),
    col("correlation_id", sa.String(36), nullable=False),
    col("action", sa.String(80), nullable=False),
    col("origin", sa.String(100), nullable=False),
    col("details", JSONB, nullable=False),
    col("previous_hash", sa.String(64), nullable=False),
    col("chain_hash", sa.String(64), nullable=False),
)
system_settings = sa.Table("system_settings", metadata, col("key", sa.String(80), primary_key=True), col("value", JSONB, nullable=False))
integration_settings = sa.Table(
    "integration_settings", metadata, col("key", sa.String(80), primary_key=True), col("value", JSONB, nullable=False)
)
rate_limits = sa.Table(
    "rate_limits",
    metadata,
    col("key", sa.String(64), primary_key=True),
    col("count", sa.Integer, nullable=False),
    col("reset_at", T, nullable=False),
)
idempotency_keys = sa.Table(
    "idempotency_keys",
    metadata,
    col("key", sa.String(64), primary_key=True),
    fk("session_id", "sessions.id"),
    col("fingerprint", sa.String(64), nullable=False),
    col("response", sa.LargeBinary, nullable=False),
    col("created_at", T, nullable=False),
)
oidc_flows = sa.Table(
    "oidc_flows",
    metadata,
    col("state_hash", sa.String(64), primary_key=True),
    col("nonce", nullable=False),
    col("verifier", nullable=False),
    col("expires_at", T, nullable=False),
)
technical_events = table(
    "technical_events",
    col("created_at", T, nullable=False),
    col("kind", sa.String(80), nullable=False),
    col("details", JSONB, nullable=False),
)
for tbl in (
    sessions,
    production_requests,
    pallet_requests,
    pallet_movements,
    access_codes,
    operational_history,
    audit_log,
    checklist_records,
):
    for field in (
        "timestamp",
        "state",
        "status",
        "address",
        "corridor",
        "user_id",
        "request_id",
        "device_id",
        "operational_date",
        "expires_at",
    ):
        if field in tbl.c:
            sa.Index(f"ix_{tbl.name}_{field}", tbl.c[field])
