import type { GameEvent } from "../lib/types";
import { clock } from "../lib/format";
import { COLORS } from "../lib/style";
import { IconPause, IconPlay, IconRestart } from "./Icons";

interface Props {
  time: number;
  max: number;
  playing: boolean;
  speed: number;
  singleMatch: boolean;
  ticks: GameEvent[]; // combat events to mark on the track
  onTime: (t: number) => void;
  onPlay: () => void;
  onSpeed: (s: number) => void;
}

const SPEEDS = [1, 5, 10, 30];

export default function Timeline({ time, max, playing, speed, singleMatch, ticks, onTime, onPlay, onSpeed }: Props) {
  const pct = (t: number) => (max ? (t / max) * 100 : 0);
  const atEnd = time >= max;
  return (
    <div className="timeline" data-tour="timeline">
      <button className="play" onClick={onPlay} aria-label={playing ? "Pause" : atEnd ? "Replay" : "Play"} title={playing ? "Pause" : "Play"}>
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      <div className="tl-main">
        <div className="tl-labels">
          <span className="tl-time">
            <b>{clock(time)}</b> / {clock(max)}
          </span>
          <span className="tl-caption">
            {singleMatch ? "Match time" : "Time since each match started · all matches lined up"}
          </span>
          {time < max && !playing && (
            <button className="link" onClick={() => onTime(max)}>
              Show full match
            </button>
          )}
        </div>
        <div className="tl-track" style={{ ["--pct" as string]: `${pct(Math.min(time, max))}%` }}>
          <div className="tl-ticks">
            {ticks.map((e, i) => (
              <span key={i} className="tick" style={{ left: `${pct(e.t)}%`, background: COLORS[e.cat] }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={Math.min(time, max)}
            onChange={(e) => onTime(Number(e.target.value))}
            aria-label="Timeline"
          />
        </div>
      </div>
      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button key={s} className={s === speed ? "on" : ""} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
        <button onClick={() => onTime(0)} title="Back to start" aria-label="Back to start" className="restart">
          <IconRestart size={14} />
        </button>
      </div>
    </div>
  );
}
