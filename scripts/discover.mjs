import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readEntries } from './lib.mjs';
import { GITHUB_SOURCES, GITHUB_CODE_SOURCES, MCP_REGISTRY_SOURCE } from './discovery/sources.mjs';
import { GithubClient, repositoryCandidate } from './discovery/github-search.mjs';
import { scanRepository } from './discovery/github-tree-scan.mjs';
import { crawlMcpRegistry } from './discovery/mcp-registry.mjs';
import { loadCheckpoint, saveCheckpoint } from './discovery/checkpoint.mjs';

const outputDir = path.join(ROOT, 'artifacts', 'discovery');
const checkpointPath = path.join(outputDir, 'checkpoint.json');
const resume = !process.argv.includes('--fresh');
const scanEnabled = !process.argv.includes('--no-scan');
const maxRepositories = Number(process.env.DISCOVERY_MAX_REPOSITORIES || 0);
const maxArtifactsPerRepository = Number(process.env.DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY || 500);
const maxSourcesPerRun = Number(process.env.DISCOVERY_MAX_SOURCES_PER_RUN || 0);
const scanConcurrency = Math.max(1, Number(process.env.DISCOVERY_SCAN_CONCURRENCY || 4));
const selectedSources = process.env.DISCOVERY_SOURCES ? new Set(process.env.DISCOVERY_SOURCES.split(',').map((value) => value.trim()).filter(Boolean)) : null;
const startedAt = new Date().toISOString();
const client = new GithubClient();
const checkpoint = resume ? await loadCheckpoint(checkpointPath) : { version: 1, completedSources: [], repositories: {}, registry: {}, sourceReports: [], registryReport: null, scanOffset: 0, cycleComplete: false };
if (resume && checkpoint.cycleComplete) {
  checkpoint.completedSources = [];
  checkpoint.sourceReports = [];
  checkpoint.registry = {};
  checkpoint.registryReport = null;
  checkpoint.scanOffset = 0;
  checkpoint.cycleComplete = false;
}
const entries = await readEntries();
const repositories = new Map(Object.entries(checkpoint.repositories));
for (const entry of entries) {
  const fullName = `${entry.repository.owner}/${entry.repository.name}`;
  const key = fullName.toLowerCase();
  const previous = repositories.get(key);
  repositories.set(key, { fullName, owner: entry.repository.owner, name: entry.repository.name, url: entry.repository.url, description: entry.summary, stars: previous?.stars ?? null, forks: previous?.forks ?? null, license: entry.license, defaultBranch: previous?.defaultBranch, archived: previous?.archived ?? false, discoveredBy: [...new Set([...(previous?.discoveredBy || []), 'curated-catalog'])].sort(), sourceKinds: [...new Set([...(previous?.sourceKinds || []), entry.kind])].sort(), reviewed: true, ...(previous?.scan ? { scan: previous.scan } : {}) });
}
const sourceReports = [...(checkpoint.sourceReports || [])];
const errors = [];
let processedSources = 0;

function sourceBudgetAvailable() {
  return selectedSources || maxSourcesPerRun <= 0 || processedSources < maxSourcesPerRun;
}

function parseGithubRepository(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, '');
  return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
}

for (const source of GITHUB_SOURCES) {
  if (selectedSources && !selectedSources.has(source.id)) continue;
  if (checkpoint.completedSources.includes(source.id)) continue;
  if (!sourceBudgetAvailable()) break;
  processedSources += 1;
  const result = await client.collectQuery(source.query, source);
  for (const item of result.items) {
    const key = item.full_name.toLowerCase();
    const candidate = repositoryCandidate(item, source);
    const previous = repositories.get(key);
    if (previous) {
      previous.discoveredBy = [...new Set([...(previous.discoveredBy || []), source.id])].sort();
      previous.sourceKinds = [...new Set([...(previous.sourceKinds || []), source.kind])].sort();
    } else repositories.set(key, candidate);
  }
  const sourceReport = { id: source.id, kind: source.kind, query: source.query, segments: result.segments, partitions: result.partitions, results: result.items.length, truncated: result.truncated, errors: result.errors, rate: result.rate };
  const reportIndex = sourceReports.findIndex((report) => report.id === source.id);
  if (reportIndex >= 0) sourceReports[reportIndex] = sourceReport; else sourceReports.push(sourceReport);
  errors.push(...result.errors.map((error) => ({ source: source.id, ...error })));
  if (result.errors.length === 0) checkpoint.completedSources.push(source.id);
  checkpoint.repositories = Object.fromEntries(repositories);
  checkpoint.sourceReports = sourceReports;
  await saveCheckpoint(checkpointPath, checkpoint);
}

for (const source of GITHUB_CODE_SOURCES) {
  if (selectedSources && !selectedSources.has(source.id)) continue;
  if (checkpoint.completedSources.includes(source.id)) continue;
  if (!sourceBudgetAvailable()) break;
  processedSources += 1;
  const result = await client.collectCodeQuery(source.query, source);
  for (const item of result.items) {
    const key = item.full_name.toLowerCase();
    const candidate = repositoryCandidate(item, source);
    const previous = repositories.get(key);
    if (previous) {
      Object.assign(previous, Object.fromEntries(Object.entries(candidate).filter(([, value]) => value != null)));
      previous.discoveredBy = [...new Set([...(previous.discoveredBy || []), source.id])].sort();
      previous.sourceKinds = [...new Set([...(previous.sourceKinds || []), source.kind])].sort();
    } else repositories.set(key, candidate);
  }
  const sourceReport = { id: source.id, kind: source.kind, query: source.query, mode: 'code-search', total: result.total, pages: result.pages, results: result.items.length, truncated: result.truncated, errors: result.errors, rate: result.rate };
  const reportIndex = sourceReports.findIndex((report) => report.id === source.id);
  if (reportIndex >= 0) sourceReports[reportIndex] = sourceReport; else sourceReports.push(sourceReport);
  errors.push(...result.errors.map((error) => ({ source: source.id, ...error })));
  if (result.errors.length === 0) checkpoint.completedSources.push(source.id);
  checkpoint.repositories = Object.fromEntries(repositories);
  checkpoint.sourceReports = sourceReports;
  await saveCheckpoint(checkpointPath, checkpoint);
}

let registryReport = { source: MCP_REGISTRY_SOURCE.id, pages: [], results: 0, complete: false, errors: [] };
if (checkpoint.registryReport) registryReport = checkpoint.registryReport;
if (!process.env.DISCOVERY_SKIP_REGISTRY && (!selectedSources || selectedSources.has(MCP_REGISTRY_SOURCE.id)) && !checkpoint.completedSources.includes(MCP_REGISTRY_SOURCE.id)) {
  const registry = await crawlMcpRegistry({ endpoint: process.env.MCP_REGISTRY_ENDPOINT || MCP_REGISTRY_SOURCE.endpoint, token: process.env.MCP_REGISTRY_TOKEN, maxPages: Number(process.env.MCP_REGISTRY_MAX_PAGES || 20), initialCursor: checkpoint.registry?.nextCursor || null, initialServers: checkpoint.registry?.servers || [], initialPages: checkpoint.registry?.pages || [], onPage: async ({ page, cursor, nextCursor, count, servers, pages, complete }) => { checkpoint.registry = { page, cursor, nextCursor, count, servers, pages, complete }; await saveCheckpoint(checkpointPath, checkpoint); } });
  registryReport = { source: MCP_REGISTRY_SOURCE.id, pages: registry.pages, results: registry.servers.length, complete: registry.complete, errors: registry.errors };
  checkpoint.registryReport = registryReport;
  for (const server of registry.servers) {
    const parsed = parseGithubRepository(server.repositoryUrl);
    const key = parsed?.fullName.toLowerCase() || server.id;
    const previous = repositories.get(key);
    if (previous) previous.registryServers = [...(previous.registryServers || []), server];
    else repositories.set(key, { fullName: parsed?.fullName || server.id, owner: parsed?.owner || null, name: parsed?.name || server.name, url: parsed?.url || server.repositoryUrl, description: server.description, stars: null, forks: null, license: 'NOASSERTION', discoveredBy: [MCP_REGISTRY_SOURCE.id], sourceKinds: ['mcp'], registryServers: [server], registryOnly: !parsed });
  }
  errors.push(...registry.errors.map((error) => ({ source: MCP_REGISTRY_SOURCE.id, ...error })));
  if (registry.errors.length === 0 && registry.complete) checkpoint.completedSources.push(MCP_REGISTRY_SOURCE.id);
  checkpoint.repositories = Object.fromEntries(repositories);
  checkpoint.sourceReports = sourceReports;
  await saveCheckpoint(checkpointPath, checkpoint);
}

const allRepositories = [...repositories.values()].filter((candidate) => candidate.owner && candidate.name);
const scanOffset = Math.min(checkpoint.scanOffset || 0, allRepositories.length);
const scanList = maxRepositories > 0 ? allRepositories.slice(scanOffset, scanOffset + maxRepositories) : allRepositories.slice(scanOffset);
const artifacts = [];
const scanReports = [];
if (scanEnabled) {
  for (let batchStart = 0; batchStart < scanList.length; batchStart += scanConcurrency) {
    const batch = scanList.slice(batchStart, batchStart + scanConcurrency);
    const results = await Promise.all(batch.map(async (candidate) => {
      const key = candidate.fullName.toLowerCase();
      const cached = checkpoint.repositories[key]?.scan;
      const scanned = cached?.status === 'fresh' && (cached.errors || []).length === 0 ? cached : await scanRepository(candidate, { maxArtifacts: maxArtifactsPerRepository });
      return { candidate, key, scanned };
    }));
    for (const { candidate, key, scanned } of results) {
      const stored = checkpoint.repositories[key] || candidate;
      checkpoint.repositories[key] = { ...stored, scan: scanned };
      scanReports.push({ repository: candidate.fullName, status: scanned.status, artifacts: scanned.artifacts.length, verifiedArtifacts: scanned.verifiedArtifacts ?? scanned.artifacts.filter((artifact) => artifact.verification === 'passed').length, deferredArtifacts: scanned.deferredArtifacts ?? scanned.artifacts.filter((artifact) => artifact.verification === 'deferred').length, truncated: scanned.truncated || false, errors: scanned.errors || [] });
      artifacts.push(...scanned.artifacts.map((artifact) => ({ ...artifact, repository: candidate.fullName, repositoryUrl: candidate.url, stars: candidate.stars, discoveredBy: candidate.discoveredBy, sourceKinds: candidate.sourceKinds })));
      errors.push(...(scanned.errors || []).map((error) => ({ source: 'github-tree-scan', repository: candidate.fullName, error })));
    }
    checkpoint.scanOffset = scanOffset + batchStart + results.length;
    await saveCheckpoint(checkpointPath, checkpoint);
  }
}
if (scanEnabled) {
  checkpoint.scanOffset = scanOffset + scanList.length;
  checkpoint.cycleComplete = checkpoint.scanOffset >= allRepositories.length;
  await saveCheckpoint(checkpointPath, checkpoint);
}

const generatedAt = new Date().toISOString();
const candidateList = [...repositories.values()].map(({ scan, ...candidate }) => candidate).sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || String(a.fullName).localeCompare(String(b.fullName)));
const coverage = {
  generatedAt,
  startedAt,
  completedAt: generatedAt,
  scope: 'Declared GitHub search sources plus official MCP Registry at crawl time.',
  limitations: ['GitHub repository search exposes at most 1,000 results per query; recursive stars/date partitions are used where possible.', 'GitHub API rate limits, deleted/private repositories, search indexing lag, and truncated repository trees can prevent absolute internet-wide completeness.', 'Discovery never executes repository code, installs dependencies, or connects to MCP servers.'],
  sources: sourceReports,
  sourcesProcessedThisRun: processedSources,
  sourcesRemaining: Math.max(0, GITHUB_SOURCES.length + GITHUB_CODE_SOURCES.length - checkpoint.completedSources.filter((id) => id !== MCP_REGISTRY_SOURCE.id).length),
  registry: registryReport,
  scans: scanReports,
  repositoriesDiscovered: candidateList.length,
  repositoriesScanned: scanEnabled ? scanList.length : 0,
  repositoriesNotScanned: scanEnabled ? Math.max(0, allRepositories.length - scanOffset - scanList.length) : candidateList.length,
  scanOffset: scanEnabled ? checkpoint.scanOffset : 0,
  cycleComplete: scanEnabled ? checkpoint.cycleComplete : false,
  artifactsDiscovered: artifacts.length,
  errors: errors.length,
  scanDisabled: !scanEnabled,
  complete: !selectedSources && !process.env.DISCOVERY_SKIP_REGISTRY && scanEnabled && errors.length === 0 && sourceReports.length === GITHUB_SOURCES.length + GITHUB_CODE_SOURCES.length && sourceReports.every((source) => !source.truncated && source.errors.length === 0) && registryReport.complete
};
const payload = { schemaVersion: '1.0.0', generatedAt, coverage, repositories: candidateList, artifacts, errors };
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'repositories.json'), JSON.stringify({ generatedAt, repositories: candidateList }, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'artifacts.json'), JSON.stringify({ generatedAt, artifacts }, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'errors.json'), JSON.stringify({ generatedAt, errors }, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'discovery.json'), JSON.stringify(payload, null, 2) + '\n');
console.log(`Discovered ${candidateList.length} repositories and ${artifacts.length} artifacts. Coverage: ${coverage.complete ? 'complete' : 'partial'}; errors: ${errors.length}.`);
