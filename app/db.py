from functools import lru_cache
from sqlalchemy import create_engine, text
from .config import settings


@lru_cache
def engine():
    return create_engine(settings().database_url.get_secret_value(), pool_pre_ping=True, hide_parameters=True)


def now(conn):
    return conn.scalar(text("SELECT clock_timestamp()"))


def lock(conn, key):
    conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})


def one(conn, query):
    return conn.execute(query).mappings().first()


def rows(conn, query):
    return list(conn.execute(query).mappings())
