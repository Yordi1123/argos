from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .auth import asegurar_admin_inicial
from .db import pool
from .routers import auth, eventos, sesiones, usuarios, vision

# Versión del sistema (SemVer). No editar a mano: ./scripts/version.sh — ver docs/versionado.md
VERSION = "1.0.0-alpha.1"


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    pool.open(wait=True, timeout=30)
    asegurar_admin_inicial()
    yield
    pool.close()


app = FastAPI(title="ARGOS API", version=VERSION, lifespan=ciclo_de_vida)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.origenes,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(usuarios.router)
app.include_router(sesiones.router)
app.include_router(eventos.router)
app.include_router(vision.router)


@app.get("/api/salud", tags=["sistema"])
def salud():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"estado": "ok", "version": VERSION}

