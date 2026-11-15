/* Reusable ES module. The experimental route must be deployed before remote use. */
export class FireRiskError extends Error {
  constructor(status, detail) {
    super(detail?.message || detail?.code || `HTTP ${status}`);
    this.name = 'FireRiskError';
    this.status = status;
    this.detail = detail;
  }
}

export function createFireRiskClient(baseURL) {
  const base = new URL(baseURL);
  if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('HTTP URL required');
  const request = async (path, params = {}, signal) => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {headers: {Accept: 'application/json'}, signal});
    const body = await response.json();
    if (!response.ok) throw new FireRiskError(response.status, body.detail);
    return body;
  };
  return Object.freeze({
    metadata: (signal) => request('/v1/fire-risk/metadata', {}, signal),
    week: (regionId, targetWeekStart, signal) => request('/v1/fire-risk', {
      region_id: String(regionId).padStart(2, '0'), target_week_start: targetWeekStart,
    }, signal),
    outlook: (regionId, signal) => request('/v1/fire-risk/outlook', {
      region_id: regionId === undefined ? undefined : String(regionId).padStart(2, '0'), limit: 300,
    }, signal),
  });
}
