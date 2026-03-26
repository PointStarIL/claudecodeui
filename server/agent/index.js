#!/usr/bin/env node
/**
 * CloudCLI Server Agent
 *
 * A lightweight standalone server that runs on each machine and exposes
 * local Claude/Cursor/Codex/Gemini sessions to a remote Hub dashboard.
 *
 * Usage:
 *   node server/agent/index.js [--port 3002] [--api-key <key>]
 *
 * The agent shares the same project-discovery and provider code as the
 * main server but strips away authentication, the full frontend, and
 * multi-user support. It is designed to be controlled by the Hub via
 * an API key passed in the X-Agent-Key header.
 */

import '../load-env.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { getProjects, getSessions, searchConversations, clearProjectDirectoryCache } from '../projects.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, resolveToolApproval, getPendingApprovalsForSession, reconnectSessionWriter } from '../claude-sdk.js';
import { spawnCursor, abortCursorSession, isCursorSessionActive, getActiveCursorSessions } from '../cursor-cli.js';
import { queryCodex, abortCodexSession, isCodexSessionActive, getActiveCodexSessions } from '../openai-codex.js';
import { spawnGemini, abortGeminiSession, isGeminiSessionActive, getActiveGeminiSessions } from '../gemini-cli.js';
import { getProvider } from '../providers/registry.js';
import { initializeDatabase, sessionNamesDb, applyCustomSessionNames } from '../database/db.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = parseInt(getArg('port', process.env.AGENT_PORT || '3002'), 10);
const API_KEY = getArg('api-key', process.env.AGENT_API_KEY || '');
const HOSTNAME = os.hostname();

// ---------------------------------------------------------------------------
// Auth middleware — simple API key check
// ---------------------------------------------------------------------------
function authenticateAgent(req, res, next) {
  if (!API_KEY) return next(); // no key configured → open access (local dev)
  const provided = req.headers['x-agent-key'] || req.query.apiKey;
  if (provided === API_KEY) return next();
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

function authenticateAgentWs(req) {
  if (!API_KEY) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get('apiKey') === API_KEY;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Health check — public, no auth
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hostname: HOSTNAME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    providers: ['claude', 'cursor', 'codex', 'gemini'],
    version: '1.0.0',
  });
});

// Protected routes
app.use('/api/agent', authenticateAgent);

// List projects (aggregated from all providers)
app.get('/api/agent/projects', async (req, res) => {
  try {
    const projects = await getProjects();
    res.json(projects);
  } catch (error) {
    console.error('[Agent] Error listing projects:', error.message);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// List sessions for a project
app.get('/api/agent/projects/:projectName/sessions', async (req, res) => {
  try {
    const { projectName } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const sessions = await getSessions(projectName, limit, offset);
    res.json(sessions);
  } catch (error) {
    console.error('[Agent] Error listing sessions:', error.message);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Fetch messages for a session (using unified provider adapter)
app.get('/api/agent/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = req.query.provider || 'claude';
    const projectName = req.query.projectName;
    const projectPath = req.query.projectPath;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const adapter = getProvider(provider);
    if (!adapter) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    const result = await adapter.fetchHistory(sessionId, {
      projectName,
      projectPath,
      limit,
      offset,
    });

    res.json(result);
  } catch (error) {
    console.error('[Agent] Error fetching messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search conversations across all projects
app.get('/api/agent/search', async (req, res) => {
  try {
    const { q, provider } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
    const results = await searchConversations(q, provider || 'claude');
    res.json(results);
  } catch (error) {
    console.error('[Agent] Error searching:', error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get active sessions across all providers
app.get('/api/agent/active-sessions', (req, res) => {
  const active = {
    claude: getActiveClaudeSDKSessions(),
    cursor: getActiveCursorSessions(),
    codex: getActiveCodexSessions(),
    gemini: getActiveGeminiSessions(),
  };
  res.json(active);
});

// ---------------------------------------------------------------------------
// WebSocket — chat relay
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }) => authenticateAgentWs(req),
});

wss.on('connection', (ws) => {
  console.log('[Agent] WebSocket client connected');

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // Relay messages using the same protocol as the main server
    // The Hub will proxy client WebSocket messages here
    const writer = {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
      },
    };

    try {
      switch (msg.type) {
        case 'claude-command':
          await queryClaudeSDK(msg.command, msg.options || {}, writer);
          break;
        case 'cursor-command':
          await spawnCursor(msg.command, msg.options || {}, writer);
          break;
        case 'codex-command':
          await queryCodex(msg.command, msg.options || {}, writer);
          break;
        case 'gemini-command':
          await spawnGemini(msg.command, msg.options || {}, writer);
          break;
        case 'abort-session':
          if (msg.provider === 'claude') abortClaudeSDKSession(msg.sessionId);
          else if (msg.provider === 'cursor') abortCursorSession(msg.sessionId);
          else if (msg.provider === 'codex') abortCodexSession(msg.sessionId);
          else if (msg.provider === 'gemini') abortGeminiSession(msg.sessionId);
          break;
        case 'claude-permission-response':
          resolveToolApproval(msg.requestId, msg.decision);
          break;
        case 'check-session-status': {
          const isActive =
            msg.provider === 'claude' ? isClaudeSDKSessionActive(msg.sessionId) :
            msg.provider === 'cursor' ? isCursorSessionActive(msg.sessionId) :
            msg.provider === 'codex' ? isCodexSessionActive(msg.sessionId) :
            msg.provider === 'gemini' ? isGeminiSessionActive(msg.sessionId) : false;
          writer.send({ type: 'session-status', sessionId: msg.sessionId, isActive });
          break;
        }
        case 'get-pending-permissions': {
          const pending = getPendingApprovalsForSession(msg.sessionId);
          writer.send({ type: 'pending-permissions', sessionId: msg.sessionId, pending });
          break;
        }
        default:
          writer.send({ type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    } catch (error) {
      console.error('[Agent] WebSocket handler error:', error.message);
      writer.send({ type: 'error', message: error.message });
    }
  });

  ws.on('close', () => {
    console.log('[Agent] WebSocket client disconnected');
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  await initializeDatabase();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`  CloudCLI Server Agent`);
    console.log(`  Host:     ${HOSTNAME}`);
    console.log(`  Port:     ${PORT}`);
    console.log(`  API Key:  ${API_KEY ? 'configured' : 'none (open access)'}`);
    console.log(`  Health:   http://0.0.0.0:${PORT}/health`);
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});

export { app, server };
