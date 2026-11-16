/**
 * Institutional directory. Only data that was read on the official page cited in `source` on VERIFIED_ON is listed;
 * anything that could not be confirmed that way is left out. Nothing here comes from memory.
 * Official names stay in Spanish; `en` holds the English gloss and translated descriptions.
 */
export const VERIFIED_ON = '2026-11-15'
export type ChannelStatus = 'verificado'
export type Scope = 'nacional' | 'regional' | 'local' | 'tecnico'
export interface Channel { kind: 'tel' | 'email' | 'web' | 'whatsapp'; value: string; label: string; status: ChannelStatus; source: string; note?: string; en: { label: string; note?: string } }
export interface Contact { id: string; sigla: string; name: string; scope: Scope; role: string; channels: Channel[]; note?: string; en: { gloss: string; role: string; note?: string } }

export const STATUS_LABEL: Record<ChannelStatus, { es: string; en: string }> = { verificado: { es: 'Verificado en fuente oficial', en: 'Verified on an official source' } }
export const SCOPE_LABEL: Record<Scope, { es: string; en: string }> = {
  nacional: { es: 'nacional', en: 'national' }, regional: { es: 'regional', en: 'regional' }, local: { es: 'local', en: 'local' }, tecnico: { es: 'técnico', en: 'technical' },
}

export const CONTACTS: Contact[] = [
  { id: 'cgbvp', sigla: 'CGBVP', name: 'Cuerpo General de Bomberos Voluntarios del Perú', scope: 'nacional', role: 'Respuesta a incendios, rescate y emergencias',
    en: { gloss: 'Peruvian General Corps of Volunteer Firefighters', role: 'Fire response, rescue and emergencies' },
    channels: [
      { kind: 'tel', value: '01 399 1111', label: 'Central administrativa', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/', note: 'Línea administrativa, no de emergencias. La web oficial lista «Emergencias 24 horas» como registro en línea, sin número.',
        en: { label: 'Administrative switchboard', note: 'Administrative line, not for emergencies. The official website lists “Emergencias 24 horas” as an online registration, without a number.' } },
      { kind: 'web', value: 'https://portal.bomberosperu.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/', en: { label: 'Official portal' } },
    ] },
  { id: 'indeci', sigla: 'INDECI', name: 'Instituto Nacional de Defensa Civil', scope: 'nacional', role: 'Preparación, respuesta y rehabilitación (SINAGERD)',
    en: { gloss: 'National Institute of Civil Defense', role: 'Preparedness, response and rehabilitation (SINAGERD)' },
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Central telefónica · lunes a viernes 08:30–16:30', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'Sede: Calle Ricardo Angulo Ramírez N° 694, Urb. Corpac, San Isidro, Lima.',
        en: { label: 'Switchboard · Monday to Friday 08:30–16:30', note: 'Headquarters: Calle Ricardo Angulo Ramírez N° 694, Urb. Corpac, San Isidro, Lima.' } },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', en: { label: 'Official portal' } },
    ] },
  { id: 'coen', sigla: 'COEN', name: 'Centro de Operaciones de Emergencia Nacional', scope: 'nacional', role: 'Monitoreo y reporte de emergencias a nivel nacional',
    note: 'Según INDECI, el COEN funciona las 24 horas del día durante todo el año.',
    en: { gloss: 'National Emergency Operations Center', role: 'Monitoring and reporting of emergencies nationwide', note: 'According to INDECI, the COEN operates 24 hours a day all year round.' },
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Vía la central de INDECI (el COEN es parte de INDECI)', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'La central atiende lunes a viernes 08:30–16:30.',
        en: { label: 'Via the INDECI switchboard (the COEN is part of INDECI)', note: 'The switchboard is staffed Monday to Friday 08:30–16:30.' } },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/coen/nosotros/', label: 'Página del COEN', status: 'verificado', source: 'https://portal.indeci.gob.pe/coen/nosotros/', en: { label: 'COEN page' } },
    ] },
  { id: 'senamhi', sigla: 'SENAMHI', name: 'Servicio Nacional de Meteorología e Hidrología del Perú', scope: 'tecnico', role: 'Pronósticos y avisos meteorológicos oficiales',
    note: 'Sede central: Jr. Cahuide 785, Jesús María, Lima.',
    en: { gloss: 'National Meteorology and Hydrology Service of Peru', role: 'Official weather forecasts and warnings', note: 'Headquarters: Jr. Cahuide 785, Jesús María, Lima.' },
    channels: [
      { kind: 'web', value: 'https://www.senamhi.gob.pe/', label: 'Portal oficial (avisos y pronósticos)', status: 'verificado', source: 'https://www.senamhi.gob.pe/?p=sedes', en: { label: 'Official portal (warnings and forecasts)' } },
    ] },
  { id: 'sernanp', sigla: 'SERNANP', name: 'Servicio Nacional de Áreas Naturales Protegidas por el Estado', scope: 'tecnico', role: 'Gestión de las áreas naturales protegidas',
    en: { gloss: 'National Service of Protected Natural Areas', role: 'Management of protected natural areas' },
    channels: [
      { kind: 'tel', value: '01 717 7500', label: 'Central · lunes a viernes 08:00–17:00', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/', note: 'Sede: Calle Diecisiete 355, Urb. El Palomar, San Isidro.',
        en: { label: 'Switchboard · Monday to Friday 08:00–17:00', note: 'Headquarters: Calle Diecisiete 355, Urb. El Palomar, San Isidro.' } },
      { kind: 'email', value: 'sernanpteatiende@sernanp.gob.pe', label: 'Atención al ciudadano', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/', en: { label: 'Citizen service' } },
    ] },
]

/** Regional emergency operation center (COER): the only confirmed route is INDECI's contact page, which lists a Dirección Desconcentrada per department. */
export const regionalCenter = (regionName: string): Contact => ({
  id: 'coer', sigla: 'COER', name: `Centro de Operaciones de Emergencia Regional — ${regionName}`, scope: 'regional',
  role: 'Coordinación regional de la respuesta',
  note: 'Para el contacto regional, INDECI lista una Dirección Desconcentrada por departamento en su página de contacto.',
  en: { gloss: `Regional Emergency Operations Center — ${regionName}`, role: 'Regional coordination of the response', note: 'For regional contact, INDECI lists a Dirección Desconcentrada (decentralized office) per department on its contact page.' },
  channels: [{ kind: 'web', value: 'https://portal.indeci.gob.pe/contactenos/', label: 'INDECI · contacto y Direcciones Desconcentradas', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/',
    en: { label: 'INDECI · contact and decentralized offices' } }],
})
