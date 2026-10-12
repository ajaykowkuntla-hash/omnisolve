import { useState, useCallback, useEffect } from 'react';
import { AnalysisMode, AnalysisResult } from '../types/analysis';
import { validateFileForMode } from '../utils/fileValidation';
import { MAX_FILES_COUNT, MAX_TOTAL_FILES_SIZE_BYTES } from '../config/supportedFiles';
import { apiService } from '../services/api';

export type AnalysisStatus = 'idle' | 'validating' | 'analyzing' | 'success' | 'error';

export function useAnalysis(isBackendOnline: boolean) {
  const [activeMode, setActiveMode] = useState<AnalysisMode>('code_debugger');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Explicit user mock mode toggle. Defaults to false (live backend mode).
  const [isMockMode, setIsMockMode] = useState<boolean>(false);

  // Clean up object URLs to prevent browser memory leaks
  const cleanupPreviewUrls = useCallback(() => {
    Object.values(previewUrls).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    setPreviewUrls({});
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      cleanupPreviewUrls();
    };
  }, [cleanupPreviewUrls]);

  const addFiles = useCallback(
    (files: File[]): boolean => {
      setValidationError(null);
      if (!files.length) return false;

      // Check max file count
      const existingNames = new Set(selectedFiles.map((f) => `${f.name}-${f.size}`));
      const newFiles = files.filter((f) => !existingNames.has(`${f.name}-${f.size}`));

      if (newFiles.length === 0) {
        setValidationError('Selected file(s) are already attached.');
        return false;
      }

      if (selectedFiles.length + newFiles.length > MAX_FILES_COUNT) {
        setValidationError(`You can attach up to ${MAX_FILES_COUNT} files simultaneously.`);
        return false;
      }

      // Check each file against mode rules
      for (const file of newFiles) {
        const validation = validateFileForMode(file, activeMode);
        if (!validation.isValid) {
          setValidationError(validation.errorMessage || 'Invalid file');
          return false;
        }
      }

      // Check total combined size
      const currentTotal = selectedFiles.reduce((acc, f) => acc + f.size, 0);
      const newTotal = newFiles.reduce((acc, f) => acc + f.size, 0);
      if (currentTotal + newTotal > MAX_TOTAL_FILES_SIZE_BYTES) {
        setValidationError('Total upload size exceeds 50MB limit.');
        return false;
      }

      // Create previews for images
      const nextPreviews: Record<string, string> = { ...previewUrls };
      newFiles.forEach((file) => {
        if (file.type.startsWith('image/')) {
          nextPreviews[`${file.name}-${file.size}`] = URL.createObjectURL(file);
        }
      });
      setPreviewUrls(nextPreviews);

      setSelectedFiles((prev) => [...prev, ...newFiles]);
      return true;
    },
    [selectedFiles, activeMode, previewUrls]
  );

  const removeFile = useCallback(
    (fileName: string, fileSize: number) => {
      const key = `${fileName}-${fileSize}`;
      if (previewUrls[key]) {
        URL.revokeObjectURL(previewUrls[key]);
        const next = { ...previewUrls };
        delete next[key];
        setPreviewUrls(next);
      }
      setSelectedFiles((prev) => prev.filter((f) => !(f.name === fileName && f.size === fileSize)));
      setValidationError(null);
    },
    [previewUrls]
  );

  const clearFiles = useCallback(() => {
    cleanupPreviewUrls();
    setSelectedFiles([]);
    setValidationError(null);
    if (status !== 'analyzing') {
      setStatus('idle');
    }
  }, [cleanupPreviewUrls, status]);

  const switchMode = useCallback(
    (newMode: AnalysisMode) => {
      setActiveMode(newMode);
      // Re-validate existing files if any
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          const validation = validateFileForMode(file, newMode);
          if (!validation.isValid) {
            setValidationError(
              `Attached file "${file.name}" is incompatible with ${newMode}. Please review your attachments.`
            );
            return;
          }
        }
        setValidationError(null);
      }
    },
    [selectedFiles]
  );

  const runAnalysis = useCallback(
    async (customQuestion?: string, filesOverride?: File[]) => {
      const filesToUse = filesOverride || selectedFiles;
      if (!filesToUse.length) {
        setValidationError('Please select or drop at least one file before starting analysis.');
        return;
      }

      // If user is trying live mode but backend is known offline, inform them explicitly
      if (!isMockMode && !isBackendOnline) {
        setErrorMessage(
          'Backend service is currently offline. Please verify that the FastAPI backend at https://omnisolve-backend.onrender.com is running, or toggle "Mock UI Mode" in the sidebar to preview frontend features.'
        );
        setStatus('error');
        return;
      }

      setStatus('analyzing');
      setErrorMessage(null);

      try {
        const analysisData = await apiService.analyzeFile(
          {
            file: filesToUse[0],
            files: filesToUse,
            analysis_type: activeMode,
            question: customQuestion,
          },
          isMockMode
        );

        setResult(analysisData);
        setSessionId(analysisData.session_id || `sess_${Date.now()}`);
        setStatus('success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Analysis failed. Please check the backend connection or try again.';
        setErrorMessage(msg);
        setStatus('error');
      }
    },
    [selectedFiles, activeMode, isMockMode, isBackendOnline]
  );

  const resetAll = useCallback(() => {
    cleanupPreviewUrls();
    setSelectedFiles([]);
    setValidationError(null);
    setResult(null);
    setSessionId(null);
    setErrorMessage(null);
    setStatus('idle');
  }, [cleanupPreviewUrls]);

  return {
    activeMode,
    switchMode,
    selectedFiles,
    previewUrls,
    validationError,
    setValidationError,
    status,
    result,
    sessionId,
    errorMessage,
    isMockMode,
    setIsMockMode,
    addFiles,
    removeFile,
    clearFiles,
    runAnalysis,
    resetAll,
  };
}

