import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pause, Play, SkipBack, SkipForward, Rewind } from "lucide-react";
import { Panel, ProvenanceBadge, SectionLabel } from "../../components/ui";
import { Button, Notice, PageHeader, Segmented } from "../../components/ui/controls";
import { formatClock, frameAt, parseReplay, runs, summarise, trail, type FrameView, type Replay, type ReplayCall, type ReplayLabel } from "../../lib/replay";
import { useTitle } from "../../lib/useTitle";
import s from "./live.module.css";

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

const LABEL_TEXT: Record<ReplayCall, string> = { H: "Home", A: "Away", D: "Dead ball", X: "Not in play" };

type Loaded =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; replay: Replay; name: string; builtIn: boolean };

/** The bundled synthetic replay, loaded on demand so it is not in the main bundle. */
async function loadBuiltIn(): Promise<Loaded> {
  const module = await import("../../data/fixtures/liveReplay.json");
  const parsed = parseReplay(module.default);
  return parsed.ok
    ? { status: "ready", replay: parsed.replay, name: "Synthetic match (built in)", builtIn: true }
    : { status: "error", error: `Built-in replay is invalid: ${parsed.error}` };
}

export function LiveReplay() {
  useTitle("Live replay");
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBuiltIn().then((result) => {
      if (alive) setLoaded(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Read in this tab only: never stored, never uploaded.
    const parsed = parseReplay(await file.text());
    if (!parsed.ok) {
      setPickError(`${file.name}: ${parsed.error}`);
      return;
    }
    setPickError(null);
    setLoaded({ status: "ready", replay: parsed.replay, name: file.name, builtIn: false });
  };

  const backToBuiltIn = async () => {
    setPickError(null);
    setLoaded({ status: "loading" });
    setLoaded(await loadBuiltIn());
  };

  return (
    <div className={s.page}>
      <PageHeader
        eyebrow={<SectionLabel rule>Lab · live</SectionLabel>}
        title={
          <>
            Live <em>replay</em>
          </>
        }
        lede="The live estimator, played back frame by frame: where it thinks the ball is, including when the tracking cannot see it, and who it thinks has it. Everything runs in this tab."
        actions={
          <label className={s.picker}>
            <input type="file" accept=".json,application/json" onChange={onPick} aria-label="Load a replay file" />
            <span>Load replay…</span>
          </label>
        }
      />

      {pickError && <Notice tone="warning">{pickError}</Notice>}

      {loaded.status === "loading" && <p className={s.fine}>Loading replay…</p>}
      {loaded.status === "error" && <Notice tone="warning">{loaded.error}</Notice>}
      {loaded.status === "ready" && (
        // Keyed by name so a new file starts from frame 0 with fresh playback state.
        <Player key={loaded.name} replay={loaded.replay} name={loaded.name} builtIn={loaded.builtIn} onReset={backToBuiltIn} />
      )}

      <Panel title="Make a replay" labelledBy="make-title" aside={<span className={s.localTag}>run in your terminal</span>}>
        <ol className={s.commands}>
          <li>
            <code>python3 starter/live_estimator.py --synthetic --replay my_replay.json</code>
            <span>a fresh simulated match, with its ground truth</span>
          </li>
          <li>
            <code>python3 starter/live_estimator.py --lag 25 --replay evaluation/replays/clip.json --replay-from 448 --replay-seconds 90</code>
            <span>a window of the real match; needs data/tactical/. The file stays in evaluation/replays/, which git ignores</span>
          </li>
        </ol>
        <p className={s.fine}>
          A real-match replay holds tracking-derived positions. Keep it on this machine: the Python side refuses to write one inside <code>web/</code>, and this page reads it
          without storing or sending it anywhere.
        </p>
      </Panel>
    </div>
  );
}

function Player({ replay, name, builtIn, onReset }: { replay: Replay; name: string; builtIn: boolean; onReset: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const summary = useMemo(() => summarise(replay), [replay]);
  const last = replay.length - 1;
  const view = frameAt(replay, index);

  // Playback: advance by wall-clock time, so the replay runs at true speed whatever the frame rate.
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(last, indexRef.current + ((now - previous) / 1000) * replay.fps * speed);
      previous = now;
      setIndex(next);
      if (next >= last) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, speed, last, replay.fps]);

  const seek = useCallback((to: number) => setIndex(Math.max(0, Math.min(last, Math.round(to)))), [last]);
  const toggle = () => {
    if (!playing && index >= last) setIndex(0);
    setPlaying((p) => !p);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") return;
    const step = event.shiftKey ? replay.fps : 1;
    if (event.key === " " && target.tagName !== "BUTTON") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight" && target.tagName !== "INPUT") {
      event.preventDefault();
      setPlaying(false);
      seek(index + step);
    } else if (event.key === "ArrowLeft" && target.tagName !== "INPUT") {
      event.preventDefault();
      setPlaying(false);
      seek(index - step);
    }
  };

  return (
    // tabIndex -1: clicking anywhere in the player focuses it, so the keyboard shortcuts work.
    <div className={s.player} onKeyDown={onKey} tabIndex={-1}>
      <div className={s.sourceBar}>
        <div className={s.sourceName}>
          {replay.provenance === "synthetic" ? <ProvenanceBadge provenance="synthetic" /> : <span className={s.localRun}>Local run · not scored</span>}
          <span>{name}</span>
          <code className={s.sourceRef}>{replay.source}</code>
        </div>
        {!builtIn && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Back to the built-in replay
          </Button>
        )}
      </div>

      <div className={s.stage}>
        <figure className={s.pitchWrap} aria-labelledby="live-pitch-caption">
          <Pitch replay={replay} view={view} />
          <figcaption id="live-pitch-caption" className={s.legend}>
            <span><i className={s.dotHome} /> Home</span>
            <span><i className={s.dotAway} /> Away</span>
            <span><i className={s.dotBallSeen} /> Ball, seen by tracking</span>
            <span><i className={s.dotBallEst} /> Estimated ball ± uncertainty</span>
          </figcaption>
        </figure>

        <Hud replay={replay} view={view} />
      </div>

      <div className={s.controls}>
        <div className={s.buttons}>
          <Button size="sm" icon={<Rewind size={15} aria-hidden="true" />} label="Back to start" onClick={() => { setPlaying(false); seek(0); }} />
          <Button size="sm" icon={<SkipBack size={15} aria-hidden="true" />} label="Back one second" onClick={() => { setPlaying(false); seek(index - replay.fps); }} />
          <Button variant="primary" icon={playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} onClick={toggle}>
            {playing ? "Pause" : "Play"}
          </Button>
          <Button size="sm" icon={<SkipForward size={15} aria-hidden="true" />} label="Forward one second" onClick={() => { setPlaying(false); seek(index + replay.fps); }} />
        </div>
        <label className={s.scrub}>
          <span className="visually-hidden">Position in replay</span>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={Math.floor(index)}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
            aria-valuetext={`${formatClock(view.seconds)} of ${formatClock(summary.seconds)}`}
          />
        </label>
        <span className={s.clock} aria-hidden="true">
          {formatClock(view.seconds)} <span>/ {formatClock(summary.seconds)}</span>
        </span>
        <Segmented<Speed> label="Playback speed" value={speed} onChange={setSpeed} options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} />
      </div>
      <p className={s.fine}>Space plays and pauses. Arrow keys step one frame, or a second with Shift.</p>

      <Panel title="Possession over the replay" labelledBy="strips-title">
        <Strip title="Estimate" labels={replay.label} index={index} onSeek={seek} />
        {replay.truth && <Strip title="Simulator truth" labels={replay.truth} index={index} onSeek={seek} />}
        <dl className={s.summary}>
          <div><dt>Length</dt><dd>{formatClock(summary.seconds)}</dd></div>
          <div><dt>Ball hidden</dt><dd>{Math.round(summary.hiddenShare * 100)}% of frames</dd></div>
          <div><dt>Answers late by</dt><dd>{(replay.lag / replay.fps).toFixed(1)} s</dd></div>
          <div><dt>Possessions, estimated</dt><dd>{summary.estimatedPossessions}</dd></div>
          {summary.truePossessions !== null && <div><dt>Possessions, truth</dt><dd>{summary.truePossessions}</dd></div>}
          {summary.agreement !== null && <div><dt>Frames matching truth</dt><dd>{(summary.agreement * 100).toFixed(1)}%</dd></div>}
        </dl>
        <p className={s.fine}>
          {replay.truth
            ? "Truth here is the simulator's own record of the invented match. Agreement on it checks the estimator's design, and says nothing about the leaderboard."
            : "No ground truth travels with a local run. Score the full-match CSV with the official evaluator; this view only shows what the estimator did."}
        </p>
      </Panel>
    </div>
  );
}

function Pitch({ replay, view }: { replay: Replay; view: FrameView }) {
  const [L, W] = replay.pitch;
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 0.35 } as const;
  const path = trail(replay, view.index);
  const sigma = view.est?.sigma ?? null;
  const description = `Frame ${view.frame}. ${view.players.length} tracks visible. ${
    view.ball ? "Ball seen by tracking." : view.est ? `Ball hidden; estimated within ${sigma === null ? "an unknown distance" : `${sigma.toFixed(1)} m`}.` : "No ball estimate yet."
  } Estimate: ${LABEL_TEXT[view.label]}.`;

  return (
    <svg viewBox={`-4 -4 ${L + 8} ${W + 8}`} className={s.pitch} role="img" aria-label={description}>
      <rect x={-4} y={-4} width={L + 8} height={W + 8} fill="var(--pitch-bg)" />
      <g className={s.pitchLines}>
        <rect x={0} y={0} width={L} height={W} {...line} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} {...line} />
        <circle cx={L / 2} cy={W / 2} r={9.15} {...line} />
        <circle cx={L / 2} cy={W / 2} r={0.45} fill="currentColor" />
        {[0, 1].map((side) => {
          const x = (depth: number) => (side ? L - depth : 0);
          return (
            <g key={side}>
              <rect x={x(16.5)} y={(W - 40.3) / 2} width={16.5} height={40.3} {...line} />
              <rect x={x(5.5)} y={(W - 18.32) / 2} width={5.5} height={18.32} {...line} />
              <rect x={side ? L : -2} y={(W - 7.32) / 2} width={2} height={7.32} {...line} />
            </g>
          );
        })}
      </g>

      {path.length > 1 && <polyline points={path.map(([x, y]) => `${x},${y}`).join(" ")} className={s.trail} />}

      {view.players.map((p) => (
        <circle key={p.slot} cx={p.x} cy={p.y} r={1.15} className={p.team === 0 ? s.home : s.away} />
      ))}

      {view.est && sigma !== null && sigma < 30 && (
        <circle cx={view.est.x} cy={view.est.y} r={Math.max(sigma, 0.6)} className={s.uncertainty} data-hidden={!view.ball} />
      )}
      {view.est && <circle cx={view.est.x} cy={view.est.y} r={0.55} className={s.estBall} />}
      {view.ball && <circle cx={view.ball[0]} cy={view.ball[1]} r={0.7} className={s.seenBall} />}
    </svg>
  );
}

function Hud({ replay, view }: { replay: Replay; view: FrameView }) {
  const bars: { key: ReplayLabel; value: number }[] = [
    { key: "H", value: view.pHome },
    { key: "A", value: view.pAway },
    { key: "D", value: view.pDead },
  ];
  const agrees = view.truth ? view.truth === view.label : null;
  return (
    <aside className={s.hud} aria-label="Current estimate">
      <div>
        <SectionLabel>Estimate</SectionLabel>
        <p className={s.call} data-state={view.label} aria-live="off">
          {LABEL_TEXT[view.label]}
        </p>
      </div>

      <div className={s.bars}>
        {bars.map((b) => (
          <div key={b.key} className={s.bar}>
            <span>{b.key}</span>
            <span className={s.barTrack}>
              <span className={s.barFill} data-state={b.key} style={{ width: `${b.value}%` }} />
            </span>
            <span className={s.barValue}>{b.value}%</span>
          </div>
        ))}
      </div>

      <dl className={s.facts}>
        <div>
          <dt>Ball</dt>
          <dd>
            {view.ball
              ? "Seen by tracking"
              : view.est
                ? `Hidden · estimated ${view.est.sigma === null ? "" : `± ${view.est.sigma.toFixed(1)} m`}`
                : "No estimate yet"}
          </dd>
        </div>
        {view.truth && (
          <div>
            <dt>Simulator truth</dt>
            <dd className={s.truth} data-agree={agrees}>
              {LABEL_TEXT[view.truth]} {agrees ? "· matches" : "· differs"}
            </dd>
          </div>
        )}
        <div>
          <dt>Frame</dt>
          <dd className={s.mono}>{view.frame}</dd>
        </div>
        <div>
          <dt title="Tracking slots are tracklets, not people: a real match has more slots than players">Tracks visible</dt>
          <dd className={s.mono}>{view.players.length} / {replay.teams.length}</dd>
        </div>
      </dl>
      <p className={s.fine}>
        Answered {(replay.lag / replay.fps).toFixed(1)} s after this frame was seen. That delay is the hindsight that steadies the call.
      </p>
    </aside>
  );
}

function Strip({ title, labels, index, onSeek }: { title: string; labels: string; index: number; onSeek: (to: number) => void }) {
  const id = useId();
  const pieces = useMemo(() => runs(labels), [labels]);
  const n = labels.length;
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - box.left) / box.width) * n);
  };
  const changes = pieces.length - 1;
  return (
    <div className={s.strip}>
      <span id={id} className={s.stripTitle}>{title}</span>
      {/* Pointer shortcut for seeking; the range input above is the keyboard control. */}
      <div className={s.stripTrack} onClick={onClick} role="img" aria-labelledby={id} aria-description={`${changes} changes of state`}>
        {pieces.map((p) => (
          <span key={p.start} className={s.piece} data-state={p.label} style={{ left: `${(p.start / n) * 100}%`, width: `${((p.stop - p.start) / n) * 100}%` }} />
        ))}
        <span className={s.playhead} style={{ left: `${(index / n) * 100}%` }} />
      </div>
    </div>
  );
}
