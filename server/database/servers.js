import { db } from './db.js';
import crypto from 'crypto';

// Create servers table (called from migrations in db.js)
export const createServersTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 3001,
      connection_type TEXT NOT NULL DEFAULT 'websocket',
      ssh_user TEXT,
      ssh_key_path TEXT,
      ssh_tunnel_port INTEGER,
      api_key TEXT,
      ssl INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

// Server database operations
const serversDb = {
  // List all active servers
  getAll: () => {
    return db.prepare(
      'SELECT * FROM servers WHERE is_active = 1 ORDER BY name ASC'
    ).all().map(serversDb._deserialize);
  },

  // Get a single server by ID
  getById: (id) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ? AND is_active = 1').get(id);
    return row ? serversDb._deserialize(row) : null;
  },

  // Create a new server
  create: ({ name, host, port = 3001, connectionType = 'websocket', sshUser, sshKeyPath, sshTunnelPort, apiKey, ssl = false }) => {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO servers (id, name, host, port, connection_type, ssh_user, ssh_key_path, ssh_tunnel_port, api_key, ssl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, host, port, connectionType, sshUser || null, sshKeyPath || null, sshTunnelPort || null, apiKey || null, ssl ? 1 : 0);
    return serversDb.getById(id);
  },

  // Update an existing server
  update: (id, fields) => {
    const allowed = ['name', 'host', 'port', 'connection_type', 'ssh_user', 'ssh_key_path', 'ssh_tunnel_port', 'api_key', 'ssl'];
    const columnMap = {
      name: 'name',
      host: 'host',
      port: 'port',
      connectionType: 'connection_type',
      connection_type: 'connection_type',
      sshUser: 'ssh_user',
      ssh_user: 'ssh_user',
      sshKeyPath: 'ssh_key_path',
      ssh_key_path: 'ssh_key_path',
      sshTunnelPort: 'ssh_tunnel_port',
      ssh_tunnel_port: 'ssh_tunnel_port',
      apiKey: 'api_key',
      api_key: 'api_key',
      ssl: 'ssl',
    };

    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      const col = columnMap[key];
      if (col && allowed.includes(col)) {
        sets.push(`${col} = ?`);
        values.push(col === 'ssl' ? (val ? 1 : 0) : (val ?? null));
      }
    }
    if (sets.length === 0) return serversDb.getById(id);

    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return serversDb.getById(id);
  },

  // Soft-delete a server
  delete: (id) => {
    const result = db.prepare('UPDATE servers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1').run(id);
    return result.changes > 0;
  },

  // Hard-delete (for cleanup)
  hardDelete: (id) => {
    const result = db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    return result.changes > 0;
  },

  // Deserialize a row from the database
  _deserialize: (row) => {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      connectionType: row.connection_type,
      sshConfig: row.connection_type === 'ssh' ? {
        user: row.ssh_user,
        keyPath: row.ssh_key_path,
        tunnelPort: row.ssh_tunnel_port,
      } : null,
      apiKey: row.api_key,
      ssl: row.ssl === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
};

export default serversDb;
