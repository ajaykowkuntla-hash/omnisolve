"""Configuration settings for the OmniSolve backend."""

from typing import List, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application metadata
    APP_NAME: str = "OmniSolve"
    SERVICE_IDENTIFIER: str = "omnisolve-ai"
    API_V1_STR: str = "/api"

    # AI Provider configuration
    GEMINI_API_KEY: str = Field(
        default="",
        description="Google Gemini API key kept strictly server-side.",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-2.0-flash",
        description="Default model identifier supported by the Google Gen AI API (e.g. gemini-2.0-flash, gemini-1.5-flash, or gemma-2-27b-it).",
    )

    # Operational limits
    MAX_UPLOAD_MB: int = Field(
        default=8,
        description="Maximum allowed upload size in megabytes.",
    )
    REQUEST_TIMEOUT_SECONDS: int = Field(
        default=90,
        description="Timeout for outbound provider requests in seconds.",
    )
    MAX_DOCUMENT_CHARS: int = Field(
        default=30000,
        description="Maximum number of characters extracted from documents before truncation.",
    )
    MAX_TEXT_INPUT_CHARS: int = Field(
        default=1000,
        description="Maximum characters allowed for optional context or question input.",
    )

    # CORS configuration
    CORS_ORIGINS: Union[str, List[str]] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"],
        description="Allowed origins for Cross-Origin Resource Sharing.",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


settings = Settings()
