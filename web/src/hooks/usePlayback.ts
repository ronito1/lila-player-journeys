import { useCallback, useEffect, useState } from "react";

/**
 * The playback clock, in seconds since match start. `Infinity` means "show everything" (the default
 * when nothing is playing), so the returned `t` is always clamped to the selection's length.
 */
export function usePlayback(maxTime: number) {
  const [time, setTime] = useState(Infinity);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((cur) => {
        const next = Math.min(cur, maxTime) + dt * speed;
        if (next >= maxTime) {
          setPlaying(false);
          return Infinity;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, maxTime]);

  const t = Math.min(time, maxTime);

  const togglePlay = () => {
    if (!playing && t >= maxTime) setTime(0); // at the end: replay from the start
    setPlaying((p) => !p);
  };
  /** Jump to a time and pause; jumping to the end shows the whole match. */
  const seek = useCallback(
    (v: number) => {
      setPlaying(false);
      setTime(v >= maxTime ? Infinity : v);
    },
    [maxTime],
  );
  /** Stop and show everything (used when the selection changes). */
  const reset = useCallback(() => {
    setPlaying(false);
    setTime(Infinity);
  }, []);
  const playFromStart = useCallback(() => {
    setTime(0);
    setPlaying(true);
  }, []);

  return { t, playing, speed, setSpeed, togglePlay, seek, reset, playFromStart };
}
