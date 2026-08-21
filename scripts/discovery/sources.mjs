export const GITHUB_SOURCES = [
  { id: 'github-topic-codex-skills', kind: 'skill', query: 'topic:codex-skills fork:false archived:false' },
  { id: 'github-topic-codex-plugin', kind: 'plugin', query: 'topic:codex-plugin fork:false archived:false' },
  { id: 'github-topic-mcp-server', kind: 'mcp', query: 'topic:mcp-server fork:false archived:false' },
  { id: 'github-topic-model-context-protocol', kind: 'mcp', query: 'topic:model-context-protocol fork:false archived:false' },
  { id: 'github-codex-skills-text', kind: 'skill', query: '"codex" "skill" in:name,description,readme fork:false archived:false' },
  { id: 'github-codex-plugins-text', kind: 'plugin', query: '"codex" "plugin" in:name,description,readme fork:false archived:false' },
  { id: 'github-mcp-text', kind: 'mcp', query: '"mcp" in:name,description,readme fork:false archived:false' },
  { id: 'github-agents-file-text', kind: 'agents', query: '"AGENTS.md" in:name,description,readme fork:false archived:false' }
];

export const GITHUB_CODE_SOURCES = [
  { id: 'github-code-skill-manifest', kind: 'skill', query: 'filename:SKILL.md' },
  { id: 'github-code-repo-skills', kind: 'skill', query: 'filename:SKILL.md path:.agents/skills' },
  { id: 'github-code-plugin-manifest', kind: 'plugin', query: 'filename:plugin.json path:.codex-plugin' },
  { id: 'github-code-plugin-mcp', kind: 'mcp', query: 'filename:.mcp.json' },
  { id: 'github-code-plugin-app', kind: 'mcp', query: 'filename:.app.json' },
  { id: 'github-code-marketplace', kind: 'marketplace', query: 'filename:marketplace.json path:.agents/plugins' },
  { id: 'github-code-hooks', kind: 'hook', query: 'filename:hooks.json path:hooks' },
  { id: 'github-code-plugin-metadata', kind: 'plugin-metadata', query: 'filename:openai.yaml path:agents' },
  { id: 'github-code-agents', kind: 'agents', query: 'filename:AGENTS.md' },
  { id: 'github-code-codex-action', kind: 'action', query: 'filename:action.yml codex' }
];

export const MCP_REGISTRY_SOURCE = {
  id: 'mcp-official-registry',
  kind: 'mcp',
  endpoint: 'https://registry.modelcontextprotocol.io/v0/servers'
};
