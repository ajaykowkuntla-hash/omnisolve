"""API route endpoints for OmniSolve."""

from typing import Optional
from fastapi import APIRouter, File, Form, UploadFile, status

from app.config import settings
from app.schemas import (
    AnalysisEnvelope,
    AnalysisMode,
    CircuitAnalysisResponse,
    DocumentAnalysisResponse,
    HealthResponse,
    ScreenshotAnalysisResponse,
    ChatRequest,
    ChatResponse,
)
from app.services.document_service import DocumentService
from app.services.gemini_service import GeminiService
from app.services.validation_service import UploadValidationService

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health check endpoint",
    description="Confirms that the OmniSolve backend service is operational.",
)
async def health_check() -> HealthResponse:
    """
    Returns operational health status.
    Strictly verifies process health without exposing API keys, models, or internal configs.
    """
    return HealthResponse(
        status="ok",
        service=settings.SERVICE_IDENTIFIER,
    )


@router.post(
    "/analyze",
    response_model=AnalysisEnvelope,
    status_code=status.HTTP_200_OK,
    summary="Analyze uploaded screenshot, circuit, or document",
    description="Validates upload and delegates to mode-specific analysis.",
)
async def analyze_content(
    mode: str = Form(..., description="Analysis mode: screenshot, circuit, or document"),
    file: UploadFile = File(..., description="File to analyze"),
    context: Optional[str] = Form(None, description="Optional supplementary context"),
    question: Optional[str] = Form(None, description="Optional question for analysis"),
):
    """
    Unified analysis endpoint.
    1. Validates requested mode.
    2. Validates string length bounds.
    3. Validates file size, extensions, and byte content without persisting to disk.
    4. Rejects invalid inputs before any external AI provider interaction.
    5. Dispatches to mode-specific provider analysis.
    """
    # 1. Mode validation
    validated_mode = UploadValidationService.validate_mode(mode)

    # 2. Text input validation
    UploadValidationService.validate_text_inputs(context=context, question=question)

    # 3. Read file bytes safely into memory
    file_bytes = await file.read()

    # 4. Content and format validation
    content_type, metadata = UploadValidationService.validate_content(
        mode=validated_mode,
        filename=file.filename,
        file_bytes=file_bytes,
    )

    # 5. Route dispatch
    if validated_mode == AnalysisMode.SCREENSHOT:
        gemini_service = GeminiService()
        result = await gemini_service.analyze_screenshot(
            image_bytes=file_bytes,
            mime_type=content_type,
            context=context,
        )
        return ScreenshotAnalysisResponse(
            mode=AnalysisMode.SCREENSHOT,
            result=result,
            warnings=[],
        )

    elif validated_mode == AnalysisMode.CIRCUIT:
        gemini_service = GeminiService()
        result = await gemini_service.analyze_circuit(
            image_bytes=file_bytes,
            mime_type=content_type,
            context=context,
            question=question,
        )
        return CircuitAnalysisResponse(
            mode=AnalysisMode.CIRCUIT,
            result=result,
            warnings=[],
        )

    elif validated_mode == AnalysisMode.DOCUMENT:
        # Extract text safely in-memory using PyMuPDF / text decoder
        extraction = DocumentService.extract_text(
            file_bytes=file_bytes,
            filename=file.filename,
        )

        gemini_service = GeminiService()
        result = await gemini_service.analyze_document(
            extracted_text=extraction.text,
            question=question,
            context=context,
            extraction_warnings=extraction.warnings,
        )

        # Merge extraction disclosures into response envelope warnings
        response_warnings = list(extraction.warnings)
        for w in result.warnings:
            if w not in response_warnings:
                response_warnings.append(w)

        return DocumentAnalysisResponse(
            mode=AnalysisMode.DOCUMENT,
            result=result,
            warnings=response_warnings,
        )

@router.post(
    "/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Follow-up conversational engineering assistant",
    description="Processes follow-up questions for the active analysis session.",
)
async def chat_message(payload: ChatRequest) -> ChatResponse:
    """
    Handles follow-up engineering inquiries.
    """
    gemini_service = GeminiService()
    answer_text = await gemini_service.answer_chat(
        question=payload.question,
        session_id=payload.session_id,
        analysis_type=payload.analysis_type,
    )
    return ChatResponse(
        session_id=payload.session_id,
        answer=answer_text,
    )
