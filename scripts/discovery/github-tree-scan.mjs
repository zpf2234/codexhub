const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/vnd.github+json' };

const artifactId = (fullName, filePath) => `github:${fullName.toLowerCase()}#${filePath}`;
const pathName = (value) => value.split('/').at(-1).toLowerCase();

function classify(filePath) {
  const lower = filePath.toLowerCase();
  if (pathName(filePath) === 'skill.md') return 'skill';
  if (lower.endsWith('/.codex-plugin/plugin.json') || lower === '.codex-plugin/plugin.json') return 'plugin';
  if (pathName(filePath) === '.mcp.json' || pathName(filePath) === '.app.json') return 'mcp';
  if (pathName(filePath) === 'agents.md' || pathName(filePath) === 'agents.override.md') return 'agents';
  if (pathName(filePath) === 'action.yml' || pathName(filePath) === 'action.yaml') return 'action';
  if (/^(.+\/)?(?:mcp|mcp-server|server|servers)\.(json|ya?ml|toml)$/i.test(filePath)) return 'mcp';
  return null;
}

function validate(type, content, filePath) {
  if (!content.trim()) return { valid: false, note: 'File is empty.' };
  if (type === 'skill') {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const frontmatter = match?.[1] || '';
    return { valid: Boolean(match && /^name:\s*\S+/m.test(frontmatter) && /^description:\s*\S+/m.test(frontmatter)), note: 'Requires YAML frontmatter with name and description.' };
  }
  if (type === 'plugin' || (type === 'mcp' && filePath.toLowerCase().endsWith('.json'))) {
    try { JSON.parse(content); return { valid: true, note: 'Valid JSON metadata.' }; }
    catch { return { valid: false, note: 'Metadata is not valid JSON.' }; }
  }
  if (type === 'action') return { valid: /^name:\s*\S+/m.test(content) && /^runs:\s*$/m.test(content), note: 'Requires name and runs keys.' };
  return { valid: true, note: 'Non-empty evidence file.' };
}

export async function scanRepository(candidate, { fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, maxArtifacts = 500, timeoutMs = Number(process.env.GITHUB_DISCOVERY_TIMEOUT_MS || 20_000) } = {}) {
  const headers = { ...DEFAULT_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const base = `https://api.github.com/repos/${candidate.owner}/${candidate.name}`;
  const request = async (url, init = {}) => {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { ...headers, ...(init.headers || {}) } });
      if (!response.ok) return { ok: false, error: `GitHub API ${response.status}` };
      return { ok: true, data: await response.json() };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  const repo = await request(base);
  if (!repo.ok) return { repository: candidate, artifacts: [], status: 'unavailable', errors: [repo.error] };
  const branch = repo.data.default_branch || candidate.defaultBranch || 'main';
  const tree = await request(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!tree.ok) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: 'partial', errors: [tree.error] };
  const files = (tree.data.tree || []).filter((item) => item.type === 'blob' && classify(item.path));
  const artifacts = [];
  for (const [index, file] of files.entries()) {
    const type = classify(file.path);
    if (index >= maxArtifacts) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, path: file.path, status: 'discovered', verification: 'deferred', note: 'Artifact path was discovered from the complete repository tree; content verification is deferred.', source: 'github-tree' });
      continue;
    }
    const content = await request(`${base}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (!content.ok || !content.data?.content) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, path: file.path, status: 'unknown', verification: 'unavailable', note: content.error || 'Content unavailable.' });
      continue;
    }
    const decoded = Buffer.from(content.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const result = validate(type, decoded, file.path);
    artifacts.push({ id: artifactId(candidate.fullName, file.path), type, path: file.path, status: result.valid ? 'verified' : 'unknown', verification: result.valid ? 'passed' : 'failed', note: result.note, source: 'github-tree' });
  }
  return { repository: { ...candidate, defaultBranch: branch, archived: repo.data.archived, stars: repo.data.stargazers_count, forks: repo.data.forks_count, license: repo.data.license?.spdx_id || candidate.license }, artifacts, status: tree.data.truncated ? 'partial' : 'fresh', truncated: Boolean(tree.data.truncated), verifiedArtifacts: Math.min(files.length, maxArtifacts), deferredArtifacts: Math.max(0, files.length - maxArtifacts), errors: tree.data.truncated ? ['GitHub recursive tree response was truncated.'] : [] };
}
