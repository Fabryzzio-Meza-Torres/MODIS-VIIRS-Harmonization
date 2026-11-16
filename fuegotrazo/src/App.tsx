import { useState } from 'react'
import { CalendarDays, ClipboardList, CloudSun, FileText, FlaskConical, LayoutDashboard, LifeBuoy, Map, Menu, ShieldAlert, TrendingUp, X, type LucideIcon } from 'lucide-react'
import { API_BASE } from './api'
import { EVENTS_UPSTREAM } from './lib/proxy-rules'
import { AppProvider, useApp, type Indicator, type Route } from './state'
import { Boundary, fmt, INDICATOR_LABEL, Select, YearInput } from './ui'
import Panorama from './modules/Panorama'
import Calendario from './modules/Calendario'
import Mapa from './modules/Mapa'
import Tendencias from './modules/Tendencias'
import Prevencion from './modules/Prevencion'
import Laboratorio from './modules/Laboratorio'
import Pronostico from './modules/Pronostico'
import Planes from './modules/Planes'
import Apoyo from './modules/Apoyo'
import Informes from './modules/Informes'

const NAV: { group: string; items: { id: Route; label: string; icon: LucideIcon }[] }[] = [
  { group: 'Exploración', items: [
    { id: 'panorama', label: 'Panorama', icon: LayoutDashboard },
    { id: 'calendario', label: 'Calendario', icon: CalendarDays },
    { id: 'mapa', label: 'Mapa de calor', icon: Map },
    { id: 'tendencias', label: 'Tendencias históricas', icon: TrendingUp },
  ] },
  { group: 'Prevención', items: [
    { id: 'prevencion', label: 'Prevención', icon: ShieldAlert },
    { id: 'pronostico', label: 'Pronóstico experimental', icon: CloudSun },
  ] },
  { group: 'Planificación', items: [
    { id: 'planes', label: 'Generador de planes', icon: ClipboardList },
    { id: 'apoyo', label: 'Centros de apoyo', icon: LifeBuoy },
    { id: 'informes', label: 'Informes', icon: FileText },
  ] },
  { group: 'Análisis', items: [{ id: 'laboratorio', label: 'Laboratorio de armonización', icon: FlaskConical }] },
]
const VIEWS: Record<Route, () => React.JSX.Element> = {
  panorama: Panorama, calendario: Calendario, mapa: Mapa, tendencias: Tendencias, prevencion: Prevencion, pronostico: Pronostico, laboratorio: Laboratorio, planes: Planes, apoyo: Apoyo, informes: Informes,
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { route, go } = useApp()
  return (
    <nav aria-label="Módulos" className="space-y-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-3 text-xs text-muted">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={route === id ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); go(id); onNavigate?.() }}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${route === id ? 'bg-surface text-ink' : 'text-muted hover:bg-surface/60 hover:text-ink'}`}>
                  <Icon size={16} aria-hidden /> {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="px-3">
      <div className="text-lg font-bold tracking-tight">Fuego<span className="text-fire">Trazo</span></div>
      <div className="text-xs text-muted">MODIS · VIIRS armonizado</div>
    </div>
  )
}

function FilterBar() {
  const { filters, setFilters, regions, meta } = useApp()
  const s = meta?.series
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line bg-base/90 px-4 py-3 backdrop-blur md:px-8 print:hidden">
      <Select label="Departamento" value={filters.region ?? ''} onChange={(v) => setFilters({ region: v || null })}
        options={[{ value: '', label: 'Todo el Perú' },
          ...regions.map((r) => ({ value: r.region_id, label: r.name.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE')) }))]} />
      <YearInput label="Desde" value={filters.y0} onChange={(y0) => setFilters({ y0 })} />
      <YearInput label="Hasta" value={filters.y1} onChange={(y1) => setFilters({ y1 })} />
      <Select<Indicator> label="Indicador" value={filters.indicator} onChange={(indicator) => setFilters({ indicator })}
        options={(Object.keys(INDICATOR_LABEL) as Indicator[]).map((k) => ({ value: k, label: INDICATOR_LABEL[k] }))} />
      <div className="ml-auto flex items-center gap-2 text-xs text-muted" title={s ? `Método ${s.method_version} · snapshot ${s.source_snapshot_id}` : undefined}>
        <span className={`inline-block size-2 rounded-full ${s ? 'bg-teal' : 'bg-amber'}`} />
        {s ? <>Series: {s.method_version} · hasta {fmt.date(s.last_week_end)}</> : 'API de series'}
      </div>
    </div>
  )
}

function Shell() {
  const { route } = useApp()
  const [open, setOpen] = useState(false)
  const View = VIEWS[route]
  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr] print:block">
      <aside className="hidden border-r border-line bg-panel py-6 md:block print:hidden"><div className="sticky top-6 space-y-8"><Brand /><Nav /></div></aside>
      <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden print:hidden">
        <Brand />
        <button aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md p-2 hover:bg-surface">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {open && <div className="border-b border-line bg-panel px-2 py-3 md:hidden"><Nav onNavigate={() => setOpen(false)} /></div>}
      <div className="min-w-0">
        <FilterBar />
        <main className="px-4 py-6 md:px-8">
          <Boundary key={route}><View /></Boundary>
        </main>
        <footer className="border-t border-line px-4 py-5 text-xs text-muted md:px-8">
          <p className="max-w-[80ch]">
            Conteos armonizados en una escala común Aqua/Suomi-NPP por semana UTC; no son número de incendios ni cobertura corregida.
            Sin estimación no significa cero. La banda cubre solo la incertidumbre del factor de calibración. Las detecciones son observaciones; los eventos, agrupaciones de detecciones; los conteos comparables, estimaciones; y el pronóstico, una probabilidad regional experimental.
          </p>
          <p className="mt-2">Datos: <a className="text-sky underline" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">API de series y pronósticos</a> y API de eventos históricos (<a className="text-sky underline" href={`${EVENTS_UPSTREAM}/docs`} target="_blank" rel="noreferrer">{EVENTS_UPSTREAM.replace('https://', '')}</a>), servicios independientes · NASA Space Apps Challenge 2026</p>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
