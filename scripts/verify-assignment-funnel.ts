// Verificación de lib/assignment-funnel.ts — el apilado de "Leads sin asesor por
// mes". Correr: pnpm verify:assignment
//
// Justifica el script la regla de precedencia: una oportunidad SIN asesor que ya
// se cerró como perdida es las dos cosas a la vez, y de qué lado cae decide el
// gráfico entero. Si un día alguien "arregla" eso repartiéndola, las alturas
// dejan de sumar el total del mes y nada en la UI se ve roto — las barras
// simplemente encogen.
//
// Envuelto en main() en vez de top-level await: este paquete es CJS.
import assert from "node:assert/strict";
import type { Opportunity } from "../lib/types";
import { NO_DATE_KEY, NO_DATE_LABEL } from "../lib/opportunity-breakdown";
import {
  ASSIGNMENT_BUCKETS,
  assignmentBucket,
  buildAssignmentByMonth,
  summarizeAssignment,
} from "../lib/assignment-funnel";

let seq = 0;

function opp(o: {
  advisor?: string;
  stage?: string;
  status?: Opportunity["status"];
  createdAt?: string | undefined;
}): Opportunity {
  return {
    id: `o${++seq}`,
    name: `Opp ${seq}`,
    pipelineId: "MiATYfkJWklaXqYc7hOr",
    pipelineStageId: "stage-1",
    status: o.status ?? "open",
    createdAt: "createdAt" in o ? (o.createdAt as string) : "2026-06-15T12:00:00.000Z",
    contactId: `c${seq}`,
    value: 0,
    stage: o.stage ?? "Nuevo Lead",
    pipelineName: "VAEO",
    assignedTo: o.advisor,
  };
}

const rowFor = (rows: ReturnType<typeof buildAssignmentByMonth>, key: string) => {
  const r = rows.find((x) => x.key === key);
  assert.ok(r, `existe la fila "${key}" (hay: ${rows.map((x) => x.key).join(", ")})`);
  return r!;
};

function main() {
  // 1. La precedencia: sin asesor gana sobre CUALQUIER estatus o etapa.
  {
    assert.equal(assignmentBucket(opp({ advisor: "Zulema" })), "abierta");
    assert.equal(assignmentBucket(opp({ advisor: "Zulema", status: "lost" })), "perdida");
    assert.equal(assignmentBucket(opp({ advisor: "Zulema", status: "won" })), "ganada");
    assert.equal(assignmentBucket(opp({ advisor: "Zulema", stage: "Ganado" })), "ganada");

    // Las mismas cuatro, pero sin asesor: todas caen en la misma cubeta.
    assert.equal(assignmentBucket(opp({})), "sinAsesor");
    assert.equal(assignmentBucket(opp({ status: "lost" })), "sinAsesor");
    assert.equal(assignmentBucket(opp({ status: "won" })), "sinAsesor");
    assert.equal(assignmentBucket(opp({ stage: "Ganado" })), "sinAsesor");
    assert.equal(assignmentBucket(opp({ status: "abandoned" })), "sinAsesor");

    // Un asesor que es puro espacio en blanco no cuenta como asignado.
    assert.equal(assignmentBucket(opp({ advisor: "   " })), "sinAsesor");
    assert.equal(assignmentBucket(opp({ advisor: "" })), "sinAsesor");
  }

  // 2. Los cuatro segmentos son excluyentes y suman el total del mes. Esta es la
  //    invariante que sostiene el apilado.
  {
    const rows = buildAssignmentByMonth([
      opp({ createdAt: "2026-07-02T10:00:00.000Z" }),
      opp({ createdAt: "2026-07-05T10:00:00.000Z", status: "lost" }),
      opp({ createdAt: "2026-07-09T10:00:00.000Z", advisor: "Zulema", status: "lost" }),
      opp({ createdAt: "2026-07-11T10:00:00.000Z", advisor: "Diana", stage: "Ganado" }),
      opp({ createdAt: "2026-07-20T10:00:00.000Z", advisor: "Dariana" }),
    ]);
    const jul = rowFor(rows, "2026-07");
    assert.equal(jul.sinAsesor, 2, "las dos sin asesor, perdida incluida");
    assert.equal(jul.perdida, 1, "solo la perdida QUE SÍ tenía asesor");
    assert.equal(jul.ganada, 1);
    assert.equal(jul.abierta, 1);
    assert.equal(jul.total, 5);

    const suma = ASSIGNMENT_BUCKETS.reduce((n, b) => n + jul[b], 0);
    assert.equal(suma, jul.total, "los cuatro segmentos suman el total");
    assert.equal(Math.round(jul.pctSinAsesor), 40);
  }

  // 3. Los ids del drill-down: cada oportunidad aparece en EXACTAMENTE una
  //    cubeta. Un id duplicado inflaría el drawer sin mover el conteo.
  {
    const opps = [
      opp({ createdAt: "2026-07-02T10:00:00.000Z" }),
      opp({ createdAt: "2026-07-05T10:00:00.000Z", status: "lost" }),
      opp({ createdAt: "2026-07-09T10:00:00.000Z", advisor: "Zulema", status: "won" }),
    ];
    const rows = buildAssignmentByMonth(opps);
    const jul = rowFor(rows, "2026-07");
    const todos = ASSIGNMENT_BUCKETS.flatMap((b) => jul.ids[b]);
    assert.equal(todos.length, opps.length);
    assert.equal(new Set(todos).size, opps.length, "ningún id repetido entre cubetas");
    for (const b of ASSIGNMENT_BUCKETS) {
      assert.equal(jul.ids[b].length, jul[b], `ids["${b}"] cuadra con su conteo`);
    }
  }

  // 4. Los meses intermedios vacíos se rellenan en cero, para que el eje no
  //    dibuje un hueco de tres meses como si fueran dos barras consecutivas.
  {
    const rows = buildAssignmentByMonth([
      opp({ createdAt: "2026-03-10T10:00:00.000Z" }),
      opp({ createdAt: "2026-06-10T10:00:00.000Z" }),
    ]);
    assert.deepEqual(
      rows.map((r) => r.key),
      ["2026-03", "2026-04", "2026-05", "2026-06"]
    );
    const abr = rowFor(rows, "2026-04");
    assert.equal(abr.total, 0);
    assert.equal(abr.pctSinAsesor, 0, "un mes vacío no es 'el 100% sin asesor'");
  }

  // 5. Sin fecha legible: una fila propia al final, nunca un registro perdido.
  {
    const rows = buildAssignmentByMonth([
      opp({ createdAt: "2026-07-02T10:00:00.000Z" }),
      opp({ createdAt: undefined }),
      opp({ createdAt: "no-es-una-fecha" }),
    ]);
    const last = rows[rows.length - 1];
    assert.equal(last.key, NO_DATE_KEY);
    assert.equal(last.label, NO_DATE_LABEL);
    assert.equal(last.total, 2);
    assert.equal(
      rows.reduce((n, r) => n + r.total, 0),
      3,
      "no se pierde ningún registro"
    );
  }

  // 6. Sin datos: arreglo vacío, no una fila fantasma.
  {
    assert.deepEqual(buildAssignmentByMonth([]), []);
    const s = summarizeAssignment([]);
    assert.equal(s.total, 0);
    assert.equal(s.pctSinAsesor, 0);
    assert.equal(s.cierreConAsesor, 0, "sin denominador, cero — no NaN");
    assert.ok(!Number.isNaN(s.cierreConAsesor));
  }

  // 7. El resumen de la nota al pie.
  {
    const rows = buildAssignmentByMonth([
      opp({ createdAt: "2026-07-02T10:00:00.000Z" }),
      opp({ createdAt: "2026-07-03T10:00:00.000Z", status: "lost" }),
      opp({ createdAt: "2026-07-04T10:00:00.000Z", status: "lost" }),
      opp({ createdAt: "2026-07-05T10:00:00.000Z", advisor: "Zulema", stage: "Ganado" }),
      opp({ createdAt: "2026-07-06T10:00:00.000Z", advisor: "Diana", status: "lost" }),
    ]);
    const s = summarizeAssignment(rows);
    assert.equal(s.total, 5);
    assert.equal(s.sinAsesor, 3);
    assert.equal(Math.round(s.pctSinAsesor), 60);
    assert.equal(s.ganadasConAsesor, 1);
    assert.equal(s.ganadasSinAsesor, 0);
    // 1 ganada de 2 que sí tuvieron asesor. El denominador NO es el total: decir
    // "20% de cierre" mezclaría la fuga con el desempeño de quien sí trabajó.
    assert.equal(s.cierreConAsesor, 50);
  }

  // 8. `ganadasSinAsesor` se MIDE, no se asume. Es la afirmación fuerte de la
  //    tarjeta ("de esos no se ha ganado ninguno"), así que tiene que ser capaz
  //    de salir distinta de cero cuando los datos lo digan.
  {
    const rows = buildAssignmentByMonth([
      opp({ createdAt: "2026-07-02T10:00:00.000Z", stage: "Ganado" }),
      opp({ createdAt: "2026-07-03T10:00:00.000Z", status: "won" }),
      opp({ createdAt: "2026-07-04T10:00:00.000Z", status: "lost" }),
    ]);
    const jul = rowFor(rows, "2026-07");
    assert.equal(jul.sinAsesor, 3, "las tres siguen en la cubeta de la fuga");
    assert.equal(jul.ganada, 0, "y ninguna se cuela al segmento de ganadas");
    assert.equal(jul.sinAsesorGanadas, 2, "pero el subconteo sí las ve");
    assert.equal(summarizeAssignment(rows).ganadasSinAsesor, 2);
    // El subconteo NO entra en el total: no es un quinto segmento.
    assert.equal(jul.total, 3);
  }

  console.log("verify-assignment-funnel: OK");
}

main();
