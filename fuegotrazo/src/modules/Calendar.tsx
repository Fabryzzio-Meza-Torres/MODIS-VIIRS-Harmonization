import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Period } from '../lib/aggregate'
import { useApp, useSeries } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, makeRamp, monthShort, monthLong, NO_DATA, PageHeader, pick, RAMP, tooltipStyle } from '../ui'

const YEARS = Array.from({ length: 26 }, (_, i) => 2001 + i)

export default function Calendario() {
  const { filters, regionName } = useApp()
  const { region, y0, y1, indicator } = filters
  const { months, weeks, loading, error, retry } = useSeries(region)
  const [sel, setSel] = useState<{ y: number; m: number } | null>(null)

  const byKey = useMemo(() => new Map(months.map((m) => [m.key, m])), [months])
  const ramp = useMemo(() => makeRamp(months.map((m) => pick(m, indicator))), [months, indicator])
  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`

  // default selection: the peak month of the last year in the period
  const fallback = useMemo(() => {
    let best = { y: y1, m: 0, v: -1 }
    for (let m = 0; m < 12; m++) { const v = byKey.get(key(y1, m)); const x = v ? pick(v, indicator) : null; if (x != null && x > best.v) best = { y: y1, m, v: x } }
    return { y: best.y, m: best.m }
  }, [byKey, y1, indicator])
  const cur = sel ?? fallback

  const across = YEARS.map((y) => { const p = byKey.get(key(y, cur.m)); return { y, v: p ? pick(p, indicator) : null } })
  const inMonth = weeks.filter((w) => w.key.startsWith(key(cur.y, cur.m)))
  const wdata = inMonth.map((w: Period) => ({
    w: w.key,
    MODIS: w.MODIS, VIIRS: w.VIIRS,
    MODIS_err: w.MODIS != null ? [w.MODIS - (w.MODIS_lo ?? w.MODIS), (w.MODIS_hi ?? w.MODIS) - w.MODIS] : undefined,
    VIIRS_err: w.VIIRS != null ? [w.VIIRS - (w.VIIRS_lo ?? w.VIIRS), (w.VIIRS_hi ?? w.VIIRS) - w.VIIRS] : undefined,
  }))

  const cell = (y: number, m: number) => {
    const k = key(y, m), p = byKey.get(k)
    const v = p ? pick(p, indicator) : null
    const label = `${monthLong()[m]} ${y}`
    const viirsAbsent = !p || (indicator === 'VIIRS' && k < '2012-02')
    const title = !p ? `${label}: ${t('fuera del periodo disponible', 'outside the available period')}`
      : v == null ? `${label}: ${viirsAbsent ? t('VIIRS no observaba', 'VIIRS was not observing') : t('sin estimación', 'no estimate')}`
      : `${label}: ${fmt.full(v)}${k >= '2026-07' ? ` (${t('parcial', 'partial')})` : ''}`
    const on = cur.y === y && cur.m === m
    return (
      <button key={k} title={title} aria-label={title} aria-pressed={on} disabled={!p}
        onClick={() => setSel({ y, m })}
        className={`h-[22px] min-w-0 rounded-[3px] text-[9px] leading-none text-base/80 ${on ? 'outline outline-2 outline-ink' : ''} ${y < y0 || y > y1 ? 'opacity-60' : ''}`}
        style={{ background: v == null ? (p ? 'transparent' : 'transparent') : ramp.color(v), border: v == null ? `1px dashed ${NO_DATA}` : undefined, cursor: p ? 'pointer' : 'default' }}>
        {k >= '2026-07' && p ? t('p', 'p') : ''}
      </button>
    )
  }

  return (
    <>
      <PageHeader title={t('Calendario de actividad', 'Activity calendar')}
        subtitle={`${regionName(region)} · ${INDICATOR_LABEL[indicator]}. ${t('Identifica los meses y temporadas con mayor actividad histórica; selecciona un mes para ver su detalle. Cada semana se asigna al mes de su lunes (UTC).', 'Identify the months and seasons with the highest historical activity; select a month to see its detail. Each week is assigned to the month of its Monday (UTC).')}`} />
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card title={t('Calendario de recurrencia histórica', 'Historical recurrence calendar')}
            subtitle={t('Años en filas y meses en columnas. «p» = mes con observación incompleta; casilla vacía = sin estimación (no es cero). Los años fuera del filtro se atenúan.', 'Years in rows and months in columns. “p” = month with incomplete observation; empty cell = no estimate (not zero). Years outside the filter are dimmed.')}>
            <div className="grid items-center gap-[3px]" style={{ gridTemplateColumns: '2.5rem repeat(12, minmax(0, 1fr))' }}>
              <div />
              {monthShort().map((m) => <div key={m} className="text-center text-[10px] text-muted">{m}</div>)}
              {YEARS.map((y) => (
                <div key={y} className="contents">
                  <div className="font-mono text-[10px] text-muted">{y}</div>
                  {monthShort().map((_, m) => cell(y, m))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted">
              <span>{t('Menos', 'Less')}</span>
              <div className="flex">{RAMP.map((c) => <div key={c} className="h-2.5 w-6" style={{ background: c }} />)}</div>
              <span>{t('Más (cuantiles del territorio)', 'More (quantiles of the territory)')}</span>
            </div>
          </Card>

          <div className="space-y-5">
            <Card title={`${t('Frente a otros años', 'Versus other years')} · ${monthLong()[cur.m]}`} subtitle={t(`${monthLong()[cur.m]} de cada año · ${regionName(region)}. Resaltado: ${cur.y}.`, `${monthLong()[cur.m]} of each year · ${regionName(region)}. Highlighted: ${cur.y}.`)}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={across} margin={{ right: 8 }}>
                  <CartesianGrid vertical={false} stroke={COLORS.grid} />
                  <XAxis dataKey="y" {...axis} interval={3} />
                  <YAxis {...axis} tickFormatter={fmt.n} width={44} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }}  formatter={(v) => fmt.full(v as number)} />
                  <Bar isAnimationActive={false} dataKey="v" name={INDICATOR_LABEL[indicator]} radius={[3, 3, 0, 0]} onClick={(d) => setSel({ y: (d as unknown as { y: number }).y, m: cur.m })} style={{ cursor: 'pointer' }}>
                    {across.map((a) => <Cell key={a.y} fill={a.y === cur.y ? COLORS.combined : '#2A4F73'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title={t(`Semanas de ${monthLong()[cur.m]} ${cur.y}`, `Weeks of ${monthLong()[cur.m]} ${cur.y}`)}
              subtitle={t('Dato armonizado por instrumento; las barras de error son la banda del 95 % del factor de calibración, no la incertidumbre total.', 'Harmonized data per instrument; the error bars are the 95 % band of the calibration factor, not the total uncertainty.')}>
              {wdata.length === 0 ? <Empty>{t('No hay semanas disponibles para este mes.', 'No weeks available for this month.')}</Empty> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={wdata} margin={{ right: 8 }}>
                    <CartesianGrid vertical={false} stroke={COLORS.grid} />
                    <XAxis dataKey="w" {...axis} tickFormatter={(w: string) => `${+w.slice(8)} ${monthShort()[+w.slice(5, 7) - 1].toLowerCase()}`} />
                    <YAxis {...axis} tickFormatter={fmt.n} width={44} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} labelFormatter={(w) => `${t('Semana del', 'Week of')} ${fmt.date(w as string)}`} formatter={(v) => (v == null ? t('sin estimación', 'no estimate') : fmt.full(v as number))} />
                    <RLegend wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} dataKey="MODIS" fill={COLORS.MODIS} radius={[3, 3, 0, 0]}><ErrorBar dataKey="MODIS_err" stroke="#F4F7FB" width={4} /></Bar>
                    <Bar isAnimationActive={false} dataKey="VIIRS" fill={COLORS.VIIRS} radius={[3, 3, 0, 0]}><ErrorBar dataKey="VIIRS_err" stroke="#F4F7FB" width={4} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
