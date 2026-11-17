from pydantic_settings import BaseSettings


class Config(BaseSettings):
    database_url: str = "postgresql://argos:argos@db:5432/argos"
    evidencias_dir: str = "/data/evidencias"
    cors_origenes: str = "http://localhost:8080"


config = Config()
