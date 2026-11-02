import type { Dispatch } from "react";
import { ChevronLeft, ChevronRight, X as Close } from "lucide-react";
import { SectionLabel } from "../../components/ui";
import { Button, Notice } from "../../components/ui/controls";
import { clock, duration, isVisible, periodOf, step } from "../../lib/match";
import type { TimelineAction, TimelineState } from "../../lib/timelineState";
import type { MatchFixture } from "../../types";
import { STATE_MEANING, STATE_NAME, teamName } from "./stateText";
import s from "./match.module.css";

/** Everything here is read from the selected segment of the fixture: nothing is typed in per view. */
export function SegmentPanel({ fixture, state, dispatch }: { fixture: MatchFixture; state: TimelineState; dispatch: Dispatch<TimelineAction> }) {
  const segment = state.selected !== null ? fixture.segments[state.selected] : undefined;
  const hasPrev = !!step(fixture, state.filter, state.selected, -1);
  const hasNext = !!step(fixture, state.filter, state.selected, 1);

  const nav = (
    <div className={s.panelNav}>
      <Button size="sm" icon={<ChevronLeft size={15} aria-hidden="true" />} disabled={!hasPrev} onClick={() => dispatch({ type: "step", dir: -1 })}>
        Previous
      </Button>
      <Button size="sm" disabled={!hasNext} onClick={() => dispatch({ type: "step", dir: 1 })}>
        Next <ChevronRight size={15} aria-hidden="true" />
      </Button>
    </div>
  );

  if (!segment) {
    return (
      <section className={s.segmentPanel} aria-labelledby="segment-title" aria-live="polite">
        <SectionLabel>Selected segment</SectionLabel>
        <h2 id="segment-title" className={`display ${s.segmentEmptyTitle}`}>
          Nothing selected
        </h2>
        <p className={s.segmentEmpty}>
          Select a segment on the timeline, or start from the first one. On the focus track, the arrow keys step through segments, and Escape clears the selection.
        </p>
        {nav}
      </section>
    );
  }

  const period = periodOf(fixture, segment);
  const visible = isVisible(segment, state.filter);
  const team = teamName(fixture, segment.state);
  const inPeriod = fixture.segments.filter((x) => x.period === segment.period);

  return (
    <section className={s.segmentPanel} data-state={segment.state} aria-labelledby="segment-title" aria-live="polite">
      <div className={s.segmentTop}>
        <SectionLabel>
          Segment {segment.index + 1} of {fixture.segments.length}
        </SectionLabel>
        <Button size="sm" variant="ghost" icon={<Close size={15} aria-hidden="true" />} label="Clear selection" onClick={() => dispatch({ type: "clearSelection" })} />
      </div>

      <div className={s.segmentHead}>
        <span className={s.segmentGlyph} data-state={segment.state} aria-hidden="true">
          {segment.state}
        </span>
        <div>
          <h2 id="segment-title" className={`display ${s.segmentTitle}`}>
            {team ?? STATE_NAME[segment.state]}
          </h2>
          <p className={s.segmentKind}>{team ? STATE_NAME[segment.state] : STATE_MEANING[segment.state]}</p>
        </div>
      </div>

      {!visible && (
        <Notice>
          This segment is hidden by the current filter.
          <span className={s.noticeActions}>
            {!state.filter.states[segment.state] && (
              <Button size="sm" onClick={() => dispatch({ type: "showState", state: segment.state })}>
                Show {segment.state}
              </Button>
            )}
            {state.filter.period !== "all" && state.filter.period !== segment.period && (
              <Button size="sm" onClick={() => dispatch({ type: "period", period: segment.period })}>
                Go to {period.label}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "clearSelection" })}>
              Clear selection
            </Button>
          </span>
        </Notice>
      )}

      <dl className={s.segmentFacts}>
        <div>
          <dt>Period</dt>
          <dd>{period.label}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd className="mono">{clock(segment.start, period, fixture.fps)}</dd>
        </div>
        <div>
          <dt>End</dt>
          <dd className="mono">{clock(segment.end, period, fixture.fps)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="mono">{duration(segment.end - segment.start, fixture.fps)}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd className="mono">
            {segment.start}–{segment.end - 1}
          </dd>
        </div>
        <div>
          <dt>In half</dt>
          <dd className="mono">
            #{inPeriod.indexOf(segment) + 1} / {inPeriod.length}
          </dd>
        </div>
      </dl>

      <p className={s.segmentNote}>{segment.note}</p>
      {nav}
    </section>
  );
}
