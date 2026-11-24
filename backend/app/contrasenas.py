"""Contraseñas de las personas: hash Argon2id (recomendación OWASP), nunca texto plano.

Política (NIST SP 800-63B): mínimo 10 caracteres, sin reglas de composición forzadas, distinta del correo.
"""
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException

_hasher = PasswordHasher()  # Argon2id, parámetros por defecto de argon2-cffi (64 MiB, t=3)
# Se verifica contra este hash cuando el correo no existe, para que el tiempo de respuesta no lo delate.
_HASH_SEÑUELO = _hasher.hash(secrets.token_urlsafe(16))

MIN, MAX = 10, 128
MAX_INTENTOS = 5          # intentos fallidos seguidos antes de bloquear la cuenta
MINUTOS_BLOQUEO = 15

# Sin caracteres ambiguos (0/O, 1/l/I) para dictarla o copiarla a mano
_ALFABETO = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def hashear(contrasena: str) -> str:
    return _hasher.hash(contrasena)


def verificar(hash_guardado: str | None, contrasena: str) -> bool:
    try:
        return _hasher.verify(hash_guardado or _HASH_SEÑUELO, contrasena) and hash_guardado is not None
    except (VerificationError, InvalidHashError):
        return False


def necesita_rehash(hash_guardado: str) -> bool:
    return _hasher.check_needs_rehash(hash_guardado)


def temporal() -> str:
    """Contraseña temporal legible, p. ej. 'Kp7m-x2Qa-9wTe' (~71 bits). Se muestra una sola vez."""
    return "-".join("".join(secrets.choice(_ALFABETO) for _ in range(4)) for _ in range(3))


def validar_nueva(nueva: str, email: str, actual: str | None = None) -> None:
    if len(nueva) < MIN:
        raise HTTPException(422, f"La contraseña debe tener al menos {MIN} caracteres")
    if len(nueva) > MAX:
        raise HTTPException(422, f"La contraseña no puede superar {MAX} caracteres")
    if nueva.strip().lower() == email.strip().lower() or nueva.lower() == email.split("@")[0].lower():
        raise HTTPException(422, "La contraseña no puede ser tu correo")
    if actual is not None and nueva == actual:
        raise HTTPException(422, "La nueva contraseña debe ser distinta de la actual")
