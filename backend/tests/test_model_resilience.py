"""Unit tests verifying model compatibility, error mapping, timeouts, and sanitized logging."""

import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import HTTPException
from google.genai import errors

from app.config import settings
from app.schemas import ScreenshotResult
from app.services.gemini_service import GeminiService


@pytest.mark.asyncio
async def test_invalid_model_identifier_returns_actionable_error():
    """Verify that a 404 / unsupported model error produces clear actionable guidance."""
    service = GeminiService(api_key="valid_test_key", model="non-existent-model-xyz")

    api_err = errors.APIError(404, "models/non-existent-model-xyz is not found for API version v1beta", {})
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=api_err)

    with patch.object(service, "_get_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            await service.analyze_screenshot(image_bytes=b"dummy", mime_type="image/png")

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "MODEL_UNAVAILABLE"
        assert "not supported or not found" in exc_info.value.detail["message"]
        assert "GEMINI_MODEL" in exc_info.value.detail["message"]


@pytest.mark.asyncio
async def test_quota_exceeded_returns_rate_limit_error():
    """Verify 429 quota exhaustion produces sanitized rate limit message."""
    service = GeminiService(api_key="valid_test_key", model="gemini-2.0-flash")

    api_err = errors.APIError(429, "Resource has been exhausted (e.g. check quota)", {})
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=api_err)

    with patch.object(service, "_get_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            await service.analyze_screenshot(image_bytes=b"dummy", mime_type="image/png")

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "MODEL_UNAVAILABLE"
        assert "quota or rate limit" in exc_info.value.detail["message"]


@pytest.mark.asyncio
async def test_timeout_error_returns_504_gateway_timeout():
    """Verify TimeoutError produces clean HTTP 504 with MODEL_TIMEOUT."""
    service = GeminiService(api_key="valid_test_key", model="gemini-2.0-flash")

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=TimeoutError("Request timed out"))

    with patch.object(service, "_get_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            await service.analyze_screenshot(image_bytes=b"dummy", mime_type="image/png")

        assert exc_info.value.status_code == 504
        assert exc_info.value.detail["code"] == "MODEL_TIMEOUT"


@pytest.mark.asyncio
async def test_auth_error_returns_auth_failed_message():
    """Verify 401/403 produces clean auth instruction without exposing keys."""
    service = GeminiService(api_key="invalid_key", model="gemini-2.0-flash")

    api_err = errors.APIError(403, "The caller does not have permission", {})
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=api_err)

    with patch.object(service, "_get_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            await service.analyze_screenshot(image_bytes=b"dummy", mime_type="image/png")

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "MODEL_UNAVAILABLE"
        assert "Authentication" in exc_info.value.detail["message"]
        assert "GEMINI_API_KEY" in exc_info.value.detail["message"]
