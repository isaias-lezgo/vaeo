"use client"

import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { BarChart3 } from "lucide-react"
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
  buildStatusByMonth,
  STATUS_BUCKETS,
  STATUS_LABELS,
  type StatusBucket,
} from "@/lib/opportunity-breakdown"
import {
  activeBuckets,
  buildUnassignedByMonth,
  summarizeUnassigned,
  type UnassignedMonthRow,
} from "@/lib/assignment-funnel"
import { PANEL_SCOPES, scopeOpportunities, type PanelId } from "@/lib/panel-scope"
import { cn } from "@/lib/utils"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
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
  STRUCTURAL_NAVY,
  ScopePill,
} from "./dashboard-ui"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

// Colores semánticos, no de marca: en un apilado de ganada/abierta/perdida el
// verde y el rojo ya significan algo antes de leer la leyenda.
const BUCKET_COLORS: Record<StatusBucket, string> = {
  ganada: "#10b981",
  abierta: STRUCTURAL_NAVY,
  perdida: "#ef4444",
}

const chartConfig = {
  ganada: { label: STATUS_LABELS.ganada, color: BUCKET_COLORS.ganada },
  abierta: { label: STATUS_LABELS.abierta, color: BUCKET_COLORS.abierta },
  perdida: { label: STATUS_LABELS.perdida, color: BUCKET_COLORS.perdida },
}

const n = (v: number) => v.toLocaleString("es-MX")
const pctFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 })

/**
 * "Sin asesor" recorta el universo a las oportunidades que nadie tiene
 * asignadas (antes era su propia tarjeta, "Leads sin asesor por mes"). Es la
 * misma pregunta sobre los mismos registros, así que vive como un toggle aquí
 * y conserva los mismos colores y el mismo orden del apilado.
 */
type Universe = "todas" | "sin-asesor"
const UNIVERSES: { id: Universe; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "sin-asesor", label: "Sin asesor" },
]

/** El mismo chrome que los switches de "Leads no ganados" y "Motivos de perdido". */
function UniverseSwitch({
  value,
  onChange,
}: {
  value: Universe
  onChange: (id: Universe) => void
}) {
  return (
    <div
      role="group"
      aria-label="Universo de oportunidades"
      className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 p-0.5"
    >
      {UNIVERSES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors",
            value === id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export interface OpportunityStatusChartProps {
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

export function OpportunityStatusChart({
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
}: OpportunityStatusChartProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [universe, setUniverse] = useState<Universe>("todas")
  const scope = PANEL_SCOPES[panel]
  const unassignedOnly = universe === "sin-asesor"

  const scoped = useMemo(
    () => scopeOpportunities(opportunities, panel, pipelines),
    [opportunities, panel, pipelines]
  )
  const statusRows = useMemo(() => buildStatusByMonth(scoped), [scoped])
  const unassignedRows = useMemo(() => buildUnassignedByMonth(scoped), [scoped])
  const summary = useMemo(() => summarizeUnassigned(unassignedRows), [unassignedRows])

  const rows = unassignedOnly ? unassignedRows : statusRows
  const total = useMemo(() => rows.reduce((sum, r) => sum + r.total, 0), [rows])

  // En "Sin asesor" solo las cubetas con registros llegan al apilado y a la
  // leyenda: hoy ninguna sin asesor está ganada, y una serie clavada en cero
  // solo mete un chip que no corresponde a nada en pantalla. El orden sigue
  // siendo el de STATUS_BUCKETS para que el toggle no reacomode el apilado.
  const buckets = useMemo(() => {
    if (!unassignedOnly) return STATUS_BUCKETS
    const active = activeBuckets(unassignedRows)
    return STATUS_BUCKETS.filter((b) => active.includes(b))
  }, [unassignedOnly, unassignedRows])

  const oppById = useMemo(
    () => new Map(allOpportunities.map((o) => [o.id, o])),
    [allOpportunities]
  )

  const openDrill = (monthKey: string, bucket: StatusBucket) => {
    const row = rows.find((r) => r.key === monthKey)
    if (!row) return
    const items = row.ids[bucket]
      .map((id) => oppById.get(id))
      .filter((o): o is Opportunity => Boolean(o))
    if (items.length === 0) return
    setDrill({
      open: true,
      title: `${row.label} — ${STATUS_LABELS[bucket]}`,
      subtitle: unassignedOnly
        ? `Embudo ${scope.label} · sin asesor asignado`
        : `Embudo ${scope.label}`,
      opportunities: items,
    })
  }

  return (
    <DashboardCard>
      <ChartCardHeader
        title="Oportunidades por estado"
        icon={BarChart3}
        total={total}
        actions={
          <>
            <UniverseSwitch value={universe} onChange={setUniverse} />
            <ScopePill
              label="Por mes de creación"
              tooltip={
                <>
                  Oportunidades del embudo <strong>{scope.label}</strong> agrupadas por el mes en
                  que se crearon en el CRM. <strong>Ganada</strong> incluye las que se registran
                  moviéndolas a una etapa &ldquo;Ganado&rdquo; sin cambiar su estatus;{" "}
                  <strong>Perdida</strong> junta las perdidas y las abandonadas. Los meses sin
                  movimiento se dibujan en cero para no comprimir el eje. Con{" "}
                  <strong>Sin asesor</strong> la gráfica cuenta solo las oportunidades que nadie
                  tiene asignadas; el porcentaje del tooltip es cuánto pesan dentro de todos los
                  leads de ese mes.
                </>
              }
            />
          </>
        }
      />
      <ChartCardContent>
        {total === 0 ? (
          // Ningún vacío usa el rojizo de cubeta centinela: que no haya
          // huérfanas es literalmente la meta.
          <ChartEmpty
            message={
              unassignedOnly && summary.grandTotal > 0
                ? "Todos los leads del periodo tienen asesor asignado"
                : "Sin oportunidades en el periodo seleccionado"
            }
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {buckets.map((bucket) => (
                <span key={bucket} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: BUCKET_COLORS[bucket] }}
                    aria-hidden
                  />
                  {STATUS_LABELS[bucket]}
                </span>
              ))}
            </div>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <BarChart data={rows} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  // Tick propio: la cubeta "Sin fecha" va en rojizo, el resto en
                  // el gris de siempre.
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
                <ChartTooltip
                  content={
                    <NonZeroTooltipContent
                      labelFormatter={(value, payload) => {
                        if (!unassignedOnly) return value
                        const row = payload?.[0]?.payload as UnassignedMonthRow | undefined
                        if (!row || row.monthTotal === 0) return value
                        return (
                          <>
                            <div>{value}</div>
                            <div className="font-normal text-muted-foreground">
                              {pctFmt.format(row.pctSinAsesor)}% de los {n(row.monthTotal)} leads
                              del mes
                            </div>
                          </>
                        )
                      }}
                    />
                  }
                />
                {buckets.map((bucket, i) => (
                  <Bar
                    key={bucket}
                    dataKey={bucket}
                    stackId="estado"
                    fill={BUCKET_COLORS[bucket]}
                    // Solo la serie de hasta arriba lleva esquinas redondeadas,
                    // o el apilado se ve partido en tres bloques sueltos.
                    radius={i === buckets.length - 1 ? [3, 3, 0, 0] : undefined}
                    cursor="pointer"
                    onClick={(payload: { key?: string }) => {
                      if (payload?.key) openDrill(payload.key, bucket)
                    }}
                  />
                ))}
              </BarChart>
            </ChartContainer>

            {unassignedOnly && (
              <p className="mt-3 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className={cn("font-medium", MISSING_TEXT)}>{n(summary.total)}</span> de{" "}
                {n(summary.grandTotal)} leads ({pctFmt.format(summary.pctSinAsesor)}%) nunca se
                asignaron a un asesor. La gráfica muestra solo a esos:{" "}
                {n(summary.byBucket.perdida)}{" "}
                {summary.byBucket.perdida === 1 ? "ya se dio por perdido" : "ya se dieron por perdidos"} y{" "}
                {n(summary.byBucket.abierta)}{" "}
                {summary.byBucket.abierta === 1 ? "sigue abierto" : "siguen abiertos"}
                {summary.byBucket.ganada === 0
                  ? ", y no se ha ganado ninguno"
                  : summary.byBucket.ganada === 1
                    ? ", y 1 se ganó"
                    : `, y ${n(summary.byBucket.ganada)} se ganaron`}
                . Asignar el lead se corrige en GHL, no aquí.
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
