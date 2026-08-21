const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/json' };

function getNextCursor(payload) {
  return payload?.metadata?.nextCursor || payload?.metadata?.next_cursor || payload?.nextCursor || payload?.next_cursor || null;
}

function getServers(payload) {
  const values = payload?.servers || payload?.items || payload?.results || [];
  return values.map((value) => value?.server || value).filter((value) => value && typeof value === 'object');
}

function repositoryUrl(server) {
  const candidates = [server.repository?.url, server.repository?.source, server.homepage, ...(server.remotes || []).map((item) => item.url), ...(server.packages || []).map((item) => item.registryUrl)];
  return candidates.find((value) => typeof value === 'string' && /^https:\/\/github\.com\//.test(value)) || null;
}

export async function crawlMcpRegistry({ endpoint = 'https://registry.modelcontextprotocol.io/v0/servers', fetchImpl = globalThis.fetch, token, pageSize = 100, maxPages = 10_000, timeoutMs = Number(process.env.MCP_REGISTRY_TIMEOUT_MS || 20_000), initialCursor = null, initialServers = [], initialPages = [], onPage } = {}) {
  const headers = { ...DEFAULT_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const servers = new Map(initialServers.map((server) => [server.id, server]));
  const pages = [...initialPages];
  const errors = [];
  let cursor = initialCursor;
  const lastPage = pages.length + maxPages;
  for (let page = pages.length + 1; page <= lastPage; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('pageSize', String(pageSize));
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers }); }
    catch (error) { errors.push({ page, error: error instanceof Error ? error.message : String(error) }); break; }
    if (!response.ok) { errors.push({ page, error: `MCP Registry HTTP ${response.status}` }); break; }
    let payload;
    try { payload = await response.json(); }
    catch (error) { errors.push({ page, error: `Invalid registry JSON: ${error.message}` }); break; }
    const batch = getServers(payload);
    for (const server of batch) {
      const name = String(server.name || server.id || '').trim();
      if (!name) continue;
      const version = String(server.version || server._meta?.version || 'unknown');
      const id = `mcp-registry:${name}@${version}`.toLowerCase();
      servers.set(id, { id, source: 'mcp-registry', name, version, title: server.title || name, description: server.description || '', repositoryUrl: repositoryUrl(server), server });
    }
    const next = getNextCursor(payload);
    pages.push({ page, count: batch.length, nextCursor: next, cursor });
    if (onPage) await onPage({ page, cursor, nextCursor: next, count: batch.length, servers: [...servers.values()], pages: [...pages], complete: !next || batch.length === 0 });
    if (!next || next === cursor || batch.length === 0) break;
    cursor = next;
  }
  return { servers: [...servers.values()], pages, errors, complete: errors.length === 0 && (!pages.length || !pages.at(-1).nextCursor), cursor };
}
