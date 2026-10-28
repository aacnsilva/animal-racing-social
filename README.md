# Animal Racing Social

A portfolio project: a fictional animal-racing betting app combined with an Instagram-style social network.

> **No real money.** All bets use fictional points with no cash value. Nothing can be bought, cashed out or transferred.

## Vision

Fans follow fictional animal races (snails, turtles, ostriches, corgis...), place point-based predictions, and share the moment: photos, posts and short videos of their favourite racers, race highlights and leaderboards.

The project exists to showcase backend architecture at scale, with two halves that each stress a different set of distributed-systems problems.

## Racing side: event-driven architecture

- **Kafka** as the backbone: race lifecycle events (`race.scheduled`, `race.started`, `race.position-updated`, `race.finished`) flow through topics.
- **Event sourcing** for races and wallets: point balances are derived from an append-only ledger of events.
- **Independent consumers** for odds calculation, bet settlement, leaderboards and notifications, each scaling on its own.
- **Exactly-once-ish settlement** using idempotent consumers, outbox pattern and replayable topics.
- **Live updates** pushed to clients over WebSockets from the event stream.

## Social side: sharding and redundancy

- **Sharded storage** for users, posts, follows and comments (shard key by user id), with a routing layer.
- **Replication and failover**: primary/replica per shard, read replicas for feeds, tested failover.
- **Media pipeline** for photos and short videos: object storage, async transcoding, CDN-style caching.
- **Feeds** built with fan-out on write for most users and fan-out on read for high-follower accounts.
- **Redundancy drills**: kill a node, lose a shard replica, partition the network, and show the system keeps serving.

## Planned stack (subject to change)

- Services: Node.js / TypeScript (and possibly Go for hot paths)
- Messaging: Apache Kafka
- Data: PostgreSQL (sharded), Redis, S3-compatible object storage
- Infra: Docker Compose locally, Kubernetes manifests, OpenTelemetry for tracing
- Clients: web first, mobile later

## Status

Early design. Architecture docs and a first vertical slice (schedule a race, place a points bet, settle it) come first.

## Disclaimer

This is a learning and portfolio project. It does not offer gambling, real-money wagering or prizes of any kind.

## License

MIT
