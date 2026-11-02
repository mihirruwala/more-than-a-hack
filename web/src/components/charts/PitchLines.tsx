/**
 * Decorative pitch drawing, in metres (105 × 68), for editorial sections. Purely illustrative:
 * it plots no data, so it is aria-hidden.
 */
export function PitchLines({ className }: { className?: string }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 0.35 } as const;
  return (
    <svg className={className} viewBox="-4 -4 113 76" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect x="0" y="0" width="105" height="68" {...stroke} />
      <line x1="52.5" y1="0" x2="52.5" y2="68" {...stroke} />
      <circle cx="52.5" cy="34" r="9.15" {...stroke} />
      <circle cx="52.5" cy="34" r="0.5" fill="currentColor" />
      {[0, 1].map((side) => {
        const flip = side === 1;
        const x = (depth: number) => (flip ? 105 - depth : 0);
        return (
          <g key={side}>
            <rect x={x(16.5)} y={13.85} width="16.5" height="40.3" {...stroke} />
            <rect x={x(5.5)} y={24.85} width="5.5" height="18.3" {...stroke} />
            <circle cx={flip ? 94 : 11} cy="34" r="0.45" fill="currentColor" />
            <path
              d={flip ? "M 88.5 26.7 A 9.15 9.15 0 0 0 88.5 41.3" : "M 16.5 26.7 A 9.15 9.15 0 0 1 16.5 41.3"}
              {...stroke}
            />
          </g>
        );
      })}
      {/* An illustrative passing move, drawn rather than measured. */}
      <path
        d="M 24 50 C 36 44, 40 30, 52.5 28 S 72 22, 80 31 S 88 40, 95 36"
        fill="none"
        stroke="var(--gold-400)"
        strokeWidth="0.5"
        strokeDasharray="1.4 1.2"
        opacity="0.9"
      />
      {[[24, 50], [52.5, 28], [80, 31]].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r="1.1" fill="var(--burgundy-500)" stroke="var(--cream-100)" strokeWidth="0.3" />
      ))}
      <circle cx="95" cy="36" r="0.9" fill="var(--cream-50)" />
    </svg>
  );
}
