/**
 * Institutional directory. Only data that was read on the official page cited in `source` on VERIFIED_ON is listed;
 * anything that could not be confirmed that way is left out. Nothing here comes from memory.
 */
export const VERIFIED_ON = '2026-11-15'
export type ChannelStatus = 'verificado'
export type Scope = 'nacional' | 'regional' | 'local' | 'tecnico'
export interface Channel { kind: 'tel' | 'email' | 'web' | 'whatsapp'; value: string; label: string; status: ChannelStatus; source: string; note?: string }
export interface Contact { id: string; sigla: string; name: string; scope: Scope; role: string; channels: Channel[]; note?: string }

export const STATUS_LABEL: Record<ChannelStatus, string> = { verificado: 'Verificado en fuente oficial' }

export const CONTACTS: Contact[] = [
  { id: 'cgbvp', sigla: 'CGBVP', name: 'Cuerpo General de Bomberos Voluntarios del Perú', scope: 'nacional', role: 'Respuesta a incendios, rescate y emergencias',
    channels: [
      { kind: 'tel', value: '01 399 1111', label: 'Central administrativa', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/', note: 'Línea administrativa, no de emergencias. La web oficial lista «Emergencias 24 horas» como registro en línea, sin número.' },
      { kind: 'web', value: 'https://portal.bomberosperu.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/' },
    ] },
  { id: 'indeci', sigla: 'INDECI', name: 'Instituto Nacional de Defensa Civil', scope: 'nacional', role: 'Preparación, respuesta y rehabilitación (SINAGERD)',
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Central telefónica · lunes a viernes 08:30–16:30', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'Sede: Calle Ricardo Angulo Ramírez N° 694, Urb. Corpac, San Isidro, Lima.' },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/' },
    ] },
  { id: 'coen', sigla: 'COEN', name: 'Centro de Operaciones de Emergencia Nacional', scope: 'nacional', role: 'Monitoreo y reporte de emergencias a nivel nacional',
    note: 'Según INDECI, el COEN funciona las 24 horas del día durante todo el año.',
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Vía la central de INDECI (el COEN es parte de INDECI)', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'La central atiende lunes a viernes 08:30–16:30.' },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/coen/nosotros/', label: 'Página del COEN', status: 'verificado', source: 'https://portal.indeci.gob.pe/coen/nosotros/' },
    ] },
  { id: 'senamhi', sigla: 'SENAMHI', name: 'Servicio Nacional de Meteorología e Hidrología del Perú', scope: 'tecnico', role: 'Pronósticos y avisos meteorológicos oficiales',
    note: 'Sede central: Jr. Cahuide 785, Jesús María, Lima.',
    channels: [
      { kind: 'web', value: 'https://www.senamhi.gob.pe/', label: 'Portal oficial (avisos y pronósticos)', status: 'verificado', source: 'https://www.senamhi.gob.pe/?p=sedes' },
    ] },
  { id: 'sernanp', sigla: 'SERNANP', name: 'Servicio Nacional de Áreas Naturales Protegidas por el Estado', scope: 'tecnico', role: 'Gestión de las áreas naturales protegidas',
    channels: [
      { kind: 'tel', value: '01 717 7500', label: 'Central · lunes a viernes 08:00–17:00', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/', note: 'Sede: Calle Diecisiete 355, Urb. El Palomar, San Isidro.' },
      { kind: 'email', value: 'sernanpteatiende@sernanp.gob.pe', label: 'Atención al ciudadano', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/' },
    ] },
]

/** Regional emergency operation center (COER): the only confirmed route is INDECI's contact page, which lists a Dirección Desconcentrada per department. */
export const regionalCenter = (regionName: string): Contact => ({
  id: 'coer', sigla: 'COER', name: `Centro de Operaciones de Emergencia Regional — ${regionName}`, scope: 'regional',
  role: 'Coordinación regional de la respuesta',
  note: 'Para el contacto regional, INDECI lista una Dirección Desconcentrada por departamento en su página de contacto.',
  channels: [{ kind: 'web', value: 'https://portal.indeci.gob.pe/contactenos/', label: 'INDECI · contacto y Direcciones Desconcentradas', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/' }],
})
