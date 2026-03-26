import { useState } from 'react';
import { ChevronDown, Monitor, Plus, Circle } from 'lucide-react';
import { useServers } from '../../contexts/ServerContext';

const statusColor: Record<string, string> = {
  connected: 'text-green-500',
  connecting: 'text-yellow-500',
  disconnected: 'text-red-500',
  error: 'text-red-500',
};

function StatusDot({ status }: { status: string }) {
  return <Circle className={`h-2 w-2 fill-current ${statusColor[status] || 'text-gray-400'}`} />;
}

type Props = {
  onManageServers: () => void;
};

export default function ServerPicker({ onManageServers }: Props) {
  const { servers, selectedServerId, selectServer, isMultiServerMode } = useServers();
  const [open, setOpen] = useState(false);

  if (!isMultiServerMode) return null;

  const selected = selectedServerId
    ? servers.find((s) => s.id === selectedServerId)
    : null;

  const label = selected ? selected.name : 'All Servers';

  return (
    <div className="relative px-3 py-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
      >
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate text-left font-medium">{label}</span>
        {selected && <StatusDot status={selected.status} />}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg">
            {/* All Servers option */}
            <button
              onClick={() => { selectServer(null); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted ${
                !selectedServerId ? 'bg-muted font-medium' : ''
              }`}
            >
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">All Servers</span>
              <span className="text-xs text-muted-foreground">{servers.length}</span>
            </button>

            <div className="border-t border-border" />

            {/* Server list */}
            {servers.map((srv) => (
              <button
                key={srv.id}
                onClick={() => { selectServer(srv.id); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted ${
                  selectedServerId === srv.id ? 'bg-muted font-medium' : ''
                }`}
              >
                <StatusDot status={srv.status} />
                <span className="flex-1 truncate text-left">{srv.name}</span>
                <span className="text-xs text-muted-foreground">{srv.host}:{srv.port}</span>
              </button>
            ))}

            <div className="border-t border-border" />

            {/* Manage servers */}
            <button
              onClick={() => { onManageServers(); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Manage Servers</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
