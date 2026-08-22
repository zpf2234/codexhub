import fs from 'node:fs/promises';
import path from 'node:path';

const REPOSITORY_SHARD_PATTERN = /^checkpoint-repositories-\d+\.json$/i;
const repositoryShardCache = new Map();
const repositoryShardBuckets = new Map();

function compactRegistryServer(server = {}) {
  const fields = ['id', 'source', 'name', 'version', 'title', 'description', 'repositoryUrl'];
  return Object.fromEntries(fields.filter((field) => server[field] !== undefined && server[field] !== null).map((field) => [field, server[field]]));
}

function migrateRepositories(repositories) {
  return Object.fromEntries(Object.entries(repositories).map(([key, value]) => {
    const repository = { ...value };
    if (repository.scan?.repository && typeof repository.scan.repository === 'object') {
      Object.assign(repository, repository.scan.repository);
      const { repository: _repository, ...scan } = repository.scan;
      repository.scan = scan;
    }
    if (Array.isArray(repository.registryServers)) repository.registryServers = repository.registryServers.map(compactRegistryServer);
    return [key, repository];
  }));
}

function migrateRegistry(registry) {
  if (!registry || typeof registry !== 'object') return {};
  return { ...registry, ...(Array.isArray(registry.servers) ? { servers: registry.servers.map(compactRegistryServer) } : {}) };
}

async function loadRepositoryShards(filePath, value) {
  if (!Array.isArray(value.repositoryShards) || value.repositoryShards.length === 0) return value.repositories && typeof value.repositories === 'object' ? value.repositories : {};
  const directory = path.dirname(filePath);
  const parts = await Promise.all(value.repositoryShards.map(async (name) => {
    const serialized = await fs.readFile(path.join(directory, name), 'utf8');
    return { name, serialized, value: JSON.parse(serialized) };
  }));
  repositoryShardCache.set(path.resolve(directory), new Map(parts.map((part) => [part.name, part.serialized])));
  repositoryShardBuckets.set(path.resolve(directory), new Map(parts.map((part) => [part.name, part.value.repositories || {}])));
  return Object.assign({}, ...parts.map((part) => part.value.repositories || {}));
}

async function writeRepositoryShards(directory, repositories, dirtyKeys = null) {
  const bucketCount = 32;
  const cacheKey = path.resolve(directory);
  const cachedBuckets = repositoryShardBuckets.get(cacheKey);
  const existingBuckets = cachedBuckets && cachedBuckets.size === bucketCount ? cachedBuckets : undefined;
  const buckets = existingBuckets || new Map(Array.from({ length: bucketCount }, (_, index) => [`checkpoint-repositories-${String(index + 1).padStart(4, '0')}.json`, {}]));
  const bucketFor = (key) => {
    let hash = 2166136261;
    for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0) % bucketCount;
  };
  const keys = dirtyKeys === null ? Object.keys(repositories || {}) : dirtyKeys;
  if (existingBuckets === undefined) {
    for (const [key, repository] of Object.entries(repositories || {})) buckets.get(`checkpoint-repositories-${String(bucketFor(key) + 1).padStart(4, '0')}.json`)[key] = repository;
  } else {
    for (const key of keys) {
      const name = `checkpoint-repositories-${String(bucketFor(key) + 1).padStart(4, '0')}.json`;
      if (repositories?.[key]) buckets.get(name)[key] = repositories[key];
      else delete buckets.get(name)[key];
    }
  }
  const previous = repositoryShardCache.get(cacheKey) || new Map();
  const names = [...buckets.keys()];
  const dirtyNames = existingBuckets === undefined
    ? names
    : new Set((dirtyKeys || []).map((key) => `checkpoint-repositories-${String(bucketFor(key) + 1).padStart(4, '0')}.json`));
  for (const name of dirtyNames) {
    const bucket = buckets.get(name);
    const serialized = JSON.stringify({ repositories: bucket }) + '\n';
    if (previous.get(name) === serialized) continue;
    const temporary = path.join(directory, `${name}.tmp`);
    await fs.writeFile(temporary, serialized);
    await fs.rename(temporary, path.join(directory, name));
    previous.set(name, serialized);
  }
  repositoryShardCache.set(cacheKey, previous);
  repositoryShardBuckets.set(cacheKey, buckets);
  const existing = (await fs.readdir(directory)).filter((name) => REPOSITORY_SHARD_PATTERN.test(name));
  for (const name of existing) if (!names.includes(name)) await fs.rm(path.join(directory, name), { force: true });
  return names;
}

export async function loadCheckpoint(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const repositories = await loadRepositoryShards(filePath, value);
    return {
      version: 1,
      completedSources: Array.isArray(value.completedSources) ? value.completedSources : [],
      sourceAttempts: value.sourceAttempts && typeof value.sourceAttempts === 'object' ? value.sourceAttempts : {},
      sourceCursor: Number.isInteger(value.sourceCursor) && value.sourceCursor >= 0 ? value.sourceCursor : 0,
      sourceStates: value.sourceStates && typeof value.sourceStates === 'object' ? value.sourceStates : {},
      repositories: migrateRepositories(repositories),
      registry: value.registry && typeof value.registry === 'object' ? migrateRegistry(value.registry) : {},
      sourceReports: Array.isArray(value.sourceReports) ? value.sourceReports : [],
      registryReport: value.registryReport && typeof value.registryReport === 'object' ? value.registryReport : null,
      scanOffset: Number.isInteger(value.scanOffset) && value.scanOffset >= 0 ? value.scanOffset : 0,
      scanCycle: Number.isInteger(value.scanCycle) && value.scanCycle >= 1 ? value.scanCycle : 1,
      cycleComplete: value.cycleComplete === true,
      sourceAlgorithmVersion: Number.isInteger(value.sourceAlgorithmVersion) ? value.sourceAlgorithmVersion : 1,
      scanAlgorithmVersion: Number.isInteger(value.scanAlgorithmVersion) ? value.scanAlgorithmVersion : 1
    };
  } catch {
    return { version: 1, completedSources: [], sourceAttempts: {}, sourceCursor: 0, sourceStates: {}, repositories: {}, registry: {}, sourceReports: [], registryReport: null, scanOffset: 0, scanCycle: 1, cycleComplete: false, sourceAlgorithmVersion: 1, scanAlgorithmVersion: 1 };
  }
}

export async function saveCheckpoint(filePath, checkpoint) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const { repositories, repositoryDirtyKeys, ...metadata } = checkpoint;
  const repositoryShards = await writeRepositoryShards(directory, repositories, Array.isArray(repositoryDirtyKeys) ? repositoryDirtyKeys : null);
  if (Array.isArray(repositoryDirtyKeys)) repositoryDirtyKeys.length = 0;
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...metadata, repositoryShards, version: 1 }) + '\n');
  await fs.rename(temporary, filePath);
}
