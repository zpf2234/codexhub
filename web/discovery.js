const params = new URLSearchParams(location.search);
const state = { data: null, query: params.get('q') || '', category: params.get('category') || 'all', verification: params.get('verification') || 'all', view: params.get('view') || 'artifacts', sort: params.get('sort') || 'repository', visible: 60 };
const categories = ['all', 'skill', 'plugin', 'mcp', 'marketplace', 'hook', 'config', 'agent-config', 'rule', 'prompt', 'plugin-metadata', 'agents', 'action', 'other'];
const labels = { all: 'All artifacts', skill: 'Skills', plugin: 'Plugins', mcp: 'MCP', marketplace: 'Marketplaces', hook: 'Hooks', config: 'Codex config', 'agent-config': 'Custom agents', rule: 'Execpolicy rules', prompt: 'Custom prompts', 'plugin-metadata': 'Plugin metadata', agents: 'AGENTS.md', action: 'Actions', other: 'Other' };
const statusLabels = { verified: 'Verified', discovered: 'Deferred', registry: 'Registry', unknown: 'Unknown' };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
const formatNumber = (value) => value == null ? 'n/a' : new Intl.NumberFormat('en', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const formatExact = (value) => value == null ? 'n/a' : new Intl.NumberFormat('en').format(value);

function syncUrl() {
  const next = new URLSearchParams();
  if (state.query) next.set('q', state.query);
  if (state.category !== 'all') next.set('category', state.category);
  if (state.verification !== 'all') next.set('verification', state.verification);
  if (state.view !== 'artifacts') next.set('view', state.view);
  if (state.sort !== 'repository') next.set('sort', state.sort);
  history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
}

function artifactLink(artifact) {
  if (artifact.source === 'mcp-registry') return safeUrl(artifact.repositoryUrl);
  const base = safeUrl(artifact.repositoryUrl);
  if (base === '#') return '#';
  return `${base}/blob/${encodeURIComponent(artifact.defaultBranch || 'main')}/${String(artifact.path).split('/').map(encodeURIComponent).join('/')}`;
}

function artifactCard(artifact) {
  const article = el('article', 'discovery-card');
  const header = el('div', 'discovery-card-header');
  header.append(el('span', `category-badge category-${artifact.category}`, artifact.categoryLabel || labels[artifact.category] || artifact.category), el('span', `verification verification-${artifact.status}`, statusLabels[artifact.status] || artifact.verification || artifact.status));
  const name = artifact.name || String(artifact.path).split('/').at(-2) || String(artifact.path).split('/').at(-1);
  const title = el('h3', '', name);
  const repo = el('p', 'owner', artifact.repository || 'Registry-only server');
  const path = el('code', 'artifact-path', artifact.path || artifact.name || 'n/a');
  const summary = el('p', 'summary', artifact.description || artifact.note || 'Artifact discovered from repository metadata.');
  const meta = el('div', 'artifact-meta');
  if (artifact.version) meta.append(el('span', '', `v${artifact.version}`));
  if (artifact.stars != null) meta.append(el('span', '', `Stars ${formatNumber(artifact.stars)}`));
  meta.append(el('span', '', artifact.source === 'mcp-registry' ? 'Official registry' : artifact.verification || 'discovered'));
  const link = el('a', 'card-link', artifact.source === 'mcp-registry' ? 'Open source' : 'View artifact');
  link.href = artifactLink(artifact); link.target = '_blank'; link.rel = 'noreferrer';
  article.append(header, title, repo, path, summary, meta, link);
  return article;
}

function repositoryCard(repository) {
  const article = el('article', 'discovery-card repository-card');
  const header = el('div', 'discovery-card-header');
  const categories = repository.categories?.length ? repository.categories : repository.sourceKinds || [];
  const badges = el('div', 'mini-badges');
  for (const category of categories) badges.append(el('span', `category-badge category-${category}`, labels[category] || category));
  header.append(badges, repository.reviewed ? el('span', 'verification verification-verified', 'Reviewed') : el('span', 'verification verification-discovered', 'Candidate'));
  const title = el('h3', '', repository.fullName || repository.name);
  const summary = el('p', 'summary', repository.description || 'No repository description.');
  const meta = el('div', 'artifact-meta');
  meta.append(el('span', '', `Stars ${formatNumber(repository.stars)}`), el('span', '', `Forks ${formatNumber(repository.forks)}`), el('span', '', repository.license || 'NOASSERTION'));
  const source = el('p', 'source-line', `Sources: ${(repository.discoveredBy || []).join(', ') || 'unknown'}`);
  const link = el('a', 'card-link', 'View repository'); link.href = safeUrl(repository.url); link.target = '_blank'; link.rel = 'noreferrer';
  article.append(header, title, summary, meta, source, link);
  return article;
}

function renderCoverage() {
  const coverage = state.data.coverage || {};
  const card = document.querySelector('#coverage-card');
  const status = el('span', `coverage-pill ${coverage.complete ? 'complete' : 'partial'}`, coverage.complete ? 'Complete cycle' : 'Scanning in progress');
  const title = el('h2', '', coverage.complete ? 'Declared sources covered' : `${formatNumber(coverage.exhaustiveSourcesRemaining ?? coverage.sourcesRemaining)} exhaustive sources remain`);
  const text = el('p', '', coverage.complete ? 'Every exhaustive source, official Registry page, and discovered repository tree completed without unresolved errors.' : `${formatNumber(coverage.repositoriesNotScanned)} repository trees remain. ${formatNumber(coverage.rateLimitedRepositories || 0)} are waiting for GitHub quota recovery; ${formatNumber(coverage.supplementalSourcesRemaining || 0)} supplemental searches remain.`);
  const time = el('small', '', `Snapshot ${new Date(state.data.generatedAt).toLocaleString()}`);
  card.replaceChildren(status, title, text, time);
  document.querySelector('#discovery-repositories').textContent = formatExact(coverage.repositoriesDiscovered ?? state.data.repositories.length);
  document.querySelector('#discovery-artifacts').textContent = formatExact(state.data.artifacts.length);
  document.querySelector('#discovery-registry').textContent = formatExact(coverage.registry?.results || state.data.artifacts.filter((artifact) => artifact.source === 'mcp-registry').length);
  document.querySelector('#discovery-scanned').textContent = formatExact(coverage.scanOffset ?? coverage.repositoriesScanned);
  renderSources(coverage);
}

function renderSources(coverage) {
  const sources = coverage.sources || [];
  document.querySelector('#coverage-source-count').textContent = `${formatNumber(sources.length)} GitHub sources | ${formatNumber(coverage.registry?.pages?.length || 0)} Registry pages`;
  const rows = sources.map((source) => {
    const row = el('article', 'source-row');
    const identity = el('div', 'source-identity'); identity.append(el('strong', '', source.id), el('small', '', `${source.mode === 'code-search' ? 'GitHub code search' : 'GitHub repository search'} | ${source.coverage || 'exhaustive'}`));
    const numbers = el('div', 'source-numbers'); numbers.append(el('span', '', `${formatNumber(source.results)} results`), el('span', '', `${formatNumber(source.segments?.length || source.pages || 0)} pages/segments`));
    const sourceState = source.errors?.length ? el('span', 'verification verification-unknown', `${source.errors.length} errors`) : source.truncated && source.coverage === 'supplemental' ? el('span', 'verification verification-discovered', 'API-capped sample') : source.truncated ? el('span', 'verification verification-discovered', `${formatNumber(source.pendingSegments || 0)} segments pending`) : el('span', 'verification verification-verified', 'Covered');
    row.append(identity, numbers, sourceState); return row;
  });
  const registry = el('article', 'source-row');
  const registryIdentity = el('div', 'source-identity'); registryIdentity.append(el('strong', '', 'mcp-official-registry'), el('small', '', 'Official MCP Registry'));
  const registryNumbers = el('div', 'source-numbers'); registryNumbers.append(el('span', '', `${formatNumber(coverage.registry?.results || 0)} records`), el('span', '', `${formatNumber(coverage.registry?.pages?.length || 0)} pages`));
  registry.append(registryIdentity, registryNumbers, coverage.registry?.complete ? el('span', 'verification verification-verified', 'Covered') : el('span', 'verification verification-discovered', 'In progress'));
  document.querySelector('#source-coverage-list').replaceChildren(...rows, registry);
}

function renderFilters() {
  const counts = state.data.coverage?.categoryCounts || {};
  document.querySelector('#discovery-filters').replaceChildren(...categories.map((category) => {
    const count = category === 'all' ? state.data.artifacts.length : counts[category] || 0;
    const button = el('button', `filter${state.category === category ? ' active' : ''}`);
    button.type = 'button'; button.append(el('span', 'filter-label', labels[category]), el('span', 'filter-count', formatNumber(count)));
    button.onclick = () => { state.category = category; state.visible = 60; render(); };
    return button;
  }));
}

function filteredArtifacts() {
  const query = state.query.trim().toLowerCase();
  return state.data.artifacts.filter((artifact) => {
    const haystack = [artifact.name, artifact.description, artifact.path, artifact.repository, artifact.category, artifact.note].filter(Boolean).join(' ').toLowerCase();
    return (state.category === 'all' || artifact.category === state.category) && (state.verification === 'all' || artifact.status === state.verification) && haystack.includes(query);
  });
}

function filteredRepositories() {
  const query = state.query.trim().toLowerCase();
  return state.data.repositories.filter((repository) => {
    const categories = repository.categories || repository.sourceKinds || [];
    const haystack = [repository.fullName, repository.description, repository.license, ...categories, ...(repository.discoveredBy || [])].filter(Boolean).join(' ').toLowerCase();
    return (state.category === 'all' || categories.includes(state.category)) && haystack.includes(query);
  });
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (state.sort === 'stars') return (b.stars ?? -1) - (a.stars ?? -1) || String(a.repository || a.fullName).localeCompare(String(b.repository || b.fullName));
    if (state.sort === 'category') return String(a.category || a.categories?.[0] || '').localeCompare(String(b.category || b.categories?.[0] || '')) || String(a.path || a.fullName).localeCompare(String(b.path || b.fullName));
    if (state.sort === 'status') return String(a.status || '').localeCompare(String(b.status || '')) || String(a.path || a.fullName).localeCompare(String(b.path || b.fullName));
    return String(a.repository || a.fullName).localeCompare(String(b.repository || b.fullName)) || String(a.path || '').localeCompare(String(b.path || ''));
  });
}

function render() {
  renderFilters(); syncUrl();
  const items = sortItems(state.view === 'artifacts' ? filteredArtifacts() : filteredRepositories());
  const visible = items.slice(0, state.visible);
  document.querySelector('#verification-filter').disabled = state.view === 'repositories';
  document.querySelector('#discovery-result-count').textContent = `${formatNumber(items.length)} ${state.view} | showing ${formatNumber(visible.length)}`;
  document.querySelector('#discovery-results').replaceChildren(...visible.map(state.view === 'artifacts' ? artifactCard : repositoryCard));
  const loadMore = document.querySelector('#discovery-load-more');
  loadMore.hidden = visible.length >= items.length;
  loadMore.textContent = `Load ${formatNumber(Math.min(60, items.length - visible.length))} more`;
  document.querySelector('#discovery-empty').hidden = items.length !== 0;
}

async function start() {
  const response = await fetch('./api/v1/discovery/dashboard.json');
  if (!response.ok) throw new Error('Discovery snapshot unavailable');
  state.data = await response.json();
  renderCoverage();
  const search = document.querySelector('#discovery-search'); search.value = state.query; search.oninput = () => { state.query = search.value; state.visible = 60; render(); };
  const view = document.querySelector('#discovery-view'); view.value = state.view; view.onchange = () => { state.view = view.value; state.visible = 60; render(); };
  const sort = document.querySelector('#discovery-sort'); sort.value = state.sort; sort.onchange = () => { state.sort = sort.value; state.visible = 60; render(); };
  const verification = document.querySelector('#verification-filter'); verification.value = state.verification; verification.onchange = () => { state.verification = verification.value; state.visible = 60; render(); };
  document.querySelector('#discovery-load-more').onclick = () => { state.visible += 60; render(); };
  render();
}

start().catch((error) => {
  document.querySelector('#coverage-card').replaceChildren(el('span', 'coverage-pill partial', 'Snapshot unavailable'), el('h2', '', 'Run a discovery build first'), el('p', '', 'Use npm run discover followed by npm run build:cached.'), el('small', '', error.message));
  document.querySelector('#discovery-empty').hidden = false;
});
