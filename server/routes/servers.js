import express from 'express';
import serversDb from '../database/servers.js';
import connectionManager from '../services/server-connection.js';

const router = express.Router();

// GET /api/servers — list all servers
router.get('/', (req, res) => {
  try {
    const servers = serversDb.getAll();
    // Strip apiKey from response for security
    const sanitized = servers.map(({ apiKey, ...rest }) => rest);
    res.json(sanitized);
  } catch (error) {
    console.error('[Servers] Error listing servers:', error.message);
    res.status(500).json({ error: 'Failed to list servers' });
  }
});

// GET /api/servers/statuses — connection statuses for all servers (must be before /:id)
router.get('/statuses', (req, res) => {
  try {
    res.json(connectionManager.getStatuses());
  } catch (error) {
    console.error('[Servers] Error getting statuses:', error.message);
    res.status(500).json({ error: 'Failed to get server statuses' });
  }
});

// GET /api/servers/:id — get a single server
router.get('/:id', (req, res) => {
  try {
    const server = serversDb.getById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    const { apiKey, ...sanitized } = server;
    res.json(sanitized);
  } catch (error) {
    console.error('[Servers] Error getting server:', error.message);
    res.status(500).json({ error: 'Failed to get server' });
  }
});

// POST /api/servers — add a new server
router.post('/', (req, res) => {
  try {
    const { name, host, port, connectionType, sshUser, sshKeyPath, sshTunnelPort, apiKey, ssl } = req.body;

    if (!name || !host) {
      return res.status(400).json({ error: 'name and host are required' });
    }

    const server = serversDb.create({
      name,
      host,
      port: port || 3001,
      connectionType: connectionType || 'websocket',
      sshUser,
      sshKeyPath,
      sshTunnelPort,
      apiKey,
      ssl: ssl || false,
    });

    const { apiKey: _, ...sanitized } = server;
    res.status(201).json(sanitized);
  } catch (error) {
    console.error('[Servers] Error creating server:', error.message);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// PUT /api/servers/:id — update a server
router.put('/:id', (req, res) => {
  try {
    const existing = serversDb.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const server = serversDb.update(req.params.id, req.body);
    const { apiKey, ...sanitized } = server;
    res.json(sanitized);
  } catch (error) {
    console.error('[Servers] Error updating server:', error.message);
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// DELETE /api/servers/:id — remove a server
router.delete('/:id', (req, res) => {
  try {
    const deleted = serversDb.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Servers] Error deleting server:', error.message);
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// POST /api/servers/:id/test — test connection to a server
router.post('/:id/test', async (req, res) => {
  try {
    const server = serversDb.getById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const protocol = server.ssl ? 'https' : 'http';
    const url = `${protocol}://${server.host}:${server.port}/health`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: server.apiKey ? { 'X-Agent-Key': server.apiKey } : {},
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        res.json({ success: true, status: 'connected', data });
      } else {
        res.json({ success: false, status: 'error', message: `HTTP ${response.status}` });
      }
    } catch (fetchError) {
      clearTimeout(timeout);
      res.json({
        success: false,
        status: 'disconnected',
        message: fetchError.name === 'AbortError' ? 'Connection timed out' : fetchError.message,
      });
    }
  } catch (error) {
    console.error('[Servers] Error testing server:', error.message);
    res.status(500).json({ error: 'Failed to test server connection' });
  }
});

// GET /api/servers/:id/projects — proxy to agent's project list
router.get('/:id/projects', async (req, res) => {
  try {
    const conn = connectionManager.get(req.params.id);
    if (!conn) {
      return res.status(404).json({ error: 'Server not found or not connected' });
    }
    const agentRes = await conn.fetch('/api/agent/projects');
    const data = await agentRes.json();

    // Tag each project with the server info
    const projects = (Array.isArray(data) ? data : []).map((p) => ({
      ...p,
      serverId: conn.config.id,
      serverName: conn.config.name,
    }));
    res.json(projects);
  } catch (error) {
    console.error('[Servers] Error proxying projects:', error.message);
    res.status(502).json({ error: 'Failed to reach agent' });
  }
});

// GET /api/servers/:id/projects/:projectName/sessions — proxy to agent
router.get('/:id/projects/:projectName/sessions', async (req, res) => {
  try {
    const conn = connectionManager.get(req.params.id);
    if (!conn) {
      return res.status(404).json({ error: 'Server not found or not connected' });
    }
    const qs = new URLSearchParams(req.query).toString();
    const agentRes = await conn.fetch(`/api/agent/projects/${encodeURIComponent(req.params.projectName)}/sessions?${qs}`);
    const data = await agentRes.json();
    res.json(data);
  } catch (error) {
    console.error('[Servers] Error proxying sessions:', error.message);
    res.status(502).json({ error: 'Failed to reach agent' });
  }
});

// GET /api/servers/:id/sessions/:sessionId/messages — proxy to agent
router.get('/:id/sessions/:sessionId/messages', async (req, res) => {
  try {
    const conn = connectionManager.get(req.params.id);
    if (!conn) {
      return res.status(404).json({ error: 'Server not found or not connected' });
    }
    const qs = new URLSearchParams(req.query).toString();
    const agentRes = await conn.fetch(`/api/agent/sessions/${encodeURIComponent(req.params.sessionId)}/messages?${qs}`);
    const data = await agentRes.json();
    res.json(data);
  } catch (error) {
    console.error('[Servers] Error proxying messages:', error.message);
    res.status(502).json({ error: 'Failed to reach agent' });
  }
});

export default router;
