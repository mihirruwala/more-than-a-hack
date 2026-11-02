import { useMemo, useRef, type Dispatch, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/controls";
import { clock, duration, isVisible, overlaps, periodOf, segmentAt, turnoverFrames, viewRange } from "../../lib/match";
import { focusWindow, type TimelineAction, type TimelineState } from "../../lib/timelineState";
import type { MatchFixture } from "../../types";
import { STATE_NAME } from "./stateText";
import s from "./match.module.css";

const pct = (value: number, start: number, span: number) => `${((value - start) / span) * 100}%`;

/**
 * Two linked tracks. The overview spans the whole view (one or both halves) and is for pointer
 * users; the focus track below it is a zoomed window whose segments are real buttons with roving
 * focus. Arrow keys step through visible segments, and the window follows.
 */
export function Timeline({ fixture, state, dispatch }: { fixture: MatchFixture; state: TimelineState; dispatch: Dispatch<TimelineAction> }) {
  const range = viewRange(fixture, state.filter);
  const view = focusWindow(fixture, state);
  const periods = state.filter.period === "all" ? fixture.periods : fixture.periods.filter((p) => p.id === state.filter.period);
  const turnovers = useMemo(() => turnoverFrames(fixture.segments), [fixture]);
  const focusRef = useRef<HTMLDivElement>(null);

  const inWindow = fixture.segments.filter((seg) => overlaps(seg, view));
  const tabTarget =
    (state.selected !== null && inWindow.find((seg) => seg.index === state.selected && isVisible(seg, state.filter))) ||
    inWindow.find((seg) => isVisible(seg, state.filter));

  const onTrackKey = (event: KeyboardEvent) => {
    const map: Record<string, TimelineAction> = {
      ArrowRight: { type: "step", dir: 1 },
      ArrowLeft: { type: "step", dir: -1 },
      Home: { type: "edge", edge: "first" },
      End: { type: "edge", edge: "last" },
      Escape: { type: "clearSelection" },
    };
    const action = map[event.key];
    if (!action) return;
    event.preventDefault();
    dispatch(action);
    // Keep keyboard focus on the newly selected segment once it renders.
    requestAnimationFrame(() => focusRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus());
  };

  const overviewClick = (event: MouseEvent<HTMLDivElement>, start: number, end: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const frame = start + ((event.clientX - rect.left) / rect.width) * (end - start);
    const hit = segmentAt(fixture.segments, frame);
    if (hit && isVisible(hit, state.filter)) dispatch({ type: "select", index: hit.index });
    else dispatch({ type: "focusFrame", frame });
  };

  const span = view.end - view.start;
  const tickEvery = state.zoom <= 4 ? 30 : state.zoom <= 8 ? 60 : 120; // seconds
  const ticks: number[] = [];
  for (let f = Math.ceil(view.start / (tickEvery * fixture.fps)) * tickEvery * fixture.fps; f <= view.end; f += tickEvery * fixture.fps) ticks.push(f);

  const hovered = state.hovered !== null ? fixture.segments[state.hovered] : undefined;

  return (
    <div className={s.timeline}>
      {/* -- overview ------------------------------------------------------------------- */}
      <div className={s.overview} aria-hidden="true">
        {periods.map((period, i) => {
          const pSpan = period.end - period.start;
          const wStart = Math.max(view.start, period.start);
          const wEnd = Math.min(view.end, period.end);
          return (
            <div key={period.id} className={s.overviewPeriod} style={{ flexGrow: pSpan }}>
              <span className={s.overviewLabel}>{period.label}</span>
              <div className={s.overviewTrack} onClick={(e) => overviewClick(e, period.start, period.end)}>
                {fixture.segments
                  .filter((seg) => seg.period === period.id)
                  .map((seg) => (
                    <span
                      key={seg.index}
                      className={`${s.ovSeg} ${s[`seg${seg.state}`]}`}
                      data-dim={!isVisible(seg, state.filter) || undefined}
                      data-selected={seg.index === state.selected || undefined}
                      style={{ left: pct(seg.start, period.start, pSpan), width: pct(seg.end, seg.start, pSpan) }}
                    />
                  ))}
                {wEnd > wStart && <span className={s.windowMark} style={{ left: pct(wStart, period.start, pSpan), width: pct(wEnd, wStart, pSpan) }} />}
              </div>
              {i < periods.length - 1 && <span className={s.halftime}>HT</span>}
            </div>
          );
        })}
      </div>

      {/* -- focus track ---------------------------------------------------------------- */}
      <div className={s.focusHead}>
        <span className="mono">
          {(() => {
            const p = fixture.periods.find((x) => view.start >= x.start && view.start < x.end) ?? fixture.periods[0]!;
            const q = fixture.periods.find((x) => view.end > x.start && view.end <= x.end) ?? p;
            return `${p.label} ${clock(view.start, p, fixture.fps)} – ${q === p ? "" : `${q.label} `}${clock(view.end, q, fixture.fps)}`;
          })()}
        </span>
        <div className={s.pan}>
          <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} aria-hidden="true" />} label="Pan earlier" disabled={view.start <= range.start} onClick={() => dispatch({ type: "pan", dir: -1 })} />
          <Button size="sm" variant="ghost" icon={<ChevronRight size={16} aria-hidden="true" />} label="Pan later" disabled={view.end >= range.end} onClick={() => dispatch({ type: "pan", dir: 1 })} />
        </div>
      </div>

      <div
        ref={focusRef}
        className={s.focusTrack}
        role="group"
        aria-label={`Possession segments, ${state.zoom}-minute window. Use the arrow keys to move between segments, Home and End to jump, Escape to clear.`}
        onKeyDown={onTrackKey}
        onMouseLeave={() => dispatch({ type: "hover", index: null })}
      >
        {inWindow.map((seg) => {
          const left = Math.max(seg.start, view.start);
          const right = Math.min(seg.end, view.end);
          const widthPct = ((right - left) / span) * 100;
          const visible = isVisible(seg, state.filter);
          const period = periodOf(fixture, seg);
          return (
            <button
              key={seg.index}
              type="button"
              className={`${s.focusSeg} ${s[`seg${seg.state}`]}`}
              style={{ left: pct(left, view.start, span), width: `${widthPct}%` }}
              data-dim={!visible || undefined}
              data-hover={seg.index === state.hovered || undefined}
              aria-pressed={seg.index === state.selected}
              tabIndex={tabTarget && seg.index === tabTarget.index ? 0 : -1}
              disabled={!visible}
              aria-label={`${STATE_NAME[seg.state]}, ${period.label} ${clock(seg.start, period, fixture.fps)} to ${clock(seg.end, period, fixture.fps)}, ${duration(seg.end - seg.start, fixture.fps)}`}
              onClick={() => dispatch({ type: "select", index: seg.index })}
              onMouseEnter={() => dispatch({ type: "hover", index: seg.index })}
              onFocus={() => dispatch({ type: "hover", index: seg.index })}
            >
              {widthPct > 3.2 && <span className={s.segLetter}>{seg.state}</span>}
              {widthPct > 9 && <span className={s.segDur}>{duration(seg.end - seg.start, fixture.fps)}</span>}
            </button>
          );
        })}
        {turnovers
          .filter((f) => f > view.start && f < view.end)
          .map((f) => (
            <span key={f} className={s.turnover} style={{ left: pct(f, view.start, span) }} aria-hidden="true" />
          ))}
        {fixture.periods.slice(1).map((p) =>
          p.start > view.start && p.start < view.end ? (
            <span key={p.id} className={s.periodLine} style={{ left: pct(p.start, view.start, span) }} aria-hidden="true">
              <span>HT</span>
            </span>
          ) : null,
        )}
      </div>

      <div className={s.focusAxis} aria-hidden="true">
        {ticks.map((f) => {
          const p = fixture.periods.find((x) => f >= x.start && f < x.end) ?? fixture.periods[fixture.periods.length - 1]!;
          return (
            <span key={f} style={{ left: pct(f, view.start, span) }}>
              {clock(f, p, fixture.fps)}
            </span>
          );
        })}
      </div>

      <p className={s.hoverLine} aria-hidden="true">
        {hovered ? (
          <>
            <span className={s[`key${hovered.state}`]} />
            <strong>{STATE_NAME[hovered.state]}</strong>
            <span className="mono">
              {clock(hovered.start, periodOf(fixture, hovered), fixture.fps)}–{clock(hovered.end, periodOf(fixture, hovered), fixture.fps)} · {duration(hovered.end - hovered.start, fixture.fps)}
            </span>
          </>
        ) : (
          <span>Hover or focus a segment to preview it. Click to select. Gold ticks mark open-play turnovers.</span>
        )}
      </p>
    </div>
  );
}

