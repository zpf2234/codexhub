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
- Discovers review candidates daily in resumable batches without auto-publishing them.
- Crawls declared GitHub sources with pagination, query partitioning, checkpoint recovery, and repository-tree artifact discovery; MCP servers are also read from the official MCP Registry.
- Runs deterministic checks locally and on GitHub Actions.

### Quick start

```powershell
npm test
npm run dashboard
```

Then open `http://127.0.0.1:4173/discovery.html`. The command builds from the latest local checkpoint and starts a no-cache local server without crawling the network.

The dashboard also refreshes a read-only inventory of local Codex component paths under `CODEX_HOME`, `~/.agents`, and the current project. It records only recognized paths and classifications; it does not read credentials, execute component code, upload the inventory, or connect to MCP servers. Use `CODEX_LOCAL_ROOTS=path1;path2` to add custom local roots, or `npm run inventory:local` to refresh the inventory without starting the server.

If port `4173` is already occupied, the dashboard automatically selects the next available local port. You can pin one explicitly with `npm run dashboard -- --port 4174`.

To advance the local discovery snapshot first, run one bounded batch and then open the dashboard:

```powershell
npm run crawl:local
npm run dashboard
```

The local crawler defaults to one source, 25 repository trees, two content validations per repository, and three MCP Registry pages. Override the corresponding environment variables when you want a larger batch.

### Discovery API

`npm run discover` produces an independently auditable dataset under `artifacts/discovery/`. A cached build publishes the same files at `dist/api/v1/discovery/`:

- `discovery.json`: combined repository, artifact, source, and error data.
- `repositories.json`: deduplicated repository candidates and source provenance.
- `artifacts.json`: individual `SKILL.md`, Plugin manifest, MCP configuration/app mappings, `AGENTS.md`, Action, and related metadata matches.
- `coverage.json`: source queries, partitions, page counts, completion state, and known limitations.
- `errors.json`: rate-limit, unavailable, and truncated-source errors.
- `schema.json`: JSON Schema for the normalized discovery snapshot.
- `dashboard.json`: compact projection used by the visual dashboard; raw Registry and checkpoint metadata stay in the full API.

The dataset is complete only relative to its exhaustive declared sources and the crawl time. Those sources are Codex-specific repository topics/names plus the official MCP Registry. Global manifest Code Search is broader but GitHub caps every query at 1,000 results, so it is published separately as supplemental coverage and never used to claim internet-wide completeness. GitHub search indexing, rate limits, private/deleted repositories, and recursive-tree truncation remain explicit limitations. Discovery never executes indexed code or connects to MCP servers. Use `npm run discover -- --fresh` to discard the previous checkpoint, or `DISCOVERY_MAX_REPOSITORIES=100 npm run discover` for a bounded test run.

For operational recovery, `GITHUB_DISCOVERY_TIMEOUT_MS` and `GITHUB_DISCOVERY_RETRIES` bound individual GitHub requests, while `GITHUB_DISCOVERY_MAX_SEGMENTS_PER_RUN` bounds how many mutually exclusive date/star partitions one source advances in a batch. Unfinished partitions and failed API calls remain in the checkpoint for later retry. The scheduled job runs hourly, advances one GitHub search source, reads at most 600 repository trees with bounded concurrency, advances ten MCP Registry pages, and has a 30-minute safety limit for large checkpoints. Limiting each run to one search source reserves GitHub API capacity for repository-tree enumeration. If the API reports zero remaining quota, tree scanning stops cleanly and leaves untouched candidates for the next run instead of recording hundreds of false repository failures. The scan queue reserves 25% of each batch for previous failures and uses the remainder for new candidates; set `DISCOVERY_SCAN_RETRY_SHARE` to tune that balance. Discovery enumerates every matching tree path; the scheduled pass leaves content verification deferred (`DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY=0`) so the full path inventory completes without spending the API budget on file contents. `DISCOVERY_MAX_SOURCES_PER_RUN`, `DISCOVERY_MAX_REPOSITORIES`, `DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY`, and `MCP_REGISTRY_MAX_PAGES` tune those batches. Failed or truncated repository trees remain in a fair retry queue and block completion until every discovered GitHub repository has a fresh, non-truncated tree scan. Repository trees use bounded concurrency configured by `DISCOVERY_SCAN_CONCURRENCY`. Completed cycles reset their scan snapshots so known repositories are refreshed instead of remaining permanently cached. Source-query algorithm upgrades invalidate old source reports without discarding completed repository scans. `DISCOVERY_SOURCES=github-topic-codex-skills` can isolate one incomplete source while diagnosing a failed scheduled run.

### Supported artifacts

- **Skill**: a `SKILL.md` with YAML frontmatter containing `name` and `description`.
- **Plugin**: `.codex-plugin/plugin.json` with `name`, `version`, and `description`; compatible `.agent-plugin/plugin.json` and `.claude-plugin/plugin.json` manifests are also indexed.
- **MCP**: `.mcp.json` or `mcp.json` bundled/server configuration; `.app.json` is retained as the `mcp-app` type for registered MCP app mappings.
- **Hooks**: `hooks/hooks.json`, other `hooks/*.json`, and project `.codex/hooks.json` lifecycle configuration.
- **Codex config**: project `.codex/config.toml` and `.codex/requirements.toml`, which may declare MCP servers, hooks, and managed requirements.
- **Custom agents**: project `.codex/agents/*.toml` subagent definitions.
- **Execpolicy rules**: project `.codex/rules/*.rules` command policy files.
- **Codex Action prompts**: `.github/codex/prompts/*.md` or `.txt` files passed to `openai/codex-action`; private `~/.codex/prompts` files are not discoverable from GitHub.
- **Agent guidance**: a declared `AGENTS.md`, `AGENTS.override.md`, `TEAM_GUIDE.md`, or `.agents.md` path; Codex's supported fallback guidance names are searched independently.
- **Action**: a repository `action.yml` or `action.yaml` describing a GitHub Action.
- **Tool**: a first-party or community tool listed for ecosystem context.
- **Marketplace**: `.agents/plugins/marketplace.json` and compatible marketplace manifests.
- **Plugin metadata**: `agents/openai.yaml` skill/plugin interface metadata.

CodexHub treats these as metadata only: it never launches indexed code or connects to an MCP server.

See [the catalog format](docs/catalog-format.md), [the scoring rubric](docs/scoring.md), and [the security model](docs/security-model.md).

### Contributing

Add one entry under `catalog/entries/`, run the checks, and open a pull request. Use the templates for corrections or removals. See [CONTRIBUTING.md](CONTRIBUTING.md).
