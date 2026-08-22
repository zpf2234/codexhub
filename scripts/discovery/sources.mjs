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
  { id: 'github-code-plugin-skills', kind: 'skill', coverage: 'supplemental', query: 'filename:SKILL.md path:skills' },
  { id: 'github-code-plugin-manifest', kind: 'plugin', coverage: 'supplemental', query: 'filename:plugin.json path:.codex-plugin' },
  { id: 'github-code-agent-plugin-manifest', kind: 'plugin', coverage: 'supplemental', query: 'filename:plugin.json path:.agent-plugin' },
  { id: 'github-code-claude-plugin-manifest', kind: 'plugin', coverage: 'supplemental', query: 'filename:plugin.json path:.claude-plugin' },
  { id: 'github-code-plugin-mcp', kind: 'mcp', coverage: 'supplemental', query: 'filename:.mcp.json' },
  { id: 'github-code-mcp-json', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.json' },
  { id: 'github-code-plugin-app', kind: 'mcp', coverage: 'supplemental', query: 'filename:.app.json' },
  { id: 'github-code-project-hooks', kind: 'hook', coverage: 'supplemental', query: 'filename:hooks.json path:.codex' },
  { id: 'github-code-hooks-anywhere', kind: 'hook', coverage: 'supplemental', query: 'filename:hooks.json' },
  { id: 'github-code-plugin-hooks', kind: 'hook', coverage: 'supplemental', query: 'path:hooks extension:json' },
  { id: 'github-code-codex-config', kind: 'config', coverage: 'supplemental', query: 'filename:config.toml path:.codex' },
  { id: 'github-code-codex-requirements', kind: 'config', coverage: 'supplemental', query: 'filename:requirements.toml path:.codex' },
  { id: 'github-code-codex-agents', kind: 'agent-config', coverage: 'supplemental', query: 'path:.codex/agents extension:toml' },
  { id: 'github-code-codex-rules', kind: 'rule', coverage: 'supplemental', query: 'path:.codex/rules extension:rules' },
  { id: 'github-code-action-prompts', kind: 'prompt', coverage: 'supplemental', query: 'path:.github/codex/prompts extension:md' },
  { id: 'github-code-action-prompt-text', kind: 'prompt', coverage: 'supplemental', query: 'path:.github/codex/prompts extension:txt' },
  { id: 'github-code-custom-prompts', kind: 'prompt', coverage: 'supplemental', query: 'path:.codex/prompts extension:md' },
  { id: 'github-code-marketplace-agents', kind: 'marketplace', coverage: 'supplemental', query: 'filename:marketplace.json path:.agents/plugins' },
  { id: 'github-code-marketplace-claude', kind: 'marketplace', coverage: 'supplemental', query: 'filename:marketplace.json path:.claude-plugin' },
  { id: 'github-code-hooks', kind: 'hook', coverage: 'supplemental', query: 'filename:hooks.json path:hooks' },
  { id: 'github-code-plugin-metadata-yaml', kind: 'skill-metadata', coverage: 'supplemental', query: 'filename:openai.yaml path:agents' },
  { id: 'github-code-plugin-metadata-yml', kind: 'skill-metadata', coverage: 'supplemental', query: 'filename:openai.yml path:agents' },
  { id: 'github-code-agents', kind: 'agents', coverage: 'supplemental', query: 'filename:AGENTS.md' },
  { id: 'github-code-agents-override', kind: 'agents', coverage: 'supplemental', query: 'filename:AGENTS.override.md' },
  { id: 'github-code-team-guide', kind: 'agents', coverage: 'supplemental', query: 'filename:TEAM_GUIDE.md' },
  { id: 'github-code-agents-dot', kind: 'agents', coverage: 'supplemental', query: 'filename:.agents.md' },
  { id: 'github-code-codex-action-yml', kind: 'action', coverage: 'supplemental', query: 'filename:action.yml codex' },
  { id: 'github-code-codex-action-yaml', kind: 'action', coverage: 'supplemental', query: 'filename:action.yaml codex' },
  { id: 'github-code-mcp-yaml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.yaml' },
  { id: 'github-code-mcp-yml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.yml' },
  { id: 'github-code-mcp-toml', kind: 'mcp', coverage: 'supplemental', query: 'filename:mcp.toml' },
  { id: 'github-code-mcp-server-json', kind: 'mcp', coverage: 'supplemental', query: 'filename:server.json modelcontextprotocol.io' },
  { id: 'github-code-mcp-server-json-anywhere', kind: 'mcp', coverage: 'supplemental', query: 'filename:server.json' }
];

export const MCP_REGISTRY_SOURCE = {
  id: 'mcp-official-registry',
  kind: 'mcp',
  endpoint: 'https://registry.modelcontextprotocol.io/v0/servers'
};
