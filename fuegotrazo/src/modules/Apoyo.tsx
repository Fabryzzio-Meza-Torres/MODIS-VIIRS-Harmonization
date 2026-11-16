import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { CONTACTS, regionalCenter, STATUS_LABEL, VERIFIED_ON, type Channel, type ChannelStatus, type Scope } from '../data/contacts'
import { useApp } from '../state'
import { Card, downloadCSV, Empty, fmt, PageHeader, Select } from '../ui'

const BADGE: Record<ChannelStatus, string> = {
  verificado: 'bg-teal/20 text-teal', sin_confirmar: 'bg-amber/20 text-amber',
}

function ChannelRow({ ch }: { ch: Channel }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(ch.value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  const copyable = ch.kind === 'tel' || ch.kind === 'email'
  return (
    <li className="min-w-0 rounded-md bg-surface px-3 py-2 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{ch.label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${BADGE[ch.status]}`}>{STATUS_LABEL[ch.status]}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {ch.kind === 'web' ? <a className="min-w-0 text-sky underline" href={ch.value} target="_blank" rel="noreferrer">{ch.value}<ExternalLink className="ml-1 inline" size={12} aria-hidden /></a>
          : ch.kind === 'email' && ch.status === 'verificado' ? <a className="min-w-0 truncate font-mono text-sky underline" href={`mailto:${ch.value}`}>{ch.value}</a>
          : ch.kind === 'tel' && ch.status === 'verificado' ? <a className="font-mono text-sky underline" href={`tel:${ch.value.replace(/[^\d+]/g, '')}`}>{ch.value}</a>
          : <span className="font-mono">{ch.value}</span>}
        {copyable && <button onClick={copy} aria-label={`Copiar ${ch.value}`} className="ml-auto rounded p-1 text-muted hover:text-ink"><Copy size={14} /></button>}
        {copied && <span role="status" className="text-xs text-teal">Copiado</span>}
      </div>
      {ch.note && <p className="mt-1.5 text-xs text-muted">{ch.note}</p>}
      {ch.source && <p className="mt-1 text-xs text-muted">Fuente: <a className="underline" href={ch.source} target="_blank" rel="noreferrer">{ch.source.replace(/^https?:\/\//, '')}</a>{ch.status === 'verificado' ? ` · leída el ${fmt.date(VERIFIED_ON)}` : ''}</p>}
    </li>
  )
}

export default function Apoyo() {
  const { filters, regionName } = useApp()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'todas' | Scope>('todas')
  const all = useMemo(() => (filters.region ? [...CONTACTS, regionalCenter(regionName(filters.region))] : CONTACTS), [filters.region, regionName])
  const shown = all.filter((c) => (scope === 'todas' || c.scope === scope) && `${c.sigla} ${c.name} ${c.role}`.toLowerCase().includes(q.toLowerCase()))
  const csv = () => downloadCSV('directorio_institucional.csv', all.flatMap((c) => c.channels.map((ch) => ({
    institucion: c.name, sigla: c.sigla, ambito: c.scope, apoyo: c.role, canal: ch.label, valor: ch.value, estado: STATUS_LABEL[ch.status], fuente: ch.source ?? '', verificado_el: ch.status === 'verificado' ? VERIFIED_ON : '',
  }))))
  return (
    <>
      <PageHeader title="Centros de apoyo" subtitle="Directorio institucional para coordinar la prevención y la respuesta ante incendios forestales." />
      <p role="note" className="mb-5 max-w-[80ch] rounded-lg border border-amber/60 bg-amber/10 p-4 text-sm">
        Un dato aparece como «verificado» solo si lo leí en la página oficial que se indica, el {fmt.date(VERIFIED_ON)}. Los «sin confirmar» tienen una fuente antigua, oculta o que no pude abrir. Se listan solo los canales que se conocen. En una emergencia en curso confirma siempre el canal en la web de la institución. Esta herramienta no atiende ni reenvía avisos.
      </p>
      <Card title="Directorio" subtitle={`${shown.length} instituciones`}
        actions={<div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Buscar
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Institución o sigla" className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink" /></label>
          <Select label="Ámbito" value={scope} onChange={setScope} options={[{ value: 'todas', label: 'Todos' }, { value: 'nacional', label: 'Nacional' }, { value: 'regional', label: 'Regional' }, { value: 'local', label: 'Local' }, { value: 'tecnico', label: 'Técnico' }]} />
          <button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">Descargar CSV</button>
        </div>}>
        {shown.length === 0 ? <Empty>Ninguna institución coincide con la búsqueda.</Empty> : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((c) => (
              <article key={c.id} className="flex min-w-0 flex-col rounded-xl border border-line p-4">
                <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-teal">{c.sigla}</span><span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">{c.scope}</span></div>
                <h3 className="mt-1 text-sm font-medium leading-snug">{c.name}</h3>
                <p className="mt-1 text-xs text-muted">{c.role}</p>
                {c.note && <p className="mt-2 text-xs text-muted">{c.note}</p>}
                <ul className="mt-3 space-y-2">{c.channels.map((ch) => <ChannelRow key={ch.kind + ch.label} ch={ch} />)}</ul>
              </article>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
