import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadCheckpoint(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      version: 1,
      completedSources: Array.isArray(value.completedSources) ? value.completedSources : [],
      sourceAttempts: value.sourceAttempts && typeof value.sourceAttempts === 'object' ? value.sourceAttempts : {},
      sourceCursor: Number.isInteger(value.sourceCursor) && value.sourceCursor >= 0 ? value.sourceCursor : 0,
      sourceStates: value.sourceStates && typeof value.sourceStates === 'object' ? value.sourceStates : {},
      repositories: value.repositories && typeof value.repositories === 'object' ? value.repositories : {},
      registry: value.registry && typeof value.registry === 'object' ? value.registry : {},
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
  await fs.writeFile(temporary, JSON.stringify({ ...checkpoint, version: 1 }, null, 2) + '\n');
  await fs.rename(temporary, filePath);
}
