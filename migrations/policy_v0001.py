from datetime import timedelta
from zoneinfo import ZoneInfo

ALL_PERMISSIONS = """dashboard:view pallet:view pallet:request pallet:accept pallet:transfer
pallet:authorize_lower pallet:lower pallet:authorize_raise pallet:raise pallet:cancel pallet:override
pallet:exp_pic_manage location:view location:block location:unlock production:view production:start
production:close history:view_own history:view_all reports:view reports:export devices:view devices:manage
users:view users:create users:update users:disable users:delete roles:view roles:manage audit:view
integration:view integration:configure security:view backup:create backup:restore system:configure
checklist:view checklist:create checklist:manage equipment:manage issues:view issues:resolve
codes:create codes:redeem""".split()
EMP = set(
    "dashboard:view pallet:view pallet:request pallet:accept pallet:lower pallet:raise location:view production:view production:start production:close history:view_own devices:view checklist:view checklist:create issues:view codes:create codes:redeem".split()
)
ENC = EMP | set(
    "pallet:transfer pallet:authorize_lower pallet:authorize_raise pallet:cancel pallet:exp_pic_manage location:block location:unlock history:view_all reports:view reports:export devices:manage users:view users:create users:update users:disable users:delete audit:view checklist:manage equipment:manage issues:resolve".split()
)
ROLE_GRANTS = {"empilhador": EMP, "encarregado": ENC, "ti": set(ALL_PERMISSIONS)}
CORRIDORS = [f"{i}-{i + 1}" for i in range(1, 30, 2)] + [f"{chr(i)}-{chr(i + 1)}" for i in range(65, 90, 2)] + ["RECEB", "OUTROS"]


def operational_day(at, timezone="America/Sao_Paulo"):
    local = at.astimezone(ZoneInfo(timezone))
    minutes = local.hour * 60 + local.minute
    shift = "T1" if 300 <= minutes < 795 else "T2" if 795 <= minutes < 1290 else "T3"
    return (local - timedelta(days=1) if minutes < 300 else local).date(), shift


def corridor_for(address, configured):
    first = address.split("-")[0]
    if first.startswith("RECEB"):
        proposed = "RECEB"
    elif len(first) == 1 and "A" <= first <= "Z":
        start = 65 + (ord(first) - 65) // 2 * 2
        proposed = f"{chr(start)}-{chr(min(start + 1, 90))}"
    elif first.isdigit() and int(first) > 0:
        start = (int(first) - 1) // 2 * 2 + 1
        proposed = f"{start}-{start + 1}"
    else:
        proposed = "OUTROS"
    return proposed if proposed in configured else "OUTROS"


TRANSITIONS = {
    "WAITING": {"ASSIGNED", "LOWER_AUTHORIZED", "CANCELLED"},
    "ASSIGNED": {"LOWER_AUTHORIZED", "CANCELLED"},
    "LOWER_AUTHORIZED": {"ASSIGNED", "LOWERING", "CANCELLED"},
    "LOWERING": {"LOWER_AUTHORIZED", "FLOOR", "READY"},
    "FLOOR": {"READY", "RAISE_AUTHORIZED"},
    "RAISE_AUTHORIZED": {"RETURNING"},
    "READY": {"RETURNING"},
    "RETURNING": {"READY", "RAISE_AUTHORIZED", "COMPLETED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
}


def can_transition(current, target, context):
    if target not in TRANSITIONS.get(current, set()):
        return False
    if target in ("LOWERING", "RETURNING"):
        return all(context.get(k) for k in ("authorized", "device", "lock", "permission"))
    return True
