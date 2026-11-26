import { useEffect, useRef } from "react";
import { LENSES, type LensId } from "../lib/lenses";

interface Props {
  active: LensId | null;
  onPick: (id: LensId) => void;
}

/** One-click answers to the questions a level designer actually asks. */
export default function QuestionBar({ active, onPick }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);

  // on narrow screens the chips scroll sideways: keep the active one visible
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>(".qchip.on");
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - 8, behavior: "smooth" });
    }
  }, [active]);

  return (
    <nav className="qbar" data-tour="questions" aria-label="Questions">
      <span className="qbar-label">Ask</span>
      <div className="qbar-chips" ref={rowRef}>
        {LENSES.map((l) => (
          <button key={l.id} className={`qchip ${active === l.id ? "on" : ""}`} onClick={() => onPick(l.id)} aria-pressed={active === l.id}>
            {l.chip}
          </button>
        ))}
      </div>
    </nav>
  );
}
