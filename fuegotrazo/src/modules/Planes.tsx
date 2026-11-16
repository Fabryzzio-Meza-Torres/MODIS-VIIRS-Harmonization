import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { fetchRisk, fetchRiskMetadata } from '../api'
import { phases } from '../lib/aggregate'
import { outcome, percent1, validity } from '../lib/forecast'
import { buildPlan, PHASE_META, type Priority, type Status, type Task } from '../lib/plan'
import { summarize } from '../lib/summary'
import { useApp, useAsync, useSeries } from '../state'
import { Card, downloadCSV, Empty, ErrorBox, fmt, Loading, MONTHS, MONTHS_LONG, PageHeader, Stat, weekLabel } from '../ui'

const field = 'w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink'
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
  const meta = useAsync(fetchRiskMetadata, [])
  const ok = !!meta.data && validity(meta.data).ok
  const week = meta.data?.available_target_weeks[0]
  const risk = useAsync((s) => (ok && region && week ? fetchRisk(region, week, s) : Promise.resolve(null)), [ok, region, week])
  const row = risk.data?.data[0]
  const o = row ? outcome(row) : null
  const pct = o?.available ? percent1(o.percent) : null
  return (
    <div className="rounded-lg bg-surface p-4 text-sm">
      <h3 className="font-semibold">Pronóstico experimental de la semana más próxima</h3>
      {!region ? <p className="mt-1 text-muted">Elige un departamento en el filtro superior: el pronóstico es regional.</p>
        : meta.loading || risk.loading ? <div aria-busy="true" className="mt-2 h-5 w-72 max-w-full animate-pulse rounded bg-line/60" />
        : !ok || !pct || !row ? <p className="mt-1 text-muted">Pronóstico no disponible ahora ({meta.error || risk.error ? 'el servicio no respondió' : 'emisión vencida o sin estimación'}). No se muestra ningún porcentaje.</p>
        : <>
          <p className="mt-1"><span className="font-mono text-lg">{pct}</span> <span className="text-muted">· probabilidad estimada de un nuevo episodio detectado en el departamento, semana {weekLabel(row.target_week_start, row.target_week_end_exclusive)}</span></p>
          <p className="mt-1 text-xs text-muted">Experimental. Emisión {fmt.lima(row.issued_at)}. No indica cuánto territorio se quemará, la gravedad ni la ubicación exacta; la ignición física no está verificada. Detalle en la sección «Pronóstico experimental».</p>
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
  const [tasks, setTasks] = useStored<Task[]>(`fuegotrazo:plan:${region ?? 'peru'}:`, [])
  const [entity, setEntity] = useState('')
  const [confirm, setConfirm] = useState(false)
  const has = S.share.some((x) => x > 0)

  const generate = () => { setTasks(buildPlan(ph, todayLima())); setConfirm(false) }
  const edit = (id: string, patch: Partial<Task>) => setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const add = () => setTasks([...tasks, { id: `custom-${Date.now()}`, phase: 'preparacion', title: '', due: todayLima(), owner: '', priority: 'Media', status: 'Pendiente', notes: '' }])
  const csv = () => downloadCSV(`plan_preventivo_${region ?? 'peru'}.csv`, tasks.map((t) => ({ fase: PHASE_META[t.phase].label, accion: t.title, fecha: t.due, responsable: t.owner, prioridad: t.priority, estado: t.status, observaciones: t.notes })))
  const seasonMonths = (k: string) => ph.map((p, m) => (p === k ? MONTHS[m] : null)).filter(Boolean).join(', ')

  return (
    <>
      <div className="print:hidden"><PageHeader title="Generador de planes preventivos" subtitle="Arma un plan de acciones para un territorio a partir de su estacionalidad histórica real. Las acciones son una plantilla orientativa que puedes editar; los responsables los defines tú." /></div>
      <div className="hidden print:block"><h1 className="text-2xl font-semibold">Plan preventivo de incendios forestales · {territory}</h1>{entity && <p>Entidad: {entity}</p>}<p className="text-sm">Generado el {fmt.date(todayLima())} con FuegoTrazo. Orientativo; no reemplaza los avisos oficiales de SENAMHI e INDECI.</p></div>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <div className="space-y-5">
          <Card title={`Diagnóstico · ${territory}`}
            subtitle={`Datos armonizados ${y0}–${y1} del ${regionName(region)}. Cambia territorio y años en los filtros superiores.`}>
            {!has ? <Empty>Sin estimaciones en este periodo.</Empty> : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Total del periodo" value={fmt.n(S.total)} hint="Datos armonizados (promedio MODIS y VIIRS)" />
                  <Stat label="Variación vs. periodo anterior" value={S.change == null ? '—' : `${S.change > 0 ? '+' : ''}${fmt.pct(S.change)}`} hint={S.priorStart == null ? 'Sin periodo anterior disponible' : `${S.priorStart}–${y0 - 1}`} />
                  <Stat label="Mes de mayor actividad" value={S.peak < 0 ? '—' : MONTHS_LONG[S.peak]} hint={S.peak < 0 ? undefined : `${fmt.pct(S.share[S.peak])} del total anual medio`} />
                  <Stat label="Temporada alta" value={seasonMonths('alta') || 'sin pico claro'} hint="Meses con ≥ 1,5 veces la participación uniforme" />
                </div>
                <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" aria-label="Fases por mes">
                  {ph.map((p, m) => (
                    <li key={m} className="rounded-lg px-2 py-2 text-center" style={{ background: PHASE_META[p].bg, color: PHASE_META[p].fg }} aria-label={`${MONTHS_LONG[m]}: ${PHASE_META[p].label}`}>
                      <div className="text-xs font-medium">{MONTHS[m]}</div><div className="font-mono text-[11px] opacity-90">{fmt.pct(S.share[m])}</div>
                    </li>
                  ))}
                </ol>
                <Pronostico region={region} />
              </div>
            )}
          </Card>

          <Card title="Acciones del plan" subtitle="Plantilla orientativa por fase; fechas calculadas desde hoy según la temporada. Edita, borra o añade lo que corresponda. Se guarda solo en este navegador."
            actions={<div className="flex flex-wrap items-end gap-2 print:hidden">
              <label className="flex flex-col gap-1 text-xs text-muted">Entidad (opcional)<input className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Ej.: Oficina de Gestión del Riesgo" /></label>
              {tasks.length > 0 && !confirm ? <button onClick={() => setConfirm(true)} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">Regenerar</button>
                : tasks.length > 0 ? <button onClick={generate} className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-ink">Confirmar: reemplaza tus ediciones</button>
                : <button onClick={generate} disabled={!has} className="rounded-md bg-fire px-3 py-1.5 text-xs font-semibold text-base disabled:opacity-40">Generar plan</button>}
              {tasks.length > 0 && <><button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">CSV</button><button onClick={() => window.print()} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">Imprimir o guardar PDF</button></>}
            </div>}>
            {tasks.length === 0 ? <Empty>Aún no hay plan para este territorio. Pulsa «Generar plan».</Empty> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="text-left text-xs text-muted"><tr>{['Fase', 'Acción', 'Fecha', 'Responsable', 'Prioridad', 'Estado', ''].map((h) => <th key={h} className="px-1 py-1 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{tasks.map((t) => (
                      <tr key={t.id} className="border-t border-line align-top">
                        <td className="px-1 py-2"><span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]" style={{ background: PHASE_META[t.phase].bg, color: PHASE_META[t.phase].fg }}>{PHASE_META[t.phase].label}</span></td>
                        <td className="px-1 py-1.5 w-[34%]"><textarea aria-label="Acción" rows={2} className={field} value={t.title} onChange={(e) => edit(t.id, { title: e.target.value })} placeholder="Describe la acción" /></td>
                        <td className="px-1 py-1.5"><input aria-label="Fecha" type="date" className={field} value={t.due} onChange={(e) => edit(t.id, { due: e.target.value })} /></td>
                        <td className="px-1 py-1.5"><input aria-label="Responsable" className={field} value={t.owner} onChange={(e) => edit(t.id, { owner: e.target.value })} placeholder="Por definir" /></td>
                        <td className="px-1 py-1.5"><select aria-label="Prioridad" className={field} value={t.priority} onChange={(e) => edit(t.id, { priority: e.target.value as Priority })}>{['Alta', 'Media', 'Baja'].map((x) => <option key={x}>{x}</option>)}</select></td>
                        <td className="px-1 py-1.5"><select aria-label="Estado" className={field} value={t.status} onChange={(e) => edit(t.id, { status: e.target.value as Status })}>{['Pendiente', 'En curso', 'Hecho'].map((x) => <option key={x}>{x}</option>)}</select></td>
                        <td className="px-1 py-1.5 print:hidden"><button aria-label="Eliminar acción" onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))} className="rounded p-1.5 text-muted hover:text-danger"><Trash2 size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <button onClick={add} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line print:hidden"><Plus size={14} /> Añadir acción</button>
              </>
            )}
          </Card>
          <p className="max-w-[80ch] text-xs text-muted">Las acciones son recomendaciones generales de prevención, no un plan oficial ni una orden. Los números de contacto están en «Centros de apoyo» con su estado de verificación. Los porcentajes del pronóstico son regionales y experimentales.</p>
        </div>
      )}
    </>
  )
}
