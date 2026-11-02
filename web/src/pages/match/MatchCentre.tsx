import { useMemo, useReducer } from "react";
import { RotateCcw } from "lucide-react";
import { ProvenanceBadge, SectionLabel } from "../../components/ui";
import { Button, Chip, Segmented } from "../../components/ui/controls";
import { demoMatch } from "../../data/fixtures/demoMatch";
import { duration, segmentsInView } from "../../lib/match";
import { ZOOMS, initialTimeline, timelineReducer, type Zoom } from "../../lib/timelineState";
import { useTitle } from "../../lib/useTitle";
import { POSSESSION_STATES, type TimelineFilter } from "../../types";
import { PitchView } from "./PitchView";
import { SegmentPanel } from "./SegmentPanel";
import { STATE_MEANING, STATE_NAME } from "./stateText";
import { StatsPanel } from "./StatsPanel";
import { Timeline } from "./Timeline";
import s from "./match.module.css";

const fixture = demoMatch;

export function MatchCentre() {
  useTitle("Match Centre");
  const reducer = useMemo(() => timelineReducer(fixture), []);
  const [state, dispatch] = useReducer(reducer, fixture, initialTimeline);
  const inView = segmentsInView(fixture, state.filter);
  const counts = Object.fromEntries(POSSESSION_STATES.map((st) => [st, inView.filter((seg) => seg.state === st).length]));
  const selected = state.selected !== null ? fixture.segments[state.selected] : undefined;
  const total = fixture.periods[fixture.periods.length - 1]!.end - fixture.periods[0]!.start;
  const filtersChanged = state.filter.period !== "all" || POSSESSION_STATES.some((st) => !state.filter.states[st]) || state.zoom !== 8;

  return (
    <div className={s.page}>
      <header className={`${s.header} grain`}>
        <div className={s.headerInner}>
          <div className={s.headerMeta}>
            <SectionLabel rule>Match Centre</SectionLabel>
            <ProvenanceBadge provenance="demo" />
          </div>
          <h1 className={s.fixtureTitle}>
            <span className={s.teamBlock} data-side="H">
              <span className={s.teamMark} aria-hidden="true" />
              <span className="display">{fixture.home.name}</span>
              <span className={s.teamTag}>Home · {fixture.home.short}</span>
            </span>
            <span className={s.versus} aria-hidden="true">
              v
            </span>
            <span className="visually-hidden"> versus </span>
            <span className={s.teamBlock} data-side="A">
              <span className={s.teamMark} aria-hidden="true" />
              <span className="display">{fixture.away.name}</span>
              <span className={s.teamTag}>Away · {fixture.away.short}</span>
            </span>
          </h1>
          <dl className={s.headerFacts}>
            <div>
              <dt>Fixture</dt>
              <dd>{fixture.competition}</dd>
            </div>
            <div>
              <dt>Play</dt>
              <dd className="mono">
                {fixture.periods.map((p) => `${p.label} ${duration(p.end - p.start, fixture.fps)}`).join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Segments</dt>
              <dd className="mono">
                {fixture.segments.length} over {duration(total, fixture.fps)}
              </dd>
            </div>
          </dl>
          <p className={s.demoNote}>
            <strong>Demo data.</strong> This is a synthetic fixture with fictional teams, produced by a seeded generator. It isn't the competition
            match, and no tracking, video or ground truth went into it.
          </p>
        </div>
      </header>

      <section className={s.board} aria-labelledby="timeline-title">
        <div className={s.boardHead}>
          <h2 id="timeline-title" className={`display ${s.boardTitle}`}>
            Possession timeline
          </h2>
          <div className={s.controls}>
            <Segmented<TimelineFilter["period"]>
              label="Period"
              value={state.filter.period}
              onChange={(period) => dispatch({ type: "period", period })}
              options={[
                { value: "all", label: "Full match" },
                ...fixture.periods.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
            <Segmented<Zoom> label="Zoom" value={state.zoom} onChange={(zoom) => dispatch({ type: "zoom", zoom })} options={ZOOMS.map((z) => ({ value: z, label: `${z} min` }))} />
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={!filtersChanged && state.selected === null} onClick={() => dispatch({ type: "reset" })}>
              Reset view
            </Button>
          </div>
        </div>

        <div className={s.legendRow} role="group" aria-label="Show or hide states">
          {POSSESSION_STATES.map((st) => (
            <Chip key={st} pressed={state.filter.states[st]} onClick={() => dispatch({ type: "toggleState", state: st })} label={`${STATE_NAME[st]}: ${state.filter.states[st] ? "shown" : "hidden"}, ${counts[st]} segments`}>
              <span className={s[`key${st}`]} aria-hidden="true" />
              <span className="mono">{st}</span>
              {STATE_NAME[st]}
              <span className={s.chipCount}>{counts[st]}</span>
            </Chip>
          ))}
        </div>

        <Timeline fixture={fixture} state={state} dispatch={dispatch} />

        <details className={s.legendDetails}>
          <summary>What the four states mean</summary>
          <dl>
            {POSSESSION_STATES.map((st) => (
              <div key={st}>
                <dt>
                  <span className={s[`key${st}`]} aria-hidden="true" /> <span className="mono">{st}</span> {STATE_NAME[st]}
                </dt>
                <dd>{STATE_MEANING[st]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <div className={s.analysis}>
        <SegmentPanel fixture={fixture} state={state} dispatch={dispatch} />
        <PitchView fixture={fixture} segment={selected} />
      </div>

      <StatsPanel fixture={fixture} filter={state.filter} />
    </div>
  );
}
