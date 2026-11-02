import { SectionLabel } from "../../components/ui";
import { duration, matchStats, segmentsInView } from "../../lib/match";
import type { MatchFixture, TimelineFilter } from "../../types";
import s from "./match.module.css";

/** Aggregates over exactly the segments the timeline is showing: same fixture, same period. */
export function StatsPanel({ fixture, filter }: { fixture: MatchFixture; filter: TimelineFilter }) {
  const segments = segmentsInView(fixture, filter);
  const stats = matchStats(segments, fixture.fps);
  const scope = filter.period === "all" ? "Full match" : fixture.periods.find((p) => p.id === filter.period)!.label;
  const share = stats.homeShare;
  const maxBin = Math.max(1, ...stats.histogram.map((b) => Math.max(b.H, b.A)));

  return (
    <section className={s.stats} aria-labelledby="stats-title">
      <header className={s.statsHead}>
        <div>
          <SectionLabel>Possession analytics · {scope}</SectionLabel>
          <h2 id="stats-title" className={`display ${s.statsTitle}`}>
            The shape of the match
          </h2>
        </div>
        <p className={s.statsNote}>Derived from the demo fixture's segments. Possessions are counted the way the scorer counts them, with X carrying the previous label.</p>
      </header>

      <div className={s.shareBlock}>
        <div className={s.shareLabels}>
          <span>
            <span className={s.teamShort}>{fixture.home.short}</span>
            <span className={s.shareValue}>{share === null ? "—" : `${Math.round(share * 100)}%`}</span>
          </span>
          <span className={s.shareCaption}>share of possession time</span>
          <span>
            <span className={s.shareValue}>{share === null ? "—" : `${100 - Math.round(share * 100)}%`}</span>
            <span className={s.teamShort}>{fixture.away.short}</span>
          </span>
        </div>
        <div className={s.shareBar} role="img" aria-label={share === null ? "No possession time" : `${fixture.home.name} ${Math.round(share * 100)} percent, ${fixture.away.name} ${100 - Math.round(share * 100)} percent of possession time`}>
          <span className={s.shareH} style={{ width: `${(share ?? 0.5) * 100}%` }} />
          <span className={s.shareA} />
        </div>
        <p className={s.shareFoot}>
          {duration(stats.frames.H, fixture.fps)} vs {duration(stats.frames.A, fixture.fps)} with the ball alive. D and X are excluded. This is a share of time, not an accuracy.
        </p>
      </div>

      <dl className={s.statGrid}>
        <div>
          <dt>Possessions</dt>
          <dd>
            <span className="mono">{stats.possessions.H + stats.possessions.A}</span>
            <small>
              {fixture.home.short} {stats.possessions.H} · {fixture.away.short} {stats.possessions.A}
            </small>
          </dd>
        </div>
        <div>
          <dt>Open-play turnovers</dt>
          <dd>
            <span className="mono">{stats.openPlayTurnovers}</span>
            <small>won with no stoppage between</small>
          </dd>
        </div>
        <div>
          <dt>Changes after a stoppage</dt>
          <dd>
            <span className="mono">{stats.changesAfterStoppage}</span>
            <small>other side restarts</small>
          </dd>
        </div>
        <div>
          <dt>Dead-ball time</dt>
          <dd>
            <span className="mono">{duration(stats.frames.D, fixture.fps)}</span>
            <small>{stats.segmentCount.D} stoppages</small>
          </dd>
        </div>
        <div>
          <dt>Abstained (X)</dt>
          <dd>
            <span className="mono">{duration(stats.frames.X, fixture.fps)}</span>
            <small>{stats.segmentCount.X} gaps</small>
          </dd>
        </div>
        <div>
          <dt>Longest possession</dt>
          <dd>
            <span className="mono">{stats.longestPossession ? duration(stats.longestPossession.frames, fixture.fps) : "—"}</span>
            <small>{stats.longestPossession ? (stats.longestPossession.state === "H" ? fixture.home.short : fixture.away.short) : ""}</small>
          </dd>
        </div>
      </dl>

      <figure className={s.histogram}>
        <figcaption>
          <SectionLabel>Possession length</SectionLabel>
          <span className={s.histKey}>
            <span><i className={s.keyH} /> {fixture.home.short}</span>
            <span><i className={s.keyA} /> {fixture.away.short}</span>
          </span>
        </figcaption>
        <table className={s.histTable}>
          <caption className="visually-hidden">Number of possessions by duration, per team</caption>
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Duration</th>
              <th scope="col">{fixture.home.name}</th>
              <th scope="col">{fixture.away.name}</th>
            </tr>
          </thead>
          <tbody>
            {stats.histogram.map((bin) => (
              <tr key={bin.label}>
                <th scope="row" className="mono">{bin.label}</th>
                {(["H", "A"] as const).map((team) => (
                  <td key={team}>
                    <span className={s.histBar} data-team={team} style={{ width: `${(bin[team] / maxBin) * 100}%` }} />
                    <span className={`mono ${s.histCount}`}>{bin[team]}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </section>
  );
}
