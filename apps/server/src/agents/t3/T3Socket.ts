import { z } from 'zod';

const envelope = z.object({
  _tag: z.string(),
  requestId: z.string().optional(),
  values: z.array(z.unknown()).optional(),
  exit: z.object({ _tag: z.string(), value: z.unknown().optional() }).optional(),
});

export class T3Socket {
  readonly ready: Promise<void>;
  private socket: WebSocket;
  private pending = new Map<string, { finish: (error?: Error) => void }>();
  private subscriptions = new Set<string>();
  private nextId = 0;
  private heartbeat: ReturnType<typeof setInterval>;
  private awaitingPong = false;
  private stopped = false;
  private failure?: string;

  constructor(
    url: URL,
    onItem: (id: string, item: unknown) => Promise<void>,
    onClose: (error?: string) => void,
  ) {
    this.socket = new WebSocket(url);
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('T3 connection timed out.'));
        this.socket.close();
      }, 10000);
      this.socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      this.socket.addEventListener('error', () => reject(new Error('Could not connect to T3.')), {
        once: true,
      });
      this.socket.addEventListener(
        'close',
        () => {
          clearTimeout(timeout);
          reject(new Error('T3 disconnected.'));
        },
        {
          once: true,
        },
      );
    });
    let processing = Promise.resolve();
    this.socket.addEventListener('message', (event) => {
      processing = processing
        .then(async () => {
          if (this.stopped) return;
          if (typeof event.data !== 'string' || event.data.length > 16 * 1024 * 1024)
            throw new Error('Invalid T3 frame.');
          const raw: unknown = JSON.parse(event.data);
          for (const value of Array.isArray(raw) ? raw : [raw]) {
            const message = envelope.parse(value);
            if (message._tag === 'Ping') this.send({ _tag: 'Pong' });
            else if (message._tag === 'Pong') this.awaitingPong = false;
            else if (message._tag === 'Chunk' && message.requestId) {
              for (const item of message.values ?? []) await onItem(message.requestId, item);
              this.send({ _tag: 'Ack', requestId: message.requestId });
            } else if (message._tag === 'Exit' && message.requestId) {
              const pending = this.pending.get(message.requestId);
              if (pending)
                pending.finish(
                  message.exit?._tag === 'Success'
                    ? undefined
                    : new Error('T3 rejected the command. Check the conversation in T3.'),
                );
              else if (this.subscriptions.has(message.requestId))
                throw new Error('T3 subscription ended.');
            } else if (message._tag === 'Defect') throw new Error('T3 connection failed.');
          }
        })
        .catch(() => {
          this.failure = 'T3 sent incompatible activity data. Update T3 and reconnect.';
          this.socket.close();
        });
    });
    this.socket.addEventListener(
      'close',
      () => {
        clearInterval(this.heartbeat);
        for (const request of this.pending.values())
          request.finish(
            new Error(
              'T3 disconnected. The command may have been accepted; check T3 before resending.',
            ),
          );
        if (!this.stopped) {
          this.stopped = true;
          onClose(this.failure);
        }
      },
      { once: true },
    );
    this.heartbeat = setInterval(() => {
      if (this.socket.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPong) {
        this.socket.close();
        return;
      }
      this.awaitingPong = true;
      this.send({ _tag: 'Ping' });
    }, 20000);
    this.heartbeat.unref();
  }

  private send(message: object) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  subscribe(id: string, tag: string, payload: object) {
    if (!id.startsWith('command:')) this.subscriptions.add(id);
    this.send({ _tag: 'Request', id, tag, payload, headers: [] });
  }

  unsubscribe(requestId: string) {
    this.subscriptions.delete(requestId);
    this.send({ _tag: 'Interrupt', requestId, interruptors: [] });
  }

  command(payload: object) {
    if (this.stopped || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('T3 is not connected.'));
    const id = `command:${++this.nextId}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(new Error('T3 did not confirm the command. Check T3 before resending.'));
        this.unsubscribe(id);
      }, 15000);
      const finish = (error?: Error) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      this.pending.set(id, { finish });
      this.subscribe(id, 'orchestration.dispatchCommand', payload);
    });
  }

  close() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    for (const request of this.pending.values())
      request.finish(new Error('T3 disconnected. Check T3 before resending.'));
    this.socket.close();
  }
}
