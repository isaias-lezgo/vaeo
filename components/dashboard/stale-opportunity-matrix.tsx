"use client"

import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import { AlarmClock, RotateCw } from "lucide-react"
import type {
  Appointment,
  Call,
  Contact,
  Message,
  Opportunity,
  Pauta,
  Pipeline,
  Task,
} from "@/lib/types"
import {
  buildStaleMatrix,
  CRITICAL_FROM_INDEX,
  STALE_BUCKETS,
  STALE_HORIZON_DAYS,
  type StaleCell,
} from "@/lib/stale-opportunity-matrix"
import { PANEL_SCOPES, scopeOpportunities, type PanelId } from "@/lib/panel-scope"
import type {
  ActivityProgress,
  ActivityStatus,
} from "@/hooks/use-conversation-activity"
import { cn } from "@/lib/utils"
import {
  ChartCardContent,
  ChartCardHeader,
  ChartEmpty,
  DashboardCard,
  ScopePill,
} from "./dashboard-ui"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

const n = (v: number) => v.toLocaleString("es-MX")

/**
 * La rampa de intensidad va en GRIS a propósito. El único color de la matriz es
 * el rojizo del cuadrante crítico, que codifica POSICIÓN; si la intensidad
 * también fuera roja habría dos escalas de color peleándose la misma celda.
 */
const HEAT_RGB = "100, 116, 139" // slate-500

/**
 * La leyenda del cuadrante sale de la cubeta, no de un número escrito a mano:
 * el umbral ya se movió una vez y un literal desfasado convertiría la leyenda
 * en una afirmación falsa sobre lo que está teñido.
 */
const CRITICAL_LEGEND = `Más de ${STALE_BUCKETS[CRITICAL_FROM_INDEX].min - 1} días`
const CRITICAL_TINT = "rgba(244, 63, 94, 0.07)" // rose-500 muy tenue

/**
 * Raíz cuadrada y no lineal, por lo mismo que en "Motivos de perdido": la celda
 * más poblada suele llevarse un múltiplo del resto, y en escala lineal el resto
 * de la matriz quedaría en blanco indistinguible.
 */
function heatAlpha(count: number, max: number): number {
  if (count === 0 || max === 0) return 0
  return Math.sqrt(Math.min(count / max, 1)) * 0.5
}

/**
 * La espera de esta tarjeta no es como la de las demás. La ruta que la alimenta
 * recorre miles de conversaciones y abre cientos de hilos: del orden de minuto
 * y medio, y el resto del panel ya terminó de pintar alrededor. Con solo un
 * spinner la lectura obvia es que la tarjeta está rota.
 *
 * El porcentaje es real, no decorativo: sale de los frames de la ruta, que
 * conoce sus dos denominadores (qué tanto retrocedió el cursor dentro del
 * horizonte, y cuántos hilos de cuántos lleva abiertos).
 */
function ActivityProgressPanel({ progress }: { progress?: ActivityProgress }) {
  const pct = progress?.pct ?? 0
  const message = progress?.message ?? "Cargando actividad de conversaciones…"
  // Antes del primer frame no hay avance que reportar, y una barra clavada en
  // 0% se lee peor que ninguna: ahí va la indeterminada, y en cuanto entra el
  // primer dato real cede su lugar.
  const determinate = pct > 0

  return (
    <div
      className="flex h-[240px] flex-col items-center justify-center gap-3 px-8 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          {determinate ? (
            // Las `key` NO son decorativas: sin ellas React reconcilia los dos
            // motion.div como el mismo elemento, y la barra determinada hereda
            // el translateX con el que se quedó la indeterminada — se pinta
            // empezando a media pista en vez de en el cero.
            <motion.div
              key="determinate"
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: `${Math.round(pct * 100)}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          ) : (
            <motion.div
              key="indeterminate"
              className="h-full w-1/3 rounded-full bg-primary"
              animate={{ x: ["-100%", "300%"] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="truncate">{message}</span>
          {determinate && (
            <span className="shrink-0 tabular-nums">{Math.round(pct * 100)}%</span>
          )}
        </div>
      </div>

      <p className="max-w-sm text-center text-[11px] text-muted-foreground/70">
        Se revisan las conversaciones de los últimos {STALE_HORIZON_DAYS} días para saber
        a quién sí se le escribió. Tarda más que el resto del panel.
      </p>
    </div>
  )
}

export interface StaleOpportunityMatrixProps {
  panel: PanelId
  /** Ya filtradas por fecha — NO se usan aquí; ver allOpportunities. */
  opportunities: Opportunity[]
  /** Sin filtrar por fecha: "sin atención en 60 días" es una condición de hoy. */
  allOpportunities: Opportunity[]
  conversationActivity?: Map<string, string | null>
  activityStatus?: ActivityStatus
  /** Avance de la carga; ausente ⇒ barra indeterminada. */
  activityProgress?: ActivityProgress
  onRetryActivity?: () => void
  contacts: Contact[]
  allContacts: Contact[]
  pipelines?: Pipeline[]
  tasks?: Task[]
  calls?: Call[]
  allPautas?: Pauta[]
  appointments?: Appointment[]
  messages?: Message[]
  locationId?: string
}

/**
 * "Oportunidades sin atención": días sin mover la oportunidad × días sin
 * mandarle un mensaje al contacto.
 *
 * Es el único gráfico del panel que mide antigüedad sin atención. Los demás
 * miden estado, y por eso un lead parado dos meses en "Lead en proceso" les
 * resulta invisible: cuenta como oportunidad abierta y ahí se queda.
 *
 * NO renderiza la matriz hasta que la actividad de conversaciones esté lista.
 * Con el mapa vacío todas las oportunidades caerían en la columna "+60 d" y el
 * gráfico afirmaría un abandono total — alarmante, verosímil y falso.
 */
export function StaleOpportunityMatrix({
  panel,
  allOpportunities,
  conversationActivity,
  activityStatus = "loading",
  activityProgress,
  onRetryActivity,
  contacts,
  allContacts,
  pipelines = [],
  tasks = [],
  calls = [],
  allPautas = [],
  appointments = [],
  messages = [],
  locationId = "",
}: StaleOpportunityMatrixProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const scope = PANEL_SCOPES[panel]
  const ready = activityStatus === "ready" && conversationActivity !== undefined

  const matrix = useMemo(() => {
    if (!ready) return null
    const scoped = scopeOpportunities(allOpportunities, panel, pipelines)
    return buildStaleMatrix(scoped, conversationActivity!, new Date())
  }, [ready, allOpportunities, conversationActivity, panel, pipelines])

  const oppById = useMemo(
    () => new Map(allOpportunities.map((o) => [o.id, o])),
    [allOpportunities]
  )

  const openDrill = (cell: StaleCell, title: string, note: string) => {
    if (cell.count === 0) return
    const items = cell.oppIds
      .map((id) => oppById.get(id))
      .filter((o): o is Opportunity => Boolean(o))
    if (items.length === 0) return
    setDrill({
      open: true,
      title,
      subtitle: `Embudo ${scope.label} · ${note}`,
      opportunities: items,
    })
  }

  const stickyCol = "sticky left-0 z-20 bg-card"

  return (
    <DashboardCard>
      <ChartCardHeader
        title="Oportunidades sin atención"
        icon={AlarmClock}
        // Sin matriz NO hay total: un "Total: 0" mientras carga es un cero
        // falso, la misma mentira que esta tarjeta evita no renderizando.
        total={matrix?.grandTotal}
        actions={
          <ScopePill
            label="Embudo vivo · a la fecha de hoy"
            tooltip={
              <>
                Solo oportunidades <strong>abiertas</strong> del embudo{" "}
                <strong>{scope.label}</strong>, sin las etapas Ganado, Perdido ni Cliente
                Futuro (esta última es un estacionamiento deliberado: ahí el silencio es la
                intención). <strong>No respeta el filtro de fechas</strong> — &ldquo;sin
                atención en 60 días&rdquo; es una condición de hoy, no de un periodo.{" "}
                <strong>Movimiento</strong> significa cambio de <em>etapa</em>, no cualquier
                edición: las automatizaciones tocan la oportunidad todo el tiempo y
                reportarían que todo se está trabajando. <strong>Mensaje</strong> significa
                cualquier saliente, <em>incluidos los automáticos</em>. Un contacto sin
                conversación, o con la última fuera de los 60 días, cae en la columna
                &ldquo;+60 d&rdquo;.
              </>
            }
          />
        }
      />
      <ChartCardContent>
        {activityStatus === "loading" ? (
          <ActivityProgressPanel progress={activityProgress} />
        ) : activityStatus === "error" || !matrix ? (
          // Nunca ceros y nunca una matriz parcial: sin el dato de mensajes, la
          // matriz entera se iría a la columna "+60 d" y acusaría un abandono
          // que no ocurrió.
          <div className="flex h-[240px] flex-col items-center justify-center gap-3 text-center text-xs text-muted-foreground">
            <p className="max-w-sm">
              No se pudo cargar la actividad de conversaciones, y sin ella esta matriz
              reportaría que ningún lead ha sido contactado. Por eso no se muestra.
            </p>
            {onRetryActivity && (
              <button
                type="button"
                onClick={onRetryActivity}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                Reintentar
              </button>
            )}
          </div>
        ) : matrix.grandTotal === 0 ? (
          <ChartEmpty message="Sin oportunidades abiertas en este embudo" />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: CRITICAL_TINT,
                    outline: "1px solid rgba(244,63,94,0.35)",
                  }}
                  aria-hidden
                />
                {CRITICAL_LEGEND} sin mover y sin escribir
              </span>
              <span className="ml-auto tabular-nums">
                {n(matrix.criticalCount)} de {n(matrix.grandTotal)} en el cuadrante crítico
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
                <thead>
                  <tr>
                    <th
                      className={cn(
                        stickyCol,
                        "border-b border-r border-border px-3 py-2 text-left font-semibold"
                      )}
                    >
                      Sin mover ↓ / sin mensaje →
                    </th>
                    {STALE_BUCKETS.map((b) => (
                      <th
                        key={b.key}
                        className="min-w-[5rem] border-b border-border px-3 py-2 font-medium text-muted-foreground"
                      >
                        {b.label}
                      </th>
                    ))}
                    <th className="min-w-[4.5rem] border-b border-l border-border px-3 py-2 font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row, rowIndex) => (
                    <tr key={row.bucket}>
                      <th
                        scope="row"
                        className={cn(
                          stickyCol,
                          "border-b border-r border-border px-3 py-1.5 text-left font-medium"
                        )}
                      >
                        {row.label}
                      </th>

                      {STALE_BUCKETS.map((b, colIndex) => {
                        const cell = row.cells[b.key]
                        const critical =
                          rowIndex >= CRITICAL_FROM_INDEX && colIndex >= CRITICAL_FROM_INDEX
                        return (
                          <td
                            key={b.key}
                            onClick={() =>
                              openDrill(
                                cell,
                                `${row.label} sin mover · ${b.label} sin mensaje`,
                                `${n(cell.count)} oportunidades`
                              )
                            }
                            style={{
                              backgroundColor: `rgba(${HEAT_RGB}, ${heatAlpha(cell.count, matrix.cellMax)})`,
                              // El tinte del cuadrante va como background-image
                              // para que se componga ENCIMA del gris de la
                              // intensidad en vez de reemplazarlo.
                              backgroundImage: critical
                                ? `linear-gradient(${CRITICAL_TINT}, ${CRITICAL_TINT})`
                                : undefined,
                            }}
                            className={cn(
                              "border-b border-border px-3 py-1.5",
                              cell.count > 0 &&
                                "cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary/40"
                            )}
                          >
                            {cell.count === 0 ? (
                              <span className="text-muted-foreground">–</span>
                            ) : (
                              n(cell.count)
                            )}
                          </td>
                        )
                      })}

                      <td
                        onClick={() =>
                          openDrill(
                            { count: row.total, oppIds: row.oppIds },
                            `${row.label} sin mover — todas`,
                            `${n(row.total)} oportunidades`
                          )
                        }
                        className={cn(
                          "border-b border-l border-border px-3 py-1.5 font-semibold",
                          row.total > 0 && "cursor-pointer hover:bg-muted/50"
                        )}
                      >
                        {n(row.total)}
                      </td>
                    </tr>
                  ))}

                  <tr className="font-semibold">
                    <th
                      scope="row"
                      className={cn(stickyCol, "border-r border-border px-3 py-2 text-left")}
                    >
                      Total
                    </th>
                    {STALE_BUCKETS.map((b) => (
                      <td
                        key={b.key}
                        onClick={() =>
                          openDrill(
                            matrix.colTotals[b.key],
                            `${b.label} sin mensaje — todas`,
                            `${n(matrix.colTotals[b.key].count)} oportunidades`
                          )
                        }
                        className={cn(
                          "px-3 py-2",
                          matrix.colTotals[b.key].count > 0 && "cursor-pointer hover:bg-muted/50"
                        )}
                      >
                        {matrix.colTotals[b.key].count === 0 ? (
                          <span className="text-muted-foreground">–</span>
                        ) : (
                          n(matrix.colTotals[b.key].count)
                        )}
                      </td>
                    ))}
                    <td className="border-l border-border px-3 py-2">{n(matrix.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </ChartCardContent>

      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={allContacts.length > 0 ? allContacts : contacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={allOpportunities}
        allPautas={allPautas}
        appointments={appointments}
        messages={messages}
        locationId={locationId}
      />
    </DashboardCard>
  )
}
