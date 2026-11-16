// The dotted transfer orbit between the input planet and the output planets, drawn like a NASA trajectory diagram.
// While Compute runs, a red probe travels along it; once results are in, the arc turns solid white.
const ARC_PATH = "M 6 60 C 60 6, 140 6, 194 46";
// The arrowhead's two barbs, 12 units long at ±25° from the arc's end direction.
const ARROWHEAD_PATH = "M 188.3 35.5 L 194 46 L 182.2 43.6";

/** @param {{ status: "idle"|"computing"|"done"|"failed"|"stale" }} props */
export default function TransferArc({ status }) {
  return (
    <div className={`transfer-arc is-${status}`} aria-hidden="true">
      <svg viewBox="0 0 200 80">
        <path className="transfer-arc-path" d={ARC_PATH} />
        <path className="transfer-arc-head" d={ARROWHEAD_PATH} />
        {/* pathLength="100" lets the CSS move the probe in percent of the arc, whatever its drawn size. */}
        {status === "computing" && <path className="transfer-arc-probe" d={ARC_PATH} pathLength="100" />}
      </svg>
    </div>
  );
}
