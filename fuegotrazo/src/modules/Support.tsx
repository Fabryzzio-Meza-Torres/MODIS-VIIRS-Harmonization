import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { getLang, t } from '../i18n'
import { CONTACTS, regionalCenter, SCOPE_LABEL, STATUS_LABEL, VERIFIED_ON, type Channel, type ChannelStatus, type Scope } from '../data/contacts'
import { useApp } from '../state'
import { Card, downloadCSV, Empty, fmt, PageHeader, Select } from '../ui'

const en = () => getLang() === 'en'
const BADGE: Record<ChannelStatus, string> = {
  verificado: 'bg-teal/20 text-teal',
}

function ChannelRow({ ch }: { ch: Channel }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(ch.value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  const copyable = ch.kind === 'tel' || ch.kind === 'email'
  return (
    <li className="min-w-0 rounded-md bg-surface px-3 py-2 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{en() ? ch.en.label : ch.label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${BADGE[ch.status]}`}>{STATUS_LABEL[ch.status][getLang()]}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {ch.kind === 'web' ? <a className="min-w-0 text-sky underline" href={ch.value} target="_blank" rel="noreferrer">{ch.value}<ExternalLink className="ml-1 inline" size={12} aria-hidden /></a>
          : ch.kind === 'email' && ch.status === 'verificado' ? <a className="min-w-0 truncate font-mono text-sky underline" href={`mailto:${ch.value}`}>{ch.value}</a>
          : ch.kind === 'tel' && ch.status === 'verificado' ? <a className="font-mono text-sky underline" href={`tel:${ch.value.replace(/[^\d+]/g, '')}`}>{ch.value}</a>
          : <span className="font-mono">{ch.value}</span>}
        {copyable && <button onClick={copy} aria-label={`${t('Copiar', 'Copy')} ${ch.value}`} className="ml-auto rounded p-1 text-muted hover:text-ink"><Copy size={14} /></button>}
        {copied && <span role="status" className="text-xs text-teal">{t('Copiado', 'Copied')}</span>}
      </div>
      {ch.note && <p className="mt-1.5 text-xs text-muted">{en() ? ch.en.note : ch.note}</p>}
      {ch.source && <p className="mt-1 text-xs text-muted">{t('Fuente', 'Source')}: <a className="underline" href={ch.source} target="_blank" rel="noreferrer">{ch.source.replace(/^https?:\/\//, '')}</a>{ch.status === 'verificado' ? ` · ${t('leída el', 'read on')} ${fmt.date(VERIFIED_ON)}` : ''}</p>}
    </li>
  )
}

export default function Apoyo() {
  const { filters, regionName } = useApp()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'todas' | Scope>('todas')
  const all = useMemo(() => (filters.region ? [...CONTACTS, regionalCenter(regionName(filters.region))] : CONTACTS), [filters.region, regionName])
  const shown = all.filter((c) => (scope === 'todas' || c.scope === scope) && `${c.sigla} ${c.name} ${c.role} ${c.en.gloss} ${c.en.role}`.toLowerCase().includes(q.toLowerCase()))
  const csv = () => downloadCSV(`${t('directorio_institucional', 'institutional_directory')}.csv`, all.flatMap((c) => c.channels.map((ch) => ({
    [t('institucion', 'institution')]: c.name, [t('sigla', 'acronym')]: c.sigla, [t('ambito', 'scope')]: SCOPE_LABEL[c.scope][getLang()], [t('apoyo', 'support')]: en() ? c.en.role : c.role, [t('canal', 'channel')]: en() ? ch.en.label : ch.label, [t('valor', 'value')]: ch.value, [t('estado', 'status')]: STATUS_LABEL[ch.status][getLang()], [t('fuente', 'source')]: ch.source ?? '', [t('verificado_el', 'verified_on')]: ch.status === 'verificado' ? VERIFIED_ON : '',
  }))))
  return (
    <>
      <PageHeader title={t('Centros de apoyo', 'Support centers')} subtitle={t('Directorio institucional para coordinar la prevención y la respuesta ante incendios forestales.', 'Institutional directory to coordinate wildfire prevention and response.')} />
      <p role="note" className="mb-5 max-w-[80ch] rounded-lg border border-amber/60 bg-amber/10 p-4 text-sm">
        {t('Solo se listan datos que se leyeron en la página oficial que se indica, el', 'Only data read on the official page indicated, on')} {fmt.date(VERIFIED_ON)}. {t('En una emergencia en curso confirma siempre el canal en la web de la institución. Esta herramienta no atiende ni reenvía avisos.', 'In an ongoing emergency always confirm the channel on the institution\'s website. This tool does not take or forward reports.')}
      </p>
      <Card title={t('Directorio', 'Directory')} subtitle={`${shown.length} ${t('instituciones', 'institutions')}`}
        actions={<div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">{t('Buscar', 'Search')}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Institución o sigla', 'Institution or acronym')} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink" /></label>
          <Select label={t('Ámbito', 'Scope')} value={scope} onChange={setScope} options={[{ value: 'todas', label: t('Todos', 'All') }, ...(['nacional', 'regional', 'local', 'tecnico'] as Scope[]).map((v) => ({ value: v, label: SCOPE_LABEL[v][getLang()].replace(/^./, (c) => c.toUpperCase()) }))]} />
          <button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('Descargar CSV', 'Download CSV')}</button>
        </div>}>
        {shown.length === 0 ? <Empty>{t('Ninguna institución coincide con la búsqueda.', 'No institution matches the search.')}</Empty> : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((c) => (
              <article key={c.id} className="flex min-w-0 flex-col rounded-xl border border-line p-4">
                <div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold text-teal">{c.sigla}</span><span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">{SCOPE_LABEL[c.scope][getLang()]}</span></div>
                <h3 className="mt-1 text-sm font-medium leading-snug">{c.name}</h3>
                {en() && <p className="text-xs text-muted">{c.en.gloss}</p>}
                <p className="mt-1 text-xs text-muted">{en() ? c.en.role : c.role}</p>
                {c.note && <p className="mt-2 text-xs text-muted">{en() ? c.en.note : c.note}</p>}
                <ul className="mt-3 space-y-2">{c.channels.map((ch) => <ChannelRow key={ch.kind + ch.label} ch={ch} />)}</ul>
              </article>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
