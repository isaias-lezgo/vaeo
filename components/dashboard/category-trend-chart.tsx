"use client"

import { useMemo, useState } from "react"
import { Compass, MessagesSquare, type LucideIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts"
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
import { buildSalesSeries, type SalesSeriesEntry } from "@/lib/sales-series"
import {
  buildCategoryBreakdown,
  CANAL_FIELDS,
  monthKeyOf as createdMonthKeyOf,
  NO_VALUE_LABEL,
  ORIGEN_FIELDS,
} from "@/lib/opportunity-breakdown"
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
  ScopePill,
  SERIES_NEUTRALS,
  SERIES_PALETTE,
} from "./dashboard-ui"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

const n = (v: number) => v.toLocaleString("es-MX")

/** Ver la nota equivalente en lost-by-dimension-chart.tsx. */
const TOTAL_ANCHOR = "__anchor"
const TOP_RADIUS = [3, 3, 0, 0] as unknown as number

export interface CategoryTrendChartProps {
  panel: PanelId
  title: string
  icon?: LucideIcon
  /** Campos a leer, en orden de preferencia (ORIGEN_FIELDS / CANAL_FIELDS). */
  fieldNames: string[]
  scopeLabel: string
  scopeTooltip: React.ReactNode
  /** Ya filtradas por fecha de creación y por el toggle de HubSpot. */
  opportunities: Opportunity[]
  /** Sin filtrar — de aquí salen las etiquetas, los colores y los joins del drill. */
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

function slotOf(entry: SalesSeriesEntry, namedIndex: number): string {
  if (entry.kind === "otros") return "otros"
  if (entry.kind === "empty") return "vacio"
  return `s${namedIndex}`
}

function colorOf(slot: string): { light: string; dark: string } {
  if (slot === "otros") return SERIES_NEUTRALS.otros
  if (slot === "vacio") return SERIES_NEUTRALS.empty
  const i = Number(slot.slice(1))
  return { light: SERIES_PALETTE.light[i], dark: SERIES_PALETTE.dark[i] }
}

/**
 * Leads que llegaron por mes, apilados por categoría (Origen de Lead o Canal de
 * Contacto). Es la versión en el tiempo de "Oportunidades por Origen de Lead":
 * la tarjeta de ranking dice CUÁNTO pesa cada origen en el periodo; ésta dice
 * CÓMO se movió mes a mes.
 *
 * No re-normaliza nada: la etiqueta de cada oportunidad sale de
 * buildCategoryBreakdown sobre el set sin filtrar, así que una grafía como
 * "WALK IN" cae en la misma serie que en la tarjeta de ranking — si las dos
 * normalizaran por su lado, un alias nuevo agruparía en una y no en la otra.
 */
export function CategoryTrendChart({
  panel,
  title,
  icon,
  fieldNames,
  scopeLabel,
  scopeTooltip,
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
}: CategoryTrendChartProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  /** Slot aislado por la leyenda; null = todas visibles. */
  const [isolated, setIsolated] = useState<string | null>(null)
  const scope = PANEL_SCOPES[panel]

  const scopedAll = useMemo(
    () => scopeOpportunities(allOpportunities, panel, pipelines),
    [allOpportunities, panel, pipelines]
  )
  const scoped = useMemo(
    () => scopeOpportunities(opportunities, panel, pipelines),
    [opportunities, panel, pipelines]
  )

  // id → etiquetas normalizadas. "Sin dato" no se mapea: una lista vacía cae en
  // la cubeta vacía de buildSalesSeries.
  const labelsById = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of buildCategoryBreakdown(scopedAll, fieldNames)) {
      if (row.label === NO_VALUE_LABEL) continue
      for (const id of row.oppIds) {
        const list = map.get(id)
        if (list) list.push(row.label)
        else map.set(id, [row.label])
      }
    }
    return map
  }, [scopedAll, fieldNames])

  const seriesOpts = useMemo(
    () => ({
      emptyLabel: NO_VALUE_LABEL,
      dimensionsOf: (o: Opportunity) => labelsById.get(o.id) ?? [],
      include: () => true,
      // Mes de CREACIÓN, con el lector local: el mismo mes en que "Oportunidades
      // por estado" pone a cada lead.
      monthOf: (o: Opportunity) => createdMonthKeyOf(o.createdAt),
      measure: "count" as const,
    }),
    [labelsById]
  )

  // Series y colores se congelan sobre el set SIN filtrar: mover el filtro de
  // fechas no debe repintar ni re-plegar las series.
  const { slotByKey, namedKeys } = useMemo(() => {
    const all = buildSalesSeries(scopedAll, seriesOpts)
    const map = new Map<string, string>()
    const names: string[] = []
    let named = 0
    for (const s of all.series) {
      if (s.kind === "named") names.push(s.key)
      map.set(s.key, slotOf(s, s.kind === "named" ? named++ : 0))
    }
    return { slotByKey: map, namedKeys: names }
  }, [scopedAll, seriesOpts])

  const data = useMemo(
    () => buildSalesSeries(scoped, { ...seriesOpts, namedKeys }),
    [scoped, seriesOpts, namedKeys]
  )

  const allSlots = useMemo(
    () => data.series.map((s) => ({ entry: s, slot: slotByKey.get(s.key) ?? "otros" })),
    [data.series, slotByKey]
  )
  // Al aislar una serie se dibuja SOLA, desde cero: atenuar las demás dejaría su
  // segmento flotando sobre las otras y la tendencia no se podría leer.
  const slots = useMemo(
    () => (isolated ? allSlots.filter((s) => s.slot === isolated) : allSlots),
    [allSlots, isolated]
  )

  const labelOf = (entry: SalesSeriesEntry) =>
    entry.kind === "otros" ? `Otros (${entry.foldedCount})` : entry.label

  const config: ChartConfig = useMemo(() => {
    const out: ChartConfig = {}
    for (const { entry, slot } of allSlots) {
      out[slot] = { label: labelOf(entry), theme: colorOf(slot) }
    }
    return out
  }, [allSlots])

  const rows = useMemo(
    () =>
      data.buckets.map((b) => {
        const row: Record<string, string | number> = {
          label: b.kind === "no-date" ? "Sin fecha" : b.label,
          total: 0,
          [TOTAL_ANCHOR]: 0,
        }
        let total = 0
        for (const { entry, slot } of slots) {
          const v = b.values[entry.key]
          if (v) {
            row[slot] = v
            total += v
          }
        }
        row.total = total
        return row
      }),
    [data.buckets, slots]
  )

  const topSlotByRow = useMemo(
    () =>
      rows.map((row) => {
        let top: string | null = null
        for (const { slot } of slots) if (row[slot]) top = slot
        return top
      }),
    [rows, slots]
  )

  const oppById = useMemo(
    () => new Map(allOpportunities.map((o) => [o.id, o])),
    [allOpportunities]
  )

  const openDrill = (entry: SalesSeriesEntry, bucketIndex: number) => {
    const bucket = data.buckets[bucketIndex]
    const ids = bucket?.oppIds[entry.key] ?? []
    if (ids.length === 0) return
    const list = ids
      .map((id) => oppById.get(id))
      .filter((o): o is Opportunity => Boolean(o))
    setDrill({
      open: true,
      title: `${bucket.label} — ${labelOf(entry)}`,
      subtitle: `${title} · embudo ${scope.label}`,
      opportunities: list,
    })
  }

  const noDateTotal = data.buckets.find((b) => b.kind === "no-date")?.total ?? 0
  const chartId = `tendencia-${panel}-${scopeLabel.toLowerCase().replace(/\s+/g, "-")}`

  return (
    <DashboardCard>
      <ChartCardHeader
        title={title}
        icon={icon}
        total={n(scoped.length)}
        actions={<ScopePill label={`${scopeLabel} · por mes de creación`} tooltip={scopeTooltip} />}
      />
      <ChartCardContent>
        {rows.length === 0 ? (
          <ChartEmpty message="Sin oportunidades en el periodo seleccionado" />
        ) : (
          <>
            <div
              data-chart={`chart-${chartId}`}
              className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              {allSlots.map(({ entry, slot }) => {
                const dimmed = isolated !== null && isolated !== slot
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setIsolated(isolated === slot ? null : slot)}
                    aria-pressed={isolated === slot}
                    className={cn(
                      "inline-flex min-w-0 max-w-[12rem] items-center gap-1.5 text-[11px] text-muted-foreground transition-opacity hover:text-foreground",
                      dimmed && "opacity-40"
                    )}
                    title={`${labelOf(entry)} · ${n(entry.total)} — clic para verla sola`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: `var(--color-${slot})` }}
                      aria-hidden
                    />
                    <span className={cn("truncate", entry.kind === "empty" && MISSING_TEXT)}>
                      {labelOf(entry)}
                    </span>
                    <span className="tabular-nums">{n(entry.total)}</span>
                  </button>
                )
              })}
            </div>

            <ChartContainer id={chartId} config={config} className="h-[280px] w-full">
              <BarChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="label"
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
                  tickFormatter={(v: number) => n(v)}
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={
                    <NonZeroTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: `var(--color-${name})` }}
                            aria-hidden
                          />
                          <span className="flex-1 truncate text-muted-foreground">
                            {config[String(name)]?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {n(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                {slots.map(({ entry, slot }) => (
                  <Bar
                    key={slot}
                    dataKey={slot}
                    stackId="tendencia"
                    fill={`var(--color-${slot})`}
                    onClick={(_: unknown, index: number) => openDrill(entry, index)}
                    className="cursor-pointer"
                  >
                    {rows.map((_, rowIndex) => (
                      <Cell
                        key={rowIndex}
                        fillOpacity={data.buckets[rowIndex].kind === "no-date" ? 0.55 : 1}
                        radius={topSlotByRow[rowIndex] === slot ? TOP_RADIUS : undefined}
                      />
                    ))}
                  </Bar>
                ))}
                <Bar dataKey={TOTAL_ANCHOR} stackId="tendencia" fill="transparent">
                  <LabelList
                    dataKey="total"
                    position="top"
                    offset={8}
                    className="fill-muted-foreground"
                    fontSize={10}
                    formatter={(v: number) => (v ? n(v) : "")}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>

            {noDateTotal > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                La última barra agrupa {n(noDateTotal)} oportunidades sin fecha de creación
                legible.
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

type ConfiguredProps = Omit<
  CategoryTrendChartProps,
  "title" | "icon" | "fieldNames" | "scopeLabel" | "scopeTooltip"
>

export function OrigenDeLeadTrendChart(props: ConfiguredProps) {
  return (
    <CategoryTrendChart
      {...props}
      title="Leads por Origen, mes a mes"
      icon={Compass}
      fieldNames={ORIGEN_FIELDS}
      scopeLabel="Origen de Lead"
      scopeTooltip={
        <>
          Oportunidades del embudo agrupadas por el mes en que <strong>se creó el lead</strong> y
          apiladas por <strong>Origen de Lead</strong>, con la misma normalización que la tarjeta
          de ranking (<em>Walk-in</em> y <em>Walk In</em> son una sola serie). Los cinco orígenes
          más grandes conservan su color; el resto se pliega en <em>Otros</em>. Haz clic en un
          origen de la leyenda para verlo solo, y en una barra para abrir sus registros. Las
          pocas oportunidades con dos orígenes cuentan en ambos.
        </>
      }
    />
  )
}

export function CanalDeContactoTrendChart(props: ConfiguredProps) {
  return (
    <CategoryTrendChart
      {...props}
      title="Leads por Canal, mes a mes"
      icon={MessagesSquare}
      fieldNames={CANAL_FIELDS}
      scopeLabel="Canal de Contacto"
      scopeTooltip={
        <>
          Oportunidades del embudo agrupadas por el mes en que <strong>se creó el lead</strong> y
          apiladas por <strong>Canal de Contacto</strong> — el medio por el que escribió, no el
          origen. Los cinco canales más grandes conservan su color; el resto se pliega en{" "}
          <em>Otros</em>. Haz clic en un canal de la leyenda para verlo solo, y en una barra para
          abrir sus registros.
        </>
      }
    />
  )
}
