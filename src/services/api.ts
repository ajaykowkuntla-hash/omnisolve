import { AnalysisResult, AnalyzePayload, HealthCheckResponse } from '../types/analysis';
import { ChatRequestPayload, ChatResponsePayload } from '../types/chat';
import { MOCK_ANALYSIS_RESULTS, MOCK_CHAT_RESPONSES } from './mockData';

// Normalize API base URL: remove trailing slashes to prevent double slashes
const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 60000; // 60s timeout for live multimodal AI inference requests

class ApiService {
  /**
   * Health check to test backend availability.
   */
  async checkHealth(signal?: AbortSignal): Promise<HealthCheckResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${BASE_URL}/api/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: signal || controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Health check returned status ${response.status}`);
      }

      const data = await response.json();
      return {
        status: data.status || 'ok',
        model_available: data.status === 'ok',
        provider: data.service ? `FastAPI (${data.service})` : 'FastAPI Backend',
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort ? 'Health check timed out (10s)' : err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        model_available: false,
        provider: `Offline (${msg})`,
      };
    }
  }

  /**
   * Submit file and metadata for AI analysis.
   */
  async analyzeFile(
    payload: AnalyzePayload,
    useMockFallback = false,
    externalSignal?: AbortSignal
  ): Promise<AnalysisResult> {
    if (useMockFallback) {
      // Simulate realistic UI delay for explicit mock testing
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const mockResult = MOCK_ANALYSIS_RESULTS[payload.analysis_type] || MOCK_ANALYSIS_RESULTS.code_debugger;
      const fileCount = payload.files ? payload.files.length : (payload.file ? 1 : 0);
      const summaryPrefix = fileCount > 1 ? `[Mock Mode — ${fileCount} files]: ` : '[Mock Mode]: ';
      return {
        ...mockResult,
        summary: summaryPrefix + mockResult.summary,
        session_id: `mock_${Date.now()}`,
      };
    }

    const formData = new FormData();
    const filesToUpload = payload.files && payload.files.length > 0 
      ? payload.files 
      : (payload.file ? [payload.file] : []);

    if (filesToUpload.length === 0) {
      throw new Error('No file provided for analysis.');
    }

    // Map frontend analysis modes to backend mode parameter
    // Backend expects: "screenshot" | "circuit" | "document"
    let backendMode = 'screenshot';
    if (payload.analysis_type === 'circuit_analyzer') {
      backendMode = 'circuit';
    } else if (payload.analysis_type === 'document_explainer') {
      backendMode = 'document';
    } else {
      backendMode = 'screenshot';
    }

    // Send required backend fields: 'mode' and 'file'
    formData.append('mode', backendMode);
    formData.append('file', filesToUpload[0]);

    if (payload.question) {
      formData.append('question', payload.question);
      formData.append('context', payload.question);
    }

    // Backward-compatibility fields in case backend router accepts them
    formData.append('analysis_type', payload.analysis_type);
    filesToUpload.forEach((f) => {
      formData.append('files', f);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const combinedSignal = externalSignal || controller.signal;

    try {
      const response = await fetch(`${BASE_URL}/api/analyze`, {
        method: 'POST',
        body: formData,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail;
        const errorMsg = typeof detail === 'object' && detail !== null
          ? detail.message || JSON.stringify(detail)
          : detail || errorData.message || `Backend returned error ${response.status}: ${response.statusText}`;
        throw new Error(errorMsg);
      }

      const json = await response.json();

      if (!json || typeof json !== 'object') {
        throw new Error('Invalid response structure: Expected JSON object from backend.');
      }

      // Check if response is wrapped in standard backend envelope: { mode: string, result: {...}, warnings?: string[] }
      if (json.result && typeof json.result === 'object') {
        return this.adaptBackendEnvelope(json, payload.analysis_type);
      }

      // Fallback for direct AnalysisResult payloads
      if (!json.summary) {
        throw new Error('Invalid analysis response: Missing required "summary" field.');
      }

      return {
        ...json,
        analysis_type: json.analysis_type || payload.analysis_type,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Analysis request timed out after 60 seconds. The AI inference pipeline may still be processing.');
      }
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Ensure the FastAPI server is accessible and CORS allows requests.`);
      }
      throw err;
    }
  }

  /**
   * Adapts backend response envelopes (ScreenshotAnalysisResponse, CircuitAnalysisResponse, DocumentAnalysisResponse)
   * into the frontend's unified AnalysisResult interface.
   */
  private adaptBackendEnvelope(envelope: any, activeMode: string): AnalysisResult {
    const res = envelope.result || {};
    const warnings: string[] = envelope.warnings || [];

    if (activeMode === 'circuit_analyzer' || envelope.mode === 'circuit') {
      const components = Array.isArray(res.visible_components)
        ? res.visible_components.map((c: any) => ({
            name: c.name || 'Component',
            designator: c.visible_label || undefined,
            description: c.notes || undefined,
          }))
        : [];

      const potentialIssues = Array.isArray(res.possible_issues)
        ? res.possible_issues.map((i: any) =>
            typeof i === 'string' ? i : `${i.issue || ''}: ${i.evidence || ''} (${i.confidence || ''} confidence)`.trim()
          )
        : [];

      return {
        session_id: envelope.session_id || `sess_${Date.now()}`,
        analysis_type: 'circuit_analyzer',
        summary: res.overview || 'Circuit analysis completed.',
        apparent_function: res.overview,
        components_identified: components,
        potential_issues: potentialIssues,
        steps: res.suggested_checks || [],
        uncertainties: [...(res.limitations || []), ...(res.safety_notes || []), ...warnings],
      };
    }

    if (activeMode === 'document_explainer' || envelope.mode === 'document') {
      const keyConcepts = Array.isArray(res.key_points) ? res.key_points : [];
      const formulas = Array.isArray(res.important_terms)
        ? res.important_terms.map((t: any) => `${t.term}: ${t.explanation}`)
        : [];

      return {
        session_id: envelope.session_id || `sess_${Date.now()}`,
        analysis_type: 'document_explainer',
        summary: res.summary || 'Document analysis completed.',
        explanation: res.answer || (res.document_title ? `Source: ${res.document_title}` : undefined),
        key_concepts: keyConcepts,
        formulas_or_definitions: formulas,
        steps: res.source_notes || [],
        uncertainties: [...(res.limitations || []), ...(res.warnings || []), ...warnings],
      };
    }

    // Default: Code Debugger / Screenshot Result
    const likelyCauses = Array.isArray(res.likely_causes)
      ? res.likely_causes.map((c: any) => (typeof c === 'string' ? c : `${c.cause}: ${c.rationale}`)).join('\n')
      : undefined;

    return {
      session_id: envelope.session_id || `sess_${Date.now()}`,
      analysis_type: 'code_debugger',
      summary: res.summary || (res.issue_type ? `Detected ${res.issue_type}` : 'Code analysis completed.'),
      findings: res.observed_evidence || [],
      likely_problem: res.issue_type || (res.likely_causes?.[0]?.cause) || undefined,
      explanation: likelyCauses,
      suggested_solution: res.debugging_steps?.[0] || undefined,
      steps: res.debugging_steps || res.verification_steps || [],
      uncertainties: [...(res.limitations || []), ...warnings],
    };
  }

  /**
   * Send follow-up contextual questions to the active session.
   */
  async sendChatMessage(
    payload: ChatRequestPayload,
    useMockFallback = false,
    externalSignal?: AbortSignal
  ): Promise<ChatResponsePayload> {
    if (useMockFallback) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mode = payload.analysis_type || 'code_debugger';
      const answers = MOCK_CHAT_RESPONSES[mode] || MOCK_CHAT_RESPONSES.code_debugger;
      const randomAnswer = answers[Math.floor(Math.random() * answers.length)];
      return {
        session_id: payload.session_id,
        answer: randomAnswer,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const combinedSignal = externalSignal || controller.signal;

    try {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // If the backend has not implemented /api/chat yet, provide an informative error
        if (response.status === 404 || response.status === 405) {
          throw new Error('Interactive chat endpoint (/api/chat) is not yet supported by the deployed backend.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail ||
          errorData.message ||
          `Chat request failed with status ${response.status}: ${response.statusText}`
        );
      }

      const json = await response.json();
      if (!json || typeof json.answer !== 'string') {
        throw new Error('Invalid response from chat endpoint: Expected "answer" string.');
      }

      return json;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Chat request timed out after 60 seconds.');
      }
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}.`);
      }
      throw err;
    }
  }
}

export const apiService = new ApiService();
