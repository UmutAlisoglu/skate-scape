// A tiny request/response channel over a Worker or MessagePort: call() a named handler on the other side and get its
// result back; emit() one-way events. Typed arrays in results are transferred, not copied, when the handler says so.

type Port = { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent) => void) | null };
type Handler = (...args: never[]) => unknown;
type Message =
  | { id: number; call: string; args: unknown[] }
  | { id: number; result: unknown }
  | { id: number; error: { message: string; name: string; status?: number } }
  | { event: string; data: unknown };

/** A handler result whose buffers move to the caller instead of being copied. */
export class Transfer<T> { constructor(readonly value: T, readonly buffers: Transferable[]) {} }

/** The buffers of typed arrays (deduplicated), for Transfer. */
export const buffersOf = (arrays: Iterable<ArrayBufferView>) => [...new Set([...arrays].map((a) => a.buffer as ArrayBuffer))];

/** An error from the other side, with its name and HTTP status (when it was a FetchError) kept. */
export class RemoteError extends Error {
  constructor(message: string, readonly remoteName: string, readonly status?: number) { super(message); }
}

export class Channel {
  private next = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
  private handlers: Record<string, Handler> = {};
  private listeners = new Map<string, ((data: never) => void)[]>();

  constructor(private readonly port: Port) {
    port.onmessage = ({ data }: MessageEvent<Message>) => {
      if ('event' in data) { for (const listener of this.listeners.get(data.event) ?? []) listener(data.data as never); return; }
      if ('call' in data) { void this.answer(data); return; }
      const job = this.pending.get(data.id);
      if (!job) return;
      this.pending.delete(data.id);
      if ('error' in data) job.reject(new RemoteError(data.error.message, data.error.name, data.error.status));
      else job.resolve(data.result);
    };
  }

  call<T>(name: string, ...args: unknown[]): Promise<T> { return this.callWith<T>(name, [], ...args); }

  /** call(), moving `transfer` (ports, buffers) to the other side. */
  callWith<T>(name: string, transfer: Transferable[], ...args: unknown[]): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.port.postMessage({ id, call: name, args } satisfies Message, transfer);
    });
  }

  serve(handlers: Record<string, Handler>) { Object.assign(this.handlers, handlers); return this; }

  emit(event: string, data: unknown) { this.port.postMessage({ event, data } satisfies Message); }
  on<T>(event: string, listener: (data: T) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (data: never) => void);
    this.listeners.set(event, list);
    return this;
  }

  /** Rejects every call still waiting (the other side is gone). */
  fail(reason: Error) { for (const job of this.pending.values()) job.reject(reason); this.pending.clear(); }

  private async answer(message: { id: number; call: string; args: unknown[] }) {
    const handler = this.handlers[message.call];
    try {
      if (!handler) throw new Error(`no handler for ${message.call}`);
      const result = await (handler as (...args: unknown[]) => unknown)(...message.args);
      if (result instanceof Transfer) this.port.postMessage({ id: message.id, result: result.value } satisfies Message, result.buffers);
      else this.port.postMessage({ id: message.id, result } satisfies Message);
    } catch (e) {
      const error = e as Error & { status?: number };
      this.port.postMessage({ id: message.id, error: { message: error.message ?? String(e), name: error.name ?? 'Error', status: error.status } } satisfies Message);
    }
  }
}
