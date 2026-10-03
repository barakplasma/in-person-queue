# ADR 0002: Hand-rolled JSON snapshot vs an embedded database

- Status: Proposed (2026-10-03), waiting on the maintainer's choice
- Deciding factor, from the maintainer: easy and rock-solid operation matters more than performance.

## Context

ADR 0001 keeps all state in memory and writes it to `state.json` at most once a second (temp file, fsync, rename, fsync the directory). The question is whether a real embedded database would make operations easier or safer.

Whatever we pick, these parts stay the same:

- the in-memory pub/sub that wakes server-sent-event streams;
- the HTTP API;
- one replica.

Only the storage layer underneath changes.

The data is small and short-lived:

- at most 10,000 queues;
- at most 1,000 people per queue;
- everything expires after 24 hours;
- realistically, a few KB in total.

## Options

Binary sizes below are measured: a static `CGO_ENABLED=0` build with `-s -w`, linking net/http plus the library.

|                           | **A. JSON snapshot (today)**                     | **B. bbolt**                                          | **C. SQLite (`modernc.org/sqlite`)**                                                   | **D. BuntDB**                                       |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| What it is                | our code: map + mutex + atomic file write        | etcd's B+tree key/value store, one file               | the SQLite engine, translated to pure Go (no cgo)                                      | in-memory key/value store with an append-only log   |
| Data lost on a crash      | up to ~1 s of changes                            | none (fsync per commit)                               | none (WAL, fsync per commit)                                                           | none with `SyncPolicy: Always` (default: up to 1 s) |
| Corruption resistance     | good: a reader only ever sees a complete file    | very good (used by etcd and Kubernetes)               | best in class (billions of deployments, huge test suite)                               | ok: the log is rewritten in the background          |
| Look at the data          | `jq state.json`                                  | `bbolt` CLI; values are our own JSON blobs            | `sqlite3 state.db` and plain SQL                                                       | none (custom log format)                            |
| Backups                   | copy the file at any time                        | hot backup through `tx.WriteTo`, which we must expose | `sqlite3 .backup`, `VACUUM INTO`, or **Litestream** continuous replication to S3/MinIO | copy the log                                        |
| Expiry                    | our sweep loop                                   | our sweep loop                                        | `DELETE … WHERE expires_at < now` with an index                                        | built-in TTL                                        |
| "Nearby" query            | our O(n) scan                                    | our O(n) scan                                         | bounding-box query on indexed lat/lon, then haversine                                  | built-in R-tree spatial index                       |
| Schema changes            | change the struct; the JSON tolerates new fields | our encoding, our migrations                          | `PRAGMA user_version` migrations                                                       | our encoding                                        |
| Code we own for storage   | ~80 lines, including the fsync/rename details    | ~100 lines of key and encoding glue                   | ~100 lines of SQL plus migrations                                                      | ~60 lines                                           |
| Dependencies              | none                                             | `x/sys` only; needs Go ≥ 1.25                         | a large generated C→Go library (≈25 modules)                                           | ~10 small modules from one author                   |
| Binary                    | 5.6 MB                                           | 5.8 MB                                                | **10.0 MB**                                                                            | 5.6 MB                                              |
| Maturity / bus factor     | it's our code                                    | very high (etcd-io, CNCF)                             | engine: extreme; Go translation: mostly one maintainer, tracks every SQLite release    | one author, last release Sep 2024                   |
| Two processes on one file | last writer wins (k8s `Recreate` prevents it)    | file lock: the second one waits                       | file lock + WAL: safe                                                                  | not safe                                            |

Rejected outright: **Badger** and **Pebble**. They are LSM trees with background compaction, many files and tuning knobs, built for write-heavy datasets far larger than ours. They would be harder to operate, the opposite of what we want.

## Recommendation

**C. SQLite via `modernc.org/sqlite`**, if the goal is the most boring operations possible:

- Zero data loss on a crash, from the most-tested storage engine there is.
- Anyone can open the file with the `sqlite3` CLI and run SQL. There is nothing project-specific to learn.
- Backups are a solved problem:
  - `sqlite3 state.db ".backup x"` for a one-off;
  - [Litestream](https://litestream.io) as a sidecar for continuous replication to MinIO or S3. That fits a self-hosted k3s setup well, and it makes losing the PVC survivable.
- Expiry and "nearby" become indexed queries instead of our own loops.
- It stays pure Go: `CGO_ENABLED=0`, the `FROM scratch` image, and cross-compiling to arm64 all keep working.

The costs:

- +4.4 MB binary.
- One large dependency tree that Dependabot needs to keep updated.
- Schema migrations become a thing, though there are only two small tables.

**Runner-up: B. bbolt.** Choose it if minimal dependencies matter more than tooling. It has the same zero-loss durability and an excellent track record, but inspection and backup tooling is weaker, and we'd still own the expiry and nearby logic.

**Keep A** if a little over a second of possible loss on a hard crash is acceptable. Crash loss is the only real weakness at this data size; on a graceful shutdown nothing is lost. A also has the fewest moving parts.

**Not D.** BuntDB fits the feature set best (TTL plus spatial index), but it has a single author, no tooling, and a niche file format, so it is the weakest on "rock solid".

## If C is chosen

```sql
CREATE TABLE queues (
  location      TEXT PRIMARY KEY,   -- "lat,lon", 4 decimals
  lat REAL NOT NULL, lon REAL NOT NULL,
  password_hash BLOB NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  expires_at    INTEGER NOT NULL    -- unix seconds
);
CREATE INDEX queues_expiry ON queues(expires_at);
CREATE INDEX queues_lat_lon ON queues(lat, lon);

CREATE TABLE users (
  location TEXT NOT NULL REFERENCES queues ON DELETE CASCADE,
  seq      INTEGER NOT NULL,        -- order in the queue
  user_id  TEXT NOT NULL,
  PRIMARY KEY (location, seq),
  UNIQUE (location, user_id)
);
```

- Open with `journal_mode=WAL`, `synchronous=FULL` and `busy_timeout`.
- Each `Store` method becomes one transaction.
- The mutex stays, but only to guard the subscriber map.
- Position is `SELECT count(*) FROM users WHERE location=? AND seq <= (…)`.
- `state.json` → `state.db`. The chart and Docker volume stay as they are.
- On first start, if a `state.json` exists, import it once, then rename it to `state.json.imported`.
