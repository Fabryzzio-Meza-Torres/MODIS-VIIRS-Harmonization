import type { Phase } from './aggregate.ts'

/** Generic prevention guidance per season phase (same orientation text as FuegoTrazo). It is advice, not data. */
type PhaseText = { label: string; tips: string[] }
export const PHASE_META: Record<Phase, { bg: string; fg: string; priority: Priority; text: { es: PhaseText; en: PhaseText } }> = {
  preparacion: { bg: '#FBBF24', fg: '#081625', priority: 'Alta', text: {
    es: { label: 'Preparación', tips: [
      'Coordinar la vigilancia comunitaria y actualizar contactos de alerta temprana.',
      'Revisar los protocolos de respuesta y el inventario de equipos con las brigadas.',
      'Priorizar el seguimiento de las zonas con mayor recurrencia histórica.',
    ] },
    en: { label: 'Preparation', tips: [
      'Coordinate community monitoring and update early-warning contacts.',
      'Review response protocols and the equipment inventory with the brigades.',
      'Prioritize monitoring of the areas with the highest historical recurrence.',
    ] },
  } },
  alta: { bg: '#EF4444', fg: '#F4F7FB', priority: 'Alta', text: {
    es: { label: 'Temporada alta', tips: [
      'Reforzar la vigilancia comunitaria en las zonas recurrentes.',
      'Consultar diariamente los avisos meteorológicos oficiales (SENAMHI).',
      'Mantener activos los canales de coordinación con INDECI, SERFOR y SERNANP.',
      'Difundir mensajes de prevención sobre el uso del fuego.',
    ] },
    en: { label: 'High season', tips: [
      'Reinforce community monitoring in recurrent areas.',
      'Check the official weather warnings (SENAMHI) every day.',
      'Keep the coordination channels with INDECI, SERFOR and SERNANP active.',
      'Spread prevention messages about the use of fire.',
    ] },
  } },
  cierre: { bg: '#38BDF8', fg: '#081625', priority: 'Media', text: {
    es: { label: 'Cierre', tips: [
      'Documentar lo ocurrido en la temporada y las lecciones aprendidas.',
      'Revisar las zonas con actividad sostenida para la planificación del próximo año.',
      'Consultar avisos meteorológicos oficiales ante condiciones secas tardías.',
    ] },
    en: { label: 'Closing', tips: [
      'Document what happened during the season and the lessons learned.',
      'Review the areas with sustained activity for planning next year.',
      'Check official weather warnings in case of late dry conditions.',
    ] },
  } },
  baja: { bg: '#17334D', fg: '#F4F7FB', priority: 'Baja', text: {
    es: { label: 'Temporada baja', tips: [
      'Mantener actualizados los planes y protocolos de respuesta.',
      'Capacitar a comunidades y personal de monitoreo.',
      'Revisar los datos históricos para planificar la próxima temporada.',
    ] },
    en: { label: 'Low season', tips: [
      'Keep response plans and protocols up to date.',
      'Train communities and monitoring staff.',
      'Review the historical data to plan the next season.',
    ] },
  } },
}
export type Lang = 'es' | 'en'
export const phaseText = (phase: Phase, lang: Lang): PhaseText => PHASE_META[phase].text[lang]

export type Priority = 'Alta' | 'Media' | 'Baja'
export type Status = 'Pendiente' | 'En curso' | 'Hecho'
export interface Task { id: string; phase: Phase; title: string; due: string; owner: string; priority: Priority; status: Status; notes: string }

const ORDER: Phase[] = ['preparacion', 'alta', 'cierre', 'baja']
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * One block of actions per phase present in the season. Each block is due on the first day of its next
 * occurrence (today if the current month already belongs to the phase). Owners are left blank on purpose:
 * naming who is responsible is the user's decision, not something this tool can know.
 */
export function buildPlan(phases: Phase[], today: string, lang: Lang = 'es'): Task[] {
  const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1
  const tasks: Task[] = []
  for (const phase of ORDER) {
    const months = phases.map((p, i) => (p === phase ? i : -1)).filter((i) => i >= 0)
    if (!months.length) continue
    // first month of the phase block found when walking forward from the current month
    let ahead = -1
    for (let k = 0; k < 12 && ahead < 0; k++) if (months.includes((m + k) % 12)) ahead = k
    const start = (m + ahead) % 12 // walking forward, the first month in the phase is the start of its block (unless we are inside it)
    const due = ahead === 0 ? today : iso(y + (start < m ? 1 : 0), start, 1)
    phaseText(phase, lang).tips.forEach((title, i) => tasks.push({ id: `${phase}-${i}`, phase, title, due, owner: '', priority: PHASE_META[phase].priority, status: 'Pendiente', notes: '' }))
  }
  return tasks.sort((a, b) => a.due.localeCompare(b.due) || ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase))
}
