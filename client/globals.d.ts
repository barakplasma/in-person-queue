declare module OpenLocationCode {
  function encode(latitude: number, longitude: number): string;
  function isValid(openLocationCode: string): boolean;
}

declare function io(
  host: string,
  config?: {
    auth?: {
      queue: string | null;
      password: string | null;
    };
  }
): {
  on(eventName: string, cb: CallableFunction): void;
  emit(eventName: string, ...args: (CallableFunction | string)[]): void;
  id: string;
};
