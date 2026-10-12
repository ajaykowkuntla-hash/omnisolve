import React, { useState, useRef, useEffect } from 'react';
import { 
  Paperclip, 
  Send, 
  Bot, 
  User, 
  X, 
  FileText, 
  Image as ImageIcon, 
  AlertCircle, 
  Plus,
  ChevronRight,
  Menu,
  Folder,
  Sliders
} from 'lucide-react';
import { AnalysisMode } from '../../types/analysis';
import { ChatMessage } from '../../types/chat';
import { Project, Conversation } from '../../types/project';
import { ANALYSIS_MODES, MAX_FILE_SIZE_BYTES, MAX_FILES_COUNT, MAX_TOTAL_FILES_SIZE_BYTES } from '../../config/supportedFiles';
import { formatFileSize, validateFileForMode } from '../../utils/fileValidation';
import { StructuredResultViewer } from '../analysis/StructuredResultViewer';
import { AppSidebar } from './AppSidebar';

interface ConversationalWorkspaceProps {
  projects: Project[];
  conversations: Conversation[];
  activeProjectId: string | null;
  activeConversationId: string | null;
  activeMode: AnalysisMode;
  onSelectProject: (projectId: string | null) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectMode: (mode: AnalysisMode) => void;
  messages: ChatMessage[];
  isWaiting: boolean;
  chatError: string | null;
  isOnline: boolean;
  isMockMode: boolean;
  onToggleMockMode: () => void;
  onSendMessage: (text: string, files?: File[]) => Promise<void>;
  onRetryMessage: () => void;
  onNewChat: () => void;
  onNewProjectChat: (projectId: string) => void;
  onOpenCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onRenameConversation: (conversation: Conversation) => void;
  onDeleteConversation: (conversation: Conversation) => void;
  onMoveConversation: (conversation: Conversation, targetProjectId: string | null) => void;
}

export const ConversationalWorkspace: React.FC<ConversationalWorkspaceProps> = ({
  projects,
  conversations,
  activeProjectId,
  activeConversationId,
  activeMode,
  onSelectProject,
  onSelectConversation,
  onSelectMode,
  messages,
  isWaiting,
  chatError,
  isOnline,
  isMockMode,
  onToggleMockMode,
  onSendMessage,
  onRetryMessage,
  onNewChat,
  onNewProjectChat,
  onOpenCreateProject,
  onEditProject,
  onDeleteProject,
  onRenameConversation,
  onDeleteConversation,
  onMoveConversation,
}) => {
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const modeConfig = ANALYSIS_MODES[activeMode];
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Clean up object URLs when unmounting or clearing
  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // Mode suggested prompts
  const getModePrompts = () => {
    switch (activeMode) {
      case 'code_debugger':
        return [
          'Find and explain errors',
          'Explain how this code works',
          'Suggest the smallest possible fix',
          'Trace issue across multiple files',
        ];
      case 'circuit_analyzer':
        return [
          'Explain how this circuit works',
          'Identify potential wiring mistakes',
          'Compare these two schematic sections',
          'Investigate a circuit problem',
        ];
      case 'document_explainer':
        return [
          'Compare key differences between these documents',
          'Summarize all uploaded files',
          'Extract important formulas & definitions',
          'Help prepare for a viva',
        ];
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isWaiting]);

  // Handle adding multiple files
  const handleFiles = (incomingFiles: FileList | File[]) => {
    setValidationError(null);
    const filesArray = Array.from(incomingFiles);
    if (!filesArray.length) return;

    // Check duplicate attachments by name + size
    const existingKeys = new Set(attachedFiles.map((f) => `${f.name}-${f.size}`));
    const newUniqueFiles = filesArray.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));

    if (newUniqueFiles.length === 0) {
      setValidationError('Selected file(s) are already attached.');
      return;
    }

    if (attachedFiles.length + newUniqueFiles.length > MAX_FILES_COUNT) {
      setValidationError(`You can attach up to ${MAX_FILES_COUNT} files simultaneously.`);
      return;
    }

    // Validate each file against mode rules
    for (const file of newUniqueFiles) {
      const validation = validateFileForMode(file, activeMode);
      if (!validation.isValid) {
        setValidationError(validation.errorMessage || 'Incompatible file.');
        return;
      }
    }

    // Validate combined total size
    const currentTotal = attachedFiles.reduce((acc, f) => acc + f.size, 0);
    const newTotal = newUniqueFiles.reduce((acc, f) => acc + f.size, 0);
    if (currentTotal + newTotal > MAX_TOTAL_FILES_SIZE_BYTES) {
      setValidationError(`Total upload size exceeds ${formatFileSize(MAX_TOTAL_FILES_SIZE_BYTES)}.`);
      return;
    }

    // Generate previews for images
    const nextPreviews = { ...previewUrls };
    newUniqueFiles.forEach((file) => {
      if (file.type.startsWith('image/')) {
        nextPreviews[`${file.name}-${file.size}`] = URL.createObjectURL(file);
      }
    });
    setPreviewUrls(nextPreviews);

    setAttachedFiles((prev) => [...prev, ...newUniqueFiles]);
  };

  const removeAttachedFile = (fileName: string, fileSize: number) => {
    const key = `${fileName}-${fileSize}`;
    if (previewUrls[key]) {
      URL.revokeObjectURL(previewUrls[key]);
      const nextPreviews = { ...previewUrls };
      delete nextPreviews[key];
      setPreviewUrls(nextPreviews);
    }
    setAttachedFiles((prev) => prev.filter((f) => !(f.name === fileName && f.size === fileSize)));
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearAllAttachedFiles = () => {
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    setPreviewUrls({});
    setAttachedFiles([]);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isWaiting) return;
    
    const text = inputText.trim();
    if (!text && attachedFiles.length === 0) return;

    const filesToSend = [...attachedFiles];
    let defaultPrompt = '';
    if (filesToSend.length === 1) {
      defaultPrompt = `Please analyze this ${filesToSend[0].name} artifact.`;
    } else if (filesToSend.length > 1) {
      defaultPrompt = `Please analyze these ${filesToSend.length} attached files (${filesToSend.map((f) => f.name).join(', ')}).`;
    }
    const textToSend = text || defaultPrompt;

    // Reset local composer
    setInputText('');
    clearAllAttachedFiles();

    await onSendMessage(textToSend, filesToSend.length > 0 ? filesToSend : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#080C12] text-white overflow-hidden font-sans">
      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* SIDEBAR: Modern, Minimal Verity Aesthetic (Desktop)                    */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div className="hidden md:flex h-full shrink-0">
        <AppSidebar
          projects={projects}
          conversations={conversations}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          activeMode={activeMode}
          isOnline={isOnline}
          isMockMode={isMockMode}
          onSelectProject={onSelectProject}
          onSelectConversation={onSelectConversation}
          onSelectMode={onSelectMode}
          onNewChat={() => {
            clearAllAttachedFiles();
            onNewChat();
          }}
          onOpenCreateProject={onOpenCreateProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
          onRenameConversation={onRenameConversation}
          onDeleteConversation={onDeleteConversation}
          onMoveConversation={onMoveConversation}
          onToggleMockMode={onToggleMockMode}
        />
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileSidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div 
            className="w-72 h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <AppSidebar
              projects={projects}
              conversations={conversations}
              activeProjectId={activeProjectId}
              activeConversationId={activeConversationId}
              activeMode={activeMode}
              isOnline={isOnline}
              isMockMode={isMockMode}
              onSelectProject={(id) => {
                onSelectProject(id);
                setMobileSidebarOpen(false);
              }}
              onSelectConversation={(id) => {
                onSelectConversation(id);
                setMobileSidebarOpen(false);
              }}
              onSelectMode={(mode) => {
                onSelectMode(mode);
                setMobileSidebarOpen(false);
              }}
              onNewChat={() => {
                clearAllAttachedFiles();
                onNewChat();
                setMobileSidebarOpen(false);
              }}
              onOpenCreateProject={() => {
                onOpenCreateProject();
                setMobileSidebarOpen(false);
              }}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
              onRenameConversation={onRenameConversation}
              onDeleteConversation={onDeleteConversation}
              onMoveConversation={onMoveConversation}
              onToggleMockMode={onToggleMockMode}
            />
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* MAIN CONVERSATION CANVAS                                              */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div 
        className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#06090E]"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Verity illuminated vertical lines background */}
        <div className={`verity-bg-lines ${messages.length > 0 ? 'in-conversation' : ''}`} />

        {/* Top Navbar */}
        <header className="h-14 border-b border-white/[0.08] bg-[#06090E]/85 backdrop-blur-2xl px-4 sm:px-6 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 rounded-lg text-[#94A0B8] hover:text-white hover:bg-white/[0.06] md:hidden cursor-pointer"
              title="Open Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-sm text-white tracking-tight">{modeConfig.name}</span>
              {activeProject && (
                <span className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-[#21D2ED]/10 border border-[#21D2ED]/30 text-[#21D2ED] text-xs font-mono">
                  <Folder className="w-3 h-3" />
                  <span>{activeProject.name}</span>
                </span>
              )}
            </div>
            <span className="text-xs text-[#94A0B8] hidden lg:inline">• {modeConfig.tagline}</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                clearAllAttachedFiles();
                onNewChat();
              }}
              className="verity-btn-secondary text-xs px-3.5 py-1.5 flex items-center space-x-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-[#21D2ED]" />
              <span>New Chat</span>
            </button>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] text-[#94A0B8] border border-white/[0.08]">
              {modeConfig.badge}
            </span>
          </div>
        </header>

        {/* PROJECT WORKSPACE BANNER (Shown when viewing a project) */}
        {activeProject && (
          <div className="bg-[#0B101A]/90 backdrop-blur-xl border-b border-white/[0.08] px-4 sm:px-6 py-3.5 shrink-0 z-10 animate-fade-in">
            <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Folder className="w-4 h-4 text-[#21D2ED]" />
                  <h2 className="text-sm font-semibold text-white tracking-tight">{activeProject.name}</h2>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-[#94A0B8]">
                    {conversations.filter((c) => c.projectId === activeProject.id).length} chats
                  </span>
                </div>
                {activeProject.description && (
                  <p className="text-xs text-[#94A0B8] line-clamp-1">{activeProject.description}</p>
                )}
                {activeProject.instructions && (
                  <div className="flex items-center space-x-1.5 text-[11px] text-[#21D2ED]/80 font-mono mt-0.5">
                    <Sliders className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-md">Instructions: "{activeProject.instructions}"</span>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => onEditProject(activeProject)}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-[#94A0B8] hover:text-white transition-colors cursor-pointer"
                >
                  Settings
                </button>
                <button
                  onClick={() => {
                    clearAllAttachedFiles();
                    onNewProjectChat(activeProject.id);
                  }}
                  className="px-3 py-1 rounded-lg bg-[#21D2ED]/10 hover:bg-[#21D2ED]/20 border border-[#21D2ED]/30 text-xs text-[#21D2ED] font-medium transition-colors cursor-pointer flex items-center space-x-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>New Chat in Project</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 relative z-10">
          {/* Chat Error alert banner if any */}
          {chatError && (
            <div className="max-w-2xl mx-auto p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{chatError}</span>
              </div>
              <button
                onClick={onRetryMessage}
                className="underline text-rose-200 hover:text-white cursor-pointer ml-2 text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {/* Drag Overlay Feedback */}
          {isDragging && (
            <div className="absolute inset-4 z-30 rounded-2xl border-2 border-dashed border-[#21D2ED] bg-[#06090E]/95 backdrop-blur-xl flex flex-col items-center justify-center pointer-events-none">
              <Paperclip className="w-10 h-10 text-[#21D2ED] animate-bounce mb-2" />
              <p className="text-sm font-medium text-white">Drop your files to attach to OmniSolve</p>
              <p className="text-xs text-[#94A0B8] mt-1 font-mono">
                Accepts {modeConfig.allowedExtensions.join(', ')} • Up to {MAX_FILES_COUNT} files (max {formatFileSize(MAX_TOTAL_FILES_SIZE_BYTES)})
              </p>
            </div>
          )}

          {/* EMPTY STATE / WELCOME SCREEN (VERITY EXPRESSIVE HERO) */}
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto py-16 sm:py-24 text-center space-y-8 animate-hero-enter">
              <div className="space-y-4">
                {/* Eyebrow Label */}
                <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.09] text-white/80 text-xs font-mono tracking-tight shadow-sm backdrop-blur-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#21D2ED] animate-pulse" />
                  <span>
                    {activeProject ? `Project Workspace: ${activeProject.name}` : modeConfig.badge}
                  </span>
                </div>

                {/* Expressive Lightweight Headline */}
                <h1 className="text-4xl sm:text-5xl font-light tracking-[-0.035em] text-white leading-[1.12] max-w-xl mx-auto">
                  {activeProject 
                    ? `Solve in ${activeProject.name}` 
                    : activeMode === 'code_debugger'
                    ? 'Complex code. Clear solutions.'
                    : activeMode === 'circuit_analyzer'
                    ? 'Understand every connection.'
                    : 'Your documents, explained clearly.'}
                </h1>

                {/* Subtitle */}
                <p className="text-sm sm:text-base text-[#94A0B8] max-w-lg mx-auto leading-relaxed font-normal">
                  {activeProject?.description 
                    ? activeProject.description
                    : activeMode === 'code_debugger'
                    ? 'Attach runtime errors, stack tracebacks, or source files. Pinpoint root causes and receive concise fixes.'
                    : activeMode === 'circuit_analyzer'
                    ? 'Upload schematic diagrams, PCB images, or breadboard snapshots. Trace nets, check pinouts, and identify wiring flaws.'
                    : 'Upload technical documents, lab manuals, or notes. Get clear explanations, useful summaries, and key insights.'}
                </p>
              </div>

              {/* Mode-specific Suggestion Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto text-left pt-2">
                {getModePrompts().map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputText(prompt);
                      textareaRef.current?.focus();
                    }}
                    className="p-3.5 rounded-2xl bg-white/[0.025] hover:bg-white/[0.07] border border-white/[0.07] hover:border-white/[0.18] backdrop-blur-sm transition-all flex items-center justify-between group cursor-pointer shadow-sm"
                  >
                    <span className="text-xs text-[#94A0B8] group-hover:text-white transition-colors">{prompt}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#64748B] group-hover:text-[#21D2ED] group-hover:translate-x-0.5 transition-all shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* MESSAGE LIST */}
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const isSystem = msg.sender === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="max-w-2xl mx-auto">
                  <div className="p-3.5 rounded-2xl bg-rose-950/20 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{msg.content}</span>
                    </div>
                    <button
                      onClick={onRetryMessage}
                      className="text-xs underline text-rose-200 hover:text-white cursor-pointer ml-2"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              );
            }

            // Normalise single vs multiple attachments for display
            const allAttachments = msg.attachments && msg.attachments.length > 0 
              ? msg.attachments 
              : (msg.attachment ? [msg.attachment] : []);

            return (
              <div key={msg.id} className="max-w-2xl mx-auto space-y-3">
                <div className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    isUser
                      ? 'bg-white text-[#080C12]'
                      : 'bg-white/[0.06] border border-white/[0.08] text-[#21D2ED]'
                  }`}>
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  {/* Message Bubble & Content */}
                  <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : ''}`}>
                    {/* Attached Files List/Grid */}
                    {allAttachments.length > 0 && (
                      <div className="space-y-2">
                        {allAttachments.map((att, attIdx) => (
                          <div key={att.id || `${att.name}-${attIdx}`} className="p-3 rounded-2xl bg-[#0E131F] border border-white/[0.08] space-y-2">
                            <div className="flex items-center space-x-2.5">
                              {att.type.startsWith('image/') ? (
                                <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />
                              ) : (
                                <FileText className="w-4 h-4 text-[#21D2ED] shrink-0" />
                              )}
                              <div className="truncate">
                                <p className="text-xs font-medium text-white truncate">{att.name}</p>
                                <span className="text-[10px] text-[#94A0B8] font-mono">{formatFileSize(att.size)}</span>
                              </div>
                            </div>

                            {att.previewUrl && (
                              <div className="max-h-56 overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 p-1">
                                <img
                                  src={att.previewUrl}
                                  alt="Attachment preview"
                                  className="max-h-52 object-contain rounded-lg mx-auto"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Text content */}
                    {msg.content && (
                      <div className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                        isUser
                          ? 'bg-white text-[#080C12] font-normal rounded-tr-sm shadow-sm'
                          : msg.isError
                          ? 'bg-rose-950/40 border border-rose-500/40 text-rose-200 rounded-tl-sm'
                          : 'verity-card text-white/90 rounded-tl-sm'
                      }`}>
                        {msg.isError && (
                          <div className="flex items-center space-x-1.5 text-rose-400 font-mono text-[11px] mb-1.5 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Diagnostic Error</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    )}

                    {/* Rich Diagnostic Analysis Result (When Available from Gemma) */}
                    {msg.analysisResult && (
                      <div className="mt-3">
                        <StructuredResultViewer
                          result={msg.analysisResult}
                          activeMode={activeMode}
                          onRetry={onRetryMessage}
                        />
                      </div>
                    )}

                    <span className={`text-[10px] block font-mono ${isUser ? 'text-[#64748B] text-right' : 'text-[#64748B]'}`}>
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Waiting indicator */}
          {isWaiting && (
            <div className="max-w-2xl mx-auto flex items-start space-x-3">
              <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[#21D2ED] shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="p-3.5 rounded-2xl verity-card flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#21D2ED] animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#21D2ED] animate-bounce delay-100" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#21D2ED] animate-bounce delay-200" />
                <span className="text-xs text-[#94A0B8] ml-2 font-mono">Running technical diagnostic...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ────────────────────────────────────────────────────────────────────── */}
        {/* COMPOSER: ChatGPT-Style with Multi-Attachment Drop & Submit           */}
        {/* ────────────────────────────────────────────────────────────────────── */}
        <div className="p-4 sm:p-6 bg-[#080C12]/95 border-t border-white/[0.08] shrink-0">
          <div className="max-w-2xl mx-auto space-y-2.5">
            {/* Validation alert */}
            {validationError && (
              <div className="p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{validationError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setValidationError(null)}
                  className="text-rose-300 hover:text-white ml-2 text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Attached file chips preview above composer */}
            {attachedFiles.length > 0 && (
              <div className="space-y-1.5 animate-fade-in">
                <div className="flex items-center justify-between px-1 text-[11px] font-mono text-[#94A0B8]">
                  <span>Attached Files ({attachedFiles.length}/{MAX_FILES_COUNT})</span>
                  <button
                    type="button"
                    onClick={clearAllAttachedFiles}
                    className="text-[#64748B] hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1.5 rounded-2xl bg-[#0E131F] border border-white/[0.12] shadow-lg">
                  {attachedFiles.map((file) => {
                    const key = `${file.name}-${file.size}`;
                    const isImg = file.type.startsWith('image/');
                    return (
                      <div
                        key={key}
                        className="flex items-center space-x-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] max-w-[220px] group transition-colors hover:border-white/20"
                      >
                        {isImg ? (
                          <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-[#21D2ED] shrink-0" />
                        )}
                        <div className="truncate flex-1 min-w-0">
                          <span className="text-xs font-medium text-white truncate block" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[9px] text-[#94A0B8] font-mono block">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachedFile(file.name, file.size)}
                          className="p-1 rounded-full hover:bg-white/[0.12] text-[#94A0B8] hover:text-white transition-colors cursor-pointer shrink-0"
                          title="Remove file"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Main Input Form */}
            <form onSubmit={handleSubmit} className="relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={modeConfig.allowedExtensions.join(',')}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFiles(e.target.files);
                  }
                }}
                className="hidden"
              />

              <div className="rounded-2xl border border-white/[0.12] focus-within:border-white/30 bg-[#0E131F] p-2 flex flex-col transition-all shadow-xl">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    attachedFiles.length > 0
                      ? `Attached ${attachedFiles.length} file(s). Ask what you'd like me to solve across them...`
                      : activeProject
                      ? `Message ${activeProject.name} or drop files (${modeConfig.name})...`
                      : `Message OmniSolve or drop files (${modeConfig.name})...`
                  }
                  rows={2}
                  className="w-full bg-transparent px-3 py-1.5 text-xs sm:text-sm text-white placeholder-[#64748B] resize-none focus:outline-none"
                />

                <div className="flex items-center justify-between pt-1.5 px-2 border-t border-white/[0.04]">
                  {/* Attachment action button */}
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-xl text-[#94A0B8] hover:text-white hover:bg-white/[0.06] transition-colors flex items-center space-x-1.5 cursor-pointer text-xs"
                      title="Attach files (multiple supported)"
                    >
                      <Paperclip className="w-4 h-4" />
                      <span className="hidden sm:inline">Attach Files</span>
                    </button>
                    <span className="text-[10px] font-mono text-[#64748B] hidden sm:inline">
                      (Max {MAX_FILES_COUNT} files, {formatFileSize(MAX_FILE_SIZE_BYTES)} each)
                    </span>
                  </div>

                  {/* Submit send button */}
                  <button
                    type="submit"
                    disabled={isWaiting || (!inputText.trim() && attachedFiles.length === 0)}
                    className="p-2 rounded-xl bg-white text-[#080C12] hover:bg-slate-200 disabled:opacity-25 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                  >
                    <Send className="w-4 h-4 stroke-[2]" />
                  </button>
                </div>
              </div>
            </form>

            <p className="text-[10px] text-[#64748B] font-mono text-center">
              {activeConversation ? `Chat: ${activeConversation.title}` : 'OmniSolve AI'} • Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};


