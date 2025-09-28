// Add declarations
declare module "ioredis" {
  interface RedisCommander<Context> {
    addToEndOfQueue(
      queue: string,
      userId: string,
      callback?: Callback<string>
    ): Result<string, Context>;
  }
}