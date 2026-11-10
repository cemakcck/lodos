/* A minimal socket.io client stand-in. Kept free of app imports so vi.mock factories can load it. */
export class FakeSocket {
  connected = false;
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, (this.handlers.get(ev) ?? []).filter((f) => f !== fn));
    return this;
  }
  emit(ev: string, ...a: unknown[]) {
    (this.handlers.get(ev) ?? []).forEach((f) => f(...a));
  }
  close() { this.connected = false; }
}

export const sockets: FakeSocket[] = [];
export const socketModule = {
  io: () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  },
};
