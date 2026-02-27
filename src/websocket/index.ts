import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { verifyJwt } from '../utils/token.js';
import type { AuthenticatedSocket } from '../types/socket.js';
import { registerGameHandlers } from './gameHandler.js';
import { registerMultiplayerHandlers } from './multiplayerHandler.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';

const log = createLogger('WebSocket');

let io: Server | null = null;

/**
 * Returns the Socket.IO server instance.
 * Use this to emit events from anywhere (services, entities, controllers)
 * without importing the HTTP server.
 *
 * @throws if called before `setupWebSocket()`.
 */
export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialised — call setupWebSocket() first');
  return io;
}

/**
 * Emits an event to a specific user's personal room.
 * Convenience wrapper so callers don't need to know the room naming convention.
 *
 * @param userId — The target user's ID
 * @param event  — Event name (use WS_EVENTS constants)
 * @param data   — Payload
 */
export function emitToUser(userId: string, event: string, data: unknown): void {
  getIO().to(`user:${userId}`).emit(event, data);
}

/**
 * Returns true if the user has at least one connected Socket.IO client.
 * Used by scheduled jobs to decide whether to push via WebSocket or Expo.
 */
export function isUserConnected(userId: string): boolean {
  try {
    const room = getIO().sockets.adapter.rooms.get(`user:${userId}`);
    return (room?.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Attaches Socket.IO to the HTTP server, sets up JWT auth on the
 * handshake, and auto-joins each user to their personal room.
 *
 * Call this once during server startup.
 */
export function setupWebSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: env.CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyJwt(token);
      (socket as AuthenticatedSocket).user = { userId: payload.userId };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ──────────────────────────────────────────────────
  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { userId } = socket.user;

    socket.join(`user:${userId}`);
    log.info({ userId }, 'Client connected');

    registerGameHandlers(socket);
    registerMultiplayerHandlers(socket);

    socket.on('disconnect', () => {
      log.info({ userId }, 'Client disconnected');
    });
  });

  multiplayerManager.start();
  log.info('Socket.IO attached to HTTP server');
  return io;
}
