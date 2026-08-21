const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/vnd.github+json' };
import { classifyPath } from './model.mjs';

const artifactId = (fullName, filePath) => `github:${fullName.toLowerCase()}#${filePath}`;
function validate(type, content, filePath) {
  if (!content.trim()) return { valid: false, note: 'File is empty.' };
  if (type === 'skill') {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const frontmatter = match?.[1] || '';
    const name = frontmatter.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    return { valid: Boolean(match && name && description), note: 'Requires YAML frontmatter with name and description.', metadata: { name, description } };
  }
  if (['plugin', 'mcp', 'marketplace', 'hook'].includes(type) && filePath.toLowerCase().endsWith('.json')) {
    try {
      const value = JSON.parse(content);
      if (type === 'plugin') return { valid: Boolean(value.name && value.version && value.description), note: 'Requires name, version, and description.', metadata: { name: value.name, version: value.version, description: value.description, bundles: ['skills', 'mcpServers', 'apps', 'hooks'].filter((key) => value[key]) } };
      if (type === 'marketplace') return { valid: Boolean(value.name && Array.isArray(value.plugins)), note: 'Requires marketplace name and plugins array.', metadata: { name: value.name, pluginCount: value.plugins?.length || 0 } };
      if (type === 'hook') return { valid: Boolean(value.hooks && typeof value.hooks === 'object'), note: 'Requires a hooks object.', metadata: { events: Object.keys(value.hooks || {}) } };
      return { valid: true, note: 'Valid JSON metadata.', metadata: { serverCount: Object.keys(value.mcp_servers || value).length } };
    }
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
  const files = (tree.data.tree || []).filter((item) => item.type === 'blob' && classifyPath(item.path).category !== 'other');
  const artifacts = [];
  for (const [index, file] of files.entries()) {
    const classification = classifyPath(file.path);
    const type = classification.type;
    if (index >= maxArtifacts) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: 'discovered', verification: 'deferred', note: 'Artifact path was discovered from the complete repository tree; content verification is deferred.', source: 'github-tree' });
      continue;
    }
    const content = await request(`${base}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (!content.ok || !content.data?.content) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: 'unknown', verification: 'unavailable', note: content.error || 'Content unavailable.' });
      continue;
    }
    const decoded = Buffer.from(content.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const result = validate(type, decoded, file.path);
    artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: result.valid ? 'verified' : 'unknown', verification: result.valid ? 'passed' : 'failed', note: result.note, source: 'github-tree', ...(result.metadata || {}) });
  }
  return { repository: { ...candidate, defaultBranch: branch, archived: repo.data.archived, stars: repo.data.stargazers_count, forks: repo.data.forks_count, license: repo.data.license?.spdx_id || candidate.license }, artifacts, status: tree.data.truncated ? 'partial' : 'fresh', truncated: Boolean(tree.data.truncated), verifiedArtifacts: Math.min(files.length, maxArtifacts), deferredArtifacts: Math.max(0, files.length - maxArtifacts), errors: tree.data.truncated ? ['GitHub recursive tree response was truncated.'] : [] };
}
