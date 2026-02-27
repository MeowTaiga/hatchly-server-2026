import type { Socket } from 'socket.io';

/** Socket with an authenticated user attached after handshake auth */
export interface AuthenticatedSocket extends Socket {
  user: {
    userId: string;
  };
}
