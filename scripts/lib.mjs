import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/+([A-Z]:)/, '$1'));
export const ENTRY_DIR = path.join(ROOT, 'catalog', 'entries');

export async function readEntries() {
  const names = (await fs.readdir(ENTRY_DIR)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(path.join(ENTRY_DIR, name), 'utf8'))));
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function scoreEntry(entry, metadata = {}) {
  const checks = [];
  const artifactStatus = entry.artifacts.some((artifact) => artifact.status === 'verified') ? 40 : entry.artifacts.length ? 25 : 0;
  checks.push({ id: 'spec.artifact', label: 'Recognized artifact', points: artifactStatus, evidence: entry.artifacts.map((artifact) => artifact.path) });
  const documentation = Math.min(20, (metadata.hasReadme ? 10 : 0) + (metadata.hasInstall ? 5 : 0) + (metadata.hasUsage ? 5 : 0));
  checks.push({ id: 'docs.basics', label: 'Documentation', points: documentation, evidence: metadata.documentationEvidence ?? [] });
  const maintenance = metadata.isArchived ? 0 : metadata.status === 'unavailable' ? 0 : metadata.updatedAt ? 20 : 10;
  checks.push({ id: 'maintenance.activity', label: 'Maintenance', points: maintenance, evidence: metadata.updatedAt ? [metadata.updatedAt] : [] });
  const hygiene = entry.license && entry.license !== 'NOASSERTION' ? 10 : 0;
  checks.push({ id: 'distribution.license', label: 'Distribution hygiene', points: hygiene, evidence: entry.license ? [entry.license] : [] });
  const transparency = entry.repository.owner && entry.repository.url ? 10 : 0;
  checks.push({ id: 'transparency.provenance', label: 'Transparency', points: transparency, evidence: [entry.repository.url] });
  const total = checks.reduce((sum, check) => sum + check.points, 0);
  const staleAge = metadata.staleAgeDays ?? 0;
  return { total, checks, ranked: hygiene > 0 && artifactStatus === 40 && !metadata.isArchived && metadata.status !== 'unavailable' && staleAge <= 7 };
}

async function githubJson(url, headers) {
  try {
    const response = await fetch(url, { headers });
    const rateRemaining = response.headers.get('x-ratelimit-remaining');
    if (!response.ok) return { ok: false, error: `GitHub API ${response.status}`, rateRemaining };
    const contentType = response.headers.get('content-type') || '';
    return { ok: true, data: contentType.includes('json') ? await response.json() : await response.text(), rateRemaining };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), rateRemaining: null };
  }
}

async function githubText(url, headers) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return { ok: false, error: `GitHub API ${response.status}` };
    return { ok: true, data: await response.text() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchMetadata(entry, offline = false) {
  const fallback = { status: offline ? 'offline' : 'unavailable', stars: null, forks: null, isArchived: false, updatedAt: null, hasReadme: false, hasInstall: false, hasUsage: false, documentationEvidence: [], warnings: offline ? ['Offline build; GitHub metadata was not fetched.'] : [] };
  if (offline) return fallback;
  const headers = { 'User-Agent': 'CodexHub/0.1', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const base = `https://api.github.com/repos/${entry.repository.owner}/${entry.repository.name}`;
  const repoResult = await githubJson(base, headers);
  if (!repoResult.ok) return { ...fallback, warnings: [repoResult.error] };
  const repo = repoResult.data;
  const treeResult = await githubJson(`${base}/git/trees/${repo.default_branch}?recursive=1`, headers);
  const paths = new Set(treeResult.ok ? (treeResult.data.tree || []).map((item) => item.path) : []);
  const artifacts = entry.artifacts.map((artifact) => ({ ...artifact, status: artifact.status === 'verified' && (paths.has(artifact.path) || [...paths].some((candidate) => candidate.startsWith(`${artifact.path}/`))) ? 'verified' : artifact.status === 'verified' ? 'unknown' : artifact.status }));
  const readmeResult = await githubText(`${base}/readme`, { ...headers, Accept: 'application/vnd.github.raw' });
  const readmeText = readmeResult.ok ? readmeResult.data : '';
  const lower = readmeText.toLowerCase();
  const warnings = [];
  if (!treeResult.ok) warnings.push(`Artifact tree unavailable: ${treeResult.error}`);
  if (!readmeResult.ok) warnings.push(`README unavailable: ${readmeResult.error}`);
  return { status: warnings.length ? 'partial' : 'fresh', fetchedAt: new Date().toISOString(), defaultBranch: repo.default_branch || 'main', stars: repo.stargazers_count, forks: repo.forks_count, isArchived: repo.archived, updatedAt: repo.pushed_at, hasReadme: Boolean(readmeText), hasInstall: /install|setup|getting started/.test(lower), hasUsage: /usage|example|quick start/.test(lower), documentationEvidence: readmeText ? ['README.md'] : [], artifacts, warnings, rateRemaining: repoResult.rateRemaining };
}
