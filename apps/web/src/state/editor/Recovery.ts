export interface RecoverySource {
  key: string;
  version: () => number;
  text: () => string;
  hash: () => string;
  write: (version: number, text: string, hash: string) => Promise<{ version: number }>;
}

type Entry = {
  source: RecoverySource;
  first: number;
  acked: number;
  captured?: number;
  afterCapture?: number;
  idle?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  health?: ReturnType<typeof setTimeout>;
  writing?: Promise<void>;
};

/** Idle debounce with a fixed deadline; acknowledgements only cover the captured version. */
export class Recovery {
  private entries = new Map<string, Entry>();
  private active = 0;
  private slots: (() => void)[] = [];
  constructor(
    private failure: (e: Error) => void,
    private delay = 350,
    private maxWait = 2000,
  ) {}
  restore(source: RecoverySource) {
    this.entries.set(source.key, { source, first: 0, acked: source.version() });
  }
  changed(source: RecoverySource) {
    let e = this.entries.get(source.key);
    if (!e) {
      e = { source, first: Date.now(), acked: -1 };
      this.entries.set(source.key, e);
    }
    if (source.version() <= e.acked) return;
    if (!e.first) e.first = Date.now();
    if (e.writing && source.version() > (e.captured ?? -1)) e.afterCapture ??= Date.now();
    clearTimeout(e.idle);
    e.idle = setTimeout(() => void this.flush(source.key).catch(() => {}), this.delay);
    e.deadline ??= setTimeout(
      () => {
        e!.deadline = undefined;
        void this.flush(source.key).catch(() => {});
      },
      Math.max(0, e.first + this.maxWait - Date.now()),
    );
    e.health ??= setTimeout(() => {
      e!.health = undefined;
      if (e!.source.version() > e!.acked)
        this.failure(
          new Error(
            'Recovery is behind. Your text is still in the editor; save or export it before closing.',
          ),
        );
    }, 3000);
  }
  async flush(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.writing) {
      await e.writing;
      if (e.source.version() > e.acked) return this.flush(key);
      return;
    }
    if (e.source.version() <= e.acked) return;
    if (this.active >= 2) {
      await new Promise<void>((resolve) => this.slots.push(resolve));
      return this.flush(key);
    }
    const version = e.source.version(),
      text = e.source.text(),
      hash = e.source.hash();
    e.captured = version;
    e.afterCapture = undefined;
    clearTimeout(e.idle);
    clearTimeout(e.deadline);
    e.idle = undefined;
    e.deadline = undefined;
    this.active++;
    e.writing = e.source
      .write(version, text, hash)
      .then((ack) => {
        e.acked = Math.max(e.acked, ack.version);
        if (e.source.version() <= e.acked) {
          clearTimeout(e.health);
          e.health = undefined;
          e.first = 0;
        } else {
          e.first = e.afterCapture ?? Date.now();
        }
      })
      .catch((error) => {
        this.failure(error);
        throw error;
      })
      .finally(() => {
        this.active--;
        e.writing = undefined;
        for (const ready of this.slots.splice(0)) ready();
      });
    await e.writing;
    if (e.source.version() > e.acked) {
      if (!e.first) e.first = Date.now();
      this.changed(e.source);
    }
  }
  forget(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    clearTimeout(e.idle);
    clearTimeout(e.deadline);
    clearTimeout(e.health);
    this.entries.delete(key);
  }
  async rebase(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    await e.writing;
    e.acked = -1;
    this.changed(e.source);
    await this.flush(key);
  }
  durable(key: string, version: number) {
    return (this.entries.get(key)?.acked ?? -1) >= version;
  }
  async flushAll() {
    do {
      await Promise.all([...this.entries.keys()].map((key) => this.flush(key)));
    } while ([...this.entries.values()].some((e) => e.source.version() > e.acked));
  }
}
