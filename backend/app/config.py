from pydantic_settings import BaseSettings


class Config(BaseSettings):
    database_url: str = "postgresql://argos:argos@db:5432/argos"
    evidencias_dir: str = "/data/evidencias"
    cors_origenes: str = "http://localhost:8080"

    # Autenticación ------------------------------------------------------------
    # OAuth Client ID (tipo "Aplicación web") de Google Cloud. No es un secreto.
    google_client_id: str = ""
    # Si no hay ningún ADMINISTRADOR activo, este Gmail se crea/reactiva como administrador al arrancar.
    sesion_horas_max: float = 8.0          # duración máxima de una sesión del panel
    sesion_minutos_inactividad: float = 30.0
    # True cuando el panel se sirva por HTTPS. En localhost por HTTP debe ser False.
    cookie_segura: bool = False

    @property
    def origenes(self) -> list[str]:
        return [o.strip() for o in self.cors_origenes.split(",") if o.strip()]


config = Config()
