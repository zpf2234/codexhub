import fs from 'node:fs/promises';
import path from 'node:path';

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

export async function loadCheckpoint(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      version: 1,
      completedSources: Array.isArray(value.completedSources) ? value.completedSources : [],
      sourceAttempts: value.sourceAttempts && typeof value.sourceAttempts === 'object' ? value.sourceAttempts : {},
      sourceCursor: Number.isInteger(value.sourceCursor) && value.sourceCursor >= 0 ? value.sourceCursor : 0,
      sourceStates: value.sourceStates && typeof value.sourceStates === 'object' ? value.sourceStates : {},
      repositories: value.repositories && typeof value.repositories === 'object' ? migrateRepositories(value.repositories) : {},
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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...checkpoint, version: 1 }) + '\n');
  await fs.rename(temporary, filePath);
}
