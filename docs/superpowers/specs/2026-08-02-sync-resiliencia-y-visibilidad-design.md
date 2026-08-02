# Resiliencia y visibilidad del sync del dashboard

**Fecha:** 2026-08-02
**Ámbito:** `lib/ghl-client.ts` (paginación), `app/api/dashboard/route.ts` (frames del
stream), `hooks/fetch-stream.ts` + `hooks/use-dashboard-data.ts` (tipos de estado),
`components/dashboard/loading-screen.tsx`, `app/page.tsx` (banner de datos incompletos).

## El problema

Dos síntomas reportados que resultan ser el mismo defecto visto desde dos lados.

**1. El panel abrió con 0 oportunidades sin avisar de nada.** 14,078 contactos y 3,072
pautas cargados, oportunidades en cero. No es que la sub-cuenta tenga cero: el fetch
murió y no había forma de que el panel lo dijera.

**2. La pantalla de carga se congela sin explicación.** Los contadores se quedan quietos
(contactos 200, oportunidades 100, pautas 100) y el usuario no sabe si sigue trabajando o
ya se murió.

### Causa raíz de (1): `Promise.all` en el abanico de páginas

`getAllOpportunities` (`lib/ghl-client.ts:902`) pide la página 1, lee `meta.total`, y
dispara **todas las páginas restantes de golpe**:

```ts
const rest = await Promise.all(
  Array.from({ length: totalPages - 1 }, (_, i) =>
    getOpportunities({ page: i + 2, limit: pageSize }).then((r) => r.opportunities)
  )
);
```

Con ~14k oportunidades son ~140 peticiones concurrentes. `Promise.all` es todo o nada:
si *una* de las 140 agota sus 5 intentos en `ghlFetch`, la promesa completa se rechaza y
**se descartan las 139 páginas que sí llegaron**. El `.catch` de la ruta
(`app/api/dashboard/route.ts:465`) lo convierte en `[]` y emite
`sendStep("opportunities", "done", 0)`.

`getAllCustomObjectRecords` (pautas, `lib/ghl-client.ts:848`) tiene la misma estructura;
sobrevivió solo porque su abanico es de ~31 páginas en vez de ~140.

`getAllContacts` es un recorrido secuencial por cursor que **acumula**, por eso llegó
completo — pero si truena a mitad del `while`, la excepción se propaga y también pierde
todo lo acumulado. Mismo defecto, distinta forma.

### Causa raíz de (2): el stream solo habla cuando algo tiene éxito

- Solo se emite un frame `step` cuando **aterriza una página**. Durante un cooldown de
  429 (`note429` bloquea todas las peticiones de esa location) o durante el backoff
  exponencial de `ghlFetch` (1s → 2s → 4s → 8s, más jitter), no sale ni un frame. La
  pantalla se queda muerta decenas de segundos sin una sola señal.
- No hay tiempo transcurrido ni noción de "esto ya tardó demasiado".
- **`done` significa dos cosas.** `sendStep("opportunities", "done", 0)` tras un fallo es
  indistinguible de "efectivamente hay 0". Ese es el eslabón exacto por el que un fallo
  total llegó a renderizarse como un dataset vacío legítimo.

### Por qué muere una página (no confirmado — requiere logs)

El error solo queda en `console.error` del servidor, así que la causa concreta se
confirma leyendo los logs de `pnpm dev` / Vercel filtrando por `[GHL]`. Candidatos, en
orden de sospecha:

1. **Timeout de 30s en páginas profundas.** `GHL_REQUEST_TIMEOUT_MS = 30_000`.
   `/opportunities/search` pagina por número de página; la página 140 obliga a GHL a
   recorrer 14,000 registros. Encaja con que solo fallara el dataset de más páginas.
2. **Presupuesto de rate-limit agotado.** El sync completo son ~300+ peticiones contra
   ~100 req/10s. `noteRateLimitHeaders` mete cooldown cada vez que
   `x-ratelimit-remaining <= 2`. Con otro consumidor del mismo token (MCP de GHL, Make,
   automatizaciones de la sub-cuenta) los 429 se apilan.
3. **`401 Command timed out`** del gateway de GHL agotando sus reintentos.
4. **Un status que no se reintenta** — 400/403/422 lanzan al primer intento
   (`lib/ghl-client.ts:164`), matando las 140 al instante.

**Este diseño no depende de cuál sea.** Con paginación tolerante, cualquiera de los
cuatro cuesta una página de 100 registros, no las 14,000. Ajustar el timeout o el ritmo
del limiter queda fuera de alcance hasta tener el log que identifique la causa.

## Diseño

### Capa 1 — Paginación tolerante a fallos (`lib/ghl-client.ts`)

Se introduce un tipo de resultado compartido para los tres recorridos paginados:

```ts
export interface PagedResult<T> {
  records: T[];
  /** Total que GHL reportó, si lo reportó. */
  total?: number;
  /** Páginas (o tramos del cursor) que no se pudieron traer tras el reintento. */
  missingPages: number[];
  /** Registros que se estiman perdidos: missingPages.length * pageSize, acotado a total. */
  missingEstimate: number;
}
```

**`getAllOpportunities` y `getAllCustomObjectRecords`:**

1. Página 1 igual que hoy. Si falla, se propaga (no hay nada que salvar).
2. El resto pasa de `Promise.all` a `Promise.allSettled`. Se absorben las cumplidas y se
   guardan los números de página de las rechazadas.
3. **Reintento por página, una vez.** Si hubo rechazos, se espera
   `RATE_LIMIT_INTERVAL_MS` (10s, el ancho de la ventana de GHL — deja que el cooldown
   expire y el bucket se rellene) y se reintentan **solo esas páginas**, otra vez con
   `allSettled`. Esto es el "reintentar automáticamente" aplicado al nivel más barato:
   1 página de 140, no las 140.
4. Devuelven `PagedResult`. Las que sigan fallando quedan en `missingPages`.

**`getAllContacts`:** el `while` se envuelve en try/catch. Al fallar una página, se rompe
el bucle, se conserva todo lo acumulado y se marca como parcial usando `total` (que ya se
captura de `meta.total`) para estimar lo perdido. No se reintenta el cursor: al no saber
la posición exacta de lo que falta, un reintento traería duplicados o un tramo arbitrario;
más honesto es reportarlo incompleto.

`searchLocationTasks` no cambia: pagina secuencialmente con `CAP = 500` por rama y ya
degrada bien.

**Sitios que llaman a estas funciones.** El radio de impacto es chico — fuera de
`lib/ghl-client.ts` solo hay dos llamantes:

- `app/api/dashboard/route.ts` (líneas 233, 460, 470) — se actualiza a `.records` y usa
  `missingPages` para decidir `done` vs `partial`.
- `scripts/diag-otro-pauta.ts:18` — script de diagnóstico; se actualiza a `.records`.

`fetchAllPautas` (`app/api/dashboard/route.ts:219`) envuelve a
`getAllCustomObjectRecords` y hoy devuelve `Pauta[]`. Pasa a devolver
`{ pautas, missingPages, missingEstimate }` para no tragarse la señal de parcialidad que
acaba de ganar la capa de abajo. Su `catch` actual, que devuelve `[]`, pasa a devolver un
resultado marcado como error.

### Capa 2 — El stream deja de mentir (`app/api/dashboard/route.ts`)

`sendStep` gana estados. `StepStatus` pasa de `loading | done` a:

| Estado | Significado |
|---|---|
| `pending` | aún no arranca (solo lado cliente) |
| `loading` | trayendo datos |
| `retrying` | falló algo y se está reintentando |
| `done` | completo y correcto |
| `partial` | trajo datos pero se sabe que faltan (`missingPages` no vacío) |
| `error` | no trajo nada |

**Reintento a nivel dataset.** Si tras la capa 1 un dataset quedó en cero registros
(falló hasta la página 1), la ruta lo reintenta **una vez completo**, emitiendo
`sendStep(key, "retrying")` antes. Ocurre dentro del mismo stream NDJSON, antes de mandar
el frame `data`, así que **no hace falta ningún endpoint nuevo**. Si el reintento
tampoco trae nada, el paso queda en `error`.

**Heartbeat.** Un `setInterval` de 5s dentro del `withClient` emite
`{ type: "heartbeat", elapsedMs }` mientras el sync sigue vivo. Es lo que le da al cliente
señal de vida durante los cooldowns, en los que hoy no sale absolutamente nada. Se limpia
en el `finally` junto al `controller.close()`.

**Warnings en el payload.** El frame `data` lleva:

```ts
warnings: Array<{
  key: StepKey;
  kind: "partial" | "error";
  loaded: number;
  expected?: number;
}>
```

### Capa 3 — La UI reporta con honestidad

**`hooks/fetch-stream.ts`** — `StreamStep.status` se amplía al nuevo union; se maneja el
frame `heartbeat` con un callback `onHeartbeat` opcional.

**`hooks/use-dashboard-data.ts`** — `StepState.status` se amplía igual. Se expone
`elapsedMs` (del heartbeat) y `stalled: boolean`, calculado en el cliente: `true` cuando
han pasado >15s desde el último frame `step`. El heartbeat sigue llegando durante un
cooldown, así que `stalled` distingue "el servidor está vivo pero atorado esperando a
GHL" de "la conexión se cayó" — sin heartbeat *y* sin steps es lo segundo.

**`components/dashboard/loading-screen.tsx`**

- Fila en ámbar con la etiqueta "reintentando…" para `retrying`; en ámbar con "parcial"
  para `partial`; en rojo con "error" para `error`. Los tres estados terminales cuentan
  para el porcentaje de la barra (el sync sí avanzó), pero el ícono no es la palomita.
- Tiempo transcurrido junto al porcentaje (`m:ss`).
- Cuando `stalled`, se sustituye la línea de progreso por
  **"GHL está limitando las solicitudes — esto puede tardar unos minutos"**. Éste es
  exactamente el hueco de la primera captura: contadores congelados sin ninguna señal.

**`app/page.tsx`** — banner ámbar bajo el header cuando `data.warnings` no viene vacío.
Nombra el dataset y las consecuencias, p. ej. *"No se pudieron cargar las oportunidades.
Las gráficas de ventas están vacías o incompletas."* Para `partial` incluye los números:
*"Se cargaron 13,900 de ~14,078 oportunidades."* Botón **Reintentar** cableado al
`refresh()` que ya existe. El banner es descartable dentro de la sesión pero reaparece en
cada sync que vuelva a producir warnings.

## Manejo de errores

- Un dataset en `error` **no bloquea el panel**: se entra con lo que sí cargó. Se
  descartó bloquear porque el resto de la información sigue siendo útil, y el banner
  elimina el riesgo real, que era confundir un fallo con un cero legítimo.
- El `.catch` por dataset de la ruta se conserva: un dataset caído nunca tumba el sync
  completo. Lo que cambia es que ahora emite `error` en vez de `done, 0`.
- Los `console.error` existentes se mantienen — son la única traza de la causa
  subyacente. Se añade el número de página a los mensajes de páginas fallidas para que el
  log diga *cuál* falló, no solo que algo falló.

## Verificación

No hay framework de tests en el repo. Este cambio toca `lib/ghl-client.ts`, que no tiene
script `verify-*`, así que:

- `npx tsc --noEmit` — obligatorio. `next build` ignora errores de TS, y este cambio
  modifica tipos de retorno usados en varios sitios, que es justo donde un error de tipos
  se escaparía sin ser visto.
- `pnpm verify:limiter` — se toca el timing alrededor del limiter (la pausa del reintento
  usa `RATE_LIMIT_INTERVAL_MS`).
- Manejo real de la app contra la sub-cuenta de VAEO, que es donde el fallo se reproduce:
  confirmar que las oportunidades ahora llegan (o llegan parciales con banner), y leer el
  log `[GHL]` para identificar por fin cuál de los cuatro candidatos es la causa.
- Simulación de fallo forzando un rechazo en una página concreta del abanico, para
  comprobar que se reintenta, que sale `partial` y que aparece el banner con los números.

## Fuera de alcance

- Ajustar `GHL_REQUEST_TIMEOUT_MS` o el ritmo del limiter — sin el log que identifique la
  causa, sería adivinar.
- Cambiar `/opportunities/search` a paginación por cursor para evitar los offsets
  profundos. Es la solución de fondo si el candidato 1 se confirma, pero es un cambio
  mayor y depende de que GHL lo soporte en ese endpoint.
- Cachear o persistir el resultado del sync entre recargas.
