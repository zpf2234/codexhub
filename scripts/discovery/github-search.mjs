const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/vnd.github+json' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withConstraint(query, constraint) {
  return `${query} ${constraint}`.trim();
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export class GithubClient {
  constructor({ fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, sleep = wait, maxRetries = Number(process.env.GITHUB_DISCOVERY_RETRIES || 3), timeoutMs = Number(process.env.GITHUB_DISCOVERY_TIMEOUT_MS || 20_000) } = {}) {
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    this.headers = { ...DEFAULT_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    this.lastRate = null;
  }

  async json(url, init = {}) {
    let attempt = 0;
    while (true) {
      let response;
      try {
        response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs), headers: { ...this.headers, ...(init.headers || {}) } });
      } catch (error) {
        if (attempt++ >= this.maxRetries) return { ok: false, error: error instanceof Error ? error.message : String(error), rate: this.lastRate };
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      const remaining = response.headers?.get?.('x-ratelimit-remaining');
      const reset = response.headers?.get?.('x-ratelimit-reset');
      const retryAfter = response.headers?.get?.('retry-after');
      this.lastRate = { remaining: remaining == null ? null : Number(remaining), reset: reset == null ? null : Number(reset), retryAfter: retryAfter == null ? null : Number(retryAfter) };
      if ((response.status === 403 || response.status === 429) && attempt < this.maxRetries) {
        const delay = retryAfter ? Number(retryAfter) * 1000 : reset ? Math.max(1000, Number(reset) * 1000 - Date.now()) : 1000 * 2 ** attempt;
        attempt += 1;
        await this.sleep(Math.min(delay, 60_000));
        continue;
      }
      if (!response.ok) return { ok: false, error: `GitHub API ${response.status}`, status: response.status, rate: this.lastRate };
      try { return { ok: true, data: await response.json(), rate: this.lastRate }; }
      catch (error) { return { ok: false, error: `Invalid JSON: ${error.message}`, rate: this.lastRate }; }
    }
  }

  async searchPage(query, page, perPage = 100, sort = 'updated', order = 'desc') {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${page}`;
    return this.json(url);
  }

  async codeSearchPage(query, page, perPage = 100) {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
    return this.json(url, { headers: { Accept: 'application/vnd.github+json' } });
  }

  async collectCodeQuery(query, source, options = {}) {
    const perPage = Math.min(100, options.perPage ?? 100);
    const first = await this.codeSearchPage(query, 1, perPage);
    if (!first.ok) return { source, items: [], total: 0, pages: 0, errors: [{ query, error: first.error, status: first.status }], truncated: true, rate: first.rate };
    const total = Number(first.data.total_count || 0);
    const pages = Math.min(Math.ceil(Math.min(total, 1000) / perPage), 10);
    const repositories = new Map();
    const errors = [];
    for (let page = 1; page <= pages; page += 1) {
      const result = page === 1 ? first : await this.codeSearchPage(query, page, perPage);
      if (!result.ok) { errors.push({ query, page, error: result.error, status: result.status }); break; }
      for (const item of result.data.items || []) {
        const repository = item.repository;
        if (repository?.full_name) repositories.set(repository.full_name.toLowerCase(), repository);
      }
    }
    return { source, items: [...repositories.values()], total, pages, errors, truncated: total > 1000 || Boolean(first.data.incomplete_results) || errors.length > 0, rate: this.lastRate };
  }

  async boundary(query, sort, order) {
    const result = await this.searchPage(query, 1, 1, sort, order);
    const item = result.ok ? result.data.items?.[0] : null;
    return { result, item };
  }

  async collectQuery(query, source, options = {}) {
    const maxResults = options.maxResults ?? 100_000;
    const perPage = Math.min(100, options.perPage ?? 100);
    const maxDepth = options.maxDepth ?? Number(process.env.GITHUB_DISCOVERY_MAX_DEPTH || 6);
    const maxSegments = options.maxSegments ?? Number(process.env.GITHUB_DISCOVERY_MAX_SEGMENTS || 32);
    const segments = [];
    const errors = [];
    const partitions = [];
    const results = new Map();
    const visited = new Set();
    let truncated = false;
    const collect = async (segmentQuery, depth = 0) => {
      if (segments.length >= maxSegments) { truncated = true; return; }
      if (visited.has(segmentQuery)) return;
      visited.add(segmentQuery);
      const probe = await this.searchPage(segmentQuery, 1, perPage);
      if (!probe.ok) { errors.push({ query: segmentQuery, error: probe.error, status: probe.status }); return; }
      const total = Number(probe.data.total_count || 0);
      if (probe.data.incomplete_results) truncated = true;
      segments.push({ query: segmentQuery, total, incomplete: Boolean(probe.data.incomplete_results) });
      if (total > 1000 && depth < maxDepth) {
        const split = await this.splitQuery(segmentQuery);
        if (split) {
          partitions.push({ from: segmentQuery, into: split });
          if (split[0] !== segmentQuery && split[1] !== segmentQuery && split[0] !== split[1]) {
            await collect(split[0], depth + 1);
            await collect(split[1], depth + 1);
            return;
          }
          truncated = true;
        }
        truncated = true;
      }
      const pages = Math.min(Math.ceil(Math.min(total, 1000) / perPage), 10);
      for (let page = 1; page <= pages && results.size < maxResults; page += 1) {
        const result = page === 1 ? { ok: true, data: probe.data, rate: probe.rate } : await this.searchPage(segmentQuery, page, perPage);
        if (!result.ok) { errors.push({ query: segmentQuery, page, error: result.error, status: result.status }); break; }
        for (const item of result.data.items || []) {
          if (!results.has(item.full_name?.toLowerCase())) results.set(item.full_name.toLowerCase(), item);
        }
      }
      if (total > 1000) truncated = true;
    };
    await collect(query);
    return { source, items: [...results.values()], segments, partitions, errors, truncated, rate: this.lastRate };
  }

  async splitQuery(query) {
    const low = await this.boundary(query, 'stars', 'asc');
    const high = await this.boundary(query, 'stars', 'desc');
    const minStars = Number(low.item?.stargazers_count);
    const maxStars = Number(high.item?.stargazers_count);
    if (Number.isFinite(minStars) && Number.isFinite(maxStars) && minStars < maxStars) {
      const pivot = Math.floor((minStars + maxStars) / 2);
      return [withConstraint(query, `stars:0..${pivot}`), withConstraint(query, `stars:${pivot + 1}..*`)];
    }
    const oldest = await this.boundary(query, 'updated', 'asc');
    const newest = await this.boundary(query, 'updated', 'desc');
    const oldDate = oldest.item?.pushed_at || oldest.item?.updated_at;
    const newDate = newest.item?.pushed_at || newest.item?.updated_at;
    if (oldDate && newDate && dateOnly(oldDate) < dateOnly(newDate)) {
      const midpoint = new Date((new Date(oldDate).getTime() + new Date(newDate).getTime()) / 2);
      const pivot = dateOnly(midpoint);
      return [withConstraint(query, `pushed:<=${pivot}`), withConstraint(query, `pushed:>${pivot}`)];
    }
    return null;
  }
}

export function repositoryCandidate(item, source) {
  return {
    fullName: item.full_name,
    owner: item.owner?.login,
    name: item.name,
    url: item.html_url,
    cloneUrl: item.clone_url,
    description: item.description,
    stars: item.stargazers_count,
    forks: item.forks_count,
    license: item.license?.spdx_id || 'NOASSERTION',
    defaultBranch: item.default_branch,
    archived: item.archived,
    pushedAt: item.pushed_at,
    discoveredBy: [source.id],
    sourceKinds: [source.kind]
  };
}
