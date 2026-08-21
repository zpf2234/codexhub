import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubClient } from '../scripts/discovery/github-search.mjs';
import { crawlMcpRegistry } from '../scripts/discovery/mcp-registry.mjs';
import { scanRepository } from '../scripts/discovery/github-tree-scan.mjs';
import { loadCheckpoint, saveCheckpoint } from '../scripts/discovery/checkpoint.mjs';
import { classifyPath, createDashboardSnapshot, normalizeDiscovery } from '../scripts/discovery/model.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('GitHub search paginates and deduplicates repository results', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const page = Number(parsed.searchParams.get('page'));
    const perPage = Number(parsed.searchParams.get('per_page'));
    const remaining = Math.max(0, 5 - (page - 1) * perPage);
    const items = Array.from({ length: Math.min(perPage, remaining) }, (_, index) => ({ full_name: `owner/${page}-${index}`, name: `${page}-${index}`, owner: { login: 'owner' }, html_url: `https://github.com/owner/${page}-${index}`, stargazers_count: 10 - index, forks_count: 0 }));
    return response({ total_count: 5, incomplete_results: false, items });
  };
  const result = await new GithubClient({ fetchImpl }).collectQuery('topic:test', { id: 'test', kind: 'skill' }, { perPage: 2 });
  assert.equal(result.items.length, 5);
  assert.deepEqual(calls.map((call) => call.searchParams.get('page')), ['1', '2', '3']);
  assert.equal(result.truncated, false);
});

test('GitHub search records a partition when a query exceeds the 1,000 result boundary', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const query = parsed.searchParams.get('q');
    if (query.includes('created:2008-01-01..')) return response({ total_count: 1, items: [{ full_name: 'low/repo', stargazers_count: 1 }] });
    if (query.match(/created:\d{4}-\d{2}-\d{2}\.\./)) return response({ total_count: 1, items: [{ full_name: 'high/repo', stargazers_count: 1500 }] });
    return response({ total_count: 1500, items: [] });
  };
  const result = await new GithubClient({ fetchImpl }).collectQuery('topic:large', { id: 'large', kind: 'mcp' }, { perPage: 100 });
  assert.equal(result.partitions.length, 1);
  assert.deepEqual(result.items.map((item) => item.full_name).sort(), ['high/repo', 'low/repo']);
  assert.equal(result.truncated, false);
  assert.ok(result.partitions[0].into.every((query) => (query.match(/created:/g) || []).length === 1));
});

test('GitHub search date partitions remain mutually exclusive across recursion', () => {
  const client = new GithubClient({ fetchImpl: async () => response({}) });
  const first = client.splitQuery('topic:test', { from: '2026-01-01', to: '2026-01-10' });
  const left = client.splitQuery('topic:test', first[0].range);
  assert.equal((left[0].query.match(/created:/g) || []).length, 1);
  assert.equal(left[0].range.to < left[1].range.from, true);
  assert.equal(first[0].range.to < first[1].range.from, true);
});

test('GitHub code search paginates and collapses multiple files from one repository', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/search/code');
    const page = Number(parsed.searchParams.get('page'));
    return response({ total_count: 2, incomplete_results: false, items: page === 1 ? [{ repository: { full_name: 'a/repo', name: 'repo', owner: { login: 'a' }, html_url: 'https://github.com/a/repo' } }, { repository: { full_name: 'a/repo', name: 'repo', owner: { login: 'a' }, html_url: 'https://github.com/a/repo' } }] : [] });
  };
  const result = await new GithubClient({ fetchImpl }).collectCodeQuery('filename:SKILL.md', { id: 'code', kind: 'skill' }, { perPage: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.truncated, false);
});

test('MCP Registry follows cursors and deduplicates versions', async () => {
  const fetchImpl = async (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) return response({ servers: [{ name: 'demo', version: '1.0.0' }], metadata: { nextCursor: 'next' } });
    return response({ servers: [{ name: 'demo', version: '1.0.0' }, { name: 'other', version: '2.0.0' }], metadata: {} });
  };
  const result = await crawlMcpRegistry({ fetchImpl, pageSize: 2 });
  assert.equal(result.pages.length, 2);
  assert.equal(result.servers.length, 2);
  assert.equal(result.complete, true);
});

test('repository tree scan discovers and validates multiple artifact types without executing code', async () => {
  const files = {
    'https://api.github.com/repos/a/b': { default_branch: 'main', archived: false, stargazers_count: 1, forks: 0, license: { spdx_id: 'MIT' } },
    'https://api.github.com/repos/a/b/git/trees/main?recursive=1': { tree: [{ type: 'blob', path: 'one/SKILL.md' }, { type: 'blob', path: '.codex-plugin/plugin.json' }, { type: 'blob', path: '.mcp.json' }, { type: 'blob', path: 'mcp.json' }, { type: 'blob', path: 'AGENTS.md' }] },
    'https://api.github.com/repos/a/b/contents/one/SKILL.md?ref=main': { content: Buffer.from('---\nname: demo\ndescription: useful\n---\n').toString('base64') },
    'https://api.github.com/repos/a/b/contents/.codex-plugin/plugin.json?ref=main': { content: Buffer.from('{"name":"demo","version":"1.0.0","description":"useful"}').toString('base64') },
    'https://api.github.com/repos/a/b/contents/mcp.json?ref=main': { content: Buffer.from('{"name":"demo"}').toString('base64') },
    'https://api.github.com/repos/a/b/contents/.mcp.json?ref=main': { content: Buffer.from('{"demo":{"command":"demo"}}').toString('base64') },
    'https://api.github.com/repos/a/b/contents/AGENTS.md?ref=main': { content: Buffer.from('rules').toString('base64') }
  };
  const result = await scanRepository({ fullName: 'a/b', owner: 'a', name: 'b', defaultBranch: 'main', license: 'MIT' }, { fetchImpl: async (url) => response(files[url]) });
  assert.deepEqual(result.artifacts.map((artifact) => artifact.type).sort(), ['agents', 'mcp', 'mcp', 'plugin', 'skill']);
  assert.ok(result.artifacts.every((artifact) => artifact.status === 'verified'));
});

test('MCP Registry resumes for another page budget after a checkpoint', async () => {
  const cursors = [];
  const fetchImpl = async (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    cursors.push(cursor);
    return response({ servers: [{ name: `server-${cursor}`, version: '1' }], metadata: { nextCursor: cursor === 'second' ? null : 'second' } });
  };
  const result = await crawlMcpRegistry({ fetchImpl, maxPages: 1, initialCursor: 'first', initialServers: [{ id: 'mcp-registry:old@1', name: 'old', version: '1' }], initialPages: [{ page: 1, count: 1, nextCursor: 'first' }] });
  assert.deepEqual(cursors, ['first']);
  assert.equal(result.pages.length, 2);
  assert.equal(result.servers.length, 2);
});

test('repository tree scan keeps every artifact path when content verification is capped', async () => {
  const tree = Array.from({ length: 4 }, (_, index) => ({ type: 'blob', path: `skills/${index}/SKILL.md` }));
  const fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/a/large') return response({ default_branch: 'main', archived: false });
    if (url.includes('/git/trees/')) return response({ tree });
    return response({ content: Buffer.from('---\nname: demo\ndescription: useful\n---').toString('base64') });
  };
  const result = await scanRepository({ fullName: 'a/large', owner: 'a', name: 'large' }, { fetchImpl, maxArtifacts: 1 });
  assert.equal(result.artifacts.length, 4);
  assert.equal(result.verifiedArtifacts, 1);
  assert.equal(result.deferredArtifacts, 3);
  assert.equal(result.artifacts.filter((artifact) => artifact.verification === 'deferred').length, 3);
});

test('checkpoint writes atomically and survives a reload', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codexhub-checkpoint-'));
  const filePath = path.join(directory, 'checkpoint.json');
  await saveCheckpoint(filePath, { completedSources: ['one'], repositories: { 'a/b': { fullName: 'a/b' } }, sourceReports: [{ id: 'one' }] });
  const checkpoint = await loadCheckpoint(filePath);
  assert.deepEqual(checkpoint.completedSources, ['one']);
  assert.equal(checkpoint.repositories['a/b'].fullName, 'a/b');
  assert.equal(checkpoint.sourceReports[0].id, 'one');
  assert.equal(checkpoint.sourceAlgorithmVersion, 1);
});

test('registry server merge key is stable across resumed pages', () => {
  const values = [{ id: 'mcp:one', version: '1' }, { id: 'mcp:one', version: '1' }, { id: 'mcp:two', version: '2' }];
  const merged = [...new Map(values.map((value) => [value.id, value])).values()];
  assert.deepEqual(merged.map((value) => value.id), ['mcp:one', 'mcp:two']);
});

test('artifact classifier recognizes Codex component paths', () => {
  assert.equal(classifyPath('.agents/skills/review/SKILL.md').category, 'skill');
  assert.equal(classifyPath('.codex-plugin/plugin.json').category, 'plugin');
  assert.equal(classifyPath('.mcp.json').category, 'mcp');
  assert.equal(classifyPath('.agents/plugins/marketplace.json').category, 'marketplace');
  assert.equal(classifyPath('hooks/hooks.json').category, 'hook');
  assert.equal(classifyPath('agents/openai.yaml').category, 'plugin-metadata');
  assert.equal(classifyPath('AGENTS.md').category, 'agents');
  assert.equal(classifyPath('action.yml').category, 'action');
});

test('discovery normalization adds registry artifacts and coverage counts', () => {
  const result = normalizeDiscovery({ generatedAt: '2026-01-01T00:00:00Z', coverage: {}, repositories: [{ fullName: 'a/b', categories: [], registryServers: [{ id: 'mcp-registry:demo@1', name: 'demo', version: '1', description: 'server' }] }], artifacts: [{ id: 'github:a/b#SKILL.md', repository: 'a/b', path: 'SKILL.md', type: 'skill', status: 'verified' }] });
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.artifacts.find((artifact) => artifact.source === 'mcp-registry').category, 'mcp');
  assert.equal(result.coverage.categoryCounts.skill, 1);
  assert.equal(result.coverage.categoryCounts.mcp, 1);
});

test('normalized discovery payload satisfies the public schema', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/discovery.schema.json', import.meta.url), 'utf8'));
  const payload = normalizeDiscovery({ generatedAt: '2026-01-01T00:00:00Z', coverage: { repositoriesDiscovered: 1, complete: false }, repositories: [{ fullName: 'a/b', name: 'b', categories: ['skill'] }], artifacts: [{ id: 'github:a/b#SKILL.md', repository: 'a/b', path: 'SKILL.md', type: 'skill', status: 'verified', source: 'github-tree' }], errors: [] });
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  assert.equal(ajv.validate(schema, payload), true, ajv.errorsText());
});

test('dashboard snapshot removes raw Registry payloads', () => {
  const discovery = normalizeDiscovery({ generatedAt: '2026-01-01T00:00:00Z', coverage: {}, repositories: [{ fullName: 'a/b', name: 'b', categories: ['mcp'], registryServers: [{ id: 'mcp-registry:demo@1', name: 'demo', version: '1', server: { huge: 'raw' } }] }], artifacts: [], errors: [] });
  const dashboard = createDashboardSnapshot(discovery);
  assert.equal('registryServers' in dashboard.repositories[0], false);
  assert.equal('server' in dashboard.artifacts[0], false);
});
