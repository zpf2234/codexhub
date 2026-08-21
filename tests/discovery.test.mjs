import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubClient } from '../scripts/discovery/github-search.mjs';
import { crawlMcpRegistry } from '../scripts/discovery/mcp-registry.mjs';
import { scanRepository } from '../scripts/discovery/github-tree-scan.mjs';
import { loadCheckpoint, saveCheckpoint } from '../scripts/discovery/checkpoint.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
    const sort = parsed.searchParams.get('sort');
    if (sort === 'stars' && parsed.searchParams.get('order') === 'asc') return response({ total_count: 1, items: [{ full_name: 'old/repo', stargazers_count: 0, pushed_at: '2020-01-01T00:00:00Z' }] });
    if (sort === 'stars' && parsed.searchParams.get('order') === 'desc') return response({ total_count: 1, items: [{ full_name: 'new/repo', stargazers_count: 2000, pushed_at: '2026-01-01T00:00:00Z' }] });
    if (query.includes('stars:0..1000')) return response({ total_count: 1, items: [{ full_name: 'low/repo', stargazers_count: 1 }] });
    if (query.includes('stars:1001..*')) return response({ total_count: 1, items: [{ full_name: 'high/repo', stargazers_count: 1500 }] });
    return response({ total_count: 1500, items: [] });
  };
  const result = await new GithubClient({ fetchImpl }).collectQuery('topic:large', { id: 'large', kind: 'mcp' }, { perPage: 100 });
  assert.equal(result.partitions.length, 1);
  assert.deepEqual(result.items.map((item) => item.full_name).sort(), ['high/repo', 'low/repo']);
  assert.equal(result.truncated, false);
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

test('checkpoint writes atomically and survives a reload', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codexhub-checkpoint-'));
  const filePath = path.join(directory, 'checkpoint.json');
  await saveCheckpoint(filePath, { completedSources: ['one'], repositories: { 'a/b': { fullName: 'a/b' } }, sourceReports: [{ id: 'one' }] });
  const checkpoint = await loadCheckpoint(filePath);
  assert.deepEqual(checkpoint.completedSources, ['one']);
  assert.equal(checkpoint.repositories['a/b'].fullName, 'a/b');
  assert.equal(checkpoint.sourceReports[0].id, 'one');
});
