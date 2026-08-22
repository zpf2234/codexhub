import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { classifyPath } from './model.mjs';

const TARGET_FILE = /(?:^|\/)(?:SKILL\.md|plugin\.json|marketplace\.json|\.mcp\.json|mcp\.json|\.app\.json|hooks\.json|config\.toml|requirements\.toml|AGENTS(?:\.override)?\.md|TEAM_GUIDE\.md|\.agents\.md|openai\.ya?ml|[^/]+\.rules|action\.ya?ml|prompts\/[^/]+\.md|agents\/[^/]+\.toml)$/i;
const SKIP_DIRS = new Set(['sessions', 'archived_sessions', 'logs', 'sqlite', 'attachments', 'generated_images', 'visualizations', 'mcp-oauth-locks', 'node_modules']);
const ALLOWED_HIDDEN_DIRS = new Set(['.agents', '.codex', '.codex-plugin', '.agent-plugin', '.claude-plugin']);

function homeDirectory() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function defaultRoots() {
  const home = homeDirectory();
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  return [
    { id: 'codex-home', root: codexHome, include: ['skills', 'plugins', '.tmp/plugins', 'AGENTS.md', 'AGENTS.override.md', 'config.toml', 'requirements.toml', 'hooks.json', 'hooks', 'rules', 'prompts', 'agents'] },
    { id: 'agents-home', root: path.join(home, '.agents'), include: ['skills', 'plugins'] },
    { id: 'project', root: process.cwd(), include: ['.agents', '.codex', 'AGENTS.md', 'AGENTS.override.md', 'TEAM_GUIDE.md', '.agents.md'] }
  ];
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
  const requested = include.flatMap((entry) => entry === '.' ? [root] : [path.join(root, entry)]);
  const visit = async (current) => {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(entry.name) && entry.name !== '.agents.md' && entry.name !== '.mcp.json' && entry.name !== '.app.json') {
        if (entry.isDirectory()) continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(full);
      } else if (entry.isFile() && TARGET_FILE.test(relativeArtifactPath(root, full))) {
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

export async function discoverLocalComponents({ roots = configuredRoots(), now = new Date().toISOString() } = {}) {
  const repositories = [];
  const artifacts = [];
  const seen = new Set();
  for (const source of roots) {
    const root = path.resolve(source.root);
    const files = await collectFiles(root, source.include || ['.']);
    const repository = `local/${source.id}`;
    repositories.push({ fullName: repository, owner: 'local', name: source.id, url: null, description: `Local Codex filesystem inventory rooted at ${root}`, stars: null, forks: null, license: 'LOCAL', defaultBranch: null, categories: [], discoveredBy: ['local-filesystem'], reviewed: false });
    for (const file of files) {
      const relative = relativeArtifactPath(root, file);
      const classification = classifyLocalPath(relative, source.id);
      if (classification.category === 'other') continue;
      const id = `local:${source.id}#${relative}`;
      if (seen.has(id)) continue;
      seen.add(id);
      artifacts.push({ id, category: classification.category, artifactType: classification.type, categoryLabel: classification.label, type: classification.type, path: relative, status: 'discovered', verification: 'deferred', source: 'local-filesystem', repository, repositoryUrl: null, note: 'Local path inventory only; content is not executed or uploaded.' });
      const repositoryRecord = repositories.at(-1);
      if (!repositoryRecord.categories.includes(classification.category)) repositoryRecord.categories.push(classification.category);
    }
  }
  return { schemaVersion: '1.0.0', generatedAt: now, source: 'local-filesystem', roots: roots.map(({ id, root }) => ({ id, root: path.resolve(root) })), repositories, artifacts, coverage: { generatedAt: now, roots: roots.length, artifacts: artifacts.length } };
}

if (process.argv.includes('--write')) {
  const output = path.resolve(process.env.CODEX_LOCAL_INVENTORY || path.join('artifacts', 'discovery', 'local.json'));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(await discoverLocalComponents(), null, 2) + '\n');
  console.log(`Indexed local Codex components into ${output}.`);
}
