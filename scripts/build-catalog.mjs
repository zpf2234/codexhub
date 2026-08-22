import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readEntries, fetchMetadata, scoreEntry } from './lib.mjs';
import { createDashboardRepositories, normalizeDiscovery } from './discovery/model.mjs';
import { readArtifactShards, writeArtifactShards } from './discovery/artifact-shards.mjs';

const offline = process.argv.includes('--offline');
const cachedOnly = process.argv.includes('--cached');
const writeCache = process.argv.includes('--write-cache');
const entries = await readEntries();
const scanTimestamp = process.env.SCAN_TIMESTAMP || new Date().toISOString();
const cachePath = path.join(ROOT, 'catalog', 'cache', 'github.json');
let cache = {};
try { cache = JSON.parse(await fs.readFile(cachePath, 'utf8')); } catch {}
const enriched = [];
for (const entry of entries) {
  let metadata = cachedOnly ? cache[entry.id] : await fetchMetadata(entry, offline);
  if (!metadata) metadata = await fetchMetadata(entry, true);
  if (!offline && !cachedOnly && metadata.status === 'unavailable' && cache[entry.id]) {
    const fetched = new Date(cache[entry.id].fetchedAt || 0).getTime();
    const staleAgeDays = Number.isFinite(fetched) ? Math.floor((Date.now() - fetched) / 86400000) : null;
    metadata = { ...cache[entry.id], status: 'stale', staleAgeDays, warnings: [...(metadata.warnings || []), `Using cached metadata from ${cache[entry.id].fetchedAt || 'an unknown date'}.`] };
  }
  const scoredEntry = metadata.artifacts ? { ...entry, artifacts: metadata.artifacts } : entry;
  const score = scoreEntry(scoredEntry, metadata);
  enriched.push({ ...scoredEntry, metadata, score });
}
enriched.sort((a, b) => b.score.total - a.score.total || a.title.localeCompare(b.title));
const output = path.join(ROOT, 'dist');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'api', 'v1'), { recursive: true });
await fs.cp(path.join(ROOT, 'web'), output, { recursive: true });
await fs.copyFile(path.join(ROOT, 'schemas', 'catalog.schema.json'), path.join(output, 'api', 'v1', 'schema.json'));
await fs.copyFile(path.join(ROOT, 'schemas', 'submission.schema.json'), path.join(output, 'api', 'v1', 'submission.schema.json'));
const discoveryDir = path.join(ROOT, 'artifacts', 'discovery');
const publicDiscoveryDir = path.join(output, 'api', 'v1', 'discovery');
const discoveryDirectoryExists = await fs.stat(discoveryDir).then((stat) => stat.isDirectory()).catch(() => false);
if (discoveryDirectoryExists) {
  await fs.mkdir(publicDiscoveryDir, { recursive: true });
  const readDiscoveryPart = async (name) => JSON.parse(await fs.readFile(path.join(discoveryDir, name), 'utf8'));
  const splitFiles = ['repositories.json', 'coverage.json', 'errors.json'];
  const splitPresence = await Promise.all(splitFiles.map(async (name) => fs.access(path.join(discoveryDir, name)).then(() => true).catch(() => false)));
  let discovery;
  if (splitPresence.every(Boolean)) {
    const repositories = await readDiscoveryPart('repositories.json');
    const coverage = await readDiscoveryPart('coverage.json');
    const errors = await readDiscoveryPart('errors.json');
    const artifacts = await readArtifactShards(discoveryDir);
    discovery = normalizeDiscovery({
      schemaVersion: '1.1.0',
      generatedAt: coverage.generatedAt || repositories.generatedAt || artifacts.generatedAt,
      coverage,
      repositories: repositories.repositories || [],
      artifacts: artifacts.artifacts || [],
      errors: errors.errors || []
    });
  } else if (splitPresence.some(Boolean)) {
    throw new Error(`Incomplete discovery snapshot in ${discoveryDir}; refusing legacy fallback.`);
  } else if (await fs.access(path.join(discoveryDir, 'discovery.json')).then(() => true).catch(() => false)) {
    discovery = normalizeDiscovery(JSON.parse(await fs.readFile(path.join(discoveryDir, 'discovery.json'), 'utf8')));
  } else {
    console.warn(`No discovery snapshot found in ${discoveryDir}; skipping Discovery API build.`);
  }
  if (discovery) {
    try {
      const local = JSON.parse(await fs.readFile(path.join(discoveryDir, 'local.json'), 'utf8'));
      discovery.repositories.push(...(local.repositories || []));
      discovery.artifacts.push(...(local.artifacts || []));
      const merged = normalizeDiscovery(discovery);
      Object.assign(discovery, merged, { coverage: { ...merged.coverage, local: local.coverage || { artifacts: local.artifacts?.length || 0 } } });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.writeFile(path.join(publicDiscoveryDir, 'discovery.json'), JSON.stringify(discovery) + '\n');
    await fs.writeFile(path.join(publicDiscoveryDir, 'repositories.json'), JSON.stringify({ generatedAt: discovery.generatedAt, repositories: discovery.repositories }) + '\n');
    const artifactShardNames = await writeArtifactShards(publicDiscoveryDir, { generatedAt: discovery.generatedAt, artifacts: discovery.artifacts });
    await fs.writeFile(path.join(publicDiscoveryDir, 'coverage.json'), JSON.stringify(discovery.coverage, null, 2) + '\n');
    await fs.writeFile(path.join(publicDiscoveryDir, 'errors.json'), JSON.stringify({ generatedAt: discovery.generatedAt, errors: discovery.errors || [] }, null, 2) + '\n');
    await fs.writeFile(path.join(publicDiscoveryDir, 'dashboard-meta.json'), JSON.stringify({ schemaVersion: discovery.schemaVersion, generatedAt: discovery.generatedAt, artifactShardCount: artifactShardNames.length, coverage: discovery.coverage, errors: discovery.errors || [] }) + '\n');
    await fs.writeFile(path.join(publicDiscoveryDir, 'dashboard-repositories.json'), JSON.stringify({ generatedAt: discovery.generatedAt, repositories: createDashboardRepositories(discovery.repositories) }) + '\n');
    await fs.copyFile(path.join(ROOT, 'schemas', 'discovery.schema.json'), path.join(publicDiscoveryDir, 'schema.json'));
  }
}
if (writeCache) {
  const nextCache = { ...cache };
  for (const entry of enriched) if (['fresh', 'partial'].includes(entry.metadata.status)) nextCache[entry.id] = entry.metadata;
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(nextCache, null, 2) + '\n');
}
const warnings = enriched.flatMap((entry) => (entry.metadata.warnings || []).map((warning) => `${entry.repository.owner}/${entry.repository.name}: ${warning}`));
const catalog = { schemaVersion: '1.0.0', scoreVersion: '0.1.0', generatedAt: scanTimestamp, refreshStatus: offline ? 'offline' : warnings.length ? 'partial' : 'fresh', warnings, entries: enriched };
await fs.writeFile(path.join(output, 'api', 'v1', 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await fs.writeFile(path.join(output, 'api', 'v1', 'stats.json'), JSON.stringify({ generatedAt: scanTimestamp, refreshStatus: catalog.refreshStatus, warnings: warnings.length, entries: enriched.length, ranked: enriched.filter((entry) => entry.score.ranked).length, kinds: Object.fromEntries(['skill', 'plugin', 'mcp', 'agents', 'action', 'tool'].map((kind) => [kind, enriched.filter((entry) => entry.kind === kind).length])) }, null, 2) + '\n');
await fs.writeFile(path.join(output, 'api', 'v1', 'meta.json'), JSON.stringify({ name: 'CodexHub', version: '0.1.0', independent: true, generatedAt: scanTimestamp }, null, 2) + '\n');
console.log(`Built ${enriched.length} entries into ${output}${offline ? ' (offline)' : cachedOnly ? ' (cached)' : ''}.`);
