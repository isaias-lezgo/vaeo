// Verification for lib/sales-pivot.ts + lib/panel-scope.ts + lib/hubspot-import.ts —
// the three pure modules that decide WHICH opportunities a panel is talking about
// and what they add up to.
// Run: pnpm verify:pivot
//
// These two modules answer a question in money, and a wrong answer looks
// exactly like a right one on screen — there is no crash to notice. The UTC
// month bucketing (assertion 1) is the subtle one: GHL stores DATE custom
// fields at UTC midnight, so reading the month in local time moves a close on
// the 1st into the previous month.
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import assert from "node:assert/strict";
import type { Opportunity, Pipeline } from "../lib/types";
import {
  buildSalesPivot,
  closeDateOf,
  NO_DATE_KEY,
  NO_SERVICIO,
  NO_SUCURSAL,
  TOTAL_KEY,
} from "../lib/sales-pivot";
import { PANEL_SCOPES, resolvePipelineId, scopeOpportunities } from "../lib/panel-scope";
import { applyHubspotFilter, hasHubspotId, isHubspotImport } from "../lib/hubspot-import";

const SUCURSAL_FIELD = PANEL_SCOPES.vaeo.sucursalField; // "Sucursal VAEO"

let seq = 0;

// Build a minimally valid Opportunity. Only the fields the pivot reads matter.
function opp(o: {
  value: number;
  cierre?: string;
  sucursal?: string;
  servicio?: string;
  status?: Opportunity["status"];
  stage?: string;
  pipelineId?: string;
}): Opportunity {
  const resolved: Record<string, string> = {};
  if (o.cierre) resolved["Fecha de Cierre"] = o.cierre;
  if (o.sucursal) resolved[SUCURSAL_FIELD] = o.sucursal;
  if (o.servicio) resolved["Servicio"] = o.servicio;

  return {
    id: `o${++seq}`,
    name: `Opp ${seq}`,
    pipelineId: o.pipelineId ?? PANEL_SCOPES.vaeo.pipelineId,
    pipelineStageId: "stage-1",
    status: o.status ?? "won",
    createdAt: "2026-01-01T00:00:00.000Z",
    contactId: `c${seq}`,
    value: o.value,
    stage: o.stage ?? "Ganado",
    pipelineName: "VAEO",
    customFieldsResolved: resolved,
  };
}

const cellAt = (
  pivot: ReturnType<typeof buildSalesPivot>,
  rowKey: string,
  columnKey: string
) => {
  const row = pivot.rows.find((r) => r.key === rowKey);
  assert.ok(row, `row ${rowKey} exists`);
  const i = pivot.columns.findIndex((c) => c.key === columnKey);
  assert.notEqual(i, -1, `column ${columnKey} exists`);
  return row!.cells[i];
};

function main() {
  // 1. UTC month bucketing at the month boundary.
  {
    const pivot = buildSalesPivot(
      [
        opp({ value: 100, cierre: "2026-08-01T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Coworking" }),
        opp({ value: 50, cierre: "2026-07-31T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Coworking" }),
      ],
      { sucursalField: SUCURSAL_FIELD }
    );
    const keys = pivot.rows.filter((r) => r.kind === "month").map((r) => r.key);
    assert.deepEqual(keys, ["2026-07", "2026-08"], "UTC midnight on the 1st stays in its own month");
    assert.equal(cellAt(pivot, "2026-08", "MTY Tanarah||Coworking").value, 100);
    assert.equal(cellAt(pivot, "2026-07", "MTY Tanarah||Coworking").value, 50);
  }

  // 2. Empty buckets: missing sucursal, missing servicio, missing close date.
  {
    const pivot = buildSalesPivot(
      [
        opp({ value: 10, cierre: "2026-03-15T00:00:00.000Z", servicio: "Coworking" }),
        opp({ value: 20, cierre: "2026-03-15T00:00:00.000Z", sucursal: "SLP Covalia" }),
        opp({ value: 30, sucursal: "SLP Covalia", servicio: "Coworking" }),
      ],
      { sucursalField: SUCURSAL_FIELD }
    );
    assert.equal(cellAt(pivot, "2026-03", `${NO_SUCURSAL}||Coworking`).value, 10, "sucursal vacía cae en Sin sucursal");
    assert.equal(cellAt(pivot, "2026-03", `SLP Covalia||${NO_SERVICIO}`).value, 20, "servicio vacío cae en Sin servicio");
    assert.equal(cellAt(pivot, NO_DATE_KEY, "SLP Covalia||Coworking").value, 30, "sin fecha cae en su propia fila");
    assert.equal(pivot.grandTotal, 60, "las tres siguen contando para el total");
  }

  // 3. Only wins count — including a stage-only win with status "open".
  {
    const pivot = buildSalesPivot(
      [
        opp({ value: 100, cierre: "2026-05-10T00:00:00.000Z", sucursal: "QRO Central Park", servicio: "Day pass", status: "won" }),
        opp({ value: 7, cierre: "2026-05-10T00:00:00.000Z", sucursal: "QRO Central Park", servicio: "Day pass", status: "open", stage: "Propuesta" }),
        opp({ value: 7, cierre: "2026-05-10T00:00:00.000Z", sucursal: "QRO Central Park", servicio: "Day pass", status: "lost", stage: "Ganado" }),
        opp({ value: 7, cierre: "2026-05-10T00:00:00.000Z", sucursal: "QRO Central Park", servicio: "Day pass", status: "abandoned", stage: "Perdido" }),
        opp({ value: 25, cierre: "2026-05-10T00:00:00.000Z", sucursal: "QRO Central Park", servicio: "Day pass", status: "open", stage: "Ganado" }),
      ],
      { sucursalField: SUCURSAL_FIELD }
    );
    assert.equal(pivot.grandTotal, 125, "abierta/perdida/abandonada fuera; stage Ganado con status open dentro");
  }

  // 4. Subtotals, total row and grand total agree with the raw sum.
  {
    const opps = [
      opp({ value: 100, cierre: "2026-04-02T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Coworking" }),
      opp({ value: 200, cierre: "2026-04-20T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Sala de Juntas" }),
      opp({ value: 300, cierre: "2026-05-05T00:00:00.000Z", sucursal: "SLP Covalia", servicio: "Coworking" }),
      opp({ value: 400, cierre: "2026-05-06T00:00:00.000Z", sucursal: "SLP Covalia" }),
    ];
    const pivot = buildSalesPivot(opps, { sucursalField: SUCURSAL_FIELD });
    const raw = opps.reduce((s, o) => s + o.value, 0);

    assert.equal(pivot.grandTotal, raw, "el total general cuadra con la suma cruda");
    assert.equal(cellAt(pivot, "2026-04", "sub||MTY Tanarah").value, 300, "subtotal por sucursal en un mes");
    assert.equal(cellAt(pivot, TOTAL_KEY, "sub||SLP Covalia").value, 700, "subtotal de la fila Total");
    assert.equal(cellAt(pivot, TOTAL_KEY, TOTAL_KEY).value, raw, "la celda Total/Total es el total general");

    // Every row's Total cell equals the sum of that row's plain cells.
    for (const row of pivot.rows) {
      const cellSum = pivot.columns.reduce(
        (s, c, i) => (c.kind === "cell" ? s + row.cells[i].value : s),
        0
      );
      const totalIdx = pivot.columns.findIndex((c) => c.key === TOTAL_KEY);
      assert.equal(row.cells[totalIdx].value, cellSum, `la fila ${row.key} cuadra con sus celdas`);
    }

    // Drill-down ids: the Total/Total cell holds every won opportunity.
    assert.equal(cellAt(pivot, TOTAL_KEY, TOTAL_KEY).oppIds.length, opps.length, "el drill del total trae todas");
  }

  // 5. Ordering: no-date row first, months ascending, Total last;
  //    "Sin servicio" closes its group and the grand total is the last column.
  {
    const pivot = buildSalesPivot(
      [
        opp({ value: 5, cierre: "2026-06-01T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Coworking" }),
        opp({ value: 5, cierre: "2026-01-01T00:00:00.000Z", sucursal: "MTY Tanarah", servicio: "Coworking" }),
        opp({ value: 9, sucursal: "MTY Tanarah", servicio: "Coworking" }),
        opp({ value: 1, cierre: "2026-01-01T00:00:00.000Z", sucursal: "MTY Tanarah" }),
      ],
      { sucursalField: SUCURSAL_FIELD }
    );
    assert.deepEqual(
      pivot.rows.map((r) => r.key),
      [NO_DATE_KEY, "2026-01", "2026-06", TOTAL_KEY],
      "sin-fecha arriba, meses ascendentes, Total al final"
    );
    assert.deepEqual(
      pivot.columns.map((c) => c.key),
      [
        "MTY Tanarah||Coworking",
        `MTY Tanarah||${NO_SERVICIO}`,
        "sub||MTY Tanarah",
        TOTAL_KEY,
      ],
      "Sin servicio cierra el grupo, luego Subtotal, y Total al final"
    );
    assert.equal(pivot.rows[0].label, "Sin fecha de cierre");
    assert.equal(pivot.rows[1].label, "ene 2026", "etiqueta de mes en español");
  }

  // 6. Empty input produces an empty pivot, not a lone Total row.
  {
    const pivot = buildSalesPivot([], { sucursalField: SUCURSAL_FIELD });
    assert.deepEqual(pivot.rows, [], "sin datos no hay filas");
    assert.equal(pivot.grandTotal, 0);
  }

  // 7. closeDateOf ignores an unparseable value.
  {
    const bad = opp({ value: 1, sucursal: "MTY Tanarah" });
    bad.customFieldsResolved = { "Fecha de Cierre": "no soy fecha" };
    assert.equal(closeDateOf(bad), undefined, "una fecha basura se trata como ausente");
  }

  // 8. panel-scope: name match wins, id is the fallback, and scoping filters.
  {
    const pipelines: Pipeline[] = [
      { id: "nuevo-id-vaeo", name: "VAEO", stages: ["Nuevo Lead", "Ganado"] },
      { id: "nuevo-id-mesh", name: "MESH", stages: ["Nuevo Lead", "Ganado"] },
    ];
    assert.equal(resolvePipelineId(pipelines, "vaeo"), "nuevo-id-vaeo", "gana el match por nombre");
    assert.equal(resolvePipelineId([], "vaeo"), PANEL_SCOPES.vaeo.pipelineId, "sin match, cae al id");
    assert.equal(resolvePipelineId(undefined, "mesh"), PANEL_SCOPES.mesh.pipelineId, "sin pipelines, cae al id");

    const mixed = [
      opp({ value: 1, pipelineId: "nuevo-id-vaeo" }),
      opp({ value: 1, pipelineId: "nuevo-id-mesh" }),
    ];
    assert.equal(scopeOpportunities(mixed, "vaeo", pipelines).length, 1, "solo el pipeline del panel");
    assert.equal(scopeOpportunities(mixed, "mesh", pipelines).length, 1);
  }

  // 9. hubspot-import: which opportunities the panel-wide toggle drops.
  {
    // The real migration date in this account. Every migrated record shares it.
    const MIGRATED = "2026-03-20T00:00:00.000Z";

    // A migrated opportunity: HubSpot id + created on the migration run.
    const migrated = (fieldName: string, id: string, cierre?: string) => {
      const o = opp({ value: 1, sucursal: "MTY Tanarah", cierre });
      o.createdAt = MIGRATED;
      o.customFieldsResolved = { ...o.customFieldsResolved, [fieldName]: id };
      return o;
    };

    // --- signal 1: the id field, matched loosely by name ---
    // Closed inside the migration month ⇒ HubSpot's own bookkeeping.
    assert.equal(hasHubspotId(migrated("ID Oportunidad HS", "1")), true, "ID Oportunidad HS");
    assert.equal(hasHubspotId(migrated("ID Hubspot", "1")), true, "ID Hubspot");
    assert.equal(hasHubspotId(migrated("HubSpot ID", "1")), true, "HubSpot ID");

    // An empty value is not an import — the field exists on every opp in some
    // accounts, blank on the ones that were never migrated.
    assert.equal(hasHubspotId(migrated("ID Oportunidad HS", "   ")), false, "campo vacío no cuenta");
    assert.equal(hasHubspotId(opp({ value: 1 })), false, "sin el campo no cuenta");

    // "Fecha de Creación import" is a different migration leftover: it says
    // nothing about HubSpot and must not drag rows out of the panel.
    assert.equal(
      hasHubspotId(migrated("Fecha de Creación import", "2026-03-01")),
      false,
      "otro campo de importación no cuenta"
    );
    // Needs an id word too, so a bare "Sucursal HS" would not qualify.
    assert.equal(hasHubspotId(migrated("Sucursal HS", "MTY")), false, "sin 'id' no cuenta");

    // --- signal 2: closed inside the migration month, or later in the CRM ---
    const imported = migrated("ID Oportunidad HS", "9", "2026-03-05T00:00:00.000Z");
    assert.equal(isHubspotImport(imported), true, "cierre antes de migrar ⇒ importación");
    assert.equal(
      isHubspotImport(migrated("ID Oportunidad HS", "9", "2026-03-31T00:00:00.000Z")),
      true,
      "cierre a fin del mes de la migración ⇒ importación (los 7 casos de 21-31 mar)"
    );
    assert.equal(
      isHubspotImport(migrated("ID Oportunidad HS", "9", "2026-04-01T00:00:00.000Z")),
      false,
      "cierre el mes siguiente ⇒ se trabajó en el CRM, cuenta como venta"
    );
    assert.equal(
      isHubspotImport(migrated("ID Oportunidad HS", "9")),
      true,
      "migrada sin fecha de cierre ⇒ importación"
    );
    // An organic deal is never an import, whatever its dates.
    const organic = opp({ value: 1, sucursal: "MTY Tanarah", cierre: "2026-03-05T00:00:00.000Z" });
    assert.equal(isHubspotImport(organic), false, "sin ID de HubSpot nunca es importación");

    const both = [imported, organic];
    assert.equal(applyHubspotFilter(both, false).length, 1, "apagado: se va la importada");
    assert.equal(applyHubspotFilter(both, false)[0].id, organic.id, "apagado: queda la orgánica");
    assert.equal(applyHubspotFilter(both, true), both, "prendido: misma referencia, sin copia");

    // The toggle must move the pivot's money, not just its row count — and the
    // deal migrated open then won in the CRM must survive it.
    const bulk = migrated("ID Oportunidad HS", "9", "2026-03-05T00:00:00.000Z");
    bulk.value = 1000;
    const workedHere = migrated("ID Oportunidad HS", "10", "2026-06-05T00:00:00.000Z");
    workedHere.value = 500;
    const native = opp({
      value: 25,
      sucursal: "MTY Tanarah",
      servicio: "Coworking",
      cierre: "2026-06-05T00:00:00.000Z",
    });
    const set = [bulk, workedHere, native];
    const on = buildSalesPivot(applyHubspotFilter(set, true), { sucursalField: SUCURSAL_FIELD });
    const off = buildSalesPivot(applyHubspotFilter(set, false), { sucursalField: SUCURSAL_FIELD });
    assert.equal(on.grandTotal, 1525, "prendido suma las tres");
    assert.equal(off.grandTotal, 525, "apagado suma la orgánica y la migrada-pero-cerrada-aquí");
  }

  console.log("verify-sales-pivot: all assertions passed");
}

main();
