import { useState } from 'react'
import { CalendarDays, ClipboardList, CloudSun, FileText, FlaskConical, LayoutDashboard, LifeBuoy, Map, Menu, ShieldAlert, TrendingUp, X, type LucideIcon } from 'lucide-react'
import { API_BASE } from './api'
import { EVENTS_UPSTREAM } from './lib/proxy-rules'
import { Languages } from 'lucide-react'
import { t, useLang, type Lang } from './i18n'
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

const nav = (): { group: string; items: { id: Route; label: string; icon: LucideIcon }[] }[] => [
  { group: t('Exploración', 'Explore'), items: [
    { id: 'panorama', label: t('Panorama', 'Overview'), icon: LayoutDashboard },
    { id: 'calendario', label: t('Calendario', 'Calendar'), icon: CalendarDays },
    { id: 'mapa', label: t('Mapa de calor', 'Heat map'), icon: Map },
    { id: 'tendencias', label: t('Tendencias históricas', 'Historical trends'), icon: TrendingUp },
  ] },
  { group: t('Prevención', 'Prevention'), items: [
    { id: 'prevencion', label: t('Prevención', 'Prevention'), icon: ShieldAlert },
    { id: 'pronostico', label: t('Pronóstico experimental', 'Experimental forecast'), icon: CloudSun },
  ] },
  { group: t('Planificación', 'Planning'), items: [
    { id: 'planes', label: t('Generador de planes', 'Plan generator'), icon: ClipboardList },
    { id: 'apoyo', label: t('Centros de apoyo', 'Support centers'), icon: LifeBuoy },
    { id: 'informes', label: t('Informes', 'Reports'), icon: FileText },
  ] },
  { group: t('Análisis', 'Analysis'), items: [{ id: 'laboratorio', label: t('Laboratorio de armonización', 'Harmonization lab'), icon: FlaskConical }] },
]
const VIEWS: Record<Route, () => React.JSX.Element> = {
  panorama: Panorama, calendario: Calendario, mapa: Mapa, tendencias: Tendencias, prevencion: Prevencion, pronostico: Pronostico, laboratorio: Laboratorio, planes: Planes, apoyo: Apoyo, informes: Informes,
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { route, go } = useApp()
  return (
    <nav aria-label={t('Módulos', 'Modules')} className="space-y-5">
      {nav().map((g) => (
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
      <div className="text-xs text-muted">{t('MODIS · VIIRS armonizado', 'MODIS · VIIRS harmonized')}</div>
    </div>
  )
}

function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div role="group" aria-label={t('Idioma', 'Language')} className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5 text-xs">
      <Languages size={14} aria-hidden className="mx-1 text-muted" />
      {([['en', 'EN', 'English'], ['es', 'ES', 'Español']] as [Lang, string, string][]).map(([l, short, name]) => (
        <button key={l} lang={l} aria-pressed={lang === l} aria-label={name} title={name} onClick={() => setLang(l)}
          className={`rounded px-2 py-1 font-medium transition-colors ${lang === l ? 'bg-fire text-base' : 'text-muted hover:text-ink'}`}>{short}</button>
      ))}
    </div>
  )
}

function FilterBar() {
  const { filters, setFilters, regions, meta } = useApp()
  const s = meta?.series
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line bg-base/90 px-4 py-3 backdrop-blur md:px-8 print:hidden">
      <Select label={t('Departamento', 'Department')} value={filters.region ?? ''} onChange={(v) => setFilters({ region: v || null })}
        options={[{ value: '', label: t('Todo el Perú', 'All of Peru') },
          ...regions.map((r) => ({ value: r.region_id, label: r.name.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE')) }))]} />
      <YearInput label={t('Desde', 'From')} value={filters.y0} onChange={(y0) => setFilters({ y0 })} />
      <YearInput label={t('Hasta', 'To')} value={filters.y1} onChange={(y1) => setFilters({ y1 })} />
      <Select<Indicator> label={t('Indicador', 'Indicator')} value={filters.indicator} onChange={(indicator) => setFilters({ indicator })}
        options={(Object.keys(INDICATOR_LABEL) as Indicator[]).map((k) => ({ value: k, label: INDICATOR_LABEL[k] }))} />
      <div className="ml-auto flex items-center gap-2 text-xs text-muted" title={s ? `${t('Método', 'Method')} ${s.method_version} · snapshot ${s.source_snapshot_id}` : undefined}>
        <span className={`inline-block size-2 rounded-full ${s ? 'bg-teal' : 'bg-amber'}`} />
        {s ? <>{t('Series', 'Series')}: {s.method_version} · {t('hasta', 'through')} {fmt.date(s.last_week_end)}</> : t('API de series', 'Series API')}
      </div>
      <LangSwitch />
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
        <div className="flex items-center gap-2">
          <LangSwitch />
          <button aria-label={open ? t('Cerrar menú', 'Close menu') : t('Abrir menú', 'Open menu')} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md p-2 hover:bg-surface">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      {open && <div className="border-b border-line bg-panel px-2 py-3 md:hidden"><Nav onNavigate={() => setOpen(false)} /></div>}
      <div className="min-w-0">
        <FilterBar />
        <main className="px-4 py-6 md:px-8">
          <Boundary key={route}><View /></Boundary>
        </main>
        <footer className="border-t border-line px-4 py-5 text-xs text-muted md:px-8">
          <p className="max-w-[80ch]">
            {t('Conteos armonizados en una escala común Aqua/Suomi-NPP por semana UTC; no son número de incendios ni cobertura corregida. Sin estimación no significa cero. La banda cubre solo la incertidumbre del factor de calibración. Las detecciones son observaciones; los eventos, agrupaciones de detecciones; los conteos comparables, estimaciones; y el pronóstico, una probabilidad regional experimental.',
              'Counts are harmonized to a common Aqua/Suomi-NPP scale per UTC week; they are not a number of fires or a coverage-corrected figure. No estimate does not mean zero. The band covers only the uncertainty of the calibration factor. Detections are observations; events are groupings of detections; comparable counts are estimates; and the forecast is an experimental regional probability.')}
          </p>
          <p className="mt-2">{t('Datos', 'Data')}: <a className="text-sky underline" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">{t('API de series y pronósticos', 'series and forecast API')}</a> {t('y API de eventos históricos', 'and historical events API')} (<a className="text-sky underline" href={`${EVENTS_UPSTREAM}/docs`} target="_blank" rel="noreferrer">{EVENTS_UPSTREAM.replace('https://', '')}</a>), {t('servicios independientes', 'independent services')} · NASA Space Apps Challenge 2026</p>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
