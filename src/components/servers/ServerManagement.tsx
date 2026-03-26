import { useState } from 'react';
import { X, Plus, Trash2, TestTube, Loader2, Circle } from 'lucide-react';
import { useServers } from '../../contexts/ServerContext';

type Props = {
  open: boolean;
  onClose: () => void;
};

type FormData = {
  name: string;
  host: string;
  port: string;
  connectionType: 'websocket' | 'ssh';
  apiKey: string;
  ssl: boolean;
  sshUser: string;
  sshKeyPath: string;
  sshTunnelPort: string;
};

const emptyForm: FormData = {
  name: '',
  host: '',
  port: '3002',
  connectionType: 'websocket',
  apiKey: '',
  ssl: false,
  sshUser: '',
  sshKeyPath: '',
  sshTunnelPort: '',
};

const statusColor: Record<string, string> = {
  connected: 'text-green-500',
  connecting: 'text-yellow-500',
  disconnected: 'text-red-500',
  error: 'text-red-500',
};

export default function ServerManagement({ open, onClose }: Props) {
  const { servers, addServer, removeServer, testServer } = useServers();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addServer({
        name: form.name,
        host: form.host,
        port: parseInt(form.port) || 3002,
        connectionType: form.connectionType,
        apiKey: form.apiKey || undefined,
        ssl: form.ssl,
      } as any);
      setForm(emptyForm);
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add server');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await testServer(id);
      setTestResult({ id, ...result });
    } catch {
      setTestResult({ id, success: false, message: 'Test failed' });
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removeServer(id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">Manage Servers</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Server list */}
        <div className="max-h-64 overflow-y-auto p-4">
          {servers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No servers configured. Add your first server agent below.
            </p>
          ) : (
            <div className="space-y-2">
              {servers.map((srv) => (
                <div key={srv.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                  <Circle className={`h-2.5 w-2.5 flex-shrink-0 fill-current ${statusColor[srv.status] || 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{srv.name}</div>
                    <div className="text-xs text-muted-foreground">{srv.host}:{srv.port} ({srv.connectionType})</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {testResult?.id === srv.id && (
                      <span className={`text-xs ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                        {testResult.success ? 'OK' : testResult.message}
                      </span>
                    )}
                    <button
                      onClick={() => handleTest(srv.id)}
                      disabled={testing === srv.id}
                      className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                      title="Test connection"
                    >
                      {testing === srv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDelete(srv.id)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-500/10"
                      title="Remove server"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add server form */}
        {showForm ? (
          <form onSubmit={handleSubmit} className="border-t border-border p-4">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="dev-server"
                    required
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Host</label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="192.168.1.10"
                    required
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Port</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    placeholder="3002"
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Connection</label>
                  <select
                    value={form.connectionType}
                    onChange={(e) => setForm({ ...form, connectionType: e.target.value as 'websocket' | 'ssh' })}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                  >
                    <option value="websocket">WebSocket</option>
                    <option value="ssh">SSH Tunnel</option>
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={form.ssl}
                      onChange={(e) => setForm({ ...form, ssl: e.target.checked })}
                    />
                    SSL
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">API Key (optional)</label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="Agent API key"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(null); }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Server'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="border-t border-border p-4">
            <button
              onClick={() => setShowForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Add Server Agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
