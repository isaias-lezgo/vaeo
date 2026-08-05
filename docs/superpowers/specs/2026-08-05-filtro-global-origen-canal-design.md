# Filtro global por Origen de Lead / Canal de Contacto

**Fecha:** 2026-08-05
**Estado:** diseño aprobado, pendiente de implementar

## Problema

La barra de filtros solo permite recortar el panel por fecha y por el toggle de
importación de HubSpot. No hay forma de preguntar "¿cómo se ve el embudo para los
leads de Meta?" o "¿qué pasa con lo que entra por WhatsApp?" sin leer un chart de
categorías y adivinar cómo se traduce al resto del panel.

Los dos conceptos ya existen como campos de la **oportunidad** y ya tienen una
agregación canónica en `lib/opportunity-breakdown.ts` (`ORIGEN_FIELDS`,
`CANAL_FIELDS`, `buildCategoryBreakdown`). Lo que falta es poder usarlos como
recorte del panel completo, no solo como eje de dos gráficos.

## Alcance

Un filtro global más, al lado de fecha e importación HubSpot, con dos menús
desplegables independientes: **Origen de lead** y **Canal de contacto**. Aplica a
los paneles VAEO y MESH. La pestaña Asistente IA queda exenta, igual que los otros
dos filtros globales.

## Semántica

- Dentro de una dimensión, los valores marcados se unen con **OR**. Entre las dos
  dimensiones se cruzan con **AND**: `{origen: [meta, google ads], canal:
  [whatsapp]}` = "oportunidades de Meta o Google ADs que llegaron por WhatsApp".
- Una selección vacía en una dimensión significa **que esa dimensión no filtra**,
  no "ninguno".
- Una celda con dos valores (`"Meta, Sitio Web"`) **coincide si cualquiera** de sus
  valores está marcado. Es la misma regla de "cuenta en cada categoría que nombra"
  que ya aplica `buildCategoryBreakdown`; el registro genuinamente tiene los dos
  orígenes.
- **"Sin dato" es un valor seleccionable**, con clave propia (`NO_VALUE_KEY`). Es
  la fila de fuga de atribución, y poder aislarla es medio motivo del filtro.

## La selección se guarda por clave normalizada, no por etiqueta

`buildCategoryBreakdown` ya colapsa `Walk-in` / `Walk In` y `Inmobiliaria` /
`Inmobiliario` en un solo grupo, vía `categoryKey()` más el mapa privado
`KEY_ALIASES`. Si el filtro comparara por etiqueta, o re-normalizara por su cuenta,
las dos definiciones podrían separarse y el menú diría un número distinto del que
dibuja el chart — exactamente la clase de bug por la que existen los módulos
compartidos de `lib/`.

Por eso:

1. Se extrae ese par (`categoryKey` + `KEY_ALIASES`) a un
   **`normalizeCategoryKey(raw)`** exportado desde `lib/opportunity-breakdown.ts`,
   y `buildCategoryBreakdown` pasa a usarlo también.
2. **`CategoryRow` gana un campo `key`**, con `NO_VALUE_KEY` en la fila "Sin dato".

Con eso, las opciones del menú son literalmente las filas del chart: misma
etiqueta, mismo conteo, misma agrupación.

## Punto de aplicación

El mismo costurón que el filtro de HubSpot, en `app/page.tsx`: sobre el set de
oportunidades **antes** del filtro de fechas.

```
data.opportunities
  → applyHubspotFilter(…, includeHubspot)
  → applyCategoryFilter(…, categoryFilter)   ← nuevo
  → scopedOpportunities                       (= prop allOpportunities)
  → filterByDateRange(…, createdAt, dateRange) (= prop opportunities)
```

Aplicarlo ahí y no en cada chart tiene dos consecuencias que son el punto:

- Lo heredan `opportunities` y `allOpportunities` a la vez, así que también lo
  obedecen la tabla pivote y las barras de ventas, que filtran `allOpportunities`
  por Fecha de Cierre por su cuenta.
- Ningún drill-down puede sacar un registro que los charts excluyeron, porque el
  set de lookup ya viene recortado.

**Qué no se filtra:** contactos, pautas, citas y tareas. Hoy solo se usan como
tabla de join en los drawers; recortarlos rompería precisamente esos joins sin
cambiar ningún agregado, ya que todos los charts actuales agregan por oportunidad.

## Módulo nuevo: `lib/category-filter.ts`

Puro, sin React, para que `scripts/verify-category-filter.ts` lo pueda aseverar.

```ts
export type CategoryDimension = "origen" | "canal"

export const CATEGORY_DIMENSIONS: Record<
  CategoryDimension,
  { label: string; fields: string[] }
>
// origen → { label: "Origen de lead", fields: ORIGEN_FIELDS }
// canal  → { label: "Canal de contacto", fields: CANAL_FIELDS }

/** Claves normalizadas marcadas por dimensión. Vacío = esa dimensión no filtra. */
export interface CategorySelection {
  origen: string[]
  canal: string[]
}

export const EMPTY_CATEGORY_SELECTION: CategorySelection

export interface CategoryOption {
  key: string
  label: string
  count: number
}

/** Las claves de una oportunidad en esa dimensión; [NO_VALUE_KEY] si no trae nada. */
export function opportunityCategoryKeys(
  opp: Opportunity,
  dimension: CategoryDimension
): string[]

export function matchesCategorySelection(
  opp: Opportunity,
  selection: CategorySelection
): boolean

export function applyCategoryFilter(
  opps: Opportunity[],
  selection: CategorySelection
): Opportunity[]

export function isEmptySelection(selection: CategorySelection): boolean

/** Opciones del menú: las filas de buildCategoryBreakdown, sin el pct. */
export function buildCategoryOptions(
  opps: Opportunity[],
  dimension: CategoryDimension
): CategoryOption[]
```

`applyCategoryFilter` con una selección vacía devuelve **el mismo arreglo**, no una
copia: es el estado por defecto y no debe invalidar los `useMemo` río abajo.

`lib/opportunity-breakdown.ts` sigue siendo el dueño de la normalización y de las
etiquetas; `lib/category-filter.ts` solo añade el mapeo dimensión → campos, la
forma de la selección y el emparejamiento.

## UI: `components/dashboard/category-filter-menu.tsx`

Un componente, dos instancias.

**Props:** `dimension`, `options: CategoryOption[]`, `selected: string[]`,
`onChange(keys: string[])`.

**Trigger.** Misma altura y tipografía que el resto de la barra (`h-7`,
`text-[11px]`, `border-border/50`, `bg-white/60 dark:bg-white/[0.06]`). Inactivo
lee `Origen de lead ▾`. Activo pasa a `variant="default"` —igual que el botón
"Personalizado" cuando lo está— y lee el valor si es uno solo (`Origen: Meta`) o
`Origen: 3 seleccionados` si son varios, más una ✕ que limpia sin abrir el menú
(`stopPropagation`).

**Contenido.** `Popover` con una lista de `Checkbox`: etiqueta a la izquierda,
conteo a la derecha en `tabular-nums`. Buscador solo cuando hay más de 10 opciones
(hoy son ~15 por dimensión). La lista es un **div plano con `overflow-y-auto` y
`max-h`, no un `ScrollArea` de Radix** — rompe `truncate`, y etiquetas como
"Referido de Asociado" lo necesitan.

**Se aplica al instante**, sin botón "Aplicar": todo es cliente y el usuario ve el
panel reaccionar. El pie solo lleva "Limpiar", deshabilitado si no hay nada
marcado.

**Estado vacío:** "Sin valores en este periodo".

**Ubicación:** los dos menús van en el flujo principal de la barra, después del
botón "Personalizado". El toggle de HubSpot se queda a la derecha con su `ml-auto`.

## De dónde salen las opciones

Se calculan en `app/page.tsx` sobre las oportunidades del **panel activo**
(`scopeOpportunities(…, activeTab, pipelines)`), ya pasadas por el filtro de
HubSpot y por el rango de fechas, pero **sin aplicar ninguna de las dos selecciones
de categoría**. Sin esa exclusión, marcar "Meta" borraría del menú todo lo demás y
el filtro sería un callejón sin salida.

Que las opciones salgan del panel activo implica que VAEO y MESH ven listas
distintas y que la selección **persiste al cambiar de pestaña**, aunque el valor no
exista en el otro pipeline. Es lo correcto: el filtro es una pregunta del usuario,
no una propiedad del panel, y borrarlo en silencio al cambiar de tab sería peor que
mostrar un panel vacío con el filtro a la vista.

Dos consecuencias aceptadas explícitamente:

- **Una clave seleccionada que ya no aparece en la lista** (moviste las fechas, o
  cambiaste de pestaña y ese valor no existe en ese pipeline) se dibuja igual,
  fijada al final con conteo 0, para que se pueda desmarcar. Sin eso queda un
  filtro activo invisible que vacía el panel.
- **Los conteos del menú se cuentan por `createdAt`**, así que no cuadran con la
  tabla pivote ni con las barras de ventas, que miden por Fecha de Cierre. Son una
  ayuda de lectura del menú; los charts siguen siendo la fuente. Se deja así porque
  un conteo distinto por chart dentro del mismo menú confundiría más de lo que
  aclara.

## Interacción con los charts existentes

- Los charts `OrigenDeLeadChart` / `CanalDeContactoChart` **sí** obedecen el filtro
  global, incluso el de su propia dimensión: filtrar Origen = Meta deja ese chart
  con una sola barra. Es honesto y no se le añade lógica de auto-exclusión.
- El switch local Canal/Origen de `LostReasonMatrix` es independiente del filtro
  global. El global recorta las oportunidades que la tabla ve; el local decide qué
  dimensión dibuja en las columnas.
- `periodLabel` —lo que la portada del PDF imprime como alcance del reporte— gana
  el sufijo del filtro: `Últimos 3 meses · Origen: Meta, Google ADs`. Un reporte
  que omite en silencio que está filtrado es un reporte que miente.

## Verificación

`scripts/verify-category-filter.ts`, corrido con `pnpm verify:category-filter`.

La aserción que importa: para **cada fila** que devuelve `buildCategoryBreakdown`
sobre un set dado, filtrar ese set por la `key` de la fila debe dejar exactamente
`row.count` oportunidades. Eso ata el conteo que muestra el menú a lo que el panel
enseña después de aplicar el filtro, que es la única forma de que las dos
definiciones no se separen con el tiempo.

Más aserciones:

- OR dentro de una dimensión; AND entre las dos.
- Selección vacía = identidad (mismo arreglo, no una copia).
- Celda multi-valor (`"Meta, Sitio Web"`) coincide por cualquiera de sus valores.
- Normalización: `Walk-in` y `Walk In` caen en la misma clave; `Inmobiliaria`
  coincide con la selección `inmobiliario` vía alias.
- "Sin dato" selecciona exactamente las oportunidades sin valor en esa dimensión.
- `buildCategoryOptions` no devuelve claves duplicadas y deja "Sin dato" al final.

Recordatorio del repo: este paquete es CommonJS, así que el script envuelve su
trabajo en un `main()` con `main().catch(...)` — el top-level `await` falla bajo
`tsx`.

Además, `npx tsc --noEmit` (el build ignora errores de TypeScript) y manejar el
panel real: marcar valores en los dos menús, mover fechas, cambiar de pestaña con
un filtro activo, y abrir un drill-down para confirmar que no aparece ningún
registro fuera del filtro.

## Cambios en la documentación

- `CLAUDE.md`: `lib/category-filter.ts` entra en la tabla de "Shared domain rules";
  `pnpm verify:category-filter` en la lista de scripts de verificación; y una
  entrada en "Key design decisions" describiéndolo como el tercer filtro global,
  aplicado en el mismo costurón que el de HubSpot y exento en el Asistente IA.

## Fuera de alcance

- Filtrar contactos, pautas, citas o tareas.
- Filtrar por sucursal o por servicio (son otros campos; si se piden, reusan este
  mismo componente).
- Persistir la selección en la URL o en `localStorage`.
- Aplicar el filtro al Asistente IA.
