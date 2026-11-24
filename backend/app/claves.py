"""Claves de API para servicios (agente de captura, módulo de visión).

Uso (desde la raíz del repo):
  docker compose exec backend python -m app.claves crear agente OPERADOR
  docker compose exec backend python -m app.claves crear vision VALIDACION_IA
  docker compose exec backend python -m app.claves listar
  docker compose exec backend python -m app.claves revocar agente

La clave se muestra UNA sola vez; en la base solo queda su SHA-256.
Si se pierde, se revoca y se crea otra con `rotar`.
"""
import argparse
import secrets
import sys

from .auth import sha256
from .db import auditar, pool, transaccion

ROLES = ("OPERADOR", "VALIDACION_IA")


def _nueva() -> str:
    return "argos_" + secrets.token_urlsafe(32)


def crear(nombre: str, rol: str) -> None:
    clave = _nueva()
    with transaccion() as conn:
        if conn.execute("SELECT 1 FROM claves_servicio WHERE nombre = %s", (nombre,)).fetchone():
            sys.exit(f"✗ Ya existe la clave '{nombre}'. Usa 'rotar {nombre}' para reemplazarla.")
        conn.execute(
            "INSERT INTO claves_servicio (nombre, rol, clave_hash) VALUES (%s, %s, %s)",
            (nombre, rol, sha256(clave)),
        )
        auditar(conn, None, "CLAVE_CREADA", "admin:cli", detalle={"servicio": nombre, "rol": rol})
    _mostrar(nombre, rol, clave)


def rotar(nombre: str) -> None:
    clave = _nueva()
    with transaccion() as conn:
        fila = conn.execute(
            "UPDATE claves_servicio SET clave_hash = %s, activa = TRUE WHERE nombre = %s RETURNING rol",
            (sha256(clave), nombre),
        ).fetchone()
        if fila is None:
            sys.exit(f"✗ No existe la clave '{nombre}'")
        auditar(conn, None, "CLAVE_ROTADA", "admin:cli", detalle={"servicio": nombre})
    _mostrar(nombre, fila["rol"], clave)


def revocar(nombre: str) -> None:
    with transaccion() as conn:
        fila = conn.execute(
            "UPDATE claves_servicio SET activa = FALSE WHERE nombre = %s RETURNING id", (nombre,)
        ).fetchone()
        if fila is None:
            sys.exit(f"✗ No existe la clave '{nombre}'")
        auditar(conn, None, "CLAVE_REVOCADA", "admin:cli", detalle={"servicio": nombre})
    print(f"✓ Clave '{nombre}' revocada")


def listar() -> None:
    with pool.connection() as conn:
        filas = conn.execute(
            "SELECT nombre, rol, activa, creada_en, ultimo_uso FROM claves_servicio ORDER BY nombre"
        ).fetchall()
    if not filas:
        print("No hay claves de servicio.")
    for f in filas:
        uso = f["ultimo_uso"].strftime("%Y-%m-%d %H:%M") if f["ultimo_uso"] else "nunca"
        print(f"{f['nombre']:<16} {f['rol']:<14} {'activa' if f['activa'] else 'REVOCADA':<9} último uso: {uso}")


def _mostrar(nombre: str, rol: str, clave: str) -> None:
    variable = "ARGOS_CLAVE_" + nombre.upper().replace("-", "_")
    print(f"✓ Clave '{nombre}' ({rol}). Cópiala ahora: no se volverá a mostrar.\n")
    print(f"  {variable}={clave}\n")
    print("  Guárdala en el .env de la laptop de campo (nunca en git).")


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.claves", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="accion", required=True)
    c = sub.add_parser("crear")
    c.add_argument("nombre")
    c.add_argument("rol", choices=ROLES)
    sub.add_parser("listar")
    for accion in ("revocar", "rotar"):
        sub.add_parser(accion).add_argument("nombre")
    a = p.parse_args()

    pool.open(wait=True, timeout=30)
    try:
        if a.accion == "crear":
            crear(a.nombre, a.rol)
        elif a.accion == "rotar":
            rotar(a.nombre)
        elif a.accion == "revocar":
            revocar(a.nombre)
        else:
            listar()
    finally:
        pool.close()


if __name__ == "__main__":
    main()
