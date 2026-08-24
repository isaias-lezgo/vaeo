// Deriva, por contacto, la fecha del ÚLTIMO MENSAJE SALIENTE — el eje de
// mensajes de la matriz "Oportunidades sin atención".
//
// GHL no expone ese dato: /conversations/search trae lastMessageDate y
// lastMessageDirection, pero ninguna fecha de "último saliente"
// (lastManualMessageDate NO lo es: cuenta manuales en ambas direcciones). Se
// deriva con dos observaciones:
//
//   1. Si la conversación termina en SALIENTE, lastMessageDate ya es la fecha
//      buscada. Es el ~93 % de los casos y no cuesta una sola llamada extra.
//   2. El último saliente es siempre ≤ el último mensaje. Una conversación muda
//      por más de STALE_HORIZON_DAYS cae en la cubeta más profunda sin abrirla.
//
// Solo se abre el hilo del resto: termina en entrante Y está dentro del
// horizonte.
//
// Se carga en segundo plano como /api/dashboard-messages: fuera de la ruta
// crítica, el panel pinta primero.
import {
  getMessages,
  searchConversationsPage,
  type GHLConversationSearchDoc,
} from "@/lib/ghl-client";
import { isActivityMessage } from "@/lib/ghl-message-mapper";
import { STALE_HORIZON_DAYS } from "@/lib/stale-opportunity-matrix";
import { requireClient, unauthorized } from "@/lib/session";
import { withClient } from "@/lib/ghl-context";

function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export const runtime = "nodejs";

/**
 * Normaliza a ISO. GHL devuelve `lastMessageDate` como epoch en MILISEGUNDOS
 * (número), mientras que el `dateAdded` de los mensajes viene como ISO — y los
 * tipos de la API declaran string en ambos. Verificado contra la sub-cuenta
 * real: la búsqueda de conversaciones regresa 1786082787710, no una fecha.
 *
 * Se normaliza aquí, en la frontera, y no río abajo, porque el consumidor hace
 * `new Date(valor)`: con un número funciona de casualidad, pero si ese mismo
 * epoch llegara como CADENA ("1786082787710") daría Invalid Date, el cliente lo
 * leería como "sin dato" y mandaría a TODOS los contactos a la cubeta de
 * abandono. Ese fallo no se ve como un error, se ve como una acusación.
 */
function toIso(value: string | number | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  const d = Number.isFinite(n) ? new Date(n) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Páginas máximas del recorrido. ~20 bastan para 60 días; el tope es un seguro. */
const MAX_PAGES = 60;
const PAGE_SIZE = 100;
/** Mismo patrón que dashboard-messages: no disparar cientos de hilos a la vez. */
const CONCURRENCY = 6;

/**
 * Cuánto del avance total se lleva la fase 1 (recorrer conversaciones) frente a
 * la fase 2 (abrir los hilos que terminan en entrante).
 *
 * No es un número inventado ni estimado: sale de cronometrar la ruta contra la
 * sub-cuenta real (2026-08-24). 3 300 conversaciones en 33 páginas tardaron
 * 16 s; los 589 hilos con CONCURRENCY 6 tardaron 73 s. 16 / 89 ≈ 0.18.
 *
 * Vale la pena recalibrarlo si el volumen de la cuenta cambia de orden, pero no
 * afinarlo: el error de unos puntos solo hace que la barra corra un poco
 * disparejo en la costura, y el reparto correcto entre las dos fases importa
 * mucho más que la precisión dentro de cada una.
 */
const SCAN_WEIGHT = 0.2;

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export async function GET() {
  // El cliente se resuelve en el scope del request: cookies() no está
  // disponible dentro del callback del stream.
  const client = await requireClient();
  if (!client) return unauthorized();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // El contexto se entra AQUÍ, no alrededor de GET(): el stream sobrevive al
      // return del handler, así que envolver el handler dejaría la bomba
      // corriendo fuera del contexto.
      await withClient(client, async () => {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(enc(obj)));
        };

        // La barra NUNCA retrocede. Las dos fases estiman su avance por
        // caminos distintos (fechas una, conteos la otra) y en la costura
        // pueden discrepar por unos puntos; un porcentaje que da marcha atrás
        // se lee como que algo salió mal, que es justo lo contrario de lo que
        // esta barra existe para comunicar.
        let lastPct = 0;
        const sendProgress = (message: string, pct: number) => {
          lastPct = Math.max(lastPct, clamp01(pct));
          send({ type: "progress", message, pct: lastPct });
        };

        try {
          const started = Date.now();
          const cutoff = started - STALE_HORIZON_DAYS * 86_400_000;

          sendProgress("Cargando actividad de conversaciones…", 0);

          // 1. Recorrer las conversaciones de la más reciente a la más vieja y
          //    cortar al cruzar el horizonte.
          const outboundAt = new Map<string, string>(); // contactId → ISO
          const pending: Array<{ conversationId: string; contactId: string }> = [];
          const seenConvIds = new Set<string>();
          let cursor: number | string | undefined;
          let scanned = 0;
          let reachedHorizon = false;

          for (let page = 0; page < MAX_PAGES && !reachedHorizon; page++) {
            let docs: GHLConversationSearchDoc[];
            try {
              const res = await searchConversationsPage({
                limit: PAGE_SIZE,
                startAfterDate: cursor,
              });
              docs = res.conversations;
            } catch (err) {
              // Se conserva lo que ya se recorrió, igual que cursorWalk: una
              // página perdida mueve algunos leads una cubeta, perderlo todo
              // haría que el gráfico acuse abandono total.
              console.error("[GHL] conversation-activity: página fallida:", err);
              break;
            }

            if (docs.length === 0) break;

            for (const c of docs) {
              // El cursor es por VALOR de sort: dos conversaciones con el mismo
              // lastMessageDate al milisegundo pueden repetirse en el corte.
              if (seenConvIds.has(c.id)) continue;
              seenConvIds.add(c.id);
              if (c.deleted) continue;
              scanned++;

              const lastIso = toIso(c.lastMessageDate);
              const ts = lastIso ? new Date(lastIso).getTime() : NaN;
              if (!Number.isNaN(ts) && ts < cutoff) {
                reachedHorizon = true;
                continue;
              }
              if (!c.contactId) continue;

              if (c.lastMessageDirection === "outbound" && lastIso) {
                // Observación 1: termina en saliente ⇒ ya es la fecha buscada.
                const prev = outboundAt.get(c.contactId);
                if (!prev || new Date(lastIso) > new Date(prev)) {
                  outboundAt.set(c.contactId, lastIso);
                }
              } else {
                pending.push({ conversationId: c.id, contactId: c.contactId });
              }
            }

            const last = docs[docs.length - 1];
            const next = last?.sort?.[0];

            // El avance de esta fase se mide por FECHA, no por páginas: el
            // recorrido va de la conversación más reciente hacia atrás hasta
            // cruzar el horizonte, así que qué tanto retrocedió el cursor
            // dentro de esa ventana ES el avance. Contar páginas contra
            // MAX_PAGES daría un porcentaje falso — el tope es un seguro que
            // casi nunca se toca, no una meta. Se toma el máximo con el avance
            // por páginas solo como piso, para que una cuenta con fechas raras
            // no deje la barra clavada en cero.
            const cursorTs = next === undefined ? NaN : Number(next);
            // Se acota aquí y no solo en sendProgress: la última página cruza
            // el horizonte, así que sin el tope daría >1 y se comería un
            // pedazo del presupuesto de la fase 2.
            const byDate = Number.isFinite(cursorTs)
              ? clamp01((started - cursorTs) / (started - cutoff))
              : 0;
            const byPage = (page + 1) / MAX_PAGES;
            sendProgress(
              `Conversaciones revisadas: ${scanned.toLocaleString("es-MX")}`,
              Math.max(byDate, byPage) * SCAN_WEIGHT
            );

            if (next === undefined) break;
            cursor = next;
            if (docs.length < PAGE_SIZE) break;
          }

          // 2. Abrir solo los hilos que terminan en entrante y siguen dentro del
          //    horizonte, con concurrencia acotada.
          const pendingTotal = pending.length;
          // Corta a propósito: la tarjeta le da poco más de 20rem y el texto
          // se trunca. Lo que no puede perderse en el corte es el "de N", que
          // es lo que convierte el número en un avance y no en un dato suelto.
          const threadLabel = (done: number) =>
            `Sin respuesta: ${done.toLocaleString("es-MX")} de ${pendingTotal.toLocaleString("es-MX")}`;

          sendProgress(
            pendingTotal === 0 ? "Cerrando…" : threadLabel(0),
            SCAN_WEIGHT
          );

          let idx = 0;
          let done = 0;
          const found: Array<{ contactId: string; iso: string } | null> = new Array(
            pending.length
          );
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
              while (idx < pending.length) {
                const i = idx++;
                const { conversationId, contactId } = pending[i];
                try {
                  const res = await getMessages(conversationId, { limit: 50 });
                  let best: string | null = null;
                  for (const m of res.messages.messages) {
                    if (m.direction !== "outbound") continue;
                    // Un chip de "oportunidad creada" no es un mensaje a nadie.
                    if (isActivityMessage(m)) continue;
                    const iso = toIso(m.dateAdded);
                    if (!iso) continue;
                    if (!best || new Date(iso) > new Date(best)) best = iso;
                  }
                  found[i] = best ? { contactId, iso: best } : null;
                } catch {
                  // El hilo no abrió: se deja sin dato. El cliente lo lee como la
                  // cubeta más profunda, que es la lectura conservadora correcta
                  // (el último saliente es ≤ el último mensaje, que ya es viejo).
                  found[i] = null;
                }
                done++;
                // Un frame por hilo serían ~600 escrituras al stream para
                // mover la barra menos de un pixel cada una. Se emite por
                // tramos, y siempre el último.
                if (done % 10 === 0 || done === pendingTotal) {
                  sendProgress(
                    threadLabel(done),
                    SCAN_WEIGHT + (done / pendingTotal) * (1 - SCAN_WEIGHT)
                  );
                }
              }
            })
          );

          for (const hit of found) {
            if (!hit) continue;
            const prev = outboundAt.get(hit.contactId);
            if (!prev || new Date(hit.iso) > new Date(prev)) {
              outboundAt.set(hit.contactId, hit.iso);
            }
          }

          // Solo se emiten los contactos CON dato. Todo lo demás —contacto sin
          // conversación, o conversación fuera del horizonte— el cliente lo
          // trata como null, que es la cubeta más profunda. Es correcto por la
          // observación 2, no una aproximación.
          const activity = [...outboundAt.entries()].map(([contactId, lastOutboundAt]) => ({
            contactId,
            lastOutboundAt,
          }));

          sendProgress("Listo", 1);
          send({
            type: "data",
            activity,
            meta: {
              conversations: scanned,
              threadsOpened: pending.length,
              horizonDays: STALE_HORIZON_DAYS,
              fetchedAt: new Date().toISOString(),
            },
          });
          controller.close();
        } catch (err) {
          send({ type: "error", message: (err as Error).message });
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
