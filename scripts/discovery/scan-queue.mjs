function byAttemptsThenName(a, b) {
  return (a.scan?.attempts || 0) - (b.scan?.attempts || 0) || String(a.fullName).localeCompare(String(b.fullName));
}

export function selectScanBatch(repositories, { limit = 0, retryShare = 0.25, isComplete = () => false } = {}) {
  const pending = repositories.filter((repository) => !isComplete(repository));
  const retries = pending.filter((repository) => repository.scan).sort(byAttemptsThenName);
  const fresh = pending.filter((repository) => !repository.scan).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  if (limit <= 0) return [...retries, ...fresh];

  const retryBudget = retries.length ? Math.max(1, Math.floor(limit * retryShare)) : 0;
  const selectedRetries = retries.slice(0, retryBudget);
  const selectedFresh = fresh.slice(0, Math.max(0, limit - selectedRetries.length));
  const remaining = limit - selectedRetries.length - selectedFresh.length;
  return [...selectedRetries, ...selectedFresh, ...retries.slice(retryBudget, retryBudget + Math.max(0, remaining))];
}
