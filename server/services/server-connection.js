/**
 * ServerConnectionManager
 *
 * Manages persistent connections from the Hub to remote Server Agents.
 * Each connection wraps a WebSocket + periodic health-check polling.
 * Supports auto-reconnect with exponential backoff.
 */

import WebSocket from 'ws';
import serversDb from '../database/servers.js';
import sshTunnelManager from './ssh-tunnel.js';

const HEALTH_CHECK_INTERVAL = 15_000; // 15 seconds
const RECONNECT_BASE_DELAY = 1_000;   // 1 second
const RECONNECT_MAX_DELAY = 60_000;   // 1 minute
const CONNECT_TIMEOUT = 5_000;        // 5 seconds

class ServerConnection {
  constructor(serverConfig, manager) {
    this.config = serverConfig;
    this.manager = manager;
    this.ws = null;
    this.status = 'disconnected'; // connected | disconnected | connecting | error
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.healthTimer = null;
    this.lastHealthData = null;
    this._messageHandlers = new Set();
  }

  get id() { return this.config.id; }

  /** Build the base URL for this agent (uses tunnel if available) */
  get baseUrl() {
    const tunnel = sshTunnelManager.getTunnel(this.config.id);
    if (tunnel) {
      // When tunneling, connect to local forwarded port (always plain HTTP)
      return `http://127.0.0.1:${tunnel.localPort}`;
    }
    const protocol = this.config.ssl ? 'https' : 'http';
    return `${protocol}://${this.config.host}:${this.config.port}`;
  }

  get wsUrl() {
    const tunnel = sshTunnelManager.getTunnel(this.config.id);
    if (tunnel) {
      const keyParam = this.config.apiKey ? `?apiKey=${this.config.apiKey}` : '';
      return `ws://127.0.0.1:${tunnel.localPort}/ws${keyParam}`;
    }
    const protocol = this.config.ssl ? 'wss' : 'ws';
    const keyParam = this.config.apiKey ? `?apiKey=${this.config.apiKey}` : '';
    return `${protocol}://${this.config.host}:${this.config.port}/ws${keyParam}`;
  }

  /** Proxy a REST request to the agent */
  async fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...options.headers };
    if (this.config.apiKey) {
      headers['X-Agent-Key'] = this.config.apiKey;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10_000);
    try {
      const resp = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeout);
      return resp;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /** Open WebSocket to the agent (establishes SSH tunnel first if needed) */
  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._setStatus('connecting');

    // Establish SSH tunnel if connection type is 'ssh'
    if (this.config.connectionType === 'ssh' && !sshTunnelManager.hasTunnel(this.config.id)) {
      if (!sshTunnelManager.isAvailable) {
        console.error(`[Hub] SSH tunneling not available (ssh2 not installed) for ${this.config.name}`);
        this._setStatus('error');
        this._scheduleReconnect();
        return;
      }
      try {
        await sshTunnelManager.createTunnel(this.config);
        console.log(`[Hub] SSH tunnel established for ${this.config.name}`);
      } catch (err) {
        console.error(`[Hub] SSH tunnel failed for ${this.config.name}:`, err.message);
        this._setStatus('error');
        this._scheduleReconnect();
        return;
      }
    }

    const ws = new WebSocket(this.wsUrl, { handshakeTimeout: CONNECT_TIMEOUT });

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this._setStatus('connected');
      this._startHealthCheck();
      console.log(`[Hub] Connected to agent: ${this.config.name} (${this.config.host}:${this.config.port})`);
    });

    ws.on('message', (data) => {
      this._messageHandlers.forEach((handler) => {
        try { handler(data, this); } catch (e) { console.error('[Hub] Message handler error:', e.message); }
      });
    });

    ws.on('close', () => {
      this._setStatus('disconnected');
      this._stopHealthCheck();
      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error(`[Hub] WebSocket error for ${this.config.name}:`, err.message);
      this._setStatus('error');
    });

    this.ws = ws;
  }

  /** Send a message through the agent WebSocket */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** Register a handler for messages from the agent */
  onMessage(handler) {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  /** Disconnect and stop reconnect */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopHealthCheck();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    // Close SSH tunnel if one was open
    if (sshTunnelManager.hasTunnel(this.config.id)) {
      sshTunnelManager.closeTunnel(this.config.id);
    }
    this._setStatus('disconnected');
  }

  /** Periodic health-check via REST */
  async healthCheck() {
    try {
      const resp = await this.fetch('/health', { timeout: 5000 });
      if (resp.ok) {
        this.lastHealthData = await resp.json();
        if (this.status !== 'connected') this._setStatus('connected');
        return { success: true, data: this.lastHealthData };
      }
      return { success: false, message: `HTTP ${resp.status}` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // -- internal --

  _setStatus(status) {
    const prev = this.status;
    this.status = status;
    if (prev !== status) {
      this.manager._onStatusChange(this);
    }
  }

  _startHealthCheck() {
    this._stopHealthCheck();
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_CHECK_INTERVAL);
  }

  _stopHealthCheck() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY,
    );
    this.reconnectAttempts++;
    console.log(`[Hub] Reconnecting to ${this.config.name} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Manager — singleton that holds all server connections
// ---------------------------------------------------------------------------

class ServerConnectionManager {
  constructor() {
    /** @type {Map<string, ServerConnection>} */
    this.connections = new Map();
    this._statusListeners = new Set();
  }

  /** Initialize connections for all registered servers */
  async init() {
    const servers = serversDb.getAll();
    for (const srv of servers) {
      this.addConnection(srv);
    }
  }

  /** Add (or replace) a connection for a server config */
  addConnection(serverConfig) {
    const existing = this.connections.get(serverConfig.id);
    if (existing) existing.disconnect();

    const conn = new ServerConnection(serverConfig, this);
    this.connections.set(serverConfig.id, conn);
    conn.connect();
    return conn;
  }

  /** Remove a server connection */
  removeConnection(serverId) {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.disconnect();
      this.connections.delete(serverId);
    }
  }

  /** Get a specific connection */
  get(serverId) {
    return this.connections.get(serverId) || null;
  }

  /** Get all connections with their status */
  getStatuses() {
    const result = {};
    for (const [id, conn] of this.connections) {
      result[id] = {
        id,
        name: conn.config.name,
        status: conn.status,
        lastHealth: conn.lastHealthData,
      };
    }
    return result;
  }

  /** Subscribe to status changes */
  onStatusChange(listener) {
    this._statusListeners.add(listener);
    return () => this._statusListeners.delete(listener);
  }

  /** Proxy a REST call to a specific agent */
  async proxyFetch(serverId, path, options) {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);
    return conn.fetch(path, options);
  }

  /** Disconnect everything */
  shutdown() {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
    // Also shut down all SSH tunnels
    sshTunnelManager.shutdown();
  }

  // -- internal --
  _onStatusChange(conn) {
    this._statusListeners.forEach((fn) => {
      try { fn(conn); } catch (e) { console.error('[Hub] Status listener error:', e.message); }
    });
  }
}

// Singleton
const connectionManager = new ServerConnectionManager();

export default connectionManager;
export { ServerConnectionManager, ServerConnection };
