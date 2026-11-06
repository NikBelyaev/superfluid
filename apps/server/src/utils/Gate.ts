export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private cap: number,
    private pending = 16,
  ) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.cap) {
      if (this.waiting.length >= this.pending)
        throw new Error('This queue is full. Wait for a running operation to finish.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
