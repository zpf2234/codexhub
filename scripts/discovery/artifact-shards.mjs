import fs from 'node:fs/promises';
import path from 'node:path';

const SHARD_PATTERN = /^artifacts-\d+\.json$/i;

export async function writeArtifactShards(outputDir, { generatedAt, artifacts = [] }, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const shardLimit = Math.max(1, Number(maxBytes) || 8 * 1024 * 1024);
  const existingFiles = await fs.readdir(outputDir);
  for (const file of existingFiles) {
    if (file === 'artifacts.json' || SHARD_PATTERN.test(file)) await fs.rm(path.join(outputDir, file), { force: true });
  }
  let shard = [];
  let shardBytes = Buffer.byteLength('{"generatedAt":"","artifacts":[]}\n');
  let shardIndex = 1;
  const names = [];
  const flush = async () => {
    const name = `artifacts-${String(shardIndex).padStart(4, '0')}.json`;
    await fs.writeFile(path.join(outputDir, name), JSON.stringify({ generatedAt, artifacts: shard }) + '\n');
    names.push(name);
    shardIndex += 1;
    shard = [];
    shardBytes = Buffer.byteLength('{"generatedAt":"","artifacts":[]}\n');
  };
  for (const artifact of artifacts) {
    const artifactBytes = Buffer.byteLength(JSON.stringify(artifact));
    if (shard.length > 0 && shardBytes + artifactBytes + 1 > shardLimit) await flush();
    shard.push(artifact);
    shardBytes += artifactBytes + 1;
  }
  await flush();
  return names;
}

export async function readArtifactShards(discoveryDir) {
  const files = await fs.readdir(discoveryDir);
  const artifactFiles = files.filter((name) => SHARD_PATTERN.test(name)).sort();
  if (artifactFiles.length === 0) return JSON.parse(await fs.readFile(path.join(discoveryDir, 'artifacts.json'), 'utf8'));
  const parts = await Promise.all(artifactFiles.map(async (name) => JSON.parse(await fs.readFile(path.join(discoveryDir, name), 'utf8'))));
  return { generatedAt: parts.find((part) => part.generatedAt)?.generatedAt, artifacts: parts.flatMap((part) => part.artifacts || []) };
}
