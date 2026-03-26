/**
 * SSH Tunnel Manager
 *
 * Creates SSH tunnels to remote agents for secure communication
 * when direct WebSocket/HTTP connections are not possible (e.g. firewalled servers).
 *
 * Uses the ssh2 library to establish tunnels that forward a local port
 * to the remote agent's port through the SSH connection.
 */

let Client;
try {
  ({ Client } = await import('ssh2'));
} catch {
  // ssh2 not installed — SSH tunneling will be unavailable
  Client = null;
}

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const DEFAULT_SSH_PORT = 22;
const TUNNEL_CONNECT_TIMEOUT = 15_000; // 15 seconds
const KEEPALIVE_INTERVAL = 10_000;     // 10 seconds

/**
 * Active tunnel entry
 * @typedef {{ conn: object, localPort: number, remotePort: number, serverId: string }} TunnelEntry
 */

class SSHTunnelManager {
  constructor() {
    /** @type {Map<string, TunnelEntry>} */
    this.tunnels = new Map();
    this._nextLocalPort = 13001; // starting local port for tunnels
  }

  /**
   * Check if SSH tunneling is available (ssh2 installed)
   */
  get isAvailable() {
    return Client !== null;
  }

  /**
   * Create an SSH tunnel to a remote server agent
   *
   * @param {object} serverConfig - Server configuration from DB
   * @param {string} serverConfig.id - Server ID
   * @param {string} serverConfig.host - SSH host (same as agent host)
   * @param {number} serverConfig.port - Agent port on the remote machine
   * @param {string} [serverConfig.sshUser] - SSH username (defaults to current OS user)
   * @param {string} [serverConfig.sshKeyPath] - Path to SSH private key
   * @param {number} [serverConfig.sshTunnelPort] - Local port to bind (auto-assigned if not set)
   * @returns {Promise<{ localPort: number, localHost: string }>}
   */
  async createTunnel(serverConfig) {
    if (!Client) {
      throw new Error('SSH tunneling is not available. Install ssh2: npm install ssh2');
    }

    const existing = this.tunnels.get(serverConfig.id);
    if (existing) {
      return { localPort: existing.localPort, localHost: '127.0.0.1' };
    }

    const sshUser = serverConfig.sshUser || process.env.USER || process.env.USERNAME || 'root';
    const sshKeyPath = serverConfig.sshKeyPath
      ? resolve(serverConfig.sshKeyPath)
      : resolve(homedir(), '.ssh', 'id_rsa');

    let privateKey;
    try {
      privateKey = readFileSync(sshKeyPath, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read SSH key at ${sshKeyPath}: ${err.message}`);
    }

    const localPort = serverConfig.sshTunnelPort || this._nextLocalPort++;
    const remotePort = serverConfig.port || 3001;

    return new Promise((resolvePromise, reject) => {
      const conn = new Client();

      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH tunnel connection timed out after ${TUNNEL_CONNECT_TIMEOUT}ms`));
      }, TUNNEL_CONNECT_TIMEOUT);

      conn.on('ready', () => {
        clearTimeout(timeout);

        // Create the TCP forwarding
        conn.forwardOut(
          '127.0.0.1',    // local bind address
          localPort,       // local port
          '127.0.0.1',    // remote host (agent runs on localhost on remote machine)
          remotePort,      // remote agent port
          (err, stream) => {
            if (err) {
              conn.end();
              return reject(new Error(`SSH tunnel forward failed: ${err.message}`));
            }

            // Note: forwardOut gives us a single stream.
            // For proper tunneling, we need to set up a local TCP server instead.
            // Let's close this stream and use a local listener approach.
            stream.close();
          }
        );

        // Store the tunnel using net server approach for proper port forwarding
        this._setupLocalForwarder(conn, serverConfig.id, localPort, remotePort)
          .then(() => {
            this.tunnels.set(serverConfig.id, {
              conn,
              localPort,
              remotePort,
              serverId: serverConfig.id,
            });

            console.log(`[SSH] Tunnel established: localhost:${localPort} → ${serverConfig.host}:${remotePort} (via ${sshUser}@${serverConfig.host})`);
            resolvePromise({ localPort, localHost: '127.0.0.1' });
          })
          .catch((setupErr) => {
            conn.end();
            reject(setupErr);
          });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[SSH] Connection error for ${serverConfig.host}:`, err.message);
        this.closeTunnel(serverConfig.id);
        reject(err);
      });

      conn.on('close', () => {
        console.log(`[SSH] Connection closed for ${serverConfig.host}`);
        this.tunnels.delete(serverConfig.id);
      });

      conn.connect({
        host: serverConfig.host,
        port: DEFAULT_SSH_PORT,
        username: sshUser,
        privateKey,
        keepaliveInterval: KEEPALIVE_INTERVAL,
        readyTimeout: TUNNEL_CONNECT_TIMEOUT,
      });
    });
  }

  /**
   * Set up a local TCP server that forwards connections through the SSH tunnel
   */
  async _setupLocalForwarder(conn, serverId, localPort, remotePort) {
    const { createServer } = await import('net');

    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        conn.forwardOut(
          '127.0.0.1',
          localPort,
          '127.0.0.1',
          remotePort,
          (err, stream) => {
            if (err) {
              console.error(`[SSH] Forward error for ${serverId}:`, err.message);
              socket.end();
              return;
            }
            socket.pipe(stream).pipe(socket);

            stream.on('close', () => socket.destroy());
            socket.on('close', () => stream.close());
          }
        );
      });

      server.on('error', (err) => {
        reject(new Error(`Failed to start local tunnel listener on port ${localPort}: ${err.message}`));
      });

      server.listen(localPort, '127.0.0.1', () => {
        // Store the server reference for cleanup
        const tunnel = this.tunnels.get(serverId);
        if (tunnel) {
          tunnel.server = server;
        } else {
          // Store server temporarily — will be merged in createTunnel
          this._pendingServer = server;
        }
        resolve();
      });

      // Attach server for later cleanup
      this._pendingServer = server;
    });
  }

  /**
   * Close an SSH tunnel
   */
  closeTunnel(serverId) {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel) return;

    try {
      if (tunnel.server) {
        tunnel.server.close();
      }
      tunnel.conn.end();
    } catch (err) {
      console.error(`[SSH] Error closing tunnel for ${serverId}:`, err.message);
    }
    this.tunnels.delete(serverId);
    console.log(`[SSH] Tunnel closed for ${serverId}`);
  }

  /**
   * Get tunnel info for a server
   */
  getTunnel(serverId) {
    return this.tunnels.get(serverId) || null;
  }

  /**
   * Check if a tunnel exists and is active
   */
  hasTunnel(serverId) {
    return this.tunnels.has(serverId);
  }

  /**
   * Close all tunnels
   */
  shutdown() {
    for (const serverId of this.tunnels.keys()) {
      this.closeTunnel(serverId);
    }
  }
}

// Singleton
const sshTunnelManager = new SSHTunnelManager();
export default sshTunnelManager;
export { SSHTunnelManager };
