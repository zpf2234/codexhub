const PATH_RULES = [
  { category: 'skill', type: 'skill', label: 'Skill', test: (path) => /(?:^|\/)skill\.md$/i.test(path) },
  { category: 'plugin', type: 'plugin', label: 'Plugin manifest', test: (path) => /(?:^|\/)\.codex-plugin\/plugin\.json$/i.test(path) },
  { category: 'mcp', type: 'mcp', label: 'MCP configuration', test: (path) => /(?:^|\/)(?:\.mcp\.json|\.app\.json)$/i.test(path) || /(?:^|\/)(?:mcp|mcp-server|server|servers)\.(?:json|ya?ml|toml)$/i.test(path) },
  { category: 'marketplace', type: 'marketplace', label: 'Plugin marketplace', test: (path) => /(?:^|\/)(?:\.agents\/plugins|\.claude-plugin)\/marketplace\.json$/i.test(path) },
  { category: 'hook', type: 'hook', label: 'Codex hook', test: (path) => /(?:^|\/)hooks\/hooks\.json$/i.test(path) || /(?:^|\/)hooks\/[^/]+\.json$/i.test(path) },
  { category: 'plugin-metadata', type: 'plugin-metadata', label: 'Plugin metadata', test: (path) => /(?:^|\/)agents\/openai\.ya?ml$/i.test(path) },
  { category: 'agents', type: 'agents', label: 'AGENTS guidance', test: (path) => /(?:^|\/)(?:agents|agents\.override)\.md$/i.test(path) },
  { category: 'action', type: 'action', label: 'GitHub Action', test: (path) => /(?:^|\/)action\.ya?ml$/i.test(path) }
];

export const CATEGORY_ORDER = ['skill', 'plugin', 'mcp', 'marketplace', 'hook', 'plugin-metadata', 'agents', 'action', 'other'];
export const CATEGORY_LABELS = {
  all: 'All artifacts',
  skill: 'Skills',
  plugin: 'Plugins',
  mcp: 'MCP',
  marketplace: 'Marketplaces',
  hook: 'Hooks',
  'plugin-metadata': 'Plugin metadata',
  agents: 'AGENTS.md',
  action: 'Actions',
  other: 'Other'
};

export function classifyPath(filePath = '') {
  const normalized = String(filePath).replaceAll('\\', '/');
  return PATH_RULES.find((rule) => rule.test(normalized)) || { category: 'other', type: 'other', label: 'Other artifact' };
}

export function classifyArtifact(artifact = {}) {
  if (artifact.category && CATEGORY_LABELS[artifact.category]) return { category: artifact.category, type: artifact.type || artifact.category, label: CATEGORY_LABELS[artifact.category] };
  if (artifact.source === 'mcp-registry' || artifact.type === 'mcp-registry') return { category: 'mcp', type: 'mcp-registry', label: 'MCP Registry' };
  return classifyPath(artifact.path || '');
}

function withClassification(artifact) {
  const classification = classifyArtifact(artifact);
  return { ...artifact, category: classification.category, artifactType: artifact.artifactType || classification.type, categoryLabel: classification.label };
}

export function normalizeDiscovery(payload = {}) {
  const repositories = (payload.repositories || []).map((repository) => ({ ...repository, categories: [...new Set((repository.categories || []).concat(repository.sourceKinds || []))].filter((value) => CATEGORY_LABELS[value]).sort() }));
  const artifacts = (payload.artifacts || []).map(withClassification);
  const existing = new Set(artifacts.map((artifact) => artifact.id));
  for (const repository of repositories) {
    for (const server of repository.registryServers || []) {
      if (existing.has(server.id)) continue;
      artifacts.push(withClassification({
        id: server.id,
        type: 'mcp-registry',
        category: 'mcp',
        path: server.name,
        status: 'registry',
        verification: 'registry',
        note: 'Published by the official MCP Registry; CodexHub does not connect to the server.',
        source: 'mcp-registry',
        repository: repository.fullName,
        repositoryUrl: repository.url,
        name: server.name,
        version: server.version,
        description: server.description
      }));
    }
  }
  const repositoryIndex = new Map(repositories.map((repository) => [String(repository.fullName).toLowerCase(), repository]));
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const repository = repositoryIndex.get(String(artifact.repository).toLowerCase());
    if (!repository) continue;
    artifacts[index] = { ...artifact, repositoryUrl: artifact.repositoryUrl || repository.url, defaultBranch: artifact.defaultBranch || repository.defaultBranch, stars: artifact.stars ?? repository.stars };
    if (!repository.categories.includes(artifact.category)) repository.categories.push(artifact.category);
  }
  for (const repository of repositories) repository.categories.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const categoryCounts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, artifacts.filter((artifact) => artifact.category === category).length]));
  const verificationCounts = Object.fromEntries(['verified', 'discovered', 'registry', 'unknown'].map((status) => [status, artifacts.filter((artifact) => artifact.status === status).length]));
  const coverage = { ...(payload.coverage || {}), categoryCounts, verificationCounts, artifactsDiscovered: artifacts.length };
  return { ...payload, schemaVersion: '1.1.0', repositories, artifacts, coverage };
}
