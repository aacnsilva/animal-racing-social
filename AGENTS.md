# Animal Racing Social

See `README.md` for the project overview.

## Workflow

We work trunk-based (TBD). `main` is the trunk:

- Keep branches short-lived (hours, at most a day or two) and changes small.
- Merge into `main` often; do not build up long-running feature branches.
- Keep `main` green and releasable. Hide unfinished work behind a flag instead of holding it on a branch.

## Linting and formatting

- TypeScript (all packages): run from the repo root after `npm ci`.
  - `npm run lint` / `npm run lint:fix` — oxlint with type-aware rules (`.oxlintrc.json`).
  - `npm run fmt` / `npm run fmt:check` — oxfmt (`.oxfmtrc.json`).
- Rust (`engine/`): lints live in `[workspace.lints]` in `engine/Cargo.toml`; every crate opts in with `[lints] workspace = true`.
  - `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings`.
- No code comments: `ars/no-comments` (custom oxlint plugin in `lint/oxlint-plugin.ts`) covers TS/TSX, and `lint/check-no-comments.ts` covers Rust and CSS. Both run as part of `npm run lint`. Only tool directives (`oxlint-disable`, `@ts-expect-error`) are allowed.
- CI runs all of these checks; keep them green before merging to `main`.
