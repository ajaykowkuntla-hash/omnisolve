"""Typed Pydantic schemas for OmniSolve requests and responses."""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


class AnalysisMode(str, Enum):
    """Supported analysis modes for OmniSolve."""
    SCREENSHOT = "screenshot"
    CIRCUIT = "circuit"
    DOCUMENT = "document"


class ConfidenceLevel(str, Enum):
    """Qualitative confidence ratings."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# ============================================================================
# Health & Status Schemas
# ============================================================================

class HealthResponse(BaseModel):
    """Health status response schema."""
    status: str = Field(default="ok", description="Operational health status.")
    service: str = Field(default="omnisolve-ai", description="Service identifier.")


# ============================================================================
# Standardized Error Schemas
# ============================================================================

class ErrorDetail(BaseModel):
    """Detailed error structure matching API contract."""
    code: str = Field(..., description="Machine-readable error code.")
    message: str = Field(..., description="Safe human-readable error description.")


class ErrorResponse(BaseModel):
    """Standard error envelope for HTTP exceptions."""
    detail: ErrorDetail


# ============================================================================
# Screenshot Analysis Schemas
# ============================================================================

class LikelyCause(BaseModel):
    """A hypothesized root cause for the observed technical issue."""
    cause: str = Field(..., description="Hypothesized cause of the problem.")
    rationale: str = Field(..., description="Visible reasoning justifying this hypothesis.")
    confidence: ConfidenceLevel = Field(..., description="Qualitative confidence rating.")


class ScreenshotResult(BaseModel):
    """Structured analysis of a software screenshot or terminal error."""
    issue_type: str = Field(..., description="Category of error, e.g., ImportError, SyntaxError.")
    summary: str = Field(..., description="High-level description of what occurred.")
    observed_evidence: List[str] = Field(
        default_factory=list,
        description="Strictly visible details in the screenshot (tracebacks, line numbers).",
    )
    likely_causes: List[LikelyCause] = Field(
        default_factory=list,
        description="Hypotheses explaining why the observed issue occurred.",
    )
    debugging_steps: List[str] = Field(
        default_factory=list,
        description="Actionable, ordered troubleshooting steps.",
    )
    verification_steps: List[str] = Field(
        default_factory=list,
        description="Steps to verify whether the issue is resolved.",
    )
    confidence: ConfidenceLevel = Field(
        ...,
        description="Overall confidence in the analysis.",
    )
    limitations: List[str] = Field(
        default_factory=list,
        description="Explicit uncertainties, obscured code, or unverified assumptions.",
    )


# ============================================================================
# Circuit Analysis Schemas
# ============================================================================

class VisibleComponent(BaseModel):
    """A hardware component visible in the circuit diagram."""
    name: str = Field(..., description="Identified component type (e.g., Resistor, IC 555).")
    visible_label: str = Field(..., description="Visible label or markings (e.g., R1 10k, U1).")
    notes: str = Field(..., description="Observations or legible pin connections.")


class PossibleIssue(BaseModel):
    """A potential wiring or component fault identified in the circuit."""
    issue: str = Field(..., description="Description of the potential circuit issue.")
    evidence: str = Field(..., description="Visible visual evidence pointing to this issue.")
    confidence: ConfidenceLevel = Field(..., description="Confidence in this observation.")


class CircuitResult(BaseModel):
    """Structured analysis of a circuit schematic or breadboard image."""
    overview: str = Field(..., description="High-level circuit description and expected function.")
    visible_components: List[VisibleComponent] = Field(
        default_factory=list,
        description="Identified components and legible labels.",
    )
    connections: List[str] = Field(
        default_factory=list,
        description="Visible node connections, power rails, and grounding.",
    )
    possible_issues: List[PossibleIssue] = Field(
        default_factory=list,
        description="Potential faults, floating pins, reverse polarity, or short circuits.",
    )
    suggested_checks: List[str] = Field(
        default_factory=list,
        description="Physical multimeter checks or inspections for a qualified user to perform.",
    )
    safety_notes: List[str] = Field(
        default_factory=list,
        description="Warnings regarding high voltage, mains connections, or thermal risk.",
    )
    limitations: List[str] = Field(
        default_factory=list,
        description="Unclear traces, hidden wiring, ambiguous junctions, or missing values.",
    )


# ============================================================================
# Document Analysis Schemas
# ============================================================================

class ImportantTerm(BaseModel):
    """A key terminology item or concept defined in the document."""
    term: str = Field(..., description="The term or keyword.")
    explanation: str = Field(..., description="Document-grounded definition or context.")


class DocumentResult(BaseModel):
    """Structured analysis of an uploaded PDF or text document."""
    document_title: Optional[str] = Field(
        default=None,
        description="Extracted document title or heading, if detectable.",
    )
    summary: str = Field(..., description="Executive summary grounded strictly in document text.")
    key_points: List[str] = Field(
        default_factory=list,
        description="Key takeaways extracted from the text.",
    )
    important_terms: List[ImportantTerm] = Field(
        default_factory=list,
        description="Key entities, parameters, or terms defined in the document.",
    )
    answer: Optional[str] = Field(
        default=None,
        description="Answer to the user's specific question, grounded in extracted content.",
    )
    source_notes: List[str] = Field(
        default_factory=list,
        description="Section, page, or line references for cited facts.",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Extraction warnings, truncated content disclosures, or scan caveats.",
    )
    limitations: List[str] = Field(
        default_factory=list,
        description="Explicit statement of content bounds, missing tables, or unread pages.",
    )


# ============================================================================
# Mode-Specific Response Envelopes
# ============================================================================

class ScreenshotAnalysisResponse(BaseModel):
    """Standard envelope for screenshot analysis."""
    mode: Literal[AnalysisMode.SCREENSHOT] = AnalysisMode.SCREENSHOT
    result: ScreenshotResult
    warnings: List[str] = Field(default_factory=list)


class CircuitAnalysisResponse(BaseModel):
    """Standard envelope for circuit analysis."""
    mode: Literal[AnalysisMode.CIRCUIT] = AnalysisMode.CIRCUIT
    result: CircuitResult
    warnings: List[str] = Field(default_factory=list)


class DocumentAnalysisResponse(BaseModel):
    """Standard envelope for document analysis."""
    mode: Literal[AnalysisMode.DOCUMENT] = AnalysisMode.DOCUMENT
    result: DocumentResult
    warnings: List[str] = Field(default_factory=list)


# Discriminated union of analysis responses
AnalysisEnvelope = Union[
    ScreenshotAnalysisResponse,
    CircuitAnalysisResponse,
    DocumentAnalysisResponse,
]

# ============================================================================
# Contextual Chat Schemas
# ============================================================================

class ChatRequest(BaseModel):
    """Payload for conversational follow-up questions."""
    session_id: str = Field(..., description="Active analysis session identifier.")
    question: str = Field(..., min_length=1, max_length=2000, description="Follow-up question.")
    analysis_type: Optional[str] = Field(default=None, description="Active analysis mode context.")


class ChatResponse(BaseModel):
    """Response returned for conversational chat messages."""
    session_id: str = Field(..., description="Session identifier.")
    answer: str = Field(..., description="Gemma 4 generated answer to follow-up inquiry.")
