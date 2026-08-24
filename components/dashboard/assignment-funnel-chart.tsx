"use client"

import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { UserX } from "lucide-react"
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
  ASSIGNMENT_BUCKETS,
  ASSIGNMENT_LABELS,
  buildAssignmentByMonth,
  summarizeAssignment,
  type AssignmentBucket,
} from "@/lib/assignment-funnel"
import { PANEL_SCOPES, scopeOpportunities, type PanelId } from "@/lib/panel-scope"
import { cn } from "@/lib/utils"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  CHART_GRID_STROKE,
  CHART_TICK,
  ChartCardContent,
  ChartCardHeader,
  ChartEmpty,
  DashboardCard,
  MISSING_TEXT,
  MissingAwareTick,
  NonZeroTooltipContent,
  SERIES_NEUTRALS,
  STRUCTURAL_NAVY,
  ScopePill,
} from "./dashboard-ui"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

/**
 * Los tres desenlaces reusan EXACTAMENTE los colores de "Oportunidades por
 * estado": son la misma pregunta sobre los mismos registros, y dos verdes
 * distintos para "ganada" harían leer los dos charts como sistemas separados.
 *
 * "Sin asesor" es una cubeta centinela, así que va en el gris de SERIES_NEUTRALS
 * y NO en un cuarto color semántico. El rojizo de MISSING_TEXT se queda en la
 * etiqueta de la leyenda; teñir el segmento rompería la validación de la paleta
 * y, peor, competiría con el rojo que ya significa "perdida" a su lado.
 */
const config: ChartConfig = {
  sinAsesor: { label: ASSIGNMENT_LABELS.sinAsesor, theme: SERIES_NEUTRALS.empty },
  perdida: { label: ASSIGNMENT_LABELS.perdida, color: "#ef4444" },
  abierta: { label: ASSIGNMENT_LABELS.abierta, color: STRUCTURAL_NAVY },
  ganada: { label: ASSIGNMENT_LABELS.ganada, color: "#10b981" },
}

const n = (v: number) => v.toLocaleString("es-MX")
const pctFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 })
const pct1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 })

export interface AssignmentFunnelChartProps {
  panel: PanelId
  /** Oportunidades ya filtradas por fecha y por el toggle de HubSpot. */
  opportunities: Opportunity[]
  /** Sin filtrar — los joins del drawer se resuelven contra estas. */
  allOpportunities: Opportunity[]
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

export function AssignmentFunnelChart({
  panel,
  opportunities,
  allOpportunities,
  contacts,
  allContacts,
  pipelines = [],
  tasks = [],
  calls = [],
  allPautas = [],
  appointments = [],
  messages = [],
  locationId = "",
}: AssignmentFunnelChartProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const scope = PANEL_SCOPES[panel]

  const rows = useMemo(
    () => buildAssignmentByMonth(scopeOpportunities(opportunities, panel, pipelines)),
    [opportunities, panel, pipelines]
  )

  const summary = useMemo(() => summarizeAssignment(rows), [rows])

  const oppById = useMemo(
    () => new Map(allOpportunities.map((o) => [o.id, o])),
    [allOpportunities]
  )

  const openDrill = (monthKey: string, bucket: AssignmentBucket) => {
    const row = rows.find((r) => r.key === monthKey)
    if (!row) return
    const items = row.ids[bucket]
      .map((id) => oppById.get(id))
      .filter((o): o is Opportunity => Boolean(o))
    if (items.length === 0) return
    setDrill({
      open: true,
      title: `${row.label} — ${ASSIGNMENT_LABELS[bucket]}`,
      subtitle: `Embudo ${scope.label}`,
      opportunities: items,
    })
  }

  // ChartStyle emite `--color-<clave>` bajo el selector [data-chart=chart-<id>],
  // y la leyenda vive FUERA del ChartContainer. Marcar el bloque de chips con el
  // MISMO data-chart es lo que le trae esas variables.
  const chartId = `asignacion-${panel}`

  return (
    <DashboardCard>
      <ChartCardHeader
        title="Leads sin asesor por mes"
        icon={UserX}
        total={summary.total}
        actions={
          <ScopePill
            label="Por mes de creación"
            tooltip={
              <>
                Oportunidades del embudo <strong>{scope.label}</strong> agrupadas por el mes
                en que se crearon. El primer corte es si alguien las tomó: una oportunidad{" "}
                <strong>sin asesor asignado</strong> cuenta en el segmento gris{" "}
                <em>aunque ya esté cerrada como perdida</em>, porque nunca se trabajó. Los
                tres segmentos de arriba son el desenlace de las que sí tuvieron asesor.
                Los meses sin movimiento se dibujan en cero para no comprimir el eje.
              </>
            }
          />
        }
      />
      <ChartCardContent>
        {summary.total === 0 ? (
          <ChartEmpty message="Sin oportunidades en el periodo seleccionado" />
        ) : (
          <>
            <div
              data-chart={`chart-${chartId}`}
              className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              {/* Al revés que el apilado: la leyenda se lee de arriba abajo, y
                  el stack se dibuja de abajo arriba. */}
              {[...ASSIGNMENT_BUCKETS].reverse().map((bucket) => (
                <span
                  key={bucket}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: `var(--color-${bucket})` }}
                    aria-hidden
                  />
                  <span className={cn(bucket === "sinAsesor" && MISSING_TEXT)}>
                    {ASSIGNMENT_LABELS[bucket]}
                  </span>
                </span>
              ))}
            </div>

            <ChartContainer id={chartId} config={config} className="h-[280px] w-full">
              <BarChart data={rows} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  // Tick propio: la cubeta "Sin fecha" va en rojizo.
                  tick={<MissingAwareTick />}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  tick={CHART_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  allowDecimals={false}
                />
                <ChartTooltip content={<NonZeroTooltipContent />} />
                {ASSIGNMENT_BUCKETS.map((bucket, i) => (
                  <Bar
                    key={bucket}
                    dataKey={bucket}
                    stackId="asignacion"
                    fill={`var(--color-${bucket})`}
                    // Solo la serie de hasta arriba lleva esquinas redondeadas, o
                    // el apilado se ve partido en bloques sueltos.
                    radius={i === ASSIGNMENT_BUCKETS.length - 1 ? [3, 3, 0, 0] : undefined}
                    cursor="pointer"
                    onClick={(payload: { key?: string }) => {
                      if (payload?.key) openDrill(payload.key, bucket)
                    }}
                  />
                ))}
              </BarChart>
            </ChartContainer>

            {summary.sinAsesor > 0 && (
              <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className={cn("font-medium", MISSING_TEXT)}>{n(summary.sinAsesor)}</span>{" "}
                de {n(summary.total)} leads ({pctFmt.format(summary.pctSinAsesor)}%) nunca se
                asignaron a un asesor
                {summary.ganadasSinAsesor === 0
                  ? ", y de esos no se ha ganado ninguno"
                  : `, y de esos se han ganado ${n(summary.ganadasSinAsesor)}`}
                . Los que sí se trabajaron cierran al {pct1.format(summary.cierreConAsesor)}%.
                Asignar el lead se corrige en GHL, no aquí.
              </p>
            )}
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
