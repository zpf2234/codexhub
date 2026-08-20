# Catalog format

Each `catalog/entries/*.json` file describes one public repository. Required fields are `id`, `kind`, `repository`, `title`, `summary`, `license`, `artifacts`, and `curated`. `kind` may be `skill`, `plugin`, `mcp`, `agents`, `action`, or `tool`.

`repository` contains `owner`, `name`, and `url`. `artifacts` is an array of evidence objects with a `type`, `path`, and `status`. Status is `verified`, `declared`, or `unknown`.

MCP entries are metadata-only. They may describe a server and its transport, but CodexHub does not connect to or execute it.
