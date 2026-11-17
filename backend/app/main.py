from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .db import pool
from .routers import eventos, sesiones


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    pool.open(wait=True, timeout=30)
    yield
    pool.close()


app = FastAPI(title="ARGOS API", version="0.1.0", lifespan=ciclo_de_vida)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in config.cors_origenes.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(sesiones.router)
app.include_router(eventos.router)


@app.get("/api/salud", tags=["sistema"])
def salud():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"estado": "ok"}


@app.get("/api/usuarios", tags=["sistema"])
def usuarios():
    with pool.connection() as conn:
        return conn.execute(
            "SELECT id, nombre, email, rol FROM usuarios WHERE activo ORDER BY id"
        ).fetchall()
