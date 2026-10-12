"""Tests for the follow-up chat endpoint."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_chat_endpoint_validation_error():
    """Verify 422 error on empty or invalid question."""
    response = client.post("/api/chat", json={"session_id": "sess_1", "question": ""})
    assert response.status_code == 422


@patch("app.services.gemini_service.GeminiService.answer_chat", new_callable=AsyncMock)
def test_chat_endpoint_success(mock_answer):
    """Verify successful response formatting."""
    mock_answer.return_value = "Yes, you can initialize useState with an empty array."
    response = client.post(
        "/api/chat",
        json={
            "session_id": "sess_test_123",
            "question": "Can I use useState([])?",
            "analysis_type": "code_debugger",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == "sess_test_123"
    assert "empty array" in data["answer"]
