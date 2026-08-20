import test from 'node:test';
import assert from 'node:assert/strict';
import { readEntries, scoreEntry } from '../scripts/lib.mjs';

test('all entries have unique ids and supported kinds', async () => {
  const entries = await readEntries();
  assert.ok(entries.length >= 10);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.ok(entries.every((entry) => ['skill', 'plugin', 'mcp', 'agents', 'action', 'tool'].includes(entry.kind)));
});

test('quality score separates popularity from quality', () => {
  const entry = { artifacts: [{ path: 'SKILL.md', status: 'verified' }], license: 'MIT', repository: { owner: 'a', url: 'https://github.com/a/b' } };
  const score = scoreEntry(entry, { hasReadme: true, hasInstall: true, hasUsage: true, updatedAt: '2026-01-01T00:00:00Z' });
  assert.equal(score.total, 100);
  assert.equal(score.ranked, true);
});
