export const GITHUB_SOURCES = [
  { id: 'github-topic-codex-skills', kind: 'skill', coverage: 'exhaustive', query: 'topic:codex-skills fork:false archived:false' },
  { id: 'github-topic-codex-plugin', kind: 'plugin', coverage: 'exhaustive', query: 'topic:codex-plugin fork:false archived:false' },
  { id: 'github-topic-mcp-server', kind: 'mcp', coverage: 'exhaustive', query: 'topic:mcp-server fork:false archived:false' },
  { id: 'github-topic-model-context-protocol', kind: 'mcp', coverage: 'exhaustive', query: 'topic:model-context-protocol fork:false archived:false' },
  { id: 'github-name-codex-skills', kind: 'skill', coverage: 'exhaustive', query: 'codex-skills in:name fork:false archived:false' },
  { id: 'github-name-codex-plugin', kind: 'plugin', coverage: 'exhaustive', query: 'codex-plugin in:name fork:false archived:false' }
];

export const GITHUB_CODE_SOURCES = [
  { id: 'github-code-skill-manifest', kind: 'skill', coverage: 'supplemental', query: 'filename:SKILL.md' },
  { id: 'github-code-repo-skills', kind: 'skill', coverage: 'supplemental', query: 'filename:SKILL.md path:.agents/skills' },
  { id: 'github-code-plugin-manifest', kind: 'plugin', coverage: 'supplemental', query: 'filename:plugin.json path:.codex-plugin' },
  { id: 'github-code-plugin-mcp', kind: 'mcp', coverage: 'supplemental', query: 'filename:.mcp.json' },
  { id: 'github-code-plugin-app', kind: 'mcp', coverage: 'supplemental', query: 'filename:.app.json' },
  { id: 'github-code-marketplace-agents', kind: 'marketplace', coverage: 'supplemental', query: 'filename:marketplace.json path:.agents/plugins' },
  { id: 'github-code-marketplace-claude', kind: 'marketplace', coverage: 'supplemental', query: 'filename:marketplace.json path:.claude-plugin' },
  { id: 'github-code-hooks', kind: 'hook', coverage: 'supplemental', query: 'filename:hooks.json path:hooks' },
  { id: 'github-code-plugin-metadata-yaml', kind: 'plugin-metadata', coverage: 'supplemental', query: 'filename:openai.yaml path:agents' },
  { id: 'github-code-plugin-metadata-yml', kind: 'plugin-metadata', coverage: 'supplemental', query: 'filename:openai.yml path:agents' },
  { id: 'github-code-agents', kind: 'agents', coverage: 'supplemental', query: 'filename:AGENTS.md' },
  { id: 'github-code-codex-action-yml', kind: 'action', coverage: 'supplemental', query: 'filename:action.yml codex' },
  { id: 'github-code-codex-action-yaml', kind: 'action', coverage: 'supplemental', query: 'filename:action.yaml codex' },
  { id: 'github-code-mcp-yaml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.yaml' },
  { id: 'github-code-mcp-yml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.yml' },
  { id: 'github-code-mcp-toml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.toml' }
];

export const MCP_REGISTRY_SOURCE = {
  id: 'mcp-official-registry',
  kind: 'mcp',
  endpoint: 'https://registry.modelcontextprotocol.io/v0/servers'
};
