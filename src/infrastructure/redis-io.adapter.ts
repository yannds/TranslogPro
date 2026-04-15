import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { INestApplication } from '@nestjs/common';

/**
 * RedisIoAdapter — configure le Redis adapter socket.io au niveau du serveur racine.
 *
 * Pourquoi pas dans les gateways ?
 * `@WebSocketServer()` et le paramètre `afterInit(server)` reçoivent le *Namespace*,
 * pas le serveur racine `io`. `.adapter()` n'existe que sur le serveur racine.
 * La seule façon correcte est de l'injecter via un IoAdapter custom dans main.ts.
 */
export class RedisIoAdapter extends IoAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(host: string, port: number, password?: string): Promise<void> {
    const pubClient = new Redis({ host, port, password });
    const subClient = pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve) => pubClient.once('ready', resolve)),
      new Promise<void>((resolve) => subClient.once('ready', resolve)),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
