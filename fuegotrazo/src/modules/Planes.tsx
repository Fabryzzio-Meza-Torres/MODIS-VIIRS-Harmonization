import { useMemo, useState } from 'react'
import { getLang, locale, t } from '../i18n'
import { Plus, Trash2 } from 'lucide-react'
import { fetchActivity, fetchActivityMetadata } from '../api'
import { phases } from '../lib/aggregate'
import { outcome, percent1, validity } from '../lib/forecast'
import { buildPlan, phaseText, PHASE_META, type Priority, type Status, type Task } from '../lib/plan'
import { summarize } from '../lib/summary'
import { useApp, useAsync, useSeries } from '../state'
import { Card, downloadCSV, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, monthShort, monthLong, PageHeader, Stat, weekLabel } from '../ui'

const field = 'w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink'
const PRIORITY: Priority[] = ['Alta', 'Media', 'Baja']
const STATUS: Status[] = ['Pendiente', 'En curso', 'Hecho']
const priorityLabel = (p: Priority) => ({ Alta: t('Alta', 'High'), Media: t('Media', 'Medium'), Baja: t('Baja', 'Low') })[p]
const statusLabel = (s: Status) => ({ Pendiente: t('Pendiente', 'To do'), 'En curso': t('En curso', 'In progress'), Hecho: t('Hecho', 'Done') })[s]
const phaseLabel = (p: keyof typeof PHASE_META) => phaseText(p, getLang()).label
const todayLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

/** Persisted per territory in this browser only (localStorage); nothing is sent anywhere. */
function useStored<T>(key: string, init: T) {
  const read = (): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : init } catch { return init } }
  const [v, setV] = useState<T>(read)
  const [k, setK] = useState(key)
  if (k !== key) { setK(key); setV(read()) }
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)) } catch { /* storage full or blocked */ } }
  return [v, set] as const
}

function Pronostico({ region }: { region: string | null }) {
  const meta = useAsync(fetchActivityMetadata, [])
  const ok = !!meta.data && validity(meta.data).ok
  const week = meta.data?.available_target_weeks[0]
  const risk = useAsync((s) => (ok && region && week ? fetchActivity(region, week, s) : Promise.resolve(null)), [ok, region, week])
  const row = risk.data?.data.find((r) => r.region_id === region && r.target_week_start === week)
  const o = row ? outcome(row) : null
  const pct = o?.available ? percent1(o.percent, locale()) : null
  return (
    <div className="rounded-lg bg-surface p-4 text-sm">
      <h3 className="font-semibold">{t('Pronóstico experimental de la semana más próxima', 'Experimental forecast for the nearest week')}</h3>
      {!region ? <p className="mt-1 text-muted">{t('Elige un departamento en el filtro superior: el pronóstico es regional.', 'Choose a department in the top filter: the forecast is regional.')}</p>
        : meta.loading || risk.loading ? <div aria-busy="true" className="mt-2 h-5 w-72 max-w-full animate-pulse rounded bg-line/60" />
        : !ok || !pct || !row ? <p className="mt-1 text-muted">{t('Pronóstico no disponible ahora', 'Forecast not available now')} ({meta.error || risk.error ? t('el servicio no respondió', 'the service did not respond') : t('emisión vencida o sin estimación', 'expired issue or no estimate')}). {t('No se muestra ningún porcentaje.', 'No percentage is shown.')}</p>
        : <>
          <p className="mt-1"><span className="font-mono text-lg">{pct}</span> <span className="text-muted">{t("· probabilidad estimada de al menos una detección compatible con fuego en el departamento, semana ", "· estimated probability of at least one detection compatible with fire in the department, week ")}{weekLabel(row.target_week_start, row.target_week_end_exclusive)}</span></p>
          <p className="mt-1 text-xs text-muted">{t('Experimental. Emisión ', 'Experimental. Issued ')}{fmt.lima(row.issued_at)}{t(". No indica cuánto territorio se quemará, la gravedad ni la ubicación exacta; no se estima una ignición física confirmada. Detalle en la sección «Pronóstico experimental».", ". It does not indicate how much territory will burn, severity or exact location; it does not estimate a confirmed physical ignition. See the “Experimental forecast” section.")}</p>
        </>}
    </div>
  )
}

export default function Planes() {
  const { filters, regionName } = useApp()
  const { region, y0, y1 } = filters
  const { months, years, weeks, loading, error, retry } = useSeries(region)
  const S = useMemo(() => summarize(years, months, weeks, 'combined', y0, y1), [years, months, weeks, y0, y1])
  const ph = useMemo(() => phases(S.share), [S.share])
  const territory = regionName(region)
  const [tasks, setTasks] = useStored<Task[]>(`fuegotrazo:plan:${region ?? 'peru'}:${getLang()}`, [])
  const [entity, setEntity] = useState('')
  const [confirm, setConfirm] = useState(false)
  const has = S.share.some((x) => x > 0)

  const generate = () => { setTasks(buildPlan(ph, todayLima(), getLang())); setConfirm(false) }
  const edit = (id: string, patch: Partial<Task>) => setTasks(tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const add = () => setTasks([...tasks, { id: `custom-${Date.now()}`, phase: 'preparacion', title: '', due: todayLima(), owner: '', priority: 'Media', status: 'Pendiente', notes: '' }])
  const csv = () => downloadCSV(`${t('plan_preventivo', 'prevention_plan')}_${region ?? 'peru'}.csv`, tasks.map((x) => ({ [t('fase', 'phase')]: phaseLabel(x.phase), [t('accion', 'action')]: x.title, [t('fecha', 'date')]: x.due, [t('responsable', 'owner')]: x.owner, [t('prioridad', 'priority')]: priorityLabel(x.priority), [t('estado', 'status')]: statusLabel(x.status), [t('observaciones', 'notes')]: x.notes })))
  const seasonMonths = (k: string) => ph.map((p, m) => (p === k ? monthShort()[m] : null)).filter(Boolean).join(', ')

  return (
    <>
      <div className="print:hidden"><PageHeader title={t('Generador de planes preventivos', 'Prevention plan generator')} subtitle={t('Arma un plan de acciones para un territorio a partir de su estacionalidad histórica real. Las acciones son una plantilla orientativa que puedes editar; los responsables los defines tú.', 'Build an action plan for a territory from its real historical seasonality. The actions are an indicative template you can edit; you define who is responsible.')} /></div>
      <div className="hidden print:block"><h1 className="text-2xl font-semibold">{t('Plan preventivo de incendios forestales', 'Wildfire prevention plan')} · {territory}</h1>{entity && <p>{t('Entidad', 'Organization')}: {entity}</p>}<p className="text-sm">{t('Generado el', 'Generated on')} {fmt.date(todayLima())} {t('con FuegoTrazo. Orientativo; no reemplaza los avisos oficiales de SENAMHI e INDECI.', 'with FuegoTrazo. Indicative; it does not replace the official warnings of SENAMHI and INDECI.')}</p></div>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <div className="space-y-5">
          <Card title={`${t('Diagnóstico', 'Diagnosis')} · ${territory}`}
            subtitle={t(`Datos armonizados ${y0}–${y1} del ${regionName(region)}. Cambia territorio y años en los filtros superiores.`, `Harmonized data ${y0}–${y1} for ${regionName(region)}. Change territory and years in the top filters.`)}>
            {!has ? <Empty>{t('Sin estimaciones en este periodo.', 'No estimates in this period.')}</Empty> : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label={t('Total del periodo', 'Period total')} value={fmt.n(S.total)} hint={INDICATOR_LABEL.combined} />
                  <Stat label={t('Variación vs. periodo anterior', 'Change vs. previous period')} value={S.change == null ? '—' : `${S.change > 0 ? '+' : ''}${fmt.pct(S.change)}`} hint={S.priorStart == null ? t('Sin periodo anterior disponible', 'No previous period available') : `${S.priorStart}–${y0 - 1}`} />
                  <Stat label={t('Mes de mayor actividad', 'Most active month')} value={S.peak < 0 ? '—' : monthLong()[S.peak]} hint={S.peak < 0 ? undefined : `${fmt.pct(S.share[S.peak])} ${t('del total anual medio', 'of the mean annual total')}`} />
                  <Stat label={t('Temporada alta', 'High season')} value={seasonMonths('alta') || t('sin pico claro', 'no clear peak')} hint={t('Meses con ≥ 1,5 veces la participación uniforme', 'Months with ≥ 1.5 times the uniform share')} />
                </div>
                <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" aria-label={t('Fases por mes', 'Phases by month')}>
                  {ph.map((p, m) => (
                    <li key={m} className="rounded-lg px-2 py-2 text-center" style={{ background: PHASE_META[p].bg, color: PHASE_META[p].fg }} aria-label={`${monthLong()[m]}: ${phaseLabel(p)}`}>
                      <div className="text-xs font-medium">{monthShort()[m]}</div><div className="font-mono text-[11px] opacity-90">{fmt.pct(S.share[m])}</div>
                    </li>
                  ))}
                </ol>
                <Pronostico region={region} />
              </div>
            )}
          </Card>

          <Card title={t('Acciones del plan', 'Plan actions')} subtitle={t('Plantilla orientativa por fase; fechas calculadas desde hoy según la temporada. Edita, borra o añade lo que corresponda. Se guarda solo en este navegador.', 'Indicative template per phase; dates computed from today according to the season. Edit, delete or add as needed. Saved only in this browser.')}
            actions={<div className="flex flex-wrap items-end gap-2 print:hidden">
              <label className="flex flex-col gap-1 text-xs text-muted">{t('Entidad (opcional)', 'Organization (optional)')}<input className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder={t('Ej.: Oficina de Gestión del Riesgo', 'E.g.: Risk Management Office')} /></label>
              {tasks.length > 0 && !confirm ? <button onClick={() => setConfirm(true)} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('Regenerar', 'Regenerate')}</button>
                : tasks.length > 0 ? <button onClick={generate} className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-ink">{t('Confirmar: reemplaza tus ediciones', 'Confirm: replaces your edits')}</button>
                : <button onClick={generate} disabled={!has} className="rounded-md bg-fire px-3 py-1.5 text-xs font-semibold text-base disabled:opacity-40">{t('Generar plan', 'Generate plan')}</button>}
              {tasks.length > 0 && <><button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">CSV</button><button onClick={() => window.print()} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('Imprimir o guardar PDF', 'Print or save as PDF')}</button></>}
            </div>}>
            {tasks.length === 0 ? <Empty>{t('Aún no hay plan para este territorio. Pulsa «Generar plan».', 'There is no plan for this territory yet. Press “Generate plan”.')}</Empty> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="text-left text-xs text-muted"><tr>{[t('Fase', 'Phase'), t('Acción', 'Action'), t('Fecha', 'Date'), t('Responsable', 'Owner'), t('Prioridad', 'Priority'), t('Estado', 'Status'), ''].map((h) => <th key={h} className="px-1 py-1 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{tasks.map((k) => (
                      <tr key={k.id} className="border-t border-line align-top">
                        <td className="px-1 py-2"><span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]" style={{ background: PHASE_META[k.phase].bg, color: PHASE_META[k.phase].fg }}>{phaseLabel(k.phase)}</span></td>
                        <td className="px-1 py-1.5 w-[34%]"><textarea aria-label={t('Acción', 'Action')} rows={2} className={field} value={k.title} onChange={(e) => edit(k.id, { title: e.target.value })} placeholder={t('Describe la acción', 'Describe the action')} /></td>
                        <td className="px-1 py-1.5"><input aria-label={t('Fecha', 'Date')} type="date" className={field} value={k.due} onChange={(e) => edit(k.id, { due: e.target.value })} /></td>
                        <td className="px-1 py-1.5"><input aria-label={t('Responsable', 'Owner')} className={field} value={k.owner} onChange={(e) => edit(k.id, { owner: e.target.value })} placeholder={t('Por definir', 'To be defined')} /></td>
                        <td className="px-1 py-1.5"><select aria-label={t('Prioridad', 'Priority')} className={field} value={k.priority} onChange={(e) => edit(k.id, { priority: e.target.value as Priority })}>{PRIORITY.map((x) => <option key={x} value={x}>{priorityLabel(x)}</option>)}</select></td>
                        <td className="px-1 py-1.5"><select aria-label={t('Estado', 'Status')} className={field} value={k.status} onChange={(e) => edit(k.id, { status: e.target.value as Status })}>{STATUS.map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}</select></td>
                        <td className="px-1 py-1.5 print:hidden"><button aria-label={t('Eliminar acción', 'Delete action')} onClick={() => setTasks(tasks.filter((x) => x.id !== k.id))} className="rounded p-1.5 text-muted hover:text-danger"><Trash2 size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <button onClick={add} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line print:hidden"><Plus size={14} /> {t('Añadir acción', 'Add action')}</button>
              </>
            )}
          </Card>
          <p className="max-w-[80ch] text-xs text-muted">{t('Las acciones son recomendaciones generales de prevención, no un plan oficial ni una orden. Los datos de contacto verificados están en «Centros de apoyo». Los porcentajes del pronóstico son regionales y experimentales.', 'The actions are general prevention recommendations, not an official plan or an order. Verified contact details are in “Support centers”. Forecast percentages are regional and experimental.')}</p>
        </div>
      )}
    </>
  )
}
