# CodexHub

## Codex ecosystem index

CodexHub is a community-maintained directory of Codex Skills, Plugins, MCP servers, and `AGENTS.md` resources. It publishes repository quality signals with evidence links, a transparent rubric, and a machine-readable catalog.

Browse the live catalog at https://zpf2234.github.io/codexhub/.

> CodexHub is independent and is not affiliated with or endorsed by OpenAI. A listing is not a security audit, endorsement, or guarantee.

### What v0.1 does

- Curates entries in `catalog/entries/` with a versioned JSON format.
- Detects supported Codex artifacts without executing repository code.
- Scores specification conformance, documentation, maintenance, distribution hygiene, and transparency.
- Builds a static searchable site and `dist/api/v1/catalog.json`.
- Runs deterministic checks locally and on GitHub Actions.

### Quick start

```powershell
npm test
npm run build:offline
python -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

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
