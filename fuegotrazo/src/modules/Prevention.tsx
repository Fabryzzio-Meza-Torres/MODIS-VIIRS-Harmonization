import { useMemo } from 'react'
import { phases, seasonalShare, type Phase } from '../lib/aggregate'
import { phaseText, PHASE_META } from '../lib/plan'
import { getLang, t } from '../i18n'
import { useApp, useSeries } from '../state'
import { Card, Empty, ErrorBox, fmt, Loading, monthShort, monthLong, PageHeader } from '../ui'

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
    <Card title={t('Calendario preventivo', 'Prevention calendar')}
      subtitle={t(`Fases orientativas para ${regionName(region)}, derivadas de los conteos comparables estimados ${y0}–${y1} (indicador combinado). Temporada alta = mes con al menos 1,5 veces la participación uniforme (8,3 %).`, `Indicative phases for ${regionName(region)}, derived from the estimated comparable counts ${y0}–${y1} (combined indicator). High season = a month with at least 1.5 times the uniform share (8.3 %).`)}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : !has ? <Empty>{t('Sin estimaciones en este periodo.', 'No estimates in this period.')}</Empty> : (
        <>
          <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
            {ph.map((p, m) => (
              <li key={m} className={`rounded-lg px-2 py-2.5 text-center ${m === now ? 'outline outline-2 outline-ink' : ''}`} style={{ background: PHASE[p].bg, color: PHASE[p].fg }}
                aria-label={`${monthLong()[m]}: ${phaseText(p, getLang()).label}, ${fmt.pct(share[m])} ${t('de la actividad anual', 'of annual activity')}`}>
                <div className="text-xs font-medium">{monthShort()[m]}</div>
                <div className="mt-1 font-mono text-[11px] opacity-90">{fmt.pct(share[m])}</div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">{t('Porcentaje de la actividad anual media que cae en cada mes. El mes actual del calendario está resaltado.', 'Percentage of the mean annual activity that falls in each month. The current calendar month is highlighted.')}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {ORDER.filter((k) => ph.includes(k)).map((k) => (
              <div key={k} className="rounded-lg bg-surface p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: PHASE[k].bg }} />{phaseText(k, getLang()).label}
                  <span className="font-normal text-muted">· {ph.map((p, m) => (p === k ? monthShort()[m] : null)).filter(Boolean).join(', ')}</span>
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{phaseText(k, getLang()).tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
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
    <Card title={t('Avisos', 'Notices')} subtitle={t('Se distinguen tres tipos de información. Este sitio no emite alertas operativas.', 'Three kinds of information are distinguished. This site does not issue operational alerts.')}>
      <dl className="grid gap-4 md:grid-cols-3 text-sm">
        {[
          [t('Histórico', 'Historical'), t('Detecciones de MODIS y VIIRS, y conteos comparables estimados en una escala común. Describe lo ocurrido, con una semana de resolución.', 'MODIS and VIIRS detections, and comparable counts estimated on a common scale. It describes what happened, at one-week resolution.')],
          [t('Pronóstico experimental', 'Experimental forecast'), t('Probabilidad regional de detectar al menos un nuevo episodio de fuego en una semana futura. No indica ubicación, extensión ni gravedad. Está en su propia sección.', 'Regional probability of detecting at least one new fire episode in a future week. It does not indicate location, extent or severity. It has its own section.')],
          [t('Oficial', 'Official'), t('Los avisos y alertas válidos los emiten SENAMHI, INDECI, SERFOR y SERNANP. Consúltalos antes de tomar decisiones operativas.', 'Valid warnings and alerts are issued by SENAMHI, INDECI, SERFOR and SERNANP. Check them before making operational decisions.')],
        ].map(([title, d]) => (
          <div key={title} className="rounded-lg bg-surface p-4"><dt className="font-semibold">{title}</dt><dd className="mt-1 text-muted">{d}</dd></div>
        ))}
      </dl>
    </Card>
  )
}

export default function Prevencion() {
  return (
    <>
      <PageHeader title={t('Centro de prevención', 'Prevention center')} subtitle={t('Estacionalidad histórica de los conteos comparables estimados, calculada con los datos de la API de series. Información orientativa para planificar.', 'Historical seasonality of the estimated comparable counts, computed from the series API data. Indicative information for planning.')} />
      <div className="space-y-5"><Calendario /><Avisos /></div>
    </>
  )
}
