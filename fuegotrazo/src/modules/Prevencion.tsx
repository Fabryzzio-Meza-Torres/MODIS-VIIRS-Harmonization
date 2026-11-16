import { useMemo } from 'react'
import { phases, seasonalShare, type Phase } from '../lib/aggregate'
import { PHASE_META } from '../lib/plan'
import { useApp, useSeries } from '../state'
import { Card, Empty, ErrorBox, fmt, Loading, MONTHS, MONTHS_LONG, PageHeader } from '../ui'

const PHASE = PHASE_META
const ORDER: Phase[] = ['preparacion', 'alta', 'cierre', 'baja']

function Calendario() {
  const { filters, regionName } = useApp()
  const { region, y0, y1 } = filters
  const { months, loading, error, retry } = useSeries(region)
  const share = useMemo(() => seasonalShare(months, y0, y1), [months, y0, y1])
  const ph = useMemo(() => phases(share), [share])
  const now = new Date().getMonth()
  const has = share.some((x) => x > 0)
  return (
    <Card title="Calendario preventivo"
      subtitle={`Fases orientativas para ${regionName(region)}, derivadas de los conteos comparables estimados ${y0}–${y1} (indicador combinado). Temporada alta = mes con al menos 1,5 veces la participación uniforme (8,3 %).`}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : !has ? <Empty>Sin estimaciones en este periodo.</Empty> : (
        <>
          <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
            {ph.map((p, m) => (
              <li key={m} className={`rounded-lg px-2 py-2.5 text-center ${m === now ? 'outline outline-2 outline-ink' : ''}`} style={{ background: PHASE[p].bg, color: PHASE[p].fg }}
                aria-label={`${MONTHS_LONG[m]}: ${PHASE[p].label}, ${fmt.pct(share[m])} de la actividad anual`}>
                <div className="text-xs font-medium">{MONTHS[m]}</div>
                <div className="mt-1 font-mono text-[11px] opacity-90">{fmt.pct(share[m])}</div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">Porcentaje de la actividad anual media que cae en cada mes. El mes actual del calendario está resaltado.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {ORDER.filter((k) => ph.includes(k)).map((k) => (
              <div key={k} className="rounded-lg bg-surface p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: PHASE[k].bg }} />{PHASE[k].label}
                  <span className="font-normal text-muted">· {ph.map((p, m) => (p === k ? MONTHS[m] : null)).filter(Boolean).join(', ')}</span>
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{PHASE[k].tips.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function Avisos() {
  return (
    <Card title="Avisos" subtitle="Se distinguen tres tipos de información. Este sitio no emite alertas operativas.">
      <dl className="grid gap-4 md:grid-cols-3 text-sm">
        {[
          ['Histórico', 'Detecciones de MODIS y VIIRS, y conteos comparables estimados en una escala común. Describe lo ocurrido, con una semana de resolución.'],
          ['Pronóstico experimental', 'Probabilidad regional de detectar al menos un nuevo episodio de fuego en una semana futura. No indica ubicación, extensión ni gravedad. Está en su propia sección.'],
          ['Oficial', 'Los avisos y alertas válidos los emiten SENAMHI, INDECI, SERFOR y SERNANP. Consúltalos antes de tomar decisiones operativas.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg bg-surface p-4"><dt className="font-semibold">{t}</dt><dd className="mt-1 text-muted">{d}</dd></div>
        ))}
      </dl>
    </Card>
  )
}

export default function Prevencion() {
  return (
    <>
      <PageHeader title="Centro de prevención" subtitle="Estacionalidad histórica de los conteos comparables estimados, calculada con los datos de la API de series. Información orientativa para planificar." />
      <div className="space-y-5"><Calendario /><Avisos /></div>
    </>
  )
}
