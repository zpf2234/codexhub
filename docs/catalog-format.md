# Catalog format

Each `catalog/entries/*.json` file describes one public repository. Required fields are `id`, `kind`, `repository`, `title`, `summary`, `license`, `artifacts`, and `curated`. `kind` may be `skill`, `plugin`, `mcp`, `agents`, `action`, or `tool`.

`repository` contains `owner`, `name`, and `url`. `artifacts` is an array of evidence objects with a `type`, `path`, and `status`. Status is `verified`, `declared`, or `unknown`.

MCP entries are metadata-only. They may describe a server and its transport, but CodexHub does not connect to or execute it.

## Discovery format

The scheduled discovery job publishes `api/v1/discovery/discovery.json` and its split views. Discovery records are candidates, not reviewed catalog entries. Each artifact has a stable source-scoped ID and records its repository, path, type, verification result, and provenance. `coverage.json` reports every declared source query, page/partition count, truncation, rate-limit or transport error, and whether the crawl is complete for that time and scope. Categories cover Skills, native or compatible Plugin manifests, MCP configuration/app mappings, marketplaces, hooks, Codex config, `AGENTS.md`, Actions, and plugin metadata.
