import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readEntries } from './lib.mjs';

const queries = [
  { kind: 'skill', query: 'topic:codex-skills fork:false archived:false' },
  { kind: 'plugin', query: 'topic:codex-plugin fork:false archived:false' },
  { kind: 'mcp', query: 'topic:mcp-server fork:false archived:false codex' },
  { kind: 'agents', query: '"AGENTS.md" in:name,description,readme fork:false archived:false' }
];
const headers = { 'User-Agent': 'CodexHub/0.1', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const entries = await readEntries();
const existing = new Set(entries.map((entry) => `${entry.repository.owner}/${entry.repository.name}`.toLowerCase()));
const candidates = new Map();

for (const search of queries) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(search.query)}&sort=updated&order=desc&per_page=10`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Discovery failed for ${search.kind}: GitHub API ${response.status}`);
  const payload = await response.json();
  for (const repository of payload.items || []) {
    if (existing.has(repository.full_name.toLowerCase())) continue;
    const key = repository.full_name.toLowerCase();
    const previous = candidates.get(key);
    const kinds = new Set(previous?.suggestedKinds || []);
    kinds.add(search.kind);
    candidates.set(key, {
      repository: repository.full_name,
      url: repository.html_url,
      description: repository.description,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      license: repository.license?.spdx_id || 'NOASSERTION',
      updatedAt: repository.pushed_at,
      suggestedKinds: [...kinds].sort(),
      reviewStatus: 'candidate',
      warning: 'Discovery match only. Artifact paths and project relevance require human review.'
    });
  }
}

const sorted = [...candidates.values()].sort((a, b) => b.stars - a.stars || a.repository.localeCompare(b.repository));
const output = { generatedAt: new Date().toISOString(), candidates: sorted };
const outputPath = path.join(ROOT, 'artifacts', 'candidates.json');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Discovered ${sorted.length} candidates at ${outputPath}.`);
