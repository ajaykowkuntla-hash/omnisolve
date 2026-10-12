"""Service for interacting with Google Gen AI / Gemma 4 models."""

import asyncio
import json
import logging
from typing import List, Optional, Type, TypeVar
from fastapi import HTTPException, status
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.prompts.circuit import build_circuit_prompt
from app.prompts.document import build_document_prompt
from app.prompts.screenshot import build_screenshot_prompt
from app.schemas import CircuitResult, DocumentResult, ScreenshotResult

logger = logging.getLogger("omnisolve.gemini_service")

T = TypeVar("T", bound=BaseModel)


class GeminiService:
    """Manages AI model inference via Google Gen AI SDK for Gemma 4."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self._api_key = api_key or settings.GEMINI_API_KEY
        self._model = model or settings.GEMINI_MODEL or "gemma-4-31b-it"

    def _get_client(self) -> genai.Client:
        """Instantiate client, verifying credentials server-side and attaching transport timeout options."""
        if not self._api_key or not self._api_key.strip():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "MODEL_UNAVAILABLE",
                    "message": "AI analysis provider credentials are not configured on the server.",
                },
            )
        return genai.Client(
            api_key=self._api_key,
            http_options=types.HttpOptions(
                timeout=settings.REQUEST_TIMEOUT_SECONDS * 1000,
            ),
        )

    async def _execute_model_call(
        self,
        contents: list,
        response_schema: Type[BaseModel],
    ) -> str:
        """
        Executes outbound call to Gemma 4 via Google Gen AI with structured output,
        timeout boundaries, single controlled retry, and sanitized error mapping.
        """
        client = self._get_client()

        # Gemma open models on Google AI Studio do not support server-enforced response_schema
        # or response_mime_type="application/json", which triggers upstream APIError 500.
        # Format adherence is guided by prompt schema instructions and validated via Pydantic.
        config = None
        if response_schema is not None and not self._model.lower().startswith("gemma"):
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema,
            )

        call_kwargs = {
            "model": self._model,
            "contents": contents,
        }
        if config is not None:
            call_kwargs["config"] = config

        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                response = await client.aio.models.generate_content(**call_kwargs)
                output_text = response.text if response and response.text else ""
                return output_text

            except HTTPException:
                raise

            except errors.APIError as exc:
                logger.error("Gemini API provider error: code=%s, msg=%s", getattr(exc, "code", "unknown"), getattr(exc, "message", "unknown"))
                status_code = getattr(exc, "code", None)

                # Retry transient errors once if attempts remain
                if attempt < max_attempts - 1 and status_code in (500, 502, 503, 504):
                    logger.warning("Transient provider error (%s). Retrying attempt %d...", status_code, attempt + 2)
                    await asyncio.sleep(0.5)
                    continue

                if status_code in (408, 504):
                    raise HTTPException(
                        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                        detail={
                            "code": "MODEL_TIMEOUT",
                            "message": "The AI analysis model request timed out.",
                        },
                    )
                elif status_code in (401, 403):
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail={
                            "code": "MODEL_UNAVAILABLE",
                            "message": "Authentication with the AI model provider failed.",
                        },
                    )
                elif status_code == 429:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail={
                            "code": "MODEL_UNAVAILABLE",
                            "message": "AI model request quota or rate limit exceeded.",
                        },
                    )
                else:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail={
                            "code": "MODEL_UNAVAILABLE",
                            "message": "The AI analysis provider encountered an error.",
                        },
                    )

            except (TimeoutError, Exception) as exc:
                exc_str = str(exc).lower()
                if "timeout" in exc_str or "timed out" in exc_str:
                    raise HTTPException(
                        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                        detail={
                            "code": "MODEL_TIMEOUT",
                            "message": "The AI analysis model request timed out.",
                        },
                    )
                logger.error("Provider execution failure during attempt %d: %s", attempt + 1, type(exc).__name__)
                if attempt == max_attempts - 1:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail={
                            "code": "MODEL_UNAVAILABLE",
                            "message": "Unable to communicate with the AI analysis provider.",
                        },
                    )
                await asyncio.sleep(0.5)

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "MODEL_UNAVAILABLE",
                "message": "The AI analysis provider was unable to generate a response.",
            },
        )

    def _parse_and_validate_json_output(
        self,
        raw_text: str,
        schema_cls: Type[T],
        mode_label: str,
    ) -> T:
        """
        Defensively parses and validates model JSON text into the specified Pydantic schema.
        """
        if not raw_text or not raw_text.strip():
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "MODEL_OUTPUT_INVALID",
                    "message": f"The AI model returned an empty {mode_label} analysis result.",
                },
            )

        cleaned = raw_text.strip()
        # Handle markdown fences
        if "```json" in cleaned:
            parts = cleaned.split("```json", 1)[1].split("```", 1)
            cleaned = parts[0].strip()
        elif "```" in cleaned:
            parts = cleaned.split("```", 1)[1].split("```", 1)
            cleaned = parts[0].strip()
        else:
            # Handle potential introductory or closing text around JSON braces
            first_brace = cleaned.find("{")
            last_brace = cleaned.rfind("}")
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                cleaned = cleaned[first_brace : last_brace + 1].strip()

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # As a fallback, try to extract between first { and last } if not already done
            first_brace = cleaned.find("{")
            last_brace = cleaned.rfind("}")
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                try:
                    parsed = json.loads(cleaned[first_brace : last_brace + 1])
                except json.JSONDecodeError:
                    parsed = None
            else:
                parsed = None

            if parsed is None:
                logger.warning("Model output failed JSON parsing for %s", mode_label)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={
                        "code": "MODEL_OUTPUT_INVALID",
                        "message": "The model response could not be parsed as valid structured JSON.",
                    },
                )

        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "MODEL_OUTPUT_INVALID",
                    "message": "The model response is not a valid JSON object.",
                },
            )

        try:
            return schema_cls.model_validate(parsed)
        except ValidationError as err:
            logger.warning("Model output failed Pydantic validation for %s: %s", mode_label, err)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "MODEL_OUTPUT_INVALID",
                    "message": f"The model response did not conform to the required {mode_label} analysis schema.",
                },
            )

    async def analyze_screenshot(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: Optional[str] = None,
    ) -> ScreenshotResult:
        """
        Sends image and screenshot prompt to Gemma 4 and validates structured output.
        """
        prompt_text = build_screenshot_prompt(context=context)
        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        contents = [image_part, prompt_text]

        raw_output = await self._execute_model_call(
            contents=contents,
            response_schema=ScreenshotResult,
        )
        return self._parse_and_validate_json_output(
            raw_text=raw_output,
            schema_cls=ScreenshotResult,
            mode_label="screenshot",
        )

    async def analyze_circuit(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: Optional[str] = None,
        question: Optional[str] = None,
    ) -> CircuitResult:
        """
        Sends circuit image and circuit prompt to Gemma 4 and validates structured output.
        """
        prompt_text = build_circuit_prompt(context=context, question=question)
        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        contents = [image_part, prompt_text]

        raw_output = await self._execute_model_call(
            contents=contents,
            response_schema=CircuitResult,
        )
        return self._parse_and_validate_json_output(
            raw_text=raw_output,
            schema_cls=CircuitResult,
            mode_label="circuit",
        )

    async def analyze_document(
        self,
        extracted_text: str,
        question: Optional[str] = None,
        context: Optional[str] = None,
        extraction_warnings: Optional[List[str]] = None,
    ) -> DocumentResult:
        """
        Sends extracted document text and document prompt to Gemma 4 and validates structured output.
        """
        prompt_text = build_document_prompt(
            extracted_text=extracted_text,
            question=question,
            context=context,
            extraction_warnings=extraction_warnings,
        )
        contents = [prompt_text]

        raw_output = await self._execute_model_call(
            contents=contents,
            response_schema=DocumentResult,
        )
        return self._parse_and_validate_json_output(
            raw_text=raw_output,
            schema_cls=DocumentResult,
            mode_label="document",
        )

    # Backward compatibility helpers for test suites
    def _parse_and_validate_screenshot_output(self, raw_text: str) -> ScreenshotResult:
        return self._parse_and_validate_json_output(
            raw_text=raw_text,
            schema_cls=ScreenshotResult,
            mode_label="screenshot",
        )

    def _parse_and_validate_circuit_output(self, raw_text: str) -> CircuitResult:
        return self._parse_and_validate_json_output(
            raw_text=raw_text,
            schema_cls=CircuitResult,
            mode_label="circuit",
        )

    def _parse_and_validate_document_output(self, raw_text: str) -> DocumentResult:
        return self._parse_and_validate_json_output(
            raw_text=raw_text,
            schema_cls=DocumentResult,
            mode_label="document",
        )

    async def answer_chat(
        self,
        question: str,
        session_id: str,
        analysis_type: Optional[str] = None,
    ) -> str:
        """
        Executes follow-up engineering query with conversational context.
        """
        system_instruction = (
            "You are OmniSolve AI, an expert multimodal engineering assistant specializing in software debugging, "
            "circuit analysis, and technical document explanation powered by Gemma 4. Provide clear, accurate, "
            "practical answers grounded in engineering best practices. Be concise and actionable."
        )
        mode_context = f" Mode: {analysis_type}." if analysis_type else ""
        prompt_text = f"{system_instruction}\n\nContext:{mode_context}\nUser Question: {question.strip()}"
        contents = [prompt_text]

        raw_output = await self._execute_model_call(
            contents=contents,
            response_schema=None,  # Free-form conversational response
        )
        return raw_output.strip()
