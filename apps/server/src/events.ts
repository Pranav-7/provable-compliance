import type { ServerResponse } from 'node:http';
import type { BankEvent } from '@pc/shared';

/** Minimal Server-Sent Events hub: the UI subscribes once and receives every state change. */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  publish(event: BankEvent): void {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }
}
