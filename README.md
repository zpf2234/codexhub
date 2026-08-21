# CodexHub

## Codex ecosystem index

[![CI](https://github.com/zpf2234/codexhub/actions/workflows/ci.yml/badge.svg)](https://github.com/zpf2234/codexhub/actions/workflows/ci.yml)
[![Pages](https://github.com/zpf2234/codexhub/actions/workflows/pages.yml/badge.svg)](https://zpf2234.github.io/codexhub/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Current release: **v0.1.0**. Catalog and scoring schemas are versioned so future changes can evolve without silently changing existing API contracts.

CodexHub is a community-maintained directory of Codex Skills, Plugins, MCP servers, and `AGENTS.md` resources. It publishes repository quality signals with evidence links, a transparent rubric, and a machine-readable catalog.

Browse the live catalog at https://zpf2234.github.io/codexhub/.

> CodexHub is independent and is not affiliated with or endorsed by OpenAI. A listing is not a security audit, endorsement, or guarantee.

### What v0.1 does

- Curates entries in `catalog/entries/` with a versioned JSON format.
- Detects supported Codex artifacts without executing repository code.
- Scores specification conformance, documentation, maintenance, distribution hygiene, and transparency.
- Builds a static searchable site and `dist/api/v1/catalog.json`.
- Compares up to three projects with quality and popularity signals side by side.
- Discovers review candidates weekly without auto-publishing them.
- Crawls declared GitHub sources with pagination, query partitioning, checkpoint recovery, and repository-tree artifact discovery; MCP servers are also read from the official MCP Registry.
- Runs deterministic checks locally and on GitHub Actions.

### Quick start

```powershell
npm test
npm run build:offline
python -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

### Discovery API

`npm run discover` produces an independently auditable dataset under `artifacts/discovery/`. A cached build publishes the same files at `dist/api/v1/discovery/`:

- `discovery.json`: combined repository, artifact, source, and error data.
- `repositories.json`: deduplicated repository candidates and source provenance.
- `artifacts.json`: individual `SKILL.md`, Plugin manifest, `AGENTS.md`, Action, and MCP metadata matches.
- `coverage.json`: source queries, partitions, page counts, completion state, and known limitations.
- `errors.json`: rate-limit, unavailable, and truncated-source errors.

The dataset is complete only relative to its declared sources and the crawl time. GitHub search indexing, rate limits, private/deleted repositories, and recursive-tree truncation remain explicit limitations. Discovery never executes indexed code or connects to MCP servers. Use `npm run discover -- --fresh` to discard the previous checkpoint, or `DISCOVERY_MAX_REPOSITORIES=100 npm run discover` for a bounded test run.

For operational recovery, `GITHUB_DISCOVERY_TIMEOUT_MS` and `GITHUB_DISCOVERY_RETRIES` bound individual GitHub requests. The scheduled job processes at most three GitHub sources, 50 repositories, and 20 MCP Registry pages per day. `DISCOVERY_MAX_SOURCES_PER_RUN`, `DISCOVERY_MAX_REPOSITORIES`, and `MCP_REGISTRY_MAX_PAGES` tune those batches; the checkpoint stores source completion plus repository/cursor positions so later runs continue the same cycle. Repository trees use bounded concurrency configured by `DISCOVERY_SCAN_CONCURRENCY`. `DISCOVERY_SOURCES=github-topic-codex-skills` can isolate one source while diagnosing a failed scheduled run.

### Supported artifacts

- **Skill**: a `SKILL.md` with YAML frontmatter containing `name` and `description`.
- **Plugin**: `.codex-plugin/plugin.json` with `name`, `version`, and `description`.
- **AGENTS**: a declared `AGENTS.md` or `AGENTS.override.md` path.
- **Action**: a repository `action.yml` or `action.yaml` describing a GitHub Action.
- **Tool**: a first-party or community tool listed for ecosystem context.
- **MCP**: metadata-only listings in v0.1. CodexHub never launches or connects to a server.

See [the catalog format](docs/catalog-format.md), [the scoring rubric](docs/scoring.md), and [the security model](docs/security-model.md).

### Contributing

Add one entry under `catalog/entries/`, run the checks, and open a pull request. Use the templates for corrections or removals. See [CONTRIBUTING.md](CONTRIBUTING.md).
