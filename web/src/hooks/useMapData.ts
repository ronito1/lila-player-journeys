import { useCallback, useEffect, useState } from "react";
import { forgetMap, loadMap, prefetchMaps, type FlatMap } from "../lib/data";
import type { DataIndex } from "../lib/types";

const SLOW_AFTER_MS = 6000;

/**
 * Loads the selected map's data. Answers for a map the user has already left are ignored, a slow
 * load is flagged so the UI can offer Retry, and after the first map arrives the others are
 * downloaded in the background so switching maps is instant.
 */
export function useMapData(index: DataIndex | null, mapId: string) {
  const [mapData, setMapData] = useState<FlatMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!index || !index.maps.some((m) => m.id === mapId)) return;
    let current = true;
    setMapData(null);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => current && setSlow(true), SLOW_AFTER_MS);
    loadMap(mapId, index.eventCategories)
      .then((d) => current && setMapData(d))
      .catch((e: Error) => current && setError(e.message))
      .finally(() => clearTimeout(slowTimer));
    return () => {
      current = false;
      clearTimeout(slowTimer);
    };
  }, [index, mapId, attempt]);

  const loaded = mapData !== null;
  const [prefetched, setPrefetched] = useState(false);
  useEffect(() => {
    if (!index || !loaded || prefetched) return;
    setPrefetched(true);
    prefetchMaps(index.maps.map((m) => m.id).filter((id) => id !== mapId), index.eventCategories);
  }, [index, loaded, prefetched, mapId]);

  const retry = useCallback(() => {
    forgetMap(mapId);
    setAttempt((a) => a + 1);
  }, [mapId]);

  return { mapData, error, slow, retry };
}
