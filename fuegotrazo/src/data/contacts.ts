/**
 * Institutional directory. Only contact data we actually have is listed. A channel is "verificado" only if it was read
 * on the official page cited in `source` on VERIFIED_ON; "sin_confirmar" means a source exists but is old, hidden or
 * could not be read from an official page. Nothing here comes from memory.
 */
export const VERIFIED_ON = '2026-11-15'
export type ChannelStatus = 'verificado' | 'sin_confirmar'
export type Scope = 'nacional' | 'regional' | 'local' | 'tecnico'
export interface Channel { kind: 'tel' | 'email' | 'web' | 'whatsapp'; value: string; label: string; status: ChannelStatus; source?: string; note?: string }
export interface Contact { id: string; sigla: string; name: string; scope: Scope; role: string; channels: Channel[]; note?: string }

export const STATUS_LABEL: Record<ChannelStatus, string> = {
  verificado: 'Verificado en fuente oficial', sin_confirmar: 'Sin confirmar',
}

export const CONTACTS: Contact[] = [
  { id: 'cgbvp', sigla: 'CGBVP', name: 'Cuerpo General de Bomberos Voluntarios del Perú', scope: 'nacional', role: 'Respuesta a incendios, rescate y emergencias',
    channels: [
      { kind: 'tel', value: '01 399 1111', label: 'Central administrativa', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/', note: 'Línea administrativa, no de emergencias. La web oficial lista «Emergencias 24 horas» como registro en línea, sin número.' },
      { kind: 'tel', value: '116', label: 'Línea de emergencias', status: 'sin_confirmar', note: 'Aparece en la página original, en prensa y en directorios, pero no la pude leer en el portal oficial. La prensa reportó interrupciones del 116 en 2026 y un número temporal: confirma el vigente en el portal del CGBVP antes de depender de ella.' },
      { kind: 'web', value: 'https://portal.bomberosperu.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.bomberosperu.gob.pe/' },
    ] },
  { id: 'indeci', sigla: 'INDECI', name: 'Instituto Nacional de Defensa Civil', scope: 'nacional', role: 'Preparación, respuesta y rehabilitación (SINAGERD)',
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Central telefónica · lunes a viernes 08:30–16:30', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'Sede: Calle Ricardo Angulo Ramírez N° 694, Urb. Corpac, San Isidro, Lima.' },
      { kind: 'tel', value: '115', label: 'Defensa Civil · emergencias', status: 'sin_confirmar', note: 'Figura en la página original y en directorios municipales y prensa; no lo pude leer en una página oficial de INDECI.' },
      { kind: 'email', value: 'contactenos@indeci.gob.pe', label: 'Correo institucional', status: 'sin_confirmar', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'Figura en el código de la página oficial de contacto, pero comentado (no visible). Confírmalo con la central telefónica.' },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/', label: 'Portal oficial', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/' },
    ] },
  { id: 'coen', sigla: 'COEN', name: 'Centro de Operaciones de Emergencia Nacional', scope: 'nacional', role: 'Monitoreo y reporte de emergencias a nivel nacional',
    note: 'Según INDECI, el COEN funciona las 24 horas del día durante todo el año.',
    channels: [
      { kind: 'tel', value: '(51) 1 225-9898', label: 'Vía la central de INDECI (el COEN es parte de INDECI)', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'La página del COEN menciona teléfono, correo y WhatsApp como canales de difusión, pero no publica números propios. La central atiende lunes a viernes 08:30–16:30.' },
      { kind: 'email', value: 'contactenos@indeci.gob.pe', label: 'Correo institucional de INDECI', status: 'sin_confirmar', source: 'https://portal.indeci.gob.pe/contactenos/', note: 'Comentado en la página oficial de contacto; confírmalo con la central.' },
      { kind: 'web', value: 'https://portal.indeci.gob.pe/coen/nosotros/', label: 'Página del COEN', status: 'verificado', source: 'https://portal.indeci.gob.pe/coen/nosotros/' },
    ] },
  { id: 'serfor', sigla: 'SERFOR', name: 'Servicio Nacional Forestal y de Fauna Silvestre', scope: 'tecnico', role: 'Gestión forestal; recibe alertas forestales (Alerta SERFOR)',
    note: 'No pude leer la ficha actual de SERFOR en gob.pe (bloquea la lectura automática). Estos datos vienen de un documento oficial de diciembre de 2018.',
    channels: [
      { kind: 'web', value: 'http://appweb.serfor.gob.pe/alertaserfor/', label: 'Alerta SERFOR (aplicación web)', status: 'sin_confirmar', source: 'https://repositorio.serfor.gob.pe/handle/SERFOR/628', note: 'Documento oficial de dic-2018; vigencia por confirmar.' },
      { kind: 'email', value: 'alerta@serfor.gob.pe', label: 'Correo de alertas', status: 'sin_confirmar', source: 'https://repositorio.serfor.gob.pe/handle/SERFOR/628', note: 'Documento oficial de dic-2018; vigencia por confirmar.' },
      { kind: 'tel', value: '947 588 269', label: 'Teléfono de Alerta SERFOR (2018)', status: 'sin_confirmar', source: 'https://repositorio.serfor.gob.pe/handle/SERFOR/628', note: 'Documento oficial de dic-2018. Según notas posteriores, este canal solo recibe mensajes escritos, no llamadas.' },
    ] },
  { id: 'senamhi', sigla: 'SENAMHI', name: 'Servicio Nacional de Meteorología e Hidrología del Perú', scope: 'tecnico', role: 'Pronósticos y avisos meteorológicos oficiales',
    channels: [
      { kind: 'web', value: 'https://www.senamhi.gob.pe/', label: 'Portal oficial (avisos y pronósticos)', status: 'verificado', source: 'https://www.senamhi.gob.pe/?p=sedes' },
      { kind: 'email', value: 'atencionalciudadano@senamhi.gob.pe', label: 'Atención al ciudadano', status: 'sin_confirmar', note: 'Figura en documentos del SENAMHI según una búsqueda, pero no pude abrirlos para confirmarlo. Sede central verificada en su web: Jr. Cahuide 785, Jesús María, Lima.' },
    ] },
  { id: 'sernanp', sigla: 'SERNANP', name: 'Servicio Nacional de Áreas Naturales Protegidas por el Estado', scope: 'tecnico', role: 'Gestión de las áreas naturales protegidas',
    note: 'La plataforma gob.pe del SERNANP podría listar otros números; no pude leerla.',
    channels: [
      { kind: 'tel', value: '01 717 7500', label: 'Central · lunes a viernes 08:00–17:00', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/', note: 'Sede: Calle Diecisiete 355, Urb. El Palomar, San Isidro.' },
      { kind: 'email', value: 'sernanpteatiende@sernanp.gob.pe', label: 'Atención al ciudadano', status: 'verificado', source: 'https://biodiversidadanp.sernanp.gob.pe/contactenos/' },
    ] },
]

/**
 * Regional emergency operation center (COER): no number is published, so the only data is INDECI's contact page,
 * which lists a Dirección Desconcentrada per department. Local centers (COEL) have no data at all and are not listed.
 */
export const regionalCenter = (regionName: string): Contact => ({
  id: 'coer', sigla: 'COER', name: `Centro de Operaciones de Emergencia Regional — ${regionName}`, scope: 'regional',
  role: 'Coordinación regional de la respuesta',
  note: 'Para el contacto regional, INDECI lista una Dirección Desconcentrada por departamento en su página de contacto.',
  channels: [{ kind: 'web', value: 'https://portal.indeci.gob.pe/contactenos/', label: 'INDECI · contacto y Direcciones Desconcentradas', status: 'verificado', source: 'https://portal.indeci.gob.pe/contactenos/' }],
})
