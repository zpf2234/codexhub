# Catalog format

Each `catalog/entries/*.json` file describes one public repository. Required fields are `id`, `kind`, `repository`, `title`, `summary`, `license`, `artifacts`, and `curated`. `kind` may be `skill`, `plugin`, `mcp`, `agents`, `action`, or `tool`.

`repository` contains `owner`, `name`, and `url`. `artifacts` is an array of evidence objects with a `type`, `path`, and `status`. Status is `verified`, `declared`, or `unknown`.

MCP entries are metadata-only. They may describe a server and its transport, but CodexHub does not connect to or execute it.

## Discovery format

The scheduled discovery job publishes the compatibility API `api/v1/discovery/discovery.json` plus size-bounded split views. The visual dashboard reads `dashboard-meta.json`, `dashboard-repositories.json`, and `artifacts-####.json` shards so it never needs to download the unbounded aggregate. Discovery records are candidates, not reviewed catalog entries. Each artifact has a stable source-scoped ID and records its repository, path, type, verification result, and provenance. Marketplace plugin references are metadata-only and are never downloaded as part of discovery. `coverage.json` reports every declared source query, page/partition count, truncation, rate-limit or transport error, and whether the crawl is complete for that time and scope. Categories cover Skills, Skill metadata, native or compatible Plugin manifests and marketplace plugin references, MCP configuration/app mappings, marketplaces, hooks, Codex config, custom agents, execpolicy rules, Codex Action prompts, Agent guidance, and Actions. The local dashboard may also merge a path-only `local-filesystem` inventory plus structural config entries from the current Codex installation; credential values are not retained or displayed.
