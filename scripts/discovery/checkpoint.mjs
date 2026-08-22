import fs from 'node:fs/promises';
import path from 'node:path';

const REPOSITORY_SHARD_PATTERN = /^checkpoint-repositories-\d+\.json$/i;

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
  const parts = await Promise.all(value.repositoryShards.map(async (name) => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
  return Object.assign({}, ...parts.map((part) => part.repositories || {}));
}

async function writeRepositoryShards(directory, repositories, maxBytes) {
  const shardLimit = Math.max(1, Number(maxBytes) || 8 * 1024 * 1024);
  const entries = Object.entries(repositories || {});
  const names = [];
  let shard = {};
  let shardBytes = Buffer.byteLength('{"repositories":{}}\n');
  const flush = async () => {
    const name = `checkpoint-repositories-${String(names.length + 1).padStart(4, '0')}.json`;
    const temporary = path.join(directory, `${name}.tmp`);
    await fs.writeFile(temporary, JSON.stringify({ repositories: shard }) + '\n');
    await fs.rename(temporary, path.join(directory, name));
    names.push(name);
    shard = {};
    shardBytes = Buffer.byteLength('{"repositories":{}}\n');
  };
  for (const [key, repository] of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(repository)) + 2;
    if (Object.keys(shard).length > 0 && shardBytes + entryBytes > shardLimit) await flush();
    shard[key] = repository;
    shardBytes += entryBytes;
  }
  await flush();
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
      cycleComplete: value.cycleComplete === true,
      sourceAlgorithmVersion: Number.isInteger(value.sourceAlgorithmVersion) ? value.sourceAlgorithmVersion : 1
    };
  } catch {
    return { version: 1, completedSources: [], sourceAttempts: {}, sourceCursor: 0, sourceStates: {}, repositories: {}, registry: {}, sourceReports: [], registryReport: null, scanOffset: 0, cycleComplete: false, sourceAlgorithmVersion: 1 };
  }
}

export async function saveCheckpoint(filePath, checkpoint) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const { repositories, ...metadata } = checkpoint;
  const repositoryShards = await writeRepositoryShards(directory, repositories, process.env.DISCOVERY_CHECKPOINT_SHARD_BYTES || 8 * 1024 * 1024);
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...metadata, repositoryShards, version: 1 }) + '\n');
  await fs.rename(temporary, filePath);
}
