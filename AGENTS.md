# Working on this experiment

- Read README.md, the [Reylo agent guidance](https://github.com/colinhacks/reylo/blob/main/skills/using-reylo/SKILL.md), and the relevant upstream API source before changing an integration.
- Run commands through `scripts/tools`; the Bun and Node pins live in `mise.toml`. Do not change global toolchains or security settings.
- The application uses `SQL` from `bun`, with the SQLite adapter. Do not replace it with `bun:sqlite`.
- Initialize the schema with `scripts/tools bun run init` before tests, typechecking, or builds. Reylo reads the development schema in `data/app.db` through `.reylo.yaml`.
- Keep each runtime query in a separate `.sql` file and let Reylo infer its types. Use each named parameter once. Migrations belong under `db/`, outside the content-mapper input.
- Run replication under Node in a separate process. Keep sync and snapshot calls serialized, fail on replication errors, and restore only into a separate fresh target.
- Required checks after meaningful changes: `scripts/tools bun test`, `scripts/tools bun run typecheck`, `scripts/tools bun run build`, and `scripts/tools bun run drill` when persistence or replication changes.
- Use synthetic data. Keep databases, WALs, credentials, replica files, caches, dependencies, and build outputs out of Git. No public hosting or paid services for this demo.
