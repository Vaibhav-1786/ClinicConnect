import datetime
import decimal

import mysql.connector  # type: ignore[reportMissingImports]
from mysql.connector import pooling  # type: ignore[reportMissingImports]
from config import Config

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="clinic_pool",
            pool_size=10,
            host=Config.DB_HOST,
            port=Config.DB_PORT,
            database=Config.DB_NAME,
            user=Config.DB_USER,
            password=Config.DB_PASSWORD,
            autocommit=False,
        )
    return _pool


def get_conn():
    return get_pool().get_connection()


def _json_safe(value):
    """
    mysql-connector returns MySQL TIME columns as datetime.timedelta and
    DECIMAL columns as decimal.Decimal — neither is JSON serializable by
    Flask's default encoder. Normalize both (and dates/datetimes, for
    safety) to plain, JSON-friendly types here, once, so every route gets
    this for free instead of needing its own per-field workaround.
    """
    if isinstance(value, datetime.timedelta):
        total_seconds = int(value.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    return value


def _row_safe(row):
    return {k: _json_safe(v) for k, v in row.items()}


def query(sql, params=None, fetchone=False, commit=False):
    """Run a query and return list[dict] (or single dict), handling commit for writes."""
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params or ())
        if commit:
            conn.commit()
            last_id = cur.lastrowid
            cur.close()
            return last_id
        rows = [_row_safe(r) for r in cur.fetchall()]
        cur.close()
        if fetchone:
            return rows[0] if rows else None
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def execute(sql, params=None):
    """Insert/update/delete. Returns lastrowid."""
    return query(sql, params, commit=True)