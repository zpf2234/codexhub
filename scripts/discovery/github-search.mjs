const DEFAULT_HEADERS = { 'User-Agent': 'CodexHub/0.2', Accept: 'application/vnd.github+json' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function midpointDate(from, to) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return dateOnly(new Date(start + Math.floor((end - start) / 2)));
}

function withCreatedRange(query, from, to) {
  const base = query.replace(/\screated:(?:[^\s]+)/gi, '').trim();
  return `${base} created:${from}..${to}`;
}

function rangeFromQuery(query) {
  const match = String(query).match(/\bcreated:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\b/i);
  return match ? { from: match[1], to: match[2] } : null;
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
    const collect = async (segmentQuery, depth = 0, createdRange = null) => {
      if (segments.length >= maxSegments) { truncated = true; return; }
      if (visited.has(segmentQuery)) return;
      visited.add(segmentQuery);
      const probe = await this.searchPage(segmentQuery, 1, perPage);
      if (!probe.ok) { errors.push({ query: segmentQuery, error: probe.error, status: probe.status }); return; }
      const total = Number(probe.data.total_count || 0);
      if (probe.data.incomplete_results) truncated = true;
      segments.push({ query: segmentQuery, total, incomplete: Boolean(probe.data.incomplete_results) });
      if (total > 1000 && depth < maxDepth) {
        const split = this.splitQuery(query, createdRange);
        if (split) {
          partitions.push({ from: segmentQuery, into: split.map((item) => item.query) });
          await collect(split[0].query, depth + 1, split[0].range);
          await collect(split[1].query, depth + 1, split[1].range);
          return;
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

  splitQuery(baseQuery, range = null) {
    const from = range?.from || '2008-01-01';
    const to = range?.to || dateOnly(new Date());
    if (from >= to) return null;
    const pivot = midpointDate(from, to);
    const rightFrom = addDays(pivot, 1);
    if (rightFrom > to) return null;
    return [
      { query: withCreatedRange(baseQuery, from, pivot), range: { from, to: pivot } },
      { query: withCreatedRange(baseQuery, rightFrom, to), range: { from: rightFrom, to } }
    ];
  }

  async collectQueryBatch(query, source, state = {}, options = {}) {
    const perPage = Math.min(100, options.perPage ?? 100);
    const maxSegments = Math.max(1, options.maxSegments ?? Number(process.env.GITHUB_DISCOVERY_MAX_SEGMENTS || 32));
    const queue = Array.isArray(state.queue) && state.queue.length ? [...state.queue] : [{ query, depth: 0, range: null }];
    const segments = [...(state.segments || [])];
    const partitions = [...(state.partitions || [])];
    const repositories = new Map();
    const errors = [];
    const unresolved = [];
    let processed = 0;

    while (queue.length && processed < maxSegments) {
      const task = queue.shift();
      const segmentQuery = task.query;
      const probe = await this.searchPage(segmentQuery, 1, perPage);
      if (!probe.ok) {
        errors.push({ query: segmentQuery, error: probe.error, status: probe.status });
        unresolved.push(task, ...queue);
        break;
      }
      processed += 1;
      const total = Number(probe.data.total_count || 0);
      const incomplete = Boolean(probe.data.incomplete_results);
      segments.push({ query: segmentQuery, total, incomplete });
      if (incomplete) {
        errors.push({ query: segmentQuery, error: 'GitHub returned incomplete repository search results.' });
        unresolved.push(task, ...queue);
        break;
      }
      if (total > 1000) {
        const split = this.splitQuery(query, task.range || rangeFromQuery(segmentQuery));
        if (split) {
          partitions.push({ from: segmentQuery, into: split.map((item) => item.query) });
          queue.unshift({ query: split[0].query, depth: task.depth + 1, range: split[0].range }, { query: split[1].query, depth: task.depth + 1, range: split[1].range });
          continue;
        }
      }
      const pages = Math.min(Math.ceil(Math.min(total, 1000) / perPage), 10);
      let failed = false;
      for (let page = 1; page <= pages; page += 1) {
        const result = page === 1 ? { ok: true, data: probe.data, rate: probe.rate } : await this.searchPage(segmentQuery, page, perPage);
        if (!result.ok) {
          errors.push({ query: segmentQuery, page, error: result.error, status: result.status });
          unresolved.push(task, ...queue);
          failed = true;
          break;
        }
        for (const item of result.data.items || []) if (item.full_name) repositories.set(item.full_name.toLowerCase(), item);
      }
      if (failed) break;
      if (total > 1000) unresolved.push(task);
    }

    const nextQueue = [...unresolved, ...queue];
    const complete = nextQueue.length === 0 && errors.length === 0;
    return {
      source,
      items: [...repositories.values()],
      segments,
      partitions,
      errors,
      truncated: !complete,
      complete,
      state: { queue: nextQueue, segments, partitions },
      rate: this.lastRate
    };
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
