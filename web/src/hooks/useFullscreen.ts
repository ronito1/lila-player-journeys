import { useCallback, useEffect, useState } from "react";

/**
 * Full screen = only the map and the timeline. Uses the browser's real full-screen mode where it
 * exists (desktop, Android); on iPhone, which doesn't allow it for web pages, the page hides
 * everything else itself, which looks the same. Esc always exits.
 */
export function useFullscreen(): [boolean, () => void] {
  const [on, setOn] = useState(false);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    const el = document.documentElement;
    if (next && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [on]);

  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setOn(false); // Esc in native full screen
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOn(false);
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return [on, toggle];
}
