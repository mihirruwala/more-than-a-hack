import { SectionLabel } from "../../components/ui";
import type { MatchFixture, MatchSegment, PitchChannel, PitchThird } from "../../types";
import s from "./match.module.css";

const L = 105;
const W = 68;
const THIRD: Record<PitchThird, number> = { defensive: 0, middle: 1, final: 2 };
const CHANNEL: Record<PitchChannel, number> = { left: 0, centre: 1, right: 2 };

/**
 * A proportioned pitch (105 × 68 m) showing where the selected possession was played. The zone is
 * synthetic: it comes from the demo fixture's generator, not from tracking. The home side attacks
 * right in the first half and left in the second; the away side, the opposite.
 */
export function PitchView({ fixture, segment }: { fixture: MatchFixture; segment: MatchSegment | undefined }) {
  const team = segment && (segment.state === "H" || segment.state === "A") ? segment.state : null;
  const attacksRight = team ? (team === "H") === (segment!.period === 1) : true;
  const zone = team && segment?.zone;

  // Facing right, the left channel is the top of the drawing; facing left, it is the bottom.
  const rect = zone
    ? (() => {
        const t = THIRD[zone.third];
        const c = CHANNEL[zone.channel];
        const col = attacksRight ? t : 2 - t;
        const row = attacksRight ? c : 2 - c;
        return { x: (col * L) / 3, y: (row * W) / 3, w: L / 3, h: W / 3 };
      })()
    : null;

  const line = { fill: "none", stroke: "currentColor", strokeWidth: 0.35 } as const;
  const teamLabel = team === "H" ? fixture.home.short : team === "A" ? fixture.away.short : null;

  return (
    <figure className={s.pitch} aria-labelledby="pitch-caption">
      <figcaption id="pitch-caption" className={s.pitchCaption}>
        <SectionLabel>Where it happened</SectionLabel>
        <span className={s.syntheticTag}>Synthetic zone · not tracking data</span>
      </figcaption>
      <svg viewBox={`-3 -3 ${L + 6} ${W + 6}`} className={s.pitchSvg} role="img" aria-label={pitchLabel(segment, zone, attacksRight, teamLabel)}>
        <rect x="-3" y="-3" width={L + 6} height={W + 6} fill="var(--pitch-bg)" />
        {[1, 2].map((i) => (
          <line key={`t${i}`} x1={(i * L) / 3} y1={0} x2={(i * L) / 3} y2={W} stroke="currentColor" strokeWidth={0.25} strokeDasharray="1 1.2" opacity={0.45} />
        ))}
        {[1, 2].map((i) => (
          <line key={`c${i}`} x1={0} y1={(i * W) / 3} x2={L} y2={(i * W) / 3} stroke="currentColor" strokeWidth={0.2} strokeDasharray="0.6 1.4" opacity={0.3} />
        ))}
        {rect && (
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} className={s.zone} data-team={team} />
        )}
        <g className={s.pitchLines}>
          <rect x="0" y="0" width={L} height={W} {...line} />
          <line x1={L / 2} y1="0" x2={L / 2} y2={W} {...line} />
          <circle cx={L / 2} cy={W / 2} r="9.15" {...line} />
          <circle cx={L / 2} cy={W / 2} r="0.45" fill="currentColor" />
          {[0, 1].map((side) => {
            const x = (depth: number) => (side ? L - depth : 0);
            return (
              <g key={side}>
                <rect x={x(16.5)} y={(W - 40.3) / 2} width="16.5" height="40.3" {...line} />
                <rect x={x(5.5)} y={(W - 18.32) / 2} width="5.5" height="18.32" {...line} />
                <rect x={side ? L : -2} y={(W - 7.32) / 2} width="2" height="7.32" {...line} />
                <circle cx={side ? L - 11 : 11} cy={W / 2} r="0.4" fill="currentColor" />
              </g>
            );
          })}
        </g>
        {team && (
          <g className={s.arrow} data-team={team} transform={`translate(${L / 2} ${W + 1.6})`}>
            <line x1={attacksRight ? -10 : 10} y1="0" x2={attacksRight ? 10 : -10} y2="0" strokeWidth="0.5" />
            <path d={attacksRight ? "M 10 0 l -2 -1.2 v 2.4 z" : "M -10 0 l 2 -1.2 v 2.4 z"} />
          </g>
        )}
      </svg>
      <p className={s.pitchNote}>
        {!segment
          ? "Select a possession to see where it was played."
          : !team
            ? segment.state === "D"
              ? "Dead ball: no possession, so no zone."
              : "No answer: the system abstained, so there is nothing to place."
            : zone
              ? `${teamLabel} attacking ${attacksRight ? "→ right" : "← left"}: mostly in the ${zone.third} third, ${zone.channel} channel.`
              : "No zone was generated for this segment."}
      </p>
    </figure>
  );
}

function pitchLabel(segment: MatchSegment | undefined, zone: MatchSegment["zone"] | null | undefined, right: boolean, team: string | null) {
  if (!segment || !zone || !team) return "Football pitch. No zone is highlighted.";
  return `Football pitch, synthetic zone: ${team} attacking ${right ? "right" : "left"}, ${zone.third} third, ${zone.channel} channel.`;
}
