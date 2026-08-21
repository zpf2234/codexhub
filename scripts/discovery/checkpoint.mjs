import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadCheckpoint(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      version: 1,
      completedSources: Array.isArray(value.completedSources) ? value.completedSources : [],
      repositories: value.repositories && typeof value.repositories === 'object' ? value.repositories : {},
      registry: value.registry && typeof value.registry === 'object' ? value.registry : {},
      sourceReports: Array.isArray(value.sourceReports) ? value.sourceReports : [],
      registryReport: value.registryReport && typeof value.registryReport === 'object' ? value.registryReport : null
    };
  } catch {
    return { version: 1, completedSources: [], repositories: {}, registry: {}, sourceReports: [], registryReport: null };
  }
}

export async function saveCheckpoint(filePath, checkpoint) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...checkpoint, version: 1 }, null, 2) + '\n');
  await fs.rename(temporary, filePath);
}
