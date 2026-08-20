import { readEntries, assert } from './lib.mjs';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const entries = await readEntries();
const schema = JSON.parse(await fs.readFile(new URL('../schemas/submission.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
const ids = new Set();
for (const entry of entries) {
  assert(validateSchema(entry), `schema validation failed for ${entry.id}: ${ajv.errorsText(validateSchema.errors)}`);
  assert(!ids.has(entry.id), `duplicate id: ${entry.id}`);
  ids.add(entry.id);
  assert(/^[a-z0-9][a-z0-9-]{2,80}$/.test(entry.id), `invalid id: ${entry.id}`);
  assert(['skill', 'plugin', 'mcp', 'agents', 'action', 'tool'].includes(entry.kind), `invalid kind: ${entry.id}`);
  assert(entry.repository?.owner && entry.repository?.name, `missing repository: ${entry.id}`);
  assert(/^https:\/\/github\.com\//.test(entry.repository.url), `invalid repository url: ${entry.id}`);
  assert(entry.title?.length >= 3 && entry.summary?.length >= 20, `missing title/summary: ${entry.id}`);
  assert(typeof entry.curated === 'boolean', `missing curated flag: ${entry.id}`);
  assert(Array.isArray(entry.artifacts) && entry.artifacts.length > 0, `missing artifacts: ${entry.id}`);
  for (const artifact of entry.artifacts) {
    assert(['verified', 'declared', 'unknown'].includes(artifact.status), `invalid artifact status: ${entry.id}`);
    assert(!artifact.path.includes('..'), `path traversal: ${entry.id}`);
  }
}
console.log(`Validated ${entries.length} catalog entries.`);
