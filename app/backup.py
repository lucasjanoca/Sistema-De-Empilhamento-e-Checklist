"""Backup pg_dump criptografado em streaming; restaura somente em banco vazio."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import struct
import subprocess
import tempfile
from datetime import datetime, timezone
from sqlalchemy.engine import make_url
import psycopg
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"SELENE-BACKUP-1\n"


def pg_env(url):
    parsed = make_url(url)
    if parsed.get_backend_name() != "postgresql":
        raise ValueError("PostgreSQL obrigatório.")
    return {
        **os.environ,
        "PGHOST": parsed.host or "",
        "PGPORT": str(parsed.port or 5432),
        "PGDATABASE": parsed.database or "",
        "PGUSER": parsed.username or "",
        "PGPASSWORD": parsed.password or "",
        "PGSSLMODE": parsed.query.get("sslmode", "prefer"),
    }


def executable(name):
    return str(Path(os.environ["PG_BIN"]) / name) if os.environ.get("PG_BIN") else name


def create(url, public_key, output):
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Arquivo de destino já existe.")
    key = serialization.load_pem_public_key(Path(public_key).read_bytes())
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size < 3072:
        raise ValueError("Chave pública RSA >= 3072 bits obrigatória.")
    aes = secrets.token_bytes(32)
    nonce = secrets.token_bytes(12)
    wrapped = key.encrypt(aes, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    header = MAGIC + struct.pack(">H", len(wrapped)) + wrapped + nonce
    encryptor = Cipher(algorithms.AES(aes), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(header)
    part = output.with_suffix(output.suffix + ".part")
    try:
        with tempfile.TemporaryFile() as errors, part.open("xb") as target:
            os.chmod(part, 0o600)
            target.write(header)
            process = subprocess.Popen(
                [executable("pg_dump"), "--format=custom", "--no-owner", "--no-acl"], stdout=subprocess.PIPE, stderr=errors, env=pg_env(url)
            )
            try:
                while chunk := process.stdout.read(1024 * 1024):
                    target.write(encryptor.update(chunk))
                if process.wait() != 0:
                    raise RuntimeError("pg_dump falhou; backup não foi publicado.")
                target.write(encryptor.finalize())
                target.write(encryptor.tag)
                target.flush()
                os.fsync(target.fileno())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        part.replace(output)
    finally:
        if part.exists():
            part.unlink()
    result = {
        "file": output.name,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "bytes": output.stat().st_size,
        "sha256": hashlib.file_digest(output.open("rb"), "sha256").hexdigest(),
        "format": "PostgreSQL custom / AES-256-GCM / RSA-OAEP-SHA256",
    }
    output.with_suffix(output.suffix + ".json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def restore(backup, private_key, url, confirm_database, password=None):
    parsed = make_url(url)
    if not confirm_database or parsed.database != confirm_database:
        raise ValueError("Confirme explicitamente o nome do banco de destino.")
    env = pg_env(url)
    with psycopg.connect(
        host=env["PGHOST"],
        port=env["PGPORT"],
        dbname=env["PGDATABASE"],
        user=env["PGUSER"],
        password=env["PGPASSWORD"],
        sslmode=env["PGSSLMODE"],
    ) as conn:
        count = conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')").fetchone()[0]
        if count:
            raise ValueError("Restore exige banco vazio. Nunca sobrescreve o banco operacional.")
    key = serialization.load_pem_private_key(Path(private_key).read_bytes(), password=password)
    with Path(backup).open("rb") as source, tempfile.TemporaryDirectory(prefix="selene-restore-") as directory:
        if source.read(len(MAGIC)) != MAGIC:
            raise ValueError("Formato inválido.")
        size_raw = source.read(2)
        size = struct.unpack(">H", size_raw)[0]
        if not 256 <= size <= 1024:
            raise ValueError("Cabeçalho inválido.")
        wrapped = source.read(size)
        nonce = source.read(12)
        header = MAGIC + size_raw + wrapped + nonce
        aes = key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        start = source.tell()
        source.seek(-16, 2)
        end = source.tell()
        tag = source.read(16)
        source.seek(start)
        decryptor = Cipher(algorithms.AES(aes), modes.GCM(nonce, tag)).decryptor()
        decryptor.authenticate_additional_data(header)
        plain = Path(directory) / "restore.dump"
        with plain.open("xb") as target:
            os.chmod(plain, 0o600)
            remaining = end - start
            while remaining > 0:
                chunk = source.read(min(remaining, 1024 * 1024))
                target.write(decryptor.update(chunk))
                remaining -= len(chunk)
            target.write(decryptor.finalize())
        # Authentication is verified before pg_restore can connect or write.
        with tempfile.TemporaryFile() as errors:
            result = subprocess.run(
                [
                    executable("pg_restore"),
                    "--dbname",
                    parsed.database,
                    "--no-owner",
                    "--no-acl",
                    "--exit-on-error",
                    "--single-transaction",
                    str(plain),
                ],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=errors,
            )
            if result.returncode:
                raise RuntimeError("pg_restore falhou; transação revertida.")
    return {"restored": True, "database": confirm_database}


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("create")
    backup.add_argument("--public-key", required=True)
    backup.add_argument("--output", required=True)
    recovery = sub.add_parser("restore")
    recovery.add_argument("--private-key", required=True)
    recovery.add_argument("--input", required=True)
    recovery.add_argument("--confirm-database", required=True)
    args = parser.parse_args()
    if args.command == "create":
        result = create(os.environ["BACKUP_DATABASE_URL"], args.public_key, args.output)
    else:
        import getpass

        password = getpass.getpass("Senha da chave privada (vazia somente para chave de teste sem senha): ")
        result = restore(
            args.input, args.private_key, os.environ["RESTORE_DATABASE_URL"], args.confirm_database, password.encode() if password else None
        )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
