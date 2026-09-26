import argparse
import getpass
import json
import sqlalchemy as sa
from . import schema as t
from .db import engine, lock, now, rows
from .security import audit, digest, password_hash


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-initial-admin", "bind-oidc", "verify-audit", "diagnose"])
    args = parser.parse_args()
    with engine().begin() as conn:
        if args.command == "create-initial-admin":
            lock(conn, "bootstrap")
            if conn.scalar(sa.select(sa.func.count()).select_from(t.users)):
                raise SystemExit("Bootstrap já realizado; use o fluxo administrativo.")
            matricula = input("Matrícula/identificador: ").strip().lower()
            name = input("Nome operacional: ").strip()
            password = getpass.getpass("Senha (mínimo 12 caracteres): ")
            if password != getpass.getpass("Confirme a senha: ") or not 1 <= len(matricula) <= 80 or not 1 <= len(name) <= 160:
                raise SystemExit("Dados inválidos.")
            uid = conn.scalar(
                t.users.insert().values(matricula=matricula, nome=name, password_hash=password_hash(password)).returning(t.users.c.id)
            )
            rid = conn.scalar(sa.select(t.roles.c.id).where(t.roles.c.name == "ti"))
            conn.execute(t.user_roles.insert().values(user_id=uid, role_id=rid))
            audit(conn, "INITIAL_ADMIN_CREATED", {"user_id": uid})
            print("Primeira conta TI criada. Nenhum dispositivo ou dado operacional foi criado.")
        elif args.command == "bind-oidc":
            matricula = input("Matrícula existente: ").strip().lower()
            subject = input("Subject OIDC homologado: ").strip()
            if not subject:
                raise SystemExit("Subject obrigatório.")
            result = conn.execute(t.users.update().where(t.users.c.matricula == matricula).values(oidc_subject=subject))
            if result.rowcount != 1:
                raise SystemExit("Usuário não encontrado.")
            audit(conn, "OIDC_IDENTITY_BOUND")
            print("Identidade vinculada.")
        elif args.command == "verify-audit":
            previous = "0" * 64
            count = 0
            for row in rows(conn, sa.select(t.audit_log).order_by(t.audit_log.c.id)):
                data = dict(row)
                stored = data.pop("chain_hash")
                data.pop("id")
                canonical = json.dumps(data, sort_keys=True, default=str, ensure_ascii=False, separators=(",", ":"))
                if data["previous_hash"] != previous or stored != digest(canonical, "audit"):
                    raise SystemExit(f"Falha de integridade no evento {row['id']}.")
                previous = stored
                count += 1
            print(f"Cadeia íntegra: {count} eventos.")
        else:
            checks = {
                "completed_with_lock": sa.select(sa.func.count())
                .select_from(t.pallet_locks.join(t.pallet_requests))
                .where(t.pallet_requests.c.state.in_(["COMPLETED", "CANCELLED"])),
                "closed_with_pending_movement": sa.select(sa.func.count())
                .select_from(t.pallet_movements.join(t.production_requests))
                .where(t.pallet_movements.c.status == "PENDING", t.production_requests.c.status == "CLOSED"),
                "overdue_confirmation": sa.select(sa.func.count())
                .select_from(t.pallet_movements)
                .where(
                    t.pallet_movements.c.status == "PENDING",
                    t.pallet_movements.c.confirm_at < now(conn) - __import__("datetime").timedelta(seconds=30),
                ),
            }
            result = {k: conn.scalar(q) for k, q in checks.items()}
            print(json.dumps(result))
            if any(result.values()):
                raise SystemExit(1)


if __name__ == "__main__":
    main()
