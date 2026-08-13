import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { parse } from 'cookie';
import { AuthService, type AuthIdentity } from '../auth/auth.service.js';

@Injectable()
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async handleConnection(socket: Socket) {
    try {
      const authorization = socket.handshake.headers.authorization;
      const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      const cookieToken = parse(socket.handshake.headers.cookie ?? '').hh_access;
      const token = bearer ?? (socket.handshake.auth.token as string | undefined) ?? cookieToken;
      if (!token) throw new Error('missing token');
      const identity = await this.auth.authenticateToken(token);
      socket.data.identity = identity;
      socket.join(`user:${identity.id}`);
      identity.warehouses.forEach(warehouse => socket.join(`warehouse:${warehouse.id}`));
      identity.permissions.forEach(permission => socket.join(`permission:${permission}`));
      identity.warehouses.forEach(warehouse => identity.permissions.forEach(permission => socket.join(`warehouse-permission:${warehouse.id}:${permission}`)));
    } catch { socket.disconnect(true); }
  }
  handleDisconnect(socket: Socket) { this.logger.debug(`Realtime client disconnected: ${socket.id}`); }
  @SubscribeMessage('realtime.ping')
  ping(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) { const identity = socket.data.identity as AuthIdentity | undefined; socket.emit('realtime.pong', { payload, userId: identity?.id }); }
  emitToWarehouse(warehouseId: string, event: string, payload: unknown) { this.server.to(`warehouse:${warehouseId}`).emit(event, payload); }
  emitToWarehousePermission(warehouseId: string, permission: string, event: string, payload: unknown) { this.server.to(`warehouse-permission:${warehouseId}:${permission}`).emit(event, payload); }
  emitToPermissions(permissionCodes: string[], event: string, payload: unknown) { this.server.to(permissionCodes.map(permission => `permission:${permission}`)).emit(event, payload); }
}
