import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { useWebSocket } from './WebSocketContext';

export type ServerInfo = {
  id: string;
  name: string;
  host: string;
  port: number;
  connectionType: 'websocket' | 'ssh';
  ssl: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServerStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export type ServerWithStatus = ServerInfo & {
  status: ServerStatus;
};

type ServerContextType = {
  servers: ServerWithStatus[];
  selectedServerId: string | null; // null = "all servers" or local mode
  isMultiServerMode: boolean;
  loading: boolean;
  selectServer: (serverId: string | null) => void;
  addServer: (data: Partial<ServerInfo>) => Promise<ServerInfo>;
  updateServer: (id: string, data: Partial<ServerInfo>) => Promise<ServerInfo>;
  removeServer: (id: string) => Promise<void>;
  testServer: (id: string) => Promise<{ success: boolean; status: string; message?: string }>;
  refreshServers: () => Promise<void>;
};

const ServerContext = createContext<ServerContextType | null>(null);

export function useServers() {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error('useServers must be used within a ServerProvider');
  }
  return context;
}

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [servers, setServers] = useState<ServerWithStatus[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { latestMessage } = useWebSocket();

  // Fetch server list + statuses
  const refreshServers = useCallback(async () => {
    try {
      const [listRes, statusRes] = await Promise.all([
        api.servers.list(),
        api.servers.statuses(),
      ]);

      if (!listRes.ok || !statusRes.ok) {
        setServers([]);
        return;
      }

      const serverList: ServerInfo[] = await listRes.json();
      const statuses: Record<string, { status: ServerStatus }> = await statusRes.json();

      const merged: ServerWithStatus[] = serverList.map((s) => ({
        ...s,
        status: statuses[s.id]?.status || 'disconnected',
      }));

      setServers(merged);
    } catch {
      // Server might not support multi-server yet — that's OK
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  // Listen for server status changes via WebSocket
  useEffect(() => {
    if (!latestMessage || latestMessage.type !== 'server_status_changed') return;
    const { serverId, status } = latestMessage;
    setServers((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, status } : s))
    );
  }, [latestMessage]);

  const selectServer = useCallback((id: string | null) => {
    setSelectedServerId(id);
    if (id) {
      localStorage.setItem('selected-server', id);
    } else {
      localStorage.removeItem('selected-server');
    }
  }, []);

  // Restore selection from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('selected-server');
    if (stored && servers.some((s) => s.id === stored)) {
      setSelectedServerId(stored);
    }
  }, [servers]);

  const addServer = useCallback(async (data: Partial<ServerInfo>) => {
    const res = await api.servers.create(data);
    if (!res.ok) throw new Error('Failed to create server');
    const server = await res.json();
    await refreshServers();
    return server;
  }, [refreshServers]);

  const updateServer = useCallback(async (id: string, data: Partial<ServerInfo>) => {
    const res = await api.servers.update(id, data);
    if (!res.ok) throw new Error('Failed to update server');
    const server = await res.json();
    await refreshServers();
    return server;
  }, [refreshServers]);

  const removeServer = useCallback(async (id: string) => {
    const res = await api.servers.delete(id);
    if (!res.ok) throw new Error('Failed to delete server');
    if (selectedServerId === id) setSelectedServerId(null);
    await refreshServers();
  }, [refreshServers, selectedServerId]);

  const testServer = useCallback(async (id: string) => {
    const res = await api.servers.test(id);
    if (!res.ok) throw new Error('Failed to test server');
    return res.json();
  }, []);

  const isMultiServerMode = servers.length > 0;

  const value = useMemo(
    () => ({
      servers,
      selectedServerId,
      isMultiServerMode,
      loading,
      selectServer,
      addServer,
      updateServer,
      removeServer,
      testServer,
      refreshServers,
    }),
    [servers, selectedServerId, isMultiServerMode, loading, selectServer, addServer, updateServer, removeServer, testServer, refreshServers]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}
