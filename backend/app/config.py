"""Configuration for the Urban Planner Dataset Assistant.

Controls API ingestion, feature flags, and runtime settings.
"""
from __future__ import annotations

import os
from typing import Literal


class Config:
    """Central configuration object."""

    # API Ingestion flags
    ENABLE_MADRID_CKAN: bool = os.getenv("ENABLE_MADRID_CKAN", "false").lower() == "true"
    ENABLE_DATOS_GOB_ES: bool = os.getenv("ENABLE_DATOS_GOB_ES", "false").lower() == "true"
    
    # API parameters
    MADRID_CKAN_ROWS: int = int(os.getenv("MADRID_CKAN_ROWS", "50"))
    MADRID_CKAN_QUERY: str = os.getenv("MADRID_CKAN_QUERY", "")  # Optional keyword filter
    
    DATOS_GOB_ES_PAGE: int = int(os.getenv("DATOS_GOB_ES_PAGE", "1"))
    DATOS_GOB_ES_LIMIT: int = int(os.getenv("DATOS_GOB_ES_LIMIT", "50"))
    DATOS_GOB_ES_QUERY: str = os.getenv("DATOS_GOB_ES_QUERY", "")  # Optional keyword filter
    
    # Caching
    CACHE_API_RESULTS: bool = os.getenv("CACHE_API_RESULTS", "true").lower() == "true"
    
    # Theme extraction — keyword-only simplified configuration
    THEME_EXTRACTION_METHOD: Literal["keywords"] = os.getenv("THEME_EXTRACTION_METHOD", "keywords")  # type: ignore

    # LLM-based insights (optional enrichment)
    ENABLE_LLM_INSIGHTS: bool = os.getenv("ENABLE_LLM_INSIGHTS", "false").lower() == "true"
    LLM_PROVIDER: Literal["openai", "groq", "none"] = os.getenv("LLM_PROVIDER", "none")  # type: ignore
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o-mini")  # or "mixtral-8x7b-32768" for Groq

    # OpenAI / generic chat completion endpoint (kept for optional features)
    OPENAI_API_URL: str = os.getenv("OPENAI_API_URL", "https://api.openai.com/v1/chat/completions")

    # Groq API settings
    GROQ_API_URL: str = os.getenv("GROQ_API_URL", "https://api.groq.com/v1/chat/completions")
    GROQ_MODEL_NAME: str = os.getenv("GROQ_MODEL_NAME", "mixtral-8x7b-32768")
    
    # Debug
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]
    CORS_ORIGIN_REGEX: str = os.getenv(
        "CORS_ORIGIN_REGEX",
        r"^http://(localhost|127\.0\.0\.1):[0-9]+$",
    )
    
    @classmethod
    def is_api_enabled(cls) -> bool:
        """Check if any API ingestion is enabled."""
        return cls.ENABLE_MADRID_CKAN or cls.ENABLE_DATOS_GOB_ES
    
    @classmethod
    def get_enabled_sources(cls) -> list[Literal["madrid_ckan", "datos_gob_es"]]:
        """Return list of enabled API sources."""
        sources: list[Literal["madrid_ckan", "datos_gob_es"]] = []
        if cls.ENABLE_MADRID_CKAN:
            sources.append("madrid_ckan")
        if cls.ENABLE_DATOS_GOB_ES:
            sources.append("datos_gob_es")
        return sources
    
    @classmethod
    def to_dict(cls) -> dict:
        """Serialize config to dict for logging/debugging."""
        return {
            "ENABLE_MADRID_CKAN": cls.ENABLE_MADRID_CKAN,
            "ENABLE_DATOS_GOB_ES": cls.ENABLE_DATOS_GOB_ES,
            "MADRID_CKAN_ROWS": cls.MADRID_CKAN_ROWS,
            "MADRID_CKAN_QUERY": cls.MADRID_CKAN_QUERY,
            "DATOS_GOB_ES_PAGE": cls.DATOS_GOB_ES_PAGE,
            "DATOS_GOB_ES_LIMIT": cls.DATOS_GOB_ES_LIMIT,
            "CACHE_API_RESULTS": cls.CACHE_API_RESULTS,
            "THEME_EXTRACTION_METHOD": cls.THEME_EXTRACTION_METHOD,
            "CORS_ORIGINS": cls.CORS_ORIGINS,
            "CORS_ORIGIN_REGEX": cls.CORS_ORIGIN_REGEX,
            "DEBUG": cls.DEBUG,
        }
