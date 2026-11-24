"""Contraseñas de las personas: hash Argon2id (recomendación OWASP), nunca texto plano.

Política (NIST SP 800-63B): mínimo 10 caracteres, sin reglas de composición forzadas, distinta del correo.
Antes de hashear o comparar se normaliza: Unicode NFKC (una "ñ" puede llegar como un solo carácter o como
letra + tilde combinada según el teclado) y sin espacios al inicio ni al final (se cuelan al copiar y pegar,
son invisibles y dejaban a la persona sin poder entrar).
"""
import secrets
import unicodedata

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


def normalizar(contrasena: str) -> str:
    return unicodedata.normalize("NFKC", contrasena).strip()


def hashear(contrasena: str) -> str:
    return _hasher.hash(normalizar(contrasena))


def _coincide(hash_guardado: str, contrasena: str) -> bool:
    try:
        return _hasher.verify(hash_guardado, contrasena)
    except (VerificationError, InvalidHashError):
        return False


def verificar(hash_guardado: str | None, contrasena: str) -> bool:
    if hash_guardado is None:
        _coincide(_HASH_SEÑUELO, contrasena)  # mismo costo de tiempo aunque la cuenta no exista
        return False
    # Normalizada primero; luego tal cual, para hashes guardados antes de normalizar (compatibilidad).
    return _coincide(hash_guardado, normalizar(contrasena)) or (
        normalizar(contrasena) != contrasena and _coincide(hash_guardado, contrasena)
    )


def necesita_rehash(hash_guardado: str) -> bool:
    return _hasher.check_needs_rehash(hash_guardado)


def temporal() -> str:
    """Contraseña temporal legible, p. ej. 'Kp7m-x2Qa-9wTe' (~71 bits). Se muestra una sola vez."""
    return "-".join("".join(secrets.choice(_ALFABETO) for _ in range(4)) for _ in range(3))


def validar_nueva(nueva: str, email: str, actual: str | None = None) -> None:
    nueva = normalizar(nueva)
    actual = normalizar(actual) if actual is not None else None
    if len(nueva) < MIN:
        raise HTTPException(422, f"La contraseña debe tener al menos {MIN} caracteres")
    if len(nueva) > MAX:
        raise HTTPException(422, f"La contraseña no puede superar {MAX} caracteres")
    if nueva.strip().lower() == email.strip().lower() or nueva.lower() == email.split("@")[0].lower():
        raise HTTPException(422, "La contraseña no puede ser tu correo")
    if actual is not None and nueva == actual:
        raise HTTPException(422, "La nueva contraseña debe ser distinta de la actual")
