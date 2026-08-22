const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/vnd.github+json' };
import { classifyPath } from './model.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const artifactId = (fullName, filePath) => `github:${fullName.toLowerCase()}#${filePath}`;
function marketplaceSourceSummary(source) {
  const safeValue = (value) => typeof value === 'string' ? value.replace(/(https?:\/\/)([^/@]+)@/i, '$1<redacted>@') : null;
  if (typeof source === 'string') return { sourceType: 'path', sourceValue: safeValue(source) };
  if (!source || typeof source !== 'object') return { sourceType: 'unknown', sourceValue: null };
  const sourceType = typeof source.source === 'string' ? source.source : 'unknown';
  const sourceValue = source.path || source.url || source.package || null;
  return { sourceType, sourceValue: safeValue(sourceValue), ref: source.ref || source.sha || null, version: source.version || null };
}

function marketplaceReferences(value, filePath) {
  if (!Array.isArray(value?.plugins)) return [];
  return value.plugins.map((plugin, index) => {
    const source = marketplaceSourceSummary(plugin?.source);
    return {
      idSuffix: `#plugins.${index + 1}`,
      name: plugin?.name || source.sourceValue || `plugin-${index + 1}`,
      description: plugin?.description || `Plugin exposed by ${value.name || 'this marketplace'}.`,
      marketplace: value.name || null,
      ...source,
      path: `${filePath}#plugins.${index + 1}`
    };
  });
}

function pluginReferences(value, filePath) {
  const fields = [
    ['skills', 'skill', 'plugin-skills-reference', 'Bundled skill path'],
    ['mcpServers', 'mcp', 'plugin-mcp-reference', 'Bundled MCP server configuration'],
    ['apps', 'mcp', 'plugin-app-reference', 'Bundled MCP app mapping'],
    ['hooks', 'hook', 'plugin-hook-reference', 'Bundled hook configuration']
  ];
  return fields.flatMap(([field, category, type, description]) => {
    const raw = value?.[field];
    if (raw == null) return [];
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map((entry, index) => ({
      idSuffix: `#${field}.${index + 1}`,
      category,
      type,
      categoryLabel: description,
      path: `${filePath}#${field}.${index + 1}`,
      name: typeof entry === 'string' ? entry : `${field}-${index + 1}`,
      description,
      target: typeof entry === 'string' ? entry : 'inline',
      note: 'Manifest reference only; the referenced component is not downloaded or executed.'
    }));
  });
}
function validate(type, content, filePath) {
  if (!content.trim()) return { valid: false, note: 'File is empty.' };
  if (type === 'skill') {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const frontmatter = match?.[1] || '';
    const name = frontmatter.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim();
    return { valid: Boolean(match && name && description), note: 'Requires YAML frontmatter with name and description.', metadata: { name, description } };
  }
  if (['plugin', 'mcp', 'mcp-server-manifest', 'marketplace', 'hook'].includes(type) && filePath.toLowerCase().endsWith('.json')) {
    try {
      const value = JSON.parse(content);
      if (type === 'plugin') return { valid: Boolean(value.name && value.version && value.description), note: 'Requires name, version, and description.', metadata: { name: value.name, version: value.version, description: value.description, bundles: ['skills', 'mcpServers', 'apps', 'hooks'].filter((key) => value[key]), bundleReferences: pluginReferences(value, filePath) } };
      if (type === 'marketplace') return { valid: Boolean(value.name && Array.isArray(value.plugins)), note: 'Requires marketplace name and plugins array.', metadata: { name: value.name, pluginCount: value.plugins?.length || 0, pluginReferences: marketplaceReferences(value, filePath) } };
      if (type === 'hook') return { valid: Boolean(value.hooks && typeof value.hooks === 'object'), note: 'Requires a hooks object.', metadata: { events: Object.keys(value.hooks || {}) } };
      return { valid: true, note: 'Valid JSON metadata.', metadata: { serverCount: Object.keys(value.mcp_servers || value).length } };
    }
    catch { return { valid: false, note: 'Metadata is not valid JSON.' }; }
  }
  if (type === 'action') return { valid: /^name:\s*\S+/m.test(content) && /^runs:\s*$/m.test(content), note: 'Requires name and runs keys.' };
  return { valid: true, note: 'Non-empty evidence file.' };
}

export async function scanRepository(candidate, { fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, maxArtifacts = 500, verifyManifests = maxArtifacts > 0 || process.env.DISCOVERY_VERIFY_MANIFESTS === 'true', timeoutMs = Number(process.env.GITHUB_DISCOVERY_TIMEOUT_MS || 20_000), maxRetries = Number(process.env.GITHUB_DISCOVERY_RETRIES || 2), sleep = wait } = {}) {
  const headers = { ...DEFAULT_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const base = `https://api.github.com/repos/${candidate.owner}/${candidate.name}`;
  const request = async (url, init = {}) => {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { ...headers, ...(init.headers || {}) } });
        const remaining = Number(response.headers?.get?.('x-ratelimit-remaining') ?? NaN);
        const reset = Number(response.headers?.get?.('x-ratelimit-reset') ?? NaN);
        if ((response.status === 403 || response.status === 429) && remaining === 0) {
          return { ok: false, error: `GitHub API ${response.status}`, status: response.status, rateLimited: true, rateRemaining: remaining, rateReset: Number.isFinite(reset) ? reset : null };
        }
        if ((response.status === 403 || response.status === 429) && attempt < maxRetries) {
          const retryAfter = Number(response.headers?.get?.('retry-after') || 0);
          const delay = retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(reset) && reset > 0 ? Math.max(1000, reset * 1000 - Date.now()) : 500 * 2 ** attempt;
          attempt += 1;
          await sleep(Math.min(delay, 30_000));
          continue;
        }
        if (!response.ok) return { ok: false, error: `GitHub API ${response.status}`, status: response.status, rateLimited: response.status === 403 || response.status === 429, rateRemaining: Number.isFinite(remaining) ? remaining : null, rateReset: Number.isFinite(reset) ? reset : null };
        return { ok: true, data: await response.json() };
      } catch (error) {
        if (attempt++ < maxRetries) {
          await sleep(Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  let repo = null;
  let branch = candidate.defaultBranch;
  const loadRepository = async () => {
    repo = await request(base);
    if (!repo.ok) return false;
    branch = repo.data.default_branch || branch || 'main';
    return true;
  };
  if (!branch && !(await loadRepository())) return { repository: candidate, artifacts: [], status: repo.rateLimited ? 'rate-limited' : repo.status === 404 || repo.status === 451 ? 'terminal-unavailable' : 'unavailable', terminal: repo.status === 404 || repo.status === 451, rateLimited: repo.rateLimited === true, rateRemaining: repo.rateRemaining, rateReset: repo.rateReset, errors: [repo.error] };
  let encodedBranch = encodeURIComponent(branch);
  let tree = await request(`${base}/git/trees/${encodedBranch}?recursive=1`);
  if (!tree.ok && [404, 422].includes(tree.status) && !repo) {
    if (!(await loadRepository())) return { repository: candidate, artifacts: [], status: repo.rateLimited ? 'rate-limited' : repo.status === 404 || repo.status === 451 ? 'terminal-unavailable' : 'unavailable', terminal: repo.status === 404 || repo.status === 451, rateLimited: repo.rateLimited === true, rateRemaining: repo.rateRemaining, rateReset: repo.rateReset, errors: [repo.error] };
    encodedBranch = encodeURIComponent(branch);
    tree = await request(`${base}/git/trees/${encodedBranch}?recursive=1`);
  }
  if (!tree.ok) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: tree.rateLimited ? 'rate-limited' : 'partial', rateLimited: tree.rateLimited === true, rateRemaining: tree.rateRemaining, rateReset: tree.rateReset, errors: [tree.error] };
  if (tree.data.truncated) {
    const root = await request(`${base}/git/trees/${encodedBranch}`);
    if (!root.ok) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: 'partial', truncated: true, errors: [root.error] };
    if (root.data.truncated) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: 'partial', truncated: true, errors: ['GitHub repository root tree response was truncated.'] };
    const files = [];
    const queue = [...(root.data.tree || []).map((item) => ({ ...item, path: item.path }))];
    while (queue.length) {
      const item = queue.shift();
      if (item.type === 'blob') { files.push(item); continue; }
      if (item.type !== 'tree' || !item.sha) continue;
      const child = await request(`${base}/git/trees/${encodeURIComponent(item.sha)}`);
      if (!child.ok) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: 'partial', truncated: true, errors: [child.error] };
      if (child.data.truncated) return { repository: { ...candidate, defaultBranch: branch }, artifacts: [], status: 'partial', truncated: true, errors: [`GitHub repository subtree response was truncated at ${item.path}.`] };
      queue.push(...(child.data.tree || []).map((entry) => ({ ...entry, path: `${item.path}/${entry.path}` })));
    }
    tree = { ok: true, data: { tree: files, truncated: false } };
  }
  const files = (tree.data.tree || []).filter((item) => item.type === 'blob' && classifyPath(item.path).category !== 'other');
  const artifacts = [];
  let verifiedArtifacts = 0;
  for (const [index, file] of files.entries()) {
    const classification = classifyPath(file.path);
    const type = classification.type;
    const verifyManifest = verifyManifests && ['plugin', 'marketplace'].includes(type);
    if (index >= maxArtifacts && !verifyManifest) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: 'discovered', verification: 'deferred', note: 'Artifact path was discovered from the complete repository tree; content verification is deferred.', source: 'github-tree' });
      continue;
    }
    const content = await request(`${base}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (!content.ok || !content.data?.content) {
      artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: 'unknown', verification: 'unavailable', note: content.error || 'Content unavailable.', source: 'github-tree' });
      continue;
    }
    const decoded = Buffer.from(content.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const result = validate(type, decoded, file.path);
    verifiedArtifacts += 1;
    artifacts.push({ id: artifactId(candidate.fullName, file.path), type, category: classification.category, categoryLabel: classification.label, path: file.path, status: result.valid ? 'verified' : 'unknown', verification: result.valid ? 'passed' : 'failed', note: result.note, source: 'github-tree', ...(result.metadata || {}) });
    if (type === 'plugin' && result.valid) {
      for (const reference of result.metadata?.bundleReferences || []) {
        artifacts.push({ id: `${artifactId(candidate.fullName, file.path)}${reference.idSuffix}`, type: reference.type, category: reference.category, categoryLabel: reference.categoryLabel, path: reference.path, name: reference.name, description: reference.description, target: reference.target, status: 'discovered', verification: 'manifest-reference', source: 'github-tree', note: reference.note });
      }
    }
    if (type === 'marketplace' && result.valid) {
      for (const reference of result.metadata?.pluginReferences || []) {
        artifacts.push({ id: `${artifactId(candidate.fullName, file.path)}${reference.idSuffix}`, type: 'marketplace-plugin-reference', category: 'plugin', categoryLabel: 'Marketplace plugin', path: reference.path, name: reference.name, description: reference.description, status: 'verified', verification: 'passed', source: 'github-tree', marketplace: reference.marketplace, sourceType: reference.sourceType, sourceValue: reference.sourceValue, ref: reference.ref, version: reference.version, note: 'Marketplace reference only; external plugin sources are not downloaded or executed.' });
      }
    }
  }
  return { repository: { ...candidate, defaultBranch: branch, archived: repo?.data.archived ?? candidate.archived, stars: repo?.data.stargazers_count ?? candidate.stars, forks: repo?.data.forks_count ?? candidate.forks, license: repo?.data.license?.spdx_id || candidate.license }, artifacts, status: 'fresh', truncated: false, verifiedArtifacts, deferredArtifacts: artifacts.filter((artifact) => artifact.verification === 'deferred').length, errors: [] };
}
