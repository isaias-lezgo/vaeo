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
  dimensiones se cruzan con **AND**: `{origen: ["Meta", "Google ADs"], canal:
  ["WhatsApp"]}` = "oportunidades de Meta o Google ADs que llegaron por WhatsApp".
- Una selección vacía en una dimensión significa **que esa dimensión no filtra**,
  no "ninguno".
- Una celda con dos valores (`"Meta, Sitio Web"`) **coincide si cualquiera** de sus
  valores está marcado. Es la misma regla de "cuenta en cada categoría que nombra"
  que ya aplica `buildCategoryBreakdown`; el registro genuinamente tiene los dos
  orígenes.
- **"Sin dato" es un valor seleccionable**, con una clave centinela propia
  (`NO_VALUE_KEY`). Es la fila de fuga de atribución, y poder aislarla es medio
  motivo del filtro.

## El menú lista la grafía cruda, sin agrupar

Esta es la decisión que separa al filtro de los charts, y es deliberada.

`buildCategoryBreakdown` colapsa `Walk In` / `WALK IN` / `walk-in` en un solo grupo
(vía `categoryKey()` y el mapa `KEY_ALIASES`) y lo dibuja con la grafía oficial del
picklist. Eso es correcto para un ranking, pero borra justo la señal que el dueño
del CRM necesita: **una grafía repetida es un error de captura que hay que corregir
en GHL**, y no puede corregir lo que no ve.

Así que el menú del filtro **no agrupa nada**. Lista cada grafía distinta tal como
está capturada —`Walk In 31`, `WALK IN 2`, `walk-in 1`— y la selección se guarda con
esa cadena verbatim. Lo mismo aplica a los alias mapeados a mano: `Inmobiliaria` e
`Inmobiliario` aparecen como dos opciones, y `Correo InfoVAEO` y `Correo Info VAEO`
también.

Lo único que se colapsa es el espacio en blanco de los extremos, que ya recorta
`categoryValuesOf`: `"Walk In"` y `"Walk In "` son la misma opción, porque esa
diferencia es invisible en pantalla y mostrarla como dos filas idénticas parecería
un bug del panel, no del dato.

**La normalización sí se usa, pero solo para ORDENAR y para marcar variantes** (ver
"Orden del menú" abajo). Nunca para fusionar opciones.

Y como se usa, tiene que ser **la misma** que la de los charts, no una copia: si el
filtro reimplementara el agrupamiento, `Inmobiliaria` e `Inmobiliario` podrían dejar
de quedar adyacentes en el menú el día que alguien toque un alias. Así que
`lib/opportunity-breakdown.ts` recibe dos cambios pequeños y aditivos:

1. **`normalizeCategoryKey(raw)` pasa a ser exportado** — es `categoryKey()` más el
   mapa privado `KEY_ALIASES`, que hoy están aplicados en línea dentro de
   `buildCategoryBreakdown`. Esa función pasa a usarlo también, así que no hay dos
   definiciones.
2. **`CategoryRow` gana un campo `key`** (la clave normalizada del grupo, y
   `NO_VALUE_KEY` en la fila "Sin dato"). Es lo que permite atar un grupo del menú a
   la fila que el chart dibuja, que es la aserción central de la verificación.

Ninguno de los dos cambia lo que los charts muestran hoy.

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

/**
 * Grafías crudas marcadas por dimensión, verbatim. Vacío = esa dimensión no
 * filtra. NO_VALUE_KEY representa "Sin dato".
 */
export interface CategorySelection {
  origen: string[]
  canal: string[]
}

export const EMPTY_CATEGORY_SELECTION: CategorySelection

/**
 * Centinela de "Sin dato": un byte nulo seguido de "sin-dato". Empieza con
 * un byte nulo para que ningún valor capturado por una persona pueda
 * colisionar con él.
 */
export const NO_VALUE_KEY: string

export interface CategoryOption {
  /** La grafía cruda, que es a la vez la clave y la etiqueta. */
  value: string
  count: number
  /**
   * Clave de agrupamiento, SOLO para ordenar y para marcar variantes en la UI.
   * Nunca fusiona opciones.
   */
  groupKey: string
  /** true si otra opción de la lista comparte su groupKey. */
  hasVariants: boolean
}

/** Las grafías de una oportunidad en esa dimensión; [NO_VALUE_KEY] si no trae nada. */
export function opportunityCategoryValues(
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

/** Una opción por grafía distinta, ya ordenada (ver "Orden del menú"). */
export function buildCategoryOptions(
  opps: Opportunity[],
  dimension: CategoryDimension
): CategoryOption[]
```

`applyCategoryFilter` con una selección vacía devuelve **el mismo arreglo**, no una
copia: es el estado por defecto y no debe invalidar los `useMemo` río abajo.

El emparejamiento es por cadena exacta ya recortada — la misma que produce
`categoryValuesOf`, así que una oportunidad siempre coincide con la opción que la
listó.

`lib/opportunity-breakdown.ts` sigue siendo el dueño de la agrupación y de las
etiquetas oficiales que usan los charts; `lib/category-filter.ts` es su contraparte
sin agrupar, para el filtro, y le pide prestada la normalización
(`normalizeCategoryKey`) únicamente para ordenar.

## Orden del menú

No agrupar crea un problema de lectura: si la lista se ordena solo por conteo,
`Walk In 31` queda arriba y `WALK IN 2` treinta filas abajo, y el error tipográfico
—que es justo lo que se quiere ver— se vuelve invisible.

Por eso el orden es **jerárquico, en dos niveles**:

1. Los grupos (por `normalizeCategoryKey`, es decir `categoryKey()` más los alias)
   se ordenan por su conteo **total** descendente.
2. Dentro de un grupo, las grafías se ordenan por su propio conteo descendente.

Resultado: las categorías grandes siguen arriba, y cada variante queda pegada a su
hermana canónica. `Walk In 31` / `WALK IN 2` / `walk-in 1` salen en filas
consecutivas, imposibles de no ver.

Los empates se rompen alfabéticamente (`localeCompare` en `es`) para que el orden
sea estable entre renders. "Sin dato" siempre va al final, igual que en los charts:
es una fuga de atribución, no una categoría que compita en el ranking.

Las opciones de un grupo con más de una grafía llevan `hasVariants: true`, que la
UI usa para marcarlas.

## UI: `components/dashboard/category-filter-menu.tsx`

Un componente, dos instancias.

**Props:** `dimension`, `options: CategoryOption[]`, `selected: string[]`,
`onChange(values: string[])`.

**Trigger.** Misma altura y tipografía que el resto de la barra (`h-7`,
`text-[11px]`, `border-border/50`, `bg-white/60 dark:bg-white/[0.06]`). Inactivo
lee `Origen de lead ▾`. Activo pasa a `variant="default"` —igual que el botón
"Personalizado" cuando lo está— y lee el valor si es uno solo (`Origen: Meta`) o
`Origen: 3 seleccionados` si son varios, más una ✕ que limpia sin abrir el menú
(`stopPropagation`).

**Contenido.** `Popover` con una lista de `Checkbox`: la grafía a la izquierda —
**verbatim, sin re-capitalizar ni normalizar en el render**, o el error volvería a
esconderse en el último paso— y el conteo a la derecha en `tabular-nums`. Buscador
siempre visible: al listar cada grafía, las opciones pasan de ~15 a bastantes más
por dimensión. La lista es un **div plano con `overflow-y-auto` y `max-h`, no un
`ScrollArea` de Radix** — rompe `truncate`, y etiquetas como "Referido de Asociado"
lo necesitan. El buscador compara sin acentos ni mayúsculas, para que escribir
`walk` encuentre las tres variantes.

**Marca de variante.** Las opciones con `hasVariants` se dibujan unidas por una
regla vertical sutil a la izquierda, y la primera del grupo lleva un ⚠ discreto con
tooltip: *"3 grafías distintas de este valor — probable error de captura en el
CRM"*. Es la razón de ser de todo el diseño sin agrupar; conviene que se lea como
señal, no como decoración.

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

- **Una grafía seleccionada que ya no aparece en la lista** (moviste las fechas, o
  cambiaste de pestaña y ese valor no existe en ese pipeline) se dibuja igual,
  fijada al final con conteo 0, para que se pueda desmarcar. Sin eso queda un
  filtro activo invisible que vacía el panel.
- **Los conteos del menú se cuentan por `createdAt`**, así que no cuadran con la
  tabla pivote ni con las barras de ventas, que miden por Fecha de Cierre. Son una
  ayuda de lectura del menú; los charts siguen siendo la fuente. Se deja así porque
  un conteo distinto por chart dentro del mismo menú confundiría más de lo que
  aclara.

## Interacción con los charts existentes

- Los charts `OrigenDeLeadChart` / `CanalDeContactoChart` **siguen agrupando las
  grafías** y no cambian: la lista sin agrupar vive solo en el menú del filtro. Un
  ranking partido en filas de 1–2 registros dejaría de responder "cuánto viene de
  Walk In", que es para lo que existe.
- Esos mismos charts **sí** obedecen el filtro global, incluso el de su propia
  dimensión: filtrar Origen = Meta deja ese chart con una sola barra. Es honesto y
  no se le añade lógica de auto-exclusión.
- Marcar una sola grafía (`WALK IN`) y ver que el chart la dibuja bajo la etiqueta
  oficial del grupo (`Walk In`) es correcto, no una inconsistencia: el menú habla
  de cómo está capturado el dato y el chart de qué significa.
- El switch local Canal/Origen de `LostReasonMatrix` es independiente del filtro
  global. El global recorta las oportunidades que la tabla ve; el local decide qué
  dimensión dibuja en las columnas.
- `periodLabel` —lo que la portada del PDF imprime como alcance del reporte— gana
  el sufijo del filtro: `Últimos 3 meses · Origen: Meta, Google ADs`. Un reporte
  que omite en silencio que está filtrado es un reporte que miente.

## Verificación

`scripts/verify-category-filter.ts`, corrido con `pnpm verify:category-filter`.

La aserción que importa, ahora que el menú no agrupa y los charts sí: **la unión de
las oportunidades que matchean todas las grafías de un grupo tiene que ser
exactamente el `oppIds` de la fila que ese grupo dibuja en el chart.** Es decir,
para cada fila de `buildCategoryBreakdown`, tomar las opciones de
`buildCategoryOptions` cuyo `groupKey` sea igual al `key` de la fila, filtrar por
todas ellas y comparar los ids con el `oppIds` de la fila.

Se compara como **conjunto de ids, no como suma de conteos**: una celda que repite
el mismo valor con dos grafías (`"Meta, meta"`) cuenta una vez en el chart —
`buildCategoryBreakdown` deduplica por clave— pero aparece en las dos opciones del
menú, así que la suma daría 2 y el conjunto da 1. La suma sería una aserción que
falla por una razón que no es un bug.

Esa aserción es la que garantiza que el menú, aunque muestre el dato partido, no
inventa ni pierde registros respecto de lo que el panel dibuja.

Más aserciones:

- OR dentro de una dimensión; AND entre las dos.
- Selección vacía = identidad (mismo arreglo, no una copia).
- Celda multi-valor (`"Meta, Sitio Web"`) coincide por cualquiera de sus valores.
- **No se agrupa:** `Walk In` y `WALK IN` son dos opciones distintas con sus propios
  conteos, y marcar una NO trae las oportunidades de la otra. Lo mismo con
  `Inmobiliaria` / `Inmobiliario`, que hoy están unidas por `KEY_ALIASES`.
- **Sí se recorta el espacio:** `"Walk In "` y `"Walk In"` son una sola opción.
- Orden: las grafías de un mismo grupo salen consecutivas, los grupos ordenados por
  su total descendente, y "Sin dato" al final.
- `hasVariants` es true exactamente para las opciones cuyo `groupKey` comparten con
  otra.
- "Sin dato" selecciona exactamente las oportunidades sin valor en esa dimensión, y
  su centinela no colisiona con ninguna grafía capturable.

Recordatorio del repo: este paquete es CommonJS, así que el script envuelve su
trabajo en un `main()` con `main().catch(...)` — el top-level `await` falla bajo
`tsx`.

Además, `npx tsc --noEmit` (el build ignora errores de TypeScript) y manejar el
panel real: marcar valores en los dos menús, mover fechas, cambiar de pestaña con
un filtro activo, y abrir un drill-down para confirmar que no aparece ningún
registro fuera del filtro.

## Cambios en la documentación

- `pnpm verify:breakdown` se vuelve a correr: `buildCategoryBreakdown` cambia por
  dentro (usa `normalizeCategoryKey` y emite `key`), aunque su salida visible no.
- `CLAUDE.md`: `lib/category-filter.ts` entra en la tabla de "Shared domain rules",
  anotado como **la contraparte sin agrupar** de `lib/opportunity-breakdown.ts` —
  para que nadie "arregle" la duplicación fusionando los dos módulos;
  `pnpm verify:category-filter` en la lista de scripts de verificación; y una
  entrada en "Key design decisions" describiéndolo como el tercer filtro global,
  aplicado en el mismo costurón que el de HubSpot y exento en el Asistente IA, con
  la razón de que el menú muestre las grafías sin agrupar.

## Fuera de alcance

- Filtrar contactos, pautas, citas o tareas.
- Filtrar por sucursal o por servicio (son otros campos; si se piden, reusan este
  mismo componente).
- Persistir la selección en la URL o en `localStorage`.
- Aplicar el filtro al Asistente IA.
- Cambiar cómo agrupan los charts de Origen/Canal o las columnas de la matriz de
  motivos de perdido. La visibilidad de las grafías vive en el menú del filtro.
- Corregir las grafías en GHL, o proponer correcciones desde el panel. El menú
  señala el problema; arreglarlo es trabajo en el CRM.
