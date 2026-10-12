import React, { useState, useEffect, useCallback } from 'react';
import { useBackendHealth } from './hooks/useBackendHealth';
import { useAnalysis } from './hooks/useAnalysis';
import { useChat } from './hooks/useChat';
import { LandingView } from './components/workflow/LandingView';
import { ConversationalWorkspace } from './components/chat/ConversationalWorkspace';
import { ProjectModal } from './components/chat/ProjectModal';
import { storageService } from './services/storageService';
import { Project, Conversation } from './types/project';
import { ChatMessage } from './types/chat';

export function App() {
  const { isOnline } = useBackendHealth();
  const [inChatWorkspace, setInChatWorkspace] = useState<boolean>(true);

  // Projects & Conversations State
  const [projects, setProjects] = useState<Project[]>(() => storageService.getProjects());
  const [conversations, setConversations] = useState<Conversation[]>(() => storageService.getConversations());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Project Modal State
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const {
    activeMode,
    switchMode,
    status,
    result,
    sessionId,
    errorMessage: analysisError,
    isMockMode,
    setIsMockMode,
    runAnalysis,
    resetAll,
  } = useAnalysis(isOnline);

  const {
    messages,
    setMessages,
    isWaiting: isWaitingChat,
    chatError,
    sendMessage,
    retryLastMessage,
    resetChat,
  } = useChat(sessionId, activeMode, isMockMode);

  // Save projects on update
  useEffect(() => {
    storageService.saveProjects(projects);
  }, [projects]);

  // Save conversations on update
  useEffect(() => {
    storageService.saveConversations(conversations);
  }, [conversations]);

  // Sync active conversation's messages into memory when switching conversations
  const handleSelectConversation = useCallback(
    (convId: string) => {
      const target = conversations.find((c) => c.id === convId);
      if (!target) return;

      setActiveConversationId(target.id);
      // Strictly set activeProjectId to conversation's projectId or null if independent
      setActiveProjectId(target.projectId || null);
      switchMode(target.analysisMode);
      setMessages(target.messages || []);
    },
    [conversations, switchMode, setMessages]
  );

  // Switch or select a project workspace
  const handleSelectProject = useCallback(
    (projId: string | null) => {
      setActiveProjectId(projId);
      if (projId) {
        const projectChats = conversations.filter((c) => c.projectId === projId);
        if (projectChats.length > 0) {
          handleSelectConversation(projectChats[0].id);
        } else {
          // Open fresh uninitialized conversation in project
          resetAll();
          resetChat();
          setActiveConversationId(null);
        }
      } else {
        // If unselecting project, start independent chat
        resetAll();
        resetChat();
        setActiveConversationId(null);
      }
    },
    [conversations, handleSelectConversation, resetAll, resetChat]
  );

  // Start an INDEPENDENT new chat (clears active project context completely)
  const handleStartIndependentChat = useCallback(() => {
    setActiveProjectId(null);
    setActiveConversationId(null);
    resetAll();
    resetChat();
  }, [resetAll, resetChat]);

  // Start a new chat SCOPED to a specific project
  const handleStartProjectChat = useCallback(
    (projectId: string) => {
      setActiveProjectId(projectId);
      setActiveConversationId(null);
      resetAll();
      resetChat();
    },
    [resetAll, resetChat]
  );

  // Create or Update Project
  const handleSaveProject = (data: { name: string; description: string; instructions: string }) => {
    const now = Date.now();
    if (editingProject) {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === editingProject.id
            ? { ...p, name: data.name, description: data.description, instructions: data.instructions, updatedAt: now }
            : p
        )
      );
      setEditingProject(null);
    } else {
      const newProj: Project = {
        id: `proj_${now}`,
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        createdAt: now,
        updatedAt: now,
      };
      setProjects((prev) => [newProj, ...prev]);
      setActiveProjectId(newProj.id);
      handleStartProjectChat(newProj.id);
    }
  };

  // Delete project safely (unassigns conversations rather than deleting user history)
  const handleDeleteProject = (project: Project) => {
    const confirmed = window.confirm(
      `Delete project "${project.name}"?\n\nNote: Conversations inside this project will be preserved as unassigned Recent Chats.`
    );
    if (!confirmed) return;

    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    setConversations((prev) =>
      prev.map((c) => (c.projectId === project.id ? { ...c, projectId: undefined } : c))
    );
    if (activeProjectId === project.id) {
      handleStartIndependentChat();
    }
  };

  // Rename a conversation
  const handleRenameConversation = (conv: Conversation) => {
    const newTitle = window.prompt('Enter new title for conversation:', conv.title);
    if (newTitle && newTitle.trim()) {
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, title: newTitle.trim(), updatedAt: Date.now() } : c))
      );
    }
  };

  // Delete a conversation
  const handleDeleteConversation = (conv: Conversation) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${conv.title}"?`);
    if (!confirmed) return;

    setConversations((prev) => prev.filter((c) => c.id !== conv.id));
    if (activeConversationId === conv.id) {
      handleStartIndependentChat();
    }
  };

  // Move or assign conversation to project
  const handleMoveConversation = (conv: Conversation, targetProjectId: string | null) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conv.id
          ? { ...c, projectId: targetProjectId || undefined, updatedAt: Date.now() }
          : c
      )
    );
    if (activeConversationId === conv.id) {
      setActiveProjectId(targetProjectId || null);
    }
  };

  // Helper to persist updated message stream into active or new conversation
  const persistMessagesToConversation = useCallback(
    (newMessages: ChatMessage[], firstQuestion?: string) => {
      const now = Date.now();
      let convId = activeConversationId;

      if (!convId) {
        // Generate new conversation
        convId = `conv_${now}`;
        const autoTitle = firstQuestion
          ? firstQuestion.slice(0, 42) + (firstQuestion.length > 42 ? '...' : '')
          : 'New Conversation';

        const newConv: Conversation = {
          id: convId,
          title: autoTitle,
          projectId: activeProjectId || undefined,
          analysisMode: activeMode,
          sessionId: sessionId || undefined,
          messages: newMessages,
          createdAt: now,
          updatedAt: now,
        };

        setActiveConversationId(convId);
        setConversations((prev) => [newConv, ...prev]);
      } else {
        // Update existing conversation
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: newMessages,
                  analysisMode: activeMode,
                  updatedAt: now,
                }
              : c
          )
        );
      }
    },
    [activeConversationId, activeProjectId, activeMode, sessionId]
  );

  // Primary send handler: Handles multi-file upload + initial analysis, or contextual follow-up chat
  const handleSendMessageWithOptionalFiles = async (text: string, files?: File[]) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. If files are attached, run multi-file analysis request (POST /api/analyze)
    if (files && files.length > 0) {
      const attachments = files.map((file) => ({
        id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));

      const userMsg: ChatMessage = {
        id: `msg_u_${Date.now()}`,
        sender: 'user',
        content: text,
        timestamp,
        attachments,
        attachment: attachments[0], // backward compatibility
      };

      const updated = [...messages, userMsg];
      setMessages(updated);
      persistMessagesToConversation(updated, text);

      // Call analysis endpoint with all files
      await runAnalysis(text, files);
      return;
    }

    // 2. If no files attached, send follow-up message to active chat session (POST /api/chat)
    const userMsg: ChatMessage = {
      id: `msg_u_${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp,
    };
    const updated = [...messages, userMsg];
    persistMessagesToConversation(updated, text);

    await sendMessage(text);
  };

  // Synchronize successful analysis result or failure from Gemma into conversation message stream
  useEffect(() => {
    if (status === 'success' && result) {
      const alreadyHasResult = messages.some((m) => m.analysisResult === result);
      if (!alreadyHasResult) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const assistantMsg: ChatMessage = {
          id: `msg_a_${Date.now()}`,
          sender: 'assistant',
          content: result.summary,
          timestamp,
          analysisResult: result,
        };
        const next = [...messages, assistantMsg];
        setMessages(next);
        persistMessagesToConversation(next);
      }
    } else if (status === 'error' && analysisError) {
      const alreadyHasError = messages.some((m) => m.isError && m.content === analysisError);
      if (!alreadyHasError) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const errorMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          sender: 'assistant',
          content: analysisError,
          timestamp,
          isError: true,
        };
        const next = [...messages, errorMsg];
        setMessages(next);
        persistMessagesToConversation(next);
      }
    }
  }, [status, result, analysisError, setMessages, messages, persistMessagesToConversation]);

  // Synchronize assistant chat message updates into saved conversation
  useEffect(() => {
    if (activeConversationId && messages.length > 0) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages, updatedAt: Date.now() }
            : c
        )
      );
    }
  }, [messages, activeConversationId]);

  return (
    <div className="min-h-screen bg-[#06090E] text-white relative overflow-hidden">
      {!inChatWorkspace ? (
        <div className="p-6 relative">
          <div className="verity-bg-lines" />
          <div className="relative z-10">
            <LandingView onStart={() => setInChatWorkspace(true)} />
          </div>
        </div>
      ) : (
        <>
          <ConversationalWorkspace
            projects={projects}
            conversations={conversations}
            activeProjectId={activeProjectId}
            activeConversationId={activeConversationId}
            activeMode={activeMode}
            onSelectProject={handleSelectProject}
            onSelectConversation={handleSelectConversation}
            onSelectMode={switchMode}
            messages={messages}
            isWaiting={isWaitingChat || status === 'analyzing'}
            chatError={chatError || analysisError}
            isOnline={isOnline}
            isMockMode={isMockMode}
            onToggleMockMode={() => setIsMockMode(!isMockMode)}
            onSendMessage={handleSendMessageWithOptionalFiles}
            onRetryMessage={retryLastMessage}
            onNewChat={handleStartIndependentChat}
            onNewProjectChat={handleStartProjectChat}
            onOpenCreateProject={() => {
              setEditingProject(null);
              setIsProjectModalOpen(true);
            }}
            onEditProject={(proj) => {
              setEditingProject(proj);
              setIsProjectModalOpen(true);
            }}
            onDeleteProject={handleDeleteProject}
            onRenameConversation={handleRenameConversation}
            onDeleteConversation={handleDeleteConversation}
            onMoveConversation={handleMoveConversation}
          />

          <ProjectModal
            isOpen={isProjectModalOpen}
            onClose={() => {
              setIsProjectModalOpen(false);
              setEditingProject(null);
            }}
            onSave={handleSaveProject}
            initialProject={editingProject}
          />
        </>
      )}
    </div>
  );
}

export default App;


