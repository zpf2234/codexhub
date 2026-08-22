import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse as parseToml } from 'smol-toml';
import { classifyPath } from './model.mjs';

const TARGET_FILE = /(?:^|\/)(?:SKILL\.md|plugin\.json|marketplace\.json|\.mcp\.json|mcp(?:-server)?\.(?:json|ya?ml|toml)|server\.json|\.app\.json|hooks\.json|hooks\/.+\.json|config\.toml|requirements\.toml|AGENTS(?:\.override)?\.md|TEAM_GUIDE\.md|\.agents\.md|openai\.ya?ml|[^/]+\.rules|action\.ya?ml|(?:\.github\/codex\/prompts|prompts)\/[^/]+\.(?:md|txt)|agents\/[^/]+\.toml)$/i;
const SKIP_DIRS = new Set(['sessions', 'archived_sessions', 'logs', 'sqlite', 'attachments', 'generated_images', 'visualizations', 'mcp-oauth-locks', 'node_modules']);
const ALLOWED_HIDDEN_DIRS = new Set(['.agents', '.codex', '.codex-plugin', '.agent-plugin', '.claude-plugin', '.github']);

function homeDirectory() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function defaultRoots() {
  const home = homeDirectory();
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const adminHome = process.env.CODEX_ADMIN_ROOT || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'codex') : '/etc/codex');
  const roots = [
    { id: 'codex-home', root: codexHome, include: ['skills', 'plugins', '.tmp/plugins', 'AGENTS.md', 'AGENTS.override.md', 'config.toml', 'requirements.toml', 'hooks.json', 'hooks', 'rules', 'prompts', 'agents'] },
    { id: 'agents-home', root: path.join(home, '.agents'), include: ['skills', 'plugins'] },
    { id: 'project', root: process.cwd(), include: ['.agents', '.codex', '.codex-plugin', '.agent-plugin', '.claude-plugin', '.github/codex/prompts', 'skills', 'hooks', '.mcp.json', '.app.json', 'AGENTS.md', 'AGENTS.override.md', 'TEAM_GUIDE.md', '.agents.md'] }
  ];
  roots.push({ id: 'codex-admin', root: adminHome, include: ['skills', 'config.toml', 'requirements.toml', 'hooks.json', 'hooks', 'rules', 'agents'] });
  return roots;
}

function configuredRoots() {
  const roots = defaultRoots();
  const extra = String(process.env.CODEX_LOCAL_ROOTS || '').split(';').map((value) => value.trim()).filter(Boolean);
  return roots.concat(extra.map((root, index) => ({ id: `custom-${index + 1}`, root, include: ['.'] })));
}

function relativeArtifactPath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function classifyLocalPath(relative, sourceId) {
  const direct = classifyPath(relative);
  if (direct.category !== 'other' || sourceId !== 'codex-home') return direct;
  return classifyPath(`.codex/${relative}`);
}

async function collectFiles(root, include) {
  const files = [];
  const visited = new Set();
  const requested = include.flatMap((entry) => entry === '.' ? [root] : [path.join(root, entry)]);
  const visit = async (current) => {
    let realCurrent;
    try { realCurrent = await fs.realpath(current); } catch { return; }
    if (visited.has(realCurrent)) return;
    visited.add(realCurrent);
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(entry.name) && entry.name !== '.agents.md' && entry.name !== '.mcp.json' && entry.name !== '.app.json') {
        if (entry.isDirectory()) continue;
      }
      const full = path.join(current, entry.name);
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(full);
      } else if (stat.isFile() && TARGET_FILE.test(relativeArtifactPath(root, full))) {
        files.push(full);
      }
    }
  };
  for (const entry of requested) {
    try {
      const stat = await fs.stat(entry);
      if (stat.isDirectory()) await visit(entry);
      else if (stat.isFile() && TARGET_FILE.test(relativeArtifactPath(root, entry))) files.push(entry);
    } catch {}
  }
  return files;
}

async function configuredComponents(file, relative, sourceId, repository) {
  if (classifyLocalPath(relative, sourceId).type !== 'codex-config') return [];
  let config;
  try { config = parseToml(await fs.readFile(file, 'utf8')); } catch { return []; }
  const artifacts = [];
  const add = (category, artifactType, name, section, description) => artifacts.push({
    id: `local:${sourceId}#${relative}#${section}`,
    category,
    artifactType,
    categoryLabel: description,
    type: artifactType,
    path: `${relative}#${section}`,
    name,
    description,
    status: 'discovered',
    verification: 'configured',
    source: 'local-filesystem',
    repository,
    repositoryUrl: null,
    note: 'Configuration structure only; credential values are not retained or displayed.'
  });
  for (const name of Object.keys(config.mcp_servers || {})) add('mcp', 'mcp-config-entry', name, `mcp_servers.${name}`, 'Configured MCP server');
  for (const event of Object.keys(config.hooks || {})) add('hook', 'hook-config-entry', event, `hooks.${event}`, 'Configured hook event');
  for (const [name, value] of Object.entries(config.agents || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) add('agent-config', 'agent-role-entry', name, `agents.${name}`, 'Configured agent role');
  }
  for (const [index, value] of (config.skills?.config || []).entries()) {
    const name = typeof value?.path === 'string' ? path.basename(path.dirname(value.path)) || path.basename(value.path) : `skill-${index + 1}`;
    add('skill', 'skill-config-entry', name, `skills.config.${index + 1}`, 'Configured skill override');
  }
  for (const [name, value] of Object.entries(config.plugins || {})) {
    add('plugin', 'plugin-config-entry', name, `plugins.${name}`, 'Configured plugin policy');
    for (const serverName of Object.keys(value?.mcp_servers || {})) add('mcp', 'mcp-config-entry', `${name}/${serverName}`, `plugins.${name}.mcp_servers.${serverName}`, 'Plugin-configured MCP server');
  }
  return artifacts;
}

function pluginManifestReferences(value, relative, sourceId, repository) {
  const fields = [
    ['skills', 'skill', 'plugin-skills-reference', 'Bundled skill path'],
    ['mcpServers', 'mcp', 'plugin-mcp-reference', 'Bundled MCP server configuration'],
    ['apps', 'mcp', 'plugin-app-reference', 'Bundled MCP app mapping'],
    ['hooks', 'hook', 'plugin-hook-reference', 'Bundled hook configuration']
  ];
  return fields.flatMap(([field, category, artifactType, description]) => {
    const raw = value?.[field];
    if (raw == null) return [];
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map((entry, index) => ({
      id: `local:${sourceId}#${relative}#${field}.${index + 1}`,
      category,
      artifactType,
      categoryLabel: description,
      type: artifactType,
      path: `${relative}#${field}.${index + 1}`,
      name: typeof entry === 'string' ? entry : `${field}-${index + 1}`,
      target: typeof entry === 'string' ? entry : 'inline',
      description,
      status: 'discovered',
      verification: 'manifest-reference',
      source: 'local-filesystem',
      repository,
      repositoryUrl: null,
      note: 'Manifest reference only; the referenced component is not downloaded or executed.'
    }));
  });
}

async function pluginManifestComponents(file, relative, sourceId, repository) {
  if (classifyLocalPath(relative, sourceId).type !== 'plugin') return [];
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
  return pluginManifestReferences(manifest, relative, sourceId, repository);
}

function marketplaceSourceSummary(source) {
  const safeValue = (value) => typeof value === 'string' ? value.replace(/(https?:\/\/)([^/@]+)@/i, '$1<redacted>@') : null;
  if (typeof source === 'string') return { sourceType: 'path', sourceValue: safeValue(source) };
  if (!source || typeof source !== 'object') return { sourceType: 'unknown', sourceValue: null };
  const sourceType = typeof source.source === 'string' ? source.source : 'unknown';
  const sourceValue = source.path || source.url || source.package || null;
  return { sourceType, sourceValue: safeValue(sourceValue), ref: source.ref || source.sha || null, version: source.version || null };
}

async function marketplaceComponents(file, relative, sourceId, repository) {
  if (classifyLocalPath(relative, sourceId).type !== 'marketplace') return [];
  let marketplace;
  try { marketplace = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
  if (!Array.isArray(marketplace.plugins)) return [];
  return marketplace.plugins.map((plugin, index) => {
    const source = marketplaceSourceSummary(plugin?.source);
    const name = plugin?.name || source.sourceValue || `plugin-${index + 1}`;
    return {
      id: `local:${sourceId}#${relative}#plugins.${index + 1}`,
      category: 'plugin',
      artifactType: 'marketplace-plugin-reference',
      categoryLabel: 'Marketplace plugin',
      type: 'marketplace-plugin-reference',
      path: `${relative}#plugins.${index + 1}`,
      name,
      description: plugin?.description || `Plugin exposed by ${marketplace.name || 'this marketplace'}.`,
      status: 'discovered',
      verification: 'configured',
      source: 'local-filesystem',
      repository,
      repositoryUrl: null,
      marketplace: marketplace.name || null,
      ...source,
      note: 'Marketplace reference only; external plugin sources are not downloaded or executed.'
    };
  });
}

export async function discoverLocalComponents({ roots = configuredRoots(), now = new Date().toISOString() } = {}) {
  const repositories = [];
  const artifacts = [];
  const seen = new Set();
  for (const source of roots) {
    const root = path.resolve(source.root);
    const files = await collectFiles(root, source.include || ['.']);
    const repository = `local/${source.id}`;
    repositories.push({ fullName: repository, owner: 'local', name: source.id, url: null, description: 'Local Codex filesystem inventory', stars: null, forks: null, license: 'LOCAL', defaultBranch: null, categories: [], discoveredBy: ['local-filesystem'], reviewed: false });
    for (const file of files) {
      const relative = relativeArtifactPath(root, file);
      const classification = classifyLocalPath(relative, source.id);
      if (classification.category === 'other') continue;
      const id = `local:${source.id}#${relative}`;
      if (seen.has(id)) continue;
      seen.add(id);
      artifacts.push({ id, category: classification.category, artifactType: classification.type, categoryLabel: classification.label, type: classification.type, path: relative, status: 'discovered', verification: 'deferred', source: 'local-filesystem', repository, repositoryUrl: null, note: 'Local path inventory only; content is not executed or uploaded.' });
      for (const configured of await configuredComponents(file, relative, source.id, repository)) {
        if (!seen.has(configured.id)) { seen.add(configured.id); artifacts.push(configured); }
      }
      for (const referenced of await pluginManifestComponents(file, relative, source.id, repository)) {
        if (!seen.has(referenced.id)) { seen.add(referenced.id); artifacts.push(referenced); }
      }
      for (const referenced of await marketplaceComponents(file, relative, source.id, repository)) {
        if (!seen.has(referenced.id)) { seen.add(referenced.id); artifacts.push(referenced); }
      }
      const repositoryRecord = repositories.at(-1);
      for (const category of artifacts.filter((artifact) => artifact.repository === repository).map((artifact) => artifact.category)) {
        if (!repositoryRecord.categories.includes(category)) repositoryRecord.categories.push(category);
      }
    }
  }
  return { schemaVersion: '1.0.0', generatedAt: now, source: 'local-filesystem', roots: roots.map(({ id }) => ({ id })), repositories, artifacts, coverage: { generatedAt: now, roots: roots.length, rootIds: roots.map(({ id }) => id), artifacts: artifacts.length } };
}

if (process.argv.includes('--write')) {
  const output = path.resolve(process.env.CODEX_LOCAL_INVENTORY || path.join('artifacts', 'discovery', 'local.json'));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(await discoverLocalComponents(), null, 2) + '\n');
  console.log(`Indexed local Codex components into ${output}.`);
}
