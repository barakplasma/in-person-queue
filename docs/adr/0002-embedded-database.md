# ADR 0002: Embedded database: Redka on SQLite

- Status: Accepted (2026-10-03)

## Context

The server ([ADR 0001](0001-go-server.md)) needs durable storage for:

- queues: a password hash, a message and an expiry;
- an ordered list of people per queue, where we can ask "what is this person's position?".

Priorities, from the maintainer: **maintainability and easy, rock-solid operation** come first, ahead of performance or binary size. Rely on an established embedded store instead of hand-rolled persistence, and run no separate database server.

## Options considered

All of them are embeddable, and all compile with `CGO_ENABLED=0`.

| Option                                   | What it is                                                  | Fit                          | Why not chosen                                                                        |
| ---------------------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| **Hand-rolled** (map + JSON snapshot)    | our own code                                                | trivial                      | we'd own fsync/rename correctness; up to ~1 s lost on a crash                         |
| **bbolt**                                | etcd's B+tree key/value store                               | very reliable                | we'd write the queue ordering, expiry and encoding ourselves; weak inspection tooling |
| **SQLite, plain** (`modernc.org/sqlite`) | SQL                                                         | very reliable, great tooling | we'd own a schema, its migrations and ~100 lines of SQL                               |
| **BuntDB**                               | in-memory KV with an append-only log, TTL and spatial index | good features                | one author, inactive since 2024, no tooling                                           |
| **NutsDB**                               | pure-Go store with Redis-like sorted sets                   | good API                     | its own file format with periodic compaction; no tooling outside the Go API           |
| **Badger / Pebble**                      | LSM trees                                                   | overkill                     | background compaction, many files, tuning knobs                                       |
| **Redka** (on `modernc.org/sqlite`)      | Redis data types (hash, sorted set, …) stored in SQLite     | **chosen**                   |                                                                                       |

## Decision

**Redka on the pure-Go `modernc.org/sqlite` driver.**

- **Redis data types are the natural model for a queue.** A sorted set scored by ticket number gives the position directly (`ZRANK` + 1), and serving the head is `ZRANGE 0 0` + `ZREM`. There's almost no storage code of our own.
- **SQLite underneath is the most proven storage engine there is.**
  - Every change is a transaction with `synchronous=full`, so a crash (including power loss) loses nothing.
  - The file opens with the standard `sqlite3` CLI.
  - Backups are `.backup` or [Litestream](https://litestream.io).
- **Low lock-in.** If Redka were ever abandoned, the data is still an ordinary SQLite file.
- **Pure Go.** It cross-compiles with `CGO_ENABLED=0` to linux (amd64, arm64, arm/v7, riscv64), darwin (amd64, arm64), windows (amd64, arm64) and freebsd. CI runs the Go tests on amd64 and arm64.

### Data model

| Key               | Type       | Contents                                                                                                       |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `queue:<lat,lon>` | hash       | `password` (SHA-256), `message`, `seq` (last ticket number), `expires` (unix ms), `joined:<user id>` (unix ms) |
| `users:<lat,lon>` | sorted set | user id (`A001`…`Z999`, from the ticket number) → ticket number                                                |

### Notes

- **Expiry** is an `expires` field plus a sweep every 10 s, which deletes expired queues and wakes their open pages. We don't use Redka's key TTL: in redka v1.0.1, writing to a key after its TTL has passed keeps the old expiry, so a queue re-created at the same spot stayed invisible. `TestExpiry` guards this. Worth reporting upstream and revisiting.
- `expires` is stored as a decimal string, because unix milliseconds overflow a 32-bit `int` on linux/arm.
- "Nearby queues" is a scan over `queue:*` keys with a haversine distance. That's fine up to the 10,000-queue cap.
- Pragmas are Redka's documented defaults (WAL, `foreign_keys=on`, `temp_store=memory`), except `synchronous=full`.
