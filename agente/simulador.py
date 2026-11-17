#!/usr/bin/env python3
"""Simulador del agente de captura ARGOS (solo biblioteca estándar).

Reproduce lo que hará el agente real con el ESP32 y la cámara:
  1. D1: solo envía eventos que superan límite + incertidumbre.
  2. Guarda la foto en data/evidencias ANTES de llamar al backend.
  3. Deja un .json junto a la foto; si el backend no responde, se reenvía luego
     con el mismo identificador (el backend no duplica).

También puede simular el módulo de visión (--analizar) para probar el panel.

Uso:
  python agente/simulador.py --eventos 8 --analizar
  python agente/simulador.py --reenviar
"""
import argparse
import hashlib
import json
import random
import struct
import urllib.error
import urllib.request
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "data" / "evidencias"
DISTANCIA_M = 3.0


def llamar(api, metodo, ruta, cuerpo=None, actor="agente"):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(
        api + ruta, data=datos, method=metodo,
        headers={"Content-Type": "application/json", "X-Actor": actor},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def png_de_prueba(ancho=640, alto=360):
    """Imagen sintética: pista gris, vehículo oscuro y una placa blanca."""
    filas = []
    for y in range(alto):
        fila = bytearray([0])
        for x in range(ancho):
            if 250 <= x <= 390 and 230 <= y <= 262:
                c = (245, 245, 245)                       # placa
            elif 170 <= x <= 470 and 120 <= y <= 300:
                c = (40, 52, 70)                          # vehículo
            else:
                c = (120, 122, 126) if y > 90 else (170, 190, 210)
            fila += bytes(c)
        filas.append(bytes(fila))
    def trozo(tipo, d):
        return struct.pack(">I", len(d)) + tipo + d + struct.pack(">I", zlib.crc32(tipo + d))
    return (b"\x89PNG\r\n\x1a\n"
            + trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
            + trozo(b"IDAT", zlib.compress(b"".join(filas), 6))
            + trozo(b"IEND", b""))


def enviar(api, sidecar: Path):
    carga = json.loads(sidecar.read_text())
    try:
        r = llamar(api, "POST", "/api/eventos", carga)
    except urllib.error.HTTPError as e:
        print(f"  ✗ {carga['id'][:8]} rechazado: {e.read().decode()}")
        return
    except urllib.error.URLError as e:
        print(f"  … {carga['id'][:8]} pendiente (backend no disponible: {e.reason})")
        return
    sidecar.rename(sidecar.with_suffix(".enviado.json"))
    print(f"  ✓ {r['id'][:8]} {r['velocidad_kmh']:6.2f} km/h → {r['estado']}")


def capturar(api, sesion, limite, incertidumbre):
    velocidad = random.uniform(limite + incertidumbre + 0.5, limite * 1.8)
    t1 = random.randint(1_000_000, 9_000_000_000)
    t2 = t1 + round(DISTANCIA_M / (velocidad / 3.6) * 1_000_000)
    ahora = datetime.now(timezone.utc)

    eid = str(uuid.uuid4())
    carpeta = RAIZ / ahora.strftime("%Y-%m-%d")
    carpeta.mkdir(parents=True, exist_ok=True)
    foto = carpeta / f"{eid}.png"
    foto.write_bytes(png_de_prueba())                         # 1) persistir primero

    carga = {
        "id": eid, "sesion_id": sesion, "t1_us": t1, "t2_us": t2,
        "ocurrido_en": ahora.isoformat(),
        "duracion_corte_ms": round(random.uniform(150, 400), 1),
        "motivo_incierto": "Barrera 1 cortada dos veces" if random.random() < 0.1 else None,
        "evidencias": [{
            "tipo": "FOTO",
            "ruta": str(foto.relative_to(RAIZ)),
            "sha256": hashlib.sha256(foto.read_bytes()).hexdigest(),
            "capturada_en": ahora.isoformat(),
        }],
    }
    sidecar = foto.with_suffix(".json")
    sidecar.write_text(json.dumps(carga, indent=2))
    enviar(api, sidecar)                                      # 2) luego registrar


def analizar(api):
    """Simula el módulo de visión: toma la cola y propone placas."""
    for ev in llamar(api, "GET", "/api/cola?limite=50"):
        if random.random() < 0.15:
            r = llamar(api, "POST", f"/api/eventos/{ev['id']}/analisis",
                       {"error": "Sin placa detectada", "modelo_version": "simulador"}, "vision")
            print(f"  ⟳ {ev['id'][:8]} análisis falló (intento {r['intento']})")
            continue
        letras = "ABCDEFGHJKLMNPRSTUVWXYZ"
        placa = (random.choice(letras) + random.choice("0123456789" + letras) + random.choice(letras)
                 + "-" + f"{random.randint(0, 999):03d}")
        r = llamar(api, "POST", f"/api/eventos/{ev['id']}/analisis", {
            "placa_candidata": placa,
            "confianza": round(random.uniform(0.45, 0.98), 3),
            "modelo_version": "simulador-0.1",
        }, "vision")
        print(f"  ◎ {ev['id'][:8]} placa {placa} → {r['estado']} (prioridad {r.get('puntaje_utilidad')})")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--sesion", type=int, help="ID de sesión abierta (si no, se crea una)")
    p.add_argument("--eventos", type=int, default=5)
    p.add_argument("--analizar", action="store_true", help="simular también el módulo de visión")
    p.add_argument("--reenviar", action="store_true", help="solo reenviar eventos pendientes")
    a = p.parse_args()

    if a.reenviar:
        pendientes = [s for s in RAIZ.rglob("*.json") if not s.name.endswith(".enviado.json")]
        print(f"Reenviando {len(pendientes)} evento(s) pendiente(s)")
        for s in pendientes:
            enviar(a.api, s)
        return

    if a.sesion:
        sesion = next(s for s in llamar(a.api, "GET", "/api/sesiones") if s["id"] == a.sesion)
    else:
        sesion = llamar(a.api, "POST", "/api/sesiones", {
            "ubicacion": "Av. Pacífico, UPIS Belén (simulación)",
            "distancia_m": DISTANCIA_M, "limite_kmh": 40, "incertidumbre_kmh": 1.0,
            "latencia_camara_ms": 120,
        }, "operador@argos.local")
        print(f"Sesión {sesion['id']} creada")

    print(f"Capturando {a.eventos} evento(s)")
    for _ in range(a.eventos):
        capturar(a.api, sesion["id"], float(sesion["limite_kmh"]), float(sesion["incertidumbre_kmh"]))
    if a.analizar:
        print("Analizando cola")
        analizar(a.api)


if __name__ == "__main__":
    main()
