// Agregación detrás de "Leads sin asesor por mes": cuántos leads de cada mes
// nunca le llegaron a nadie, y cómo terminaron los que sí se trabajaron.
//
// Puro y sin React, igual que lib/opportunity-breakdown.ts y por la misma razón:
// un conteo silenciosamente mal aquí se ve idéntico a uno bien en la UI. Vive
// bajo scripts/verify-assignment-funnel.ts.
import type { Opportunity } from "./types"
import { isWonOpp } from "./opportunity-status"
import {
  statusBucket,
  monthKeyOf,
  monthLabelOf,
  monthsBetween,
  NO_DATE_KEY,
  NO_DATE_LABEL,
} from "./opportunity-breakdown"

/**
 * Las cuatro cubetas del apilado, en orden de abajo hacia arriba.
 *
 * "Sin asesor" va pegada al eje a propósito: es la que se está midiendo, y solo
 * contra una línea recta se le puede leer la altura de un mes a otro. Encima
 * quedan los tres desenlaces de las que SÍ se trabajaron.
 */
export const ASSIGNMENT_BUCKETS = ["sinAsesor", "perdida", "abierta", "ganada"] as const

export type AssignmentBucket = (typeof ASSIGNMENT_BUCKETS)[number]

export const ASSIGNMENT_LABELS: Record<AssignmentBucket, string> = {
  sinAsesor: "Sin asesor",
  perdida: "Perdidas",
  abierta: "Abiertas",
  ganada: "Ganadas",
}

/**
 * La cubeta de una oportunidad. El primer corte es "¿alguien la tomó?" y gana
 * sobre todo lo demás: una oportunidad sin asesor que ya se marcó como perdida
 * cuenta en "Sin asesor", NO en "Perdidas".
 *
 * Eso es deliberado y es el punto entero del gráfico. En el embudo VAEO hay
 * 2 054 oportunidades cerradas como perdidas que nunca tuvieron asesor; contarlas
 * como "perdidas" las mezclaría con las que un asesor trabajó y no logró cerrar,
 * que es una falla completamente distinta. Repartirlas también rompería el
 * apilado, que necesita segmentos excluyentes para que las alturas sumen el
 * total del mes.
 *
 * El asesor es `opp.assignedTo`, que el sync ya resolvió de id a nombre — la
 * misma lectura que hace lib/advisor-breakdown.ts para su fila "Sin asesor".
 */
export function assignmentBucket(opp: Opportunity): AssignmentBucket {
  if (!(opp.assignedTo ?? "").trim()) return "sinAsesor"
  return statusBucket(opp)
}

export interface AssignmentMonthRow {
  /** `YYYY-MM`, o NO_DATE_KEY para la fila sin fecha. */
  key: string
  label: string
  sinAsesor: number
  perdida: number
  abierta: number
  ganada: number
  total: number
  /**
   * Cuántas de las `sinAsesor` de este mes están ganadas. Es un SUBCONTEO de
   * `sinAsesor`, no un quinto segmento: no entra en el apilado ni en `total`.
   *
   * Existe porque la afirmación fuerte de esta tarjeta —"de los leads que nunca
   * se asignaron no se ha ganado ninguno"— tiene que ser algo que se mide, no
   * algo que la cubetización garantiza. Si mañana alguien gana una venta sin
   * asesor asignado, este número lo delata en vez de esconderlo.
   */
  sinAsesorGanadas: number
  /** Sin asesor sobre el total del mes, 0–100. */
  pctSinAsesor: number
  /** Ids por cubeta, para el drill-down. */
  ids: Record<AssignmentBucket, string[]>
}

export interface AssignmentSummary {
  total: number
  sinAsesor: number
  /** Sin asesor sobre el total, 0–100. */
  pctSinAsesor: number
  /** Ganadas ENTRE las que sí tuvieron asesor — nunca sobre el total. */
  ganadasConAsesor: number
  /** Ganadas entre las que nunca tuvieron asesor. Medido, no asumido. */
  ganadasSinAsesor: number
  /** Cierre de las que sí se trabajaron, 0–100. */
  cierreConAsesor: number
}

function emptyRow(key: string, label: string): AssignmentMonthRow {
  return {
    key,
    label,
    sinAsesor: 0,
    perdida: 0,
    abierta: 0,
    ganada: 0,
    total: 0,
    sinAsesorGanadas: 0,
    pctSinAsesor: 0,
    ids: { sinAsesor: [], perdida: [], abierta: [], ganada: [] },
  }
}

/**
 * Una fila por mes de `createdAt`, con el conteo de cada cubeta y los ids que la
 * componen.
 *
 * Los meses intermedios sin ningún registro se rellenan en cero, para que el eje
 * no insinúe continuidad donde no la hay — misma regla, y mismos helpers, que
 * buildStatusByMonth().
 *
 * Las oportunidades sin `createdAt` legible caen en una fila "Sin fecha" al
 * final en vez de desaparecer.
 */
export function buildAssignmentByMonth(opps: Opportunity[]): AssignmentMonthRow[] {
  const byMonth = new Map<string, AssignmentMonthRow>()
  let noDate: AssignmentMonthRow | null = null

  for (const opp of opps) {
    const key = monthKeyOf(opp.createdAt)
    let row: AssignmentMonthRow
    if (key === null) {
      noDate ??= emptyRow(NO_DATE_KEY, NO_DATE_LABEL)
      row = noDate
    } else {
      row = byMonth.get(key) ?? emptyRow(key, monthLabelOf(key))
      byMonth.set(key, row)
    }
    const bucket = assignmentBucket(opp)
    row[bucket] += 1
    row.total += 1
    row.ids[bucket].push(opp.id)
    if (bucket === "sinAsesor" && isWonOpp(opp)) row.sinAsesorGanadas += 1
  }

  const keys = [...byMonth.keys()].sort()
  const rows =
    keys.length === 0
      ? []
      : monthsBetween(keys[0], keys[keys.length - 1]).map(
          (k) => byMonth.get(k) ?? emptyRow(k, monthLabelOf(k))
        )

  if (noDate) rows.push(noDate)

  for (const r of rows) {
    r.pctSinAsesor = r.total === 0 ? 0 : (r.sinAsesor / r.total) * 100
  }
  return rows
}

/**
 * El resumen de la nota al pie. Se calcula acumulando las filas ya construidas y
 * no con una segunda pasada sobre `opps`, para que no pueda contar distinto de
 * lo que el gráfico dibuja.
 */
export function summarizeAssignment(rows: AssignmentMonthRow[]): AssignmentSummary {
  let total = 0
  let sinAsesor = 0
  let ganada = 0
  let ganadasSinAsesor = 0
  for (const r of rows) {
    total += r.total
    sinAsesor += r.sinAsesor
    ganada += r.ganada
    ganadasSinAsesor += r.sinAsesorGanadas
  }
  const conAsesor = total - sinAsesor
  return {
    total,
    sinAsesor,
    pctSinAsesor: total === 0 ? 0 : (sinAsesor / total) * 100,
    ganadasConAsesor: ganada,
    ganadasSinAsesor,
    cierreConAsesor: conAsesor === 0 ? 0 : (ganada / conAsesor) * 100,
  }
}
