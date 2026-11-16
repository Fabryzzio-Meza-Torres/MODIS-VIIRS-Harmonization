/**
 * Explicit map between region_id of the series API (/v1/regions, MINAM boundaries, UPPERCASE without accents)
 * and the department names of the events API (/departments, geoBoundaries, with accents).
 * The two services do not share identifiers nor identical boundaries.
 */
export const EVENT_DEPARTMENT: Record<string, string> = {
  '01': 'Amazonas', '02': 'Ancash', '03': 'Apurímac', '04': 'Arequipa', '05': 'Ayacucho',
  '06': 'Cajamarca', '07': 'El Callao', '08': 'Cusco', '09': 'Huancavelica', '10': 'Huánuco',
  '11': 'Ica', '12': 'Junín', '13': 'La Libertad', '14': 'Lambayeque', '15': 'Lima',
  '16': 'Loreto', '17': 'Madre de Dios', '18': 'Moquegua', '19': 'Pasco', '20': 'Piura',
  '21': 'Puno', '22': 'San Martín', '23': 'Tacna', '24': 'Tumbes', '25': 'Ucayali',
}

export const eventDepartment = (regionId: string | null): string | null => (regionId ? EVENT_DEPARTMENT[regionId] ?? null : null)

export const regionIdForEventDepartment = (name: string): string | null =>
  Object.entries(EVENT_DEPARTMENT).find(([, n]) => n === name)?.[0] ?? null

/** Names in the mapping that the events service does not list (exact match), and service names with no region. */
export function checkMapping(serviceDepartments: string[]) {
  const mapped = Object.values(EVENT_DEPARTMENT)
  return {
    missingInService: mapped.filter((n) => !serviceDepartments.includes(n)),
    unmapped: serviceDepartments.filter((n) => !mapped.includes(n)),
  }
}
