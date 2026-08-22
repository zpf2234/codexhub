import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readEntries } from './lib.mjs';
import { GITHUB_SOURCES, GITHUB_CODE_SOURCES, MCP_REGISTRY_SOURCE } from './discovery/sources.mjs';
import { GithubClient, repositoryCandidate } from './discovery/github-search.mjs';
import { scanRepository } from './discovery/github-tree-scan.mjs';
import { crawlMcpRegistry } from './discovery/mcp-registry.mjs';
import { loadCheckpoint, saveCheckpoint } from './discovery/checkpoint.mjs';
import { normalizeDiscovery } from './discovery/model.mjs';
import { selectScanBatch } from './discovery/scan-queue.mjs';
import { writeArtifactShards } from './discovery/artifact-shards.mjs';

const outputDir = path.join(ROOT, 'artifacts', 'discovery');
const checkpointPath = path.join(outputDir, 'checkpoint.json');
const SOURCE_ALGORITHM_VERSION = 3;
const resume = !process.argv.includes('--fresh');
const scanEnabled = !process.argv.includes('--no-scan');
const maxRepositories = Number(process.env.DISCOVERY_MAX_REPOSITORIES || 0);
const maxArtifactsPerRepository = Number(process.env.DISCOVERY_MAX_ARTIFACTS_PER_REPOSITORY || 500);
const artifactShardBytes = Math.max(1_048_576, Number(process.env.DISCOVERY_ARTIFACT_SHARD_BYTES || 8 * 1024 * 1024));
const maxSourcesPerRun = Number(process.env.DISCOVERY_MAX_SOURCES_PER_RUN || 0);
const scanConcurrency = Math.max(1, Number(process.env.DISCOVERY_SCAN_CONCURRENCY || 4));
const selectedSources = process.env.DISCOVERY_SOURCES ? new Set(process.env.DISCOVERY_SOURCES.split(',').map((value) => value.trim()).filter(Boolean)) : null;
const startedAt = new Date().toISOString();
const client = new GithubClient();
const checkpoint = resume ? await loadCheckpoint(checkpointPath) : { version: 1, completedSources: [], sourceAttempts: {}, sourceCursor: 0, repositories: {}, registry: {}, sourceReports: [], scanOffset: 0, cycleComplete: false };
checkpoint.repositoryDirtyKeys = [];
function markRepositoryDirty(key) {
  if (key && !checkpoint.repositoryDirtyKeys.includes(key)) checkpoint.repositoryDirtyKeys.push(key);
}
if (checkpoint.sourceAlgorithmVersion !== SOURCE_ALGORITHM_VERSION) {
  const registryComplete = checkpoint.registryReport?.complete === true && checkpoint.registry?.complete === true;
  checkpoint.completedSources = registryComplete ? [MCP_REGISTRY_SOURCE.id] : [];
  checkpoint.sourceAttempts = {};
  checkpoint.sourceCursor = 0;
  checkpoint.sourceStates = {};
  checkpoint.sourceReports = [];
  checkpoint.sourceAlgorithmVersion = SOURCE_ALGORITHM_VERSION;
  checkpoint.cycleComplete = false;
}
if (resume && checkpoint.cycleComplete) {
  checkpoint.completedSources = [];
  checkpoint.sourceReports = [];
  checkpoint.registry = {};
  checkpoint.registryReport = null;
  checkpoint.scanOffset = 0;
  checkpoint.sourceAttempts = {};
  checkpoint.sourceCursor = 0;
  checkpoint.sourceStates = {};
  checkpoint.cycleComplete = false;
  for (const [key, repository] of Object.entries(checkpoint.repositories)) {
    if (repository.registryOnly === true && !repository.owner) {
      delete checkpoint.repositories[key];
      markRepositoryDirty(key);
      continue;
    }
    delete repository.scan;
    delete repository.registryServers;
    delete repository.registryOnly;
  }
}
const entries = await readEntries();
const repositories = new Map(Object.entries(checkpoint.repositories));
for (const entry of entries) {
  const fullName = `${entry.repository.owner}/${entry.repository.name}`;
  const key = fullName.toLowerCase();
  const previous = repositories.get(key);
  repositories.set(key, { fullName, owner: entry.repository.owner, name: entry.repository.name, url: entry.repository.url, description: entry.summary, stars: previous?.stars ?? null, forks: previous?.forks ?? null, license: entry.license, defaultBranch: previous?.defaultBranch, archived: previous?.archived ?? false, discoveredBy: [...new Set([...(previous?.discoveredBy || []), 'curated-catalog'])].sort(), sourceKinds: [...new Set([...(previous?.sourceKinds || []), entry.kind])].sort(), reviewed: true, ...(previous?.scan ? { scan: previous.scan } : {}) });
  markRepositoryDirty(key);
}
const sourceReports = [...(checkpoint.sourceReports || [])];
const errors = [];
let processedSources = 0;

const githubSources = [...GITHUB_SOURCES, ...GITHUB_CODE_SOURCES];
const sourceOrder = new Map(githubSources.map((source, index) => [source.id, index]));
checkpoint.sourceAttempts ||= {};
checkpoint.sourceCursor ||= 0;

function sourceBudgetAvailable() {
  return selectedSources || maxSourcesPerRun <= 0 || processedSources < maxSourcesPerRun;
}

function sourceSucceeded(result) {
  return result.errors.length === 0 && result.truncated === false;
}

function mergeRepositories(items, source) {
  for (const item of items) {
    const key = item.full_name.toLowerCase();
    const candidate = repositoryCandidate(item, source);
    const previous = repositories.get(key);
    if (previous) {
      Object.assign(previous, Object.fromEntries(Object.entries(candidate).filter(([, value]) => value != null)));
      previous.discoveredBy = [...new Set([...(previous.discoveredBy || []), source.id])].sort();
      previous.sourceKinds = [...new Set([...(previous.sourceKinds || []), source.kind])].sort();
    } else repositories.set(key, candidate);
    markRepositoryDirty(key);
  }
}

function saveSourceReport(report) {
  const reportIndex = sourceReports.findIndex((value) => value.id === report.id);
  if (reportIndex >= 0) sourceReports[reportIndex] = report;
  else sourceReports.push(report);
}

function parseGithubRepository(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, '');
  return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
}

const unresolvedSources = githubSources
  .filter((source) => (!selectedSources || selectedSources.has(source.id)) && !checkpoint.completedSources.includes(source.id))
  .sort((a, b) => (checkpoint.sourceAttempts[a.id] || 0) - (checkpoint.sourceAttempts[b.id] || 0) || sourceOrder.get(a.id) - sourceOrder.get(b.id));
const sourcesThisRun = selectedSources ? unresolvedSources : unresolvedSources.slice(0, maxSourcesPerRun > 0 ? maxSourcesPerRun : unresolvedSources.length);

for (const source of sourcesThisRun) {
  if (!sourceBudgetAvailable()) break;
  processedSources += 1;
  checkpoint.sourceAttempts[source.id] = (checkpoint.sourceAttempts[source.id] || 0) + 1;
  const isCodeSource = GITHUB_CODE_SOURCES.some((candidate) => candidate.id === source.id);
  const result = isCodeSource
    ? await client.collectCodeQuery(source.query, source)
    : await client.collectQueryBatch(source.query, source, checkpoint.sourceStates[source.id] || {}, { maxSegments: Number(process.env.GITHUB_DISCOVERY_MAX_SEGMENTS_PER_RUN || process.env.GITHUB_DISCOVERY_MAX_SEGMENTS || 32) });
  if (!isCodeSource) checkpoint.sourceStates[source.id] = result.state;
  mergeRepositories(result.items, source);
  const sourceReport = isCodeSource
    ? { id: source.id, kind: source.kind, coverage: source.coverage, query: source.query, mode: 'code-search', total: result.total, pages: result.pages, results: [...repositories.values()].filter((repository) => repository.discoveredBy?.includes(source.id)).length, truncated: result.truncated, errors: result.errors, rate: result.rate }
    : { id: source.id, kind: source.kind, coverage: source.coverage, query: source.query, segments: result.segments, partitions: result.partitions, pendingSegments: result.state.queue.length, results: [...repositories.values()].filter((repository) => repository.discoveredBy?.includes(source.id)).length, truncated: result.truncated, errors: result.errors, rate: result.rate };
  saveSourceReport(sourceReport);
  errors.push(...result.errors.map((error) => ({ source: source.id, ...error })));
  if ((source.coverage === 'supplemental' && result.errors.length === 0) || sourceSucceeded(result)) {
    if (!checkpoint.completedSources.includes(source.id)) checkpoint.completedSources.push(source.id);
  }
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
    if (previous) previous.registryServers = [...new Map([...(previous.registryServers || []), server].map((value) => [value.id, value])).values()];
    else repositories.set(key, { fullName: parsed?.fullName || server.id, owner: parsed?.owner || null, name: parsed?.name || server.name, url: parsed?.url || server.repositoryUrl, description: server.description, stars: null, forks: null, license: 'NOASSERTION', discoveredBy: [MCP_REGISTRY_SOURCE.id], sourceKinds: ['mcp'], registryServers: [server], registryOnly: !parsed });
    markRepositoryDirty(key);
  }
  errors.push(...registry.errors.map((error) => ({ source: MCP_REGISTRY_SOURCE.id, ...error })));
  if (registry.errors.length === 0 && registry.complete) checkpoint.completedSources.push(MCP_REGISTRY_SOURCE.id);
  checkpoint.repositories = Object.fromEntries(repositories);
  checkpoint.sourceReports = sourceReports;
  await saveCheckpoint(checkpointPath, checkpoint);
}

// Preserve errors from a previously persisted Registry attempt when this run skips it.
if (!registryReport.complete && registryReport.errors?.length) {
  errors.push(...registryReport.errors.map((error) => ({ source: MCP_REGISTRY_SOURCE.id, ...error })));
}

const allRepositories = [...repositories.values()].filter((candidate) => candidate.owner && candidate.name);
const successfullyScanned = (candidate) => {
  const scan = checkpoint.repositories[candidate.fullName.toLowerCase()]?.scan;
  return (scan?.status === 'fresh' && scan.truncated !== true && (scan.errors || []).length === 0) || scan?.terminal === true;
};
const scanCandidates = allRepositories.map((candidate) => ({ ...candidate, scan: checkpoint.repositories[candidate.fullName.toLowerCase()]?.scan }));
const scanList = selectScanBatch(scanCandidates, { limit: maxRepositories, retryShare: Number(process.env.DISCOVERY_SCAN_RETRY_SHARE || 0.25), isComplete: successfullyScanned });
const artifacts = [];
const scanReports = [];
let rateLimitedScanEvents = 0;
let scanAttemptsThisRun = 0;
if (scanEnabled) {
  let rateLimited = false;
  for (let batchStart = 0; batchStart < scanList.length; batchStart += scanConcurrency) {
    const batch = scanList.slice(batchStart, batchStart + scanConcurrency);
    const results = await Promise.all(batch.map(async (candidate) => {
      scanAttemptsThisRun += 1;
      const key = candidate.fullName.toLowerCase();
      const scanned = await scanRepository(candidate, { maxArtifacts: maxArtifactsPerRepository });
      scanned.attempts = (checkpoint.repositories[key]?.scan?.attempts || 0) + 1;
      return { candidate, key, scanned };
    }));
    for (const { candidate, key, scanned } of results) {
      if (scanned.rateLimited === true) {
        rateLimitedScanEvents += 1;
        rateLimited = true;
        continue;
      }
      const stored = checkpoint.repositories[key] || candidate;
      const { repository: scannedRepository, ...scan } = scanned;
      checkpoint.repositories[key] = { ...stored, ...(scannedRepository || {}), scan };
      markRepositoryDirty(key);
      scanReports.push({ repository: candidate.fullName, status: scanned.status, artifacts: scanned.artifacts.length, verifiedArtifacts: scanned.verifiedArtifacts ?? scanned.artifacts.filter((artifact) => artifact.verification === 'passed').length, deferredArtifacts: scanned.deferredArtifacts ?? scanned.artifacts.filter((artifact) => artifact.verification === 'deferred').length, truncated: scanned.truncated || false, errors: scanned.errors || [] });
      artifacts.push(...scanned.artifacts.map((artifact) => ({ ...artifact, repository: candidate.fullName, repositoryUrl: candidate.url, stars: candidate.stars, discoveredBy: candidate.discoveredBy, sourceKinds: candidate.sourceKinds })));
      if (scanned.terminal !== true) errors.push(...(scanned.errors || []).map((error) => ({ source: 'github-tree-scan', repository: candidate.fullName, error })));
    }
    if (rateLimited) {
      break;
    }
    checkpoint.scanOffset = allRepositories.filter(successfullyScanned).length;
    await saveCheckpoint(checkpointPath, checkpoint);
  }
}
if (scanEnabled) {
  checkpoint.scanOffset = allRepositories.filter(successfullyScanned).length;
  const sourcesComplete = githubSources.every((source) => checkpoint.completedSources.includes(source.id));
  checkpoint.cycleComplete = checkpoint.scanOffset >= allRepositories.length && sourcesComplete && registryReport.complete;
  await saveCheckpoint(checkpointPath, checkpoint);
}

const generatedAt = new Date().toISOString();
const candidateList = [...repositories.values()].map(({ scan, ...candidate }) => ({ ...candidate })).sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || String(a.fullName).localeCompare(String(b.fullName)));
const repositoryIndex = new Map(candidateList.map((repository) => [String(repository.fullName).toLowerCase(), repository]));
const accumulatedArtifacts = Object.values(checkpoint.repositories).flatMap((stored) => (stored.scan?.artifacts || []).map((artifact) => {
  const repository = repositoryIndex.get(String(stored.fullName).toLowerCase()) || stored;
  return { ...artifact, repository: stored.fullName, repositoryUrl: repository.url, defaultBranch: repository.defaultBranch, stars: repository.stars, discoveredBy: repository.discoveredBy, sourceKinds: repository.sourceKinds };
}));
const isRateLimitedScan = (scan) => scan?.status === 'rate-limited' || ((scan?.errors || []).length > 0 && scan.errors.every((error) => /^GitHub API (?:403|429)$/.test(error)));
const persistedScanFailures = allRepositories
  .filter((candidate) => {
    const scan = checkpoint.repositories[candidate.fullName.toLowerCase()]?.scan;
    return !successfullyScanned(candidate) && scan && !isRateLimitedScan(scan);
  })
  .map((candidate) => {
    const scan = checkpoint.repositories[candidate.fullName.toLowerCase()].scan;
    return { repository: candidate.fullName, status: scan.status, truncated: scan.truncated === true, errors: scan.errors || [] };
  });
const terminalUnavailableRepositories = allRepositories.filter((candidate) => checkpoint.repositories[candidate.fullName.toLowerCase()]?.scan?.terminal === true).length;
const rateLimitedRepositories = allRepositories.filter((candidate) => isRateLimitedScan(checkpoint.repositories[candidate.fullName.toLowerCase()]?.scan)).length;
const persistedErrors = persistedScanFailures.map((failure) => ({ source: 'github-tree-scan', repository: failure.repository, status: failure.status, truncated: failure.truncated, error: failure.errors.join('; ') || 'Repository tree scan is incomplete.' }));
const historicalRegistryErrors = (registryReport.errors || []).map((error) => ({ source: MCP_REGISTRY_SOURCE.id, ...error }));
const unresolvedErrors = [...new Map([...errors, ...persistedErrors, ...historicalRegistryErrors].map((error) => [JSON.stringify(error), error])).values()];
const sourcesRemaining = githubSources.filter((source) => !checkpoint.completedSources.includes(source.id)).length;
const exhaustiveSources = GITHUB_SOURCES.filter((source) => source.coverage === 'exhaustive');
const exhaustiveSourcesRemaining = exhaustiveSources.filter((source) => !checkpoint.completedSources.includes(source.id)).length;
const supplementalSources = GITHUB_CODE_SOURCES.filter((source) => source.coverage === 'supplemental');
const supplementalSourcesRemaining = supplementalSources.filter((source) => !checkpoint.completedSources.includes(source.id)).length;
const repositoriesNotScanned = allRepositories.filter((candidate) => !successfullyScanned(candidate)).length;
const allSourceReportsReady = githubSources.every((source) => {
  const report = sourceReports.find((value) => value.id === source.id);
  if (!report || (report.errors || []).length > 0) return false;
  return source.coverage === 'supplemental' || report.truncated === false;
});
const coverage = {
  generatedAt,
  startedAt,
  completedAt: generatedAt,
  scope: 'Cumulative Codex ecosystem index refreshed from declared GitHub search sources plus the official MCP Registry.',
  limitations: ['GitHub repository search is exhaustively date-partitioned across batches until every segment is below the 1,000-result API boundary.', 'GitHub Code Search exposes at most 1,000 results per query and cannot be exhaustively enumerated; these manifest searches are reported as supplemental coverage.', 'GitHub API rate limits, deleted/private repositories, and search indexing lag prevent claims of absolute internet-wide completeness.', 'Discovery never executes repository code, installs dependencies, or connects to MCP servers.'],
  declaredSources: githubSources.map(({ id, kind, coverage: sourceCoverage, query }) => ({ id, kind, coverage: sourceCoverage, query })),
  sources: sourceReports,
  sourcesProcessedThisRun: processedSources,
  sourcesRemaining,
  exhaustiveSourcesRemaining,
  supplementalSourcesRemaining,
  registry: registryReport,
  scans: scanReports,
  repositoriesDiscovered: candidateList.length,
  repositoriesSelected: scanEnabled ? scanList.length : 0,
  repositoriesScanned: scanEnabled ? scanAttemptsThisRun : 0,
  repositoriesNotScanned: scanEnabled ? repositoriesNotScanned : candidateList.length,
  scanOffset: scanEnabled ? checkpoint.scanOffset : 0,
  repositoriesScannedTotal: scanEnabled ? checkpoint.scanOffset : 0,
  cycleComplete: scanEnabled ? checkpoint.cycleComplete : false,
  persistedScanFailures,
  terminalUnavailableRepositories,
  rateLimitedRepositories,
  rateLimitedScanEvents,
  artifactsDiscovered: accumulatedArtifacts.length,
  errors: unresolvedErrors.length,
  scanDisabled: !scanEnabled,
  complete: !selectedSources && !process.env.DISCOVERY_SKIP_REGISTRY && scanEnabled && checkpoint.cycleComplete && sourcesRemaining === 0 && repositoriesNotScanned === 0 && persistedScanFailures.length === 0 && allSourceReportsReady && registryReport.complete
};
const payload = normalizeDiscovery({ schemaVersion: '1.1.0', generatedAt, coverage, repositories: candidateList, artifacts: accumulatedArtifacts, errors: unresolvedErrors });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'repositories.json'), JSON.stringify({ generatedAt, repositories: payload.repositories }) + '\n');
await writeArtifactShards(outputDir, { generatedAt, artifacts: payload.artifacts }, { maxBytes: artifactShardBytes });
await fs.writeFile(path.join(outputDir, 'coverage.json'), JSON.stringify(payload.coverage, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'errors.json'), JSON.stringify({ generatedAt, errors: unresolvedErrors }, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'discovery.json'), JSON.stringify(payload) + '\n');
console.log(`Discovered ${candidateList.length} repositories and ${payload.artifacts.length} artifacts. Coverage: ${coverage.complete ? 'complete' : 'partial'}; unresolved errors: ${unresolvedErrors.length}.`);
