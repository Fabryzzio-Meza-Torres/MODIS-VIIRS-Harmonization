export type Instrument = 'MODIS' | 'VIIRS'
export interface WeekRow {
  week_start_utc: string; instrument: Instrument; platform: string | null
  raw_count: number | null; harmonized_count: number | null
  lower_bound: number | null; upper_bound: number | null
  coverage_status: string; estimation_status: 'estimated' | 'unavailable'
}
type N = number | null
export interface Period {
  key: string; weeks: number; combined: N
  MODIS: N; MODIS_raw: N; MODIS_lo: N; MODIS_hi: N
  VIIRS: N; VIIRS_raw: N; VIIRS_lo: N; VIIRS_hi: N
}
const FIELDS = ['combined', 'MODIS', 'MODIS_raw', 'MODIS_lo', 'MODIS_hi', 'VIIRS', 'VIIRS_raw', 'VIIRS_lo', 'VIIRS_hi'] as const
const add = (a: N, b: N): N => (b == null ? a : (a ?? 0) + b)
const blank = (key: string): Period => ({ key, weeks: 0, combined: null, MODIS: null, MODIS_raw: null,
  MODIS_lo: null, MODIS_hi: null, VIIRS: null, VIIRS_raw: null, VIIRS_lo: null, VIIRS_hi: null })
export const monthKey = (iso: string) => iso.slice(0, 7)
export const yearKey = (iso: string) => iso.slice(0, 4)

export function weekly(rows: WeekRow[]): Period[] {
  const by = new Map<string, Period>()
  for (const r of rows) {
    const p = by.get(r.week_start_utc) ?? blank(r.week_start_utc)
    const i = r.instrument
    p[i] = r.harmonized_count; p[`${i}_raw`] = r.raw_count
    p[`${i}_lo`] = r.lower_bound; p[`${i}_hi`] = r.upper_bound
    by.set(p.key, p)
  }
  for (const p of by.values()) {
    const v = [p.MODIS, p.VIIRS].filter((x): x is number => x != null)
    p.combined = v.length ? v.reduce((a, b) => a + b) / v.length : null
    p.weeks = 1
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function rollup(periods: Period[], keyOf: (iso: string) => string): Period[] {
  const by = new Map<string, Period>()
  for (const w of periods) {
    const k = keyOf(w.key), p = by.get(k) ?? blank(k)
    for (const f of FIELDS) p[f] = add(p[f], w[f])
    p.weeks += w.weeks
    by.set(k, p)
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Share of the combined index per calendar month (0=Jan) over years y0..y1. */
export function seasonalShare(months: Period[], y0: number, y1: number): number[] {
  const s = Array(12).fill(0)
  for (const m of months) {
    const y = +m.key.slice(0, 4)
    if (y >= y0 && y <= y1 && m.combined != null) s[+m.key.slice(5, 7) - 1] += m.combined
  }
  const t = s.reduce((a, b) => a + b, 0)
  return t ? s.map((x) => x / t) : s
}

export type Phase = 'alta' | 'preparacion' | 'cierre' | 'baja'
// ponytail: fixed threshold 1.5× uniform share; tune if a region has two seasons that blur together
export function phases(share: number[]): Phase[] {
  const alta = share.map((x) => x >= 1.5 / 12)
  const out: Phase[] = alta.map((a) => (a ? 'alta' : 'baja'))
  for (let m = 0; m < 12; m++) {
    if (alta[m] && !alta[(m + 11) % 12]) for (const d of [1, 2]) { const i = (m - d + 12) % 12; if (out[i] === 'baja') out[i] = 'preparacion' }
    if (alta[m] && !alta[(m + 1) % 12]) { const i = (m + 1) % 12; if (out[i] === 'baja') out[i] = 'cierre' }
  }
  return out
}

/** Lin's CCC, R² (Pearson²) and relative bias (mean(y−x)/mean(x)). */
export function agreement(x: number[], y: number[]) {
  const n = x.length, mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / n
  const mx = mean(x), my = mean(y)
  let sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; sxy += (x[i] - mx) * (y[i] - my) }
  sxx /= n; syy /= n; sxy /= n
  return { n, ccc: (2 * sxy) / (sxx + syy + (mx - my) ** 2), r2: sxy ** 2 / (sxx * syy), bias: (my - mx) / mx }
}
