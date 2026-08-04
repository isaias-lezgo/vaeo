"use client"

import { useMemo, useState } from "react"
import { Table2 } from "lucide-react"
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
import { buildSalesPivot, closeDateOf, type PivotCell } from "@/lib/sales-pivot"
import { PANEL_SCOPES, scopeOpportunities, type PanelId } from "@/lib/panel-scope"
import { filterByDateRange, type ResolvedDateRange } from "@/lib/date-range"
import { cn } from "@/lib/utils"
import {
  ChartCardContent,
  ChartCardHeader,
  ChartEmpty,
  DashboardCard,
  ScopePill,
} from "./dashboard-ui"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
})

export interface SalesPivotTableProps {
  panel: PanelId
  /** Unfiltered opportunities — this table does its own date filtering, by close date. */
  allOpportunities: Opportunity[]
  contacts: Contact[]
  /** Unfiltered contacts — drill-down joins resolve against these. */
  allContacts: Contact[]
  pipelines?: Pipeline[]
  dateRange: ResolvedDateRange | null
  tasks?: Task[]
  calls?: Call[]
  allPautas?: Pauta[]
  appointments?: Appointment[]
  messages?: Message[]
  locationId?: string
}

export function SalesPivotTable({
  panel,
  allOpportunities,
  contacts,
  allContacts,
  pipelines = [],
  dateRange,
  tasks = [],
  calls = [],
  allPautas = [],
  appointments = [],
  messages = [],
  locationId = "",
}: SalesPivotTableProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const scope = PANEL_SCOPES[panel]

  // Deliberately built off allOpportunities, not the date-filtered prop: the
  // rest of the panel filters by createdAt, and this table measures the close
  // date. filterByDateRange keeps records with no date, which is what puts the
  // "Sin fecha de cierre" row on screen under any filter.
  const pivot = useMemo(() => {
    const scoped = scopeOpportunities(allOpportunities, panel, pipelines)
    const inRange = filterByDateRange(scoped, closeDateOf, dateRange)
    return buildSalesPivot(inRange, { sucursalField: scope.sucursalField })
  }, [allOpportunities, panel, pipelines, dateRange, scope.sucursalField])

  const oppById = useMemo(
    () => new Map(allOpportunities.map((o) => [o.id, o])),
    [allOpportunities]
  )

  const openDrill = (cell: PivotCell, title: string, subtitle: string) => {
    if (cell.oppIds.length === 0) return
    const opportunities = cell.oppIds
      .map((id) => oppById.get(id))
      .filter((o): o is Opportunity => Boolean(o))
    setDrill({ open: true, title, subtitle, opportunities })
  }

  // Column-group spans for the top header row: one <th> per sucursal covering
  // its servicio columns plus its subtotal.
  const groups = useMemo(() => {
    const out: { sucursal: string; span: number }[] = []
    for (const col of pivot.columns) {
      if (col.kind === "total") continue
      const last = out[out.length - 1]
      if (last && last.sucursal === col.sucursal) last.span += 1
      else out.push({ sucursal: col.sucursal, span: 1 })
    }
    return out
  }, [pivot.columns])

  const stickyCol = "sticky left-0 z-20 bg-card"

  return (
    <DashboardCard>
      <ChartCardHeader
        title="Resumen general de ventas"
        icon={Table2}
        total={money.format(pivot.grandTotal)}
        actions={
          <ScopePill
            label="Ganadas · por fecha de cierre"
            tooltip={
              <>
                Suma el valor de las oportunidades <strong>ganadas</strong> del embudo{" "}
                {scope.label}, agrupadas por el mes de su <strong>Fecha de Cierre</strong>{" "}
                (no por su fecha de creación). Las que no tienen sucursal o servicio
                capturado caen en las columnas <em>Sin sucursal</em> / <em>Sin servicio</em>,
                y las que no tienen fecha de cierre viven en la fila{" "}
                <em>Sin fecha de cierre</em>, que no se ve afectada por el filtro de fechas.
              </>
            }
          />
        }
      />
      <ChartCardContent>
        {pivot.rows.length === 0 ? (
          <ChartEmpty message="Sin ventas cerradas en el periodo seleccionado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-max border-separate border-spacing-0 text-right text-xs tabular-nums">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className={cn(
                      stickyCol,
                      "border-b border-r border-border px-3 py-2 text-left align-bottom font-semibold"
                    )}
                  >
                    Fecha de cierre
                  </th>
                  {groups.map((g) => (
                    <th
                      key={g.sucursal}
                      colSpan={g.span}
                      className="border-b border-r border-border px-3 py-2 text-center font-semibold"
                    >
                      {g.sucursal}
                    </th>
                  ))}
                  <th
                    rowSpan={2}
                    className="border-b border-border px-3 py-2 align-bottom font-semibold"
                  >
                    Total
                  </th>
                </tr>
                <tr>
                  {pivot.columns
                    .filter((c) => c.kind !== "total")
                    .map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          "min-w-[7.5rem] border-b border-border px-3 py-2 font-medium text-muted-foreground",
                          c.kind === "subtotal" && "border-r font-semibold text-foreground"
                        )}
                      >
                        {c.servicio}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((row) => (
                  <tr key={row.key} className={cn(row.kind === "total" && "font-semibold")}>
                    <th
                      scope="row"
                      className={cn(
                        stickyCol,
                        "whitespace-nowrap border-b border-r border-border px-3 py-2 text-left font-medium",
                        row.kind === "total" && "font-semibold",
                        row.kind === "no-date" && "text-muted-foreground"
                      )}
                    >
                      {row.label}
                    </th>
                    {row.cells.map((cell, i) => {
                      const col = pivot.columns[i]
                      const label =
                        col.kind === "cell"
                          ? `${col.sucursal} · ${col.servicio}`
                          : col.kind === "subtotal"
                            ? `${col.sucursal} · total`
                            : "Todas las sucursales"
                      return (
                        <td
                          key={col.key}
                          onClick={() =>
                            openDrill(cell, `${row.label} — ${label}`, "Oportunidades ganadas")
                          }
                          className={cn(
                            "border-b border-border px-3 py-2",
                            (col.kind === "subtotal" || col.kind === "total") && "font-semibold",
                            col.kind === "subtotal" && "border-r",
                            cell.oppIds.length > 0 && "cursor-pointer hover:bg-muted/50"
                          )}
                        >
                          {cell.value === 0 ? (
                            <span className="text-muted-foreground">–</span>
                          ) : (
                            money.format(cell.value)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
