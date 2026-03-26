import { useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { Server } from 'lucide-react';
import type { LoadingProgress, Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  MCPServerStatus,
  SessionWithProvider,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isProjectStarred: (projectName: string) => boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  expandedProjects,
  editingProject,
  editingName,
  loadingSessions,
  initialSessionsLoaded,
  currentTime,
  editingSession,
  editingSessionName,
  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  isProjectStarred,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectListProps) {
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  // Group projects by server when multiple servers have projects
  const hasMultipleServers = filteredProjects.some((p) => p.serverId);
  const groupedByServer = useMemo(() => {
    if (!hasMultipleServers) return null;

    const groups = new Map<string, { serverName: string; projects: Project[] }>();
    for (const project of filteredProjects) {
      const sId = (project.serverId as string) || 'local';
      const sName = (project.serverName as string) || 'Local';
      if (!groups.has(sId)) {
        groups.set(sId, { serverName: sName, projects: [] });
      }
      groups.get(sId)!.projects.push(project);
    }
    return groups;
  }, [filteredProjects, hasMultipleServers]);

  const renderProjectItem = (project: Project) => (
    <SidebarProjectItem
      key={`${project.serverId || 'local'}-${project.name}`}
      project={project}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      isExpanded={expandedProjects.has(project.name)}
      isDeleting={deletingProjects.has(project.name)}
      isStarred={isProjectStarred(project.name)}
      editingProject={editingProject}
      editingName={editingName}
      sessions={getProjectSessions(project)}
      initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
      isLoadingSessions={Boolean(loadingSessions[project.name])}
      currentTime={currentTime}
      editingSession={editingSession}
      editingSessionName={editingSessionName}
      tasksEnabled={tasksEnabled}
      mcpServerStatus={mcpServerStatus}
      onEditingNameChange={onEditingNameChange}
      onToggleProject={onToggleProject}
      onProjectSelect={onProjectSelect}
      onToggleStarProject={onToggleStarProject}
      onStartEditingProject={onStartEditingProject}
      onCancelEditingProject={onCancelEditingProject}
      onSaveProjectName={onSaveProjectName}
      onDeleteProject={onDeleteProject}
      onSessionSelect={onSessionSelect}
      onDeleteSession={onDeleteSession}
      onLoadMoreSessions={onLoadMoreSessions}
      onNewSession={onNewSession}
      onEditingSessionNameChange={onEditingSessionNameChange}
      onStartEditingSession={onStartEditingSession}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      t={t}
    />
  );

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {!showProjects
        ? state
        : groupedByServer
          ? Array.from(groupedByServer.entries()).map(([serverId, { serverName, projects: serverProjects }]) => (
              <div key={serverId}>
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Server className="h-3 w-3" />
                  <span className="truncate">{serverName}</span>
                  <span className="ml-auto text-[10px] font-normal tabular-nums">
                    {serverProjects.length}
                  </span>
                </div>
                {serverProjects.map(renderProjectItem)}
              </div>
            ))
          : filteredProjects.map(renderProjectItem)}
    </div>
  );
}
