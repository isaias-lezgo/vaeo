"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { fetchStream } from "./fetch-stream";

interface ActivityPayload {
  activity: Array<{ contactId: string; lastOutboundAt: string | null }>;
  meta: {
    conversations: number;
    threadsOpened: number;
    horizonDays: number;
    fetchedAt: string;
  };
}

/**
 * "loading" y "error" NO son lo mismo que un mapa vacío, y por eso el estado
 * viaja aparte del dato: con el mapa vacío la matriz de abandono manda TODAS
 * las oportunidades a la columna "+60 d" y afirma un abandono total. Es el peor
 * modo de fallo posible —alarmante, verosímil y falso— así que el componente
 * no debe pintar la matriz hasta ver "ready".
 */
export type ActivityStatus = "loading" | "ready" | "error";

/**
 * Lo que la tarjeta necesita para pintar una barra determinada mientras la
 * ruta trabaja. `pct` es 0–1 y puede faltar (un frame de texto suelto), en cuyo
 * caso quien pinte debe conservar el último valor conocido en vez de volver a
 * cero.
 */
export interface ActivityProgress {
  message: string;
  pct: number;
}

/**
 * Carga /api/conversation-activity al montar, independiente del sync principal,
 * igual que useConversationsData: el panel pinta primero y la actividad entra
 * después.
 */
export function useConversationActivity() {
  const [activity, setActivity] = useState<Map<string, string | null>>(new Map());
  const [status, setStatus] = useState<ActivityStatus>("loading");
  const [progress, setProgress] = useState<ActivityProgress>({
    message: "Cargando actividad de conversaciones…",
    pct: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus("loading");
    setProgress({ message: "Cargando actividad de conversaciones…", pct: 0 });

    try {
      const result = await fetchStream<ActivityPayload>(
        "/api/conversation-activity",
        (message, pct) =>
          // Un frame sin `pct` NO es 0%: conserva el último avance conocido.
          // Mandar la barra al inicio a media carga es peor que no tenerla.
          setProgress((prev) => ({ message, pct: pct ?? prev.pct })),
        ctrl.signal
      );
      setActivity(new Map(result.activity.map((a) => [a.contactId, a.lastOutboundAt])));
      setStatus("ready");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setActivity(new Map());
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  return { activity, status, progress, refresh };
}
