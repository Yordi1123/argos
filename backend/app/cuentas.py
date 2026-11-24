"""CLI de cuentas de personas (para el primer administrador o si nadie puede entrar).

    docker compose exec backend python -m app.cuentas admin <correo> "<Nombre Apellido>"
    docker compose exec backend python -m app.cuentas restablecer <correo>
    docker compose exec backend python -m app.cuentas listar

Imprime una contraseña temporal UNA sola vez; la persona debe cambiarla al primer ingreso.
"""
import sys

from .auth import cerrar_sesiones_de, email_canonico
from .contrasenas import hashear, temporal
from .db import auditar, pool, transaccion

ACTOR = "sistema:cli"


def _mostrar(email: str, clave: str) -> None:
    print(f"\n  Correo:              {email}\n  Contraseña temporal: {clave}\n")
    print("  Se muestra una sola vez. Al ingresar, ARGOS pedirá cambiarla.\n")


def admin(email: str, nombre: str | None) -> None:
    email = email.strip().lower()
    clave = temporal()
    with transaccion() as conn:
        u = conn.execute(
            """INSERT INTO usuarios (nombre, email, email_canonico, rol, contrasena_hash, debe_cambiar_contrasena)
               VALUES (%(n)s, %(e)s, %(c)s, 'ADMINISTRADOR', %(h)s, TRUE)
               ON CONFLICT (email_canonico) DO UPDATE
                 SET rol = 'ADMINISTRADOR', activo = TRUE, contrasena_hash = %(h)s,
                     debe_cambiar_contrasena = TRUE, intentos_fallidos = 0, bloqueado_hasta = NULL,
                     nombre = COALESCE(%(nn)s, usuarios.nombre)
               RETURNING id, email""",
            {"n": nombre or email, "nn": nombre, "e": email, "c": email_canonico(email), "h": hashear(clave)},
        ).fetchone()
        cerrar_sesiones_de(conn, u["id"], "Contraseña restablecida desde la consola")
        auditar(conn, None, "ADMIN_INICIAL", ACTOR, detalle={"email": u["email"]})
    _mostrar(u["email"], clave)


def restablecer(email: str) -> None:
    clave = temporal()
    with transaccion() as conn:
        u = conn.execute(
            """UPDATE usuarios SET contrasena_hash = %s, debe_cambiar_contrasena = TRUE,
                      intentos_fallidos = 0, bloqueado_hasta = NULL
               WHERE email_canonico = %s RETURNING id, email, activo""",
            (hashear(clave), email_canonico(email)),
        ).fetchone()
        if u is None:
            sys.exit(f"No existe una cuenta con el correo {email}")
        cerrar_sesiones_de(conn, u["id"], "Contraseña restablecida desde la consola")
        auditar(conn, None, "CONTRASENA_RESTABLECIDA", ACTOR, detalle={"email": u["email"]})
    _mostrar(u["email"], clave)
    if not u["activo"]:
        print("  Aviso: la cuenta está desactivada; un administrador debe reactivarla.\n")


def listar() -> None:
    with pool.connection() as conn:
        for f in conn.execute(
            """SELECT email, rol, activo, contrasena_hash IS NOT NULL AS clave, ultimo_acceso
               FROM usuarios ORDER BY activo DESC, rol, email"""
        ):
            print(f"  {'●' if f['activo'] else '○'} {f['email']:<36} {f['rol']:<14} "
                  f"{'con contraseña' if f['clave'] else 'sin contraseña':<15} último acceso: {f['ultimo_acceso'] or '—'}")


if __name__ == "__main__":
    pool.open(wait=True)
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "admin":
        admin(args[1], " ".join(args[2:]).strip() or None)
    elif len(args) == 2 and args[0] == "restablecer":
        restablecer(args[1])
    elif args == ["listar"]:
        listar()
    else:
        sys.exit(__doc__)
