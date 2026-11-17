import json
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import config

pool = ConnectionPool(
    config.database_url,
    min_size=1,
    max_size=10,
    open=False,
    kwargs={"row_factory": dict_row},
)


@contextmanager
def transaccion():
    """Conexión con transacción: commit al salir, rollback si hay excepción."""
    with pool.connection() as conn:
        with conn.transaction():
            yield conn


def auditar(conn, evento_id, accion, actor, anterior=None, nuevo=None, detalle=None):
    conn.execute(
        """INSERT INTO auditoria (evento_id, accion, estado_anterior, estado_nuevo, actor, detalle)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (evento_id, accion, anterior, nuevo, actor, json.dumps(detalle or {}, default=str)),
    )
