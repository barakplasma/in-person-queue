declare module OpenLocationCode {
  function encode(latitude: number, longitude:number): string;
}

declare function io(host: string, config?: {
  auth?: {
    queue: string | null,
    password: string | null
  }
}): {
  on(eventName: string, cb: VoidFunction): void;
  emit(eventName: string, ...args: (VoidFunction|string)[]): void;
};