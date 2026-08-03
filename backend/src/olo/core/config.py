"""Configuración del backend. Única fuente de verdad de los ajustes.

Nada de secretos en código: todo llega por variables de entorno. En local se
leen de `.env.local` (que está en .gitignore); en despliegue, del gestor de
secretos del proveedor.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, PostgresDsn, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    LOCAL = "local"
    DEV = "dev"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Identidad del servicio ────────────────────────────────────────────
    app_name: str = "olo-api"
    app_version: str = "0.1.0"
    environment: Environment = Environment.LOCAL
    debug: bool = False

    # ── Supabase ──────────────────────────────────────────────────────────
    supabase_url: str = Field(..., description="https://<ref>.supabase.co")
    supabase_anon_key: SecretStr | None = None

    # ── Base de datos ─────────────────────────────────────────────────────
    # Se conecta SIEMPRE con el rol `olo_app`, que no tiene BYPASSRLS.
    # Usar `postgres` o `service_role` aquí anularía todo el aislamiento
    # multi-tenant: ambos tienen BYPASSRLS.
    database_url: PostgresDsn = Field(
        ..., description="DSN del pooler en modo transaction (puerto 6543)"
    )
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_timeout_s: int = 10
    db_statement_timeout_ms: int = 30_000

    # ── Verificación de JWT ───────────────────────────────────────────────
    # Por defecto se valida contra el JWKS del proyecto (claves asimétricas).
    # `hs256` existe solo para proyectos que aún usan el secreto compartido.
    jwt_algorithm: Literal["jwks", "hs256"] = "jwks"
    jwt_secret: SecretStr | None = None
    jwt_audience: str = "authenticated"
    jwks_cache_ttl_s: int = 600
    # Tolerancia de reloj al validar `exp`, `iat` y `nbf`. PyJWT no aplica
    # ninguna por defecto: un token recién emitido por Supabase se rechaza con
    # `ImmatureSignatureError` en cuanto el reloj local va décimas de segundo
    # por detrás del suyo. Medido: 401 INVALID_TOKEN intermitentes en la suite
    # de integración, con el servicio de hora de Windows sin sincronizar.
    #
    # 5 s, no más: la tolerancia también se aplica a `exp`, y alargarla regala
    # vida extra a tokens caducados. Un desfase mayor que esto es un reloj roto
    # —hay que arreglar la sincronización de hora, no ensanchar la ventana.
    jwt_leeway_s: int = 5

    # ── Observabilidad ────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_json: bool = True

    # ── API ───────────────────────────────────────────────────────────────
    api_v1_prefix: str = "/v1"
    # NoDecode es imprescindible: sin él, pydantic-settings intenta interpretar
    # el valor como JSON en la capa de origen, ANTES de que corran los
    # validadores, y una cadena vacía —el caso normal en local— revienta el
    # arranque con un error de parseo que no dice nada útil.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    @field_validator("supabase_url")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        """Acepta lista separada por comas, que es lo que documenta .env.example.

        Sin esto, pydantic-settings intenta interpretar el valor como JSON y una
        cadena vacía —el caso normal en local— revienta el arranque con un error
        de parseo que no dice nada útil.
        """
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def is_production(self) -> bool:
        return self.environment is Environment.PRODUCTION

    def safe_summary(self) -> dict[str, str | bool | int]:
        """Resumen apto para logs: no incluye ningún secreto ni el DSN."""
        return {
            "app": self.app_name,
            "version": self.app_version,
            "environment": str(self.environment),
            "debug": self.debug,
            "jwt_algorithm": self.jwt_algorithm,
            "db_pool_size": self.db_pool_size,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Instancia única. `lru_cache` para no releer el entorno por request."""
    return Settings()  # type: ignore[call-arg]
