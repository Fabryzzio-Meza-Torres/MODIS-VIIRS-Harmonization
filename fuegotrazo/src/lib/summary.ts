import { seasonalShare, type Period } from './aggregate.ts'

export type Ind = 'combined' | 'MODIS' | 'VIIRS'
export interface Summary {
  total: number | null; prior: number | null; change: number | null
  priorStart: number | null // first year of the comparison period, null when it would start before 2001
  share: number[]; peak: number // peak: month index 0..11, -1 when there is no estimate
  estimated: number; weeks: number
}

const year = (key: string) => +key.slice(0, 4)

/** Totals, change against the previous period of the same length, seasonality and estimate coverage for years y0..y1. */
export function summarize(years: Period[], months: Period[], weeks: Period[], ind: Ind, y0: number, y1: number): Summary {
  const sum = (a: number, b: number) => {
    let s: number | null = null
    for (const y of years) if (year(y.key) >= a && year(y.key) <= b && y[ind] != null) s = (s ?? 0) + y[ind]!
    return s
  }
  const n = y1 - y0 + 1
  const total = sum(y0, y1)
  const priorStart = y0 - n >= 2001 ? y0 - n : null
  const prior = priorStart == null ? null : sum(priorStart, y0 - 1)
  const share = seasonalShare(months, y0, y1)
  const wk = weeks.filter((w) => year(w.key) >= y0 && year(w.key) <= y1)
  return {
    total, prior, change: total != null && prior ? total / prior - 1 : null, priorStart, share,
    peak: share.some((x) => x > 0) ? share.indexOf(Math.max(...share)) : -1,
    estimated: wk.filter((w) => w[ind] != null).length, weeks: wk.length,
  }
}
