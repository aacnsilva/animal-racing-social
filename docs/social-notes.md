# Social layer: notes for later

Captured during the betting API design; the social layer is built after betting.

- **Sharding by user.** Postgres sharded by `userId`. User IDs are already
  shard-aware (64-bit: timestamp | logical shard | sequence; see
  `docs/api/platform.md` §1), so betting data written today needs no migration.
- **Celebrity pot.** High-follower accounts are handled with fan-out on
  **read**: their posts are merged into followers' feeds at read time instead
  of being written into every follower's feed. Regular accounts use fan-out
  on write. Threshold for "celebrity" is TBD (e.g. > 10k followers), with
  hysteresis so accounts don't flap.
- Race results, big payouts and season champions are the planned feed
  content (`bet.events`, `season.events`, `stable.events`).
