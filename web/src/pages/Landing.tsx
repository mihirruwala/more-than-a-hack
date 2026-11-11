import { ArrowRight } from "lucide-react";
import { PitchLines } from "../components/charts/PitchLines";
import { PossessionStrip, StateLegend } from "../components/charts/PossessionStrip";
import { ButtonLink, ProvenanceBadge, SectionLabel, score } from "../components/ui";
import { demoMatch } from "../data/fixtures/demoMatch";
import { clip } from "../lib/match";
import { useTitle } from "../lib/useTitle";
import { baselineFloor } from "../data/fixtures/project";
import s from "./Landing.module.css";

// Published facts about the challenge, quoted from README.md / DATA.md. Not results of ours.
const FACTS = [
  { value: "199,319", unit: "frames", text: "One label for every frame of a full LaLiga match, at 25 fps." },
  { value: "41", unit: "%", text: "The share of graded frames where the automatic tracking can't see the ball." },
  { value: "1", unit: "metric", text: "spellF1: how many of the real possessions are recovered whole." },
];

const STEPS = [
  ["Align", "Put the tracking, tagging and video on one frame index."],
  ["Interpret", "Read the player and ball geometry, and handle the gaps."],
  ["Infer", "Decide on each frame which team, if either, has the ball."],
  ["Clean", "Join fragments into possessions, and stop flicker from creating new ones."],
  ["Evaluate", "Score with the official scorer and record every run."],
  ["Submit", "Write a validated file that the code can reproduce exactly."],
];

// The first twelve minutes of the same demo fixture the Match Centre uses.
const preview = clip(demoMatch.segments, demoMatch.periods[0]!.start, demoMatch.periods[0]!.start + 12 * 60 * demoMatch.fps);

export function Landing() {
  useTitle("");
  return (
    <>
      <section className={`${s.hero} grain`}>
        <PitchLines className={s.heroPitch} />
        <div className={s.heroInner}>
          <SectionLabel rule>More than a Hack 2027 · Phase 1</SectionLabel>
          <h1 className={`display ${s.heroTitle}`}>
            Who has
            <br />
            <em>the ball?</em>
          </h1>
          <p className={s.heroLede}>
            A research project in football possession estimation. It turns automatic tracking of
            twenty-two players and a ball into a frame-by-frame account of which team is in
            control and when play stops.
          </p>
          <div className={s.heroActions}>
            <ButtonLink to="/match" tone="primary">
              Explore the Match Centre <ArrowRight size={16} aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to="/methodology">How it works</ButtonLink>
          </div>
        </div>
      </section>

      <section className={s.preview} aria-labelledby="preview-title">
        <div className={s.wrap}>
          <div className={s.previewHead}>
            <div>
              <SectionLabel>Product preview</SectionLabel>
              <h2 id="preview-title" className={`display ${s.h2}`}>
                A match, read as possessions
              </h2>
            </div>
            <ProvenanceBadge provenance="demo" />
          </div>
          <div className={s.previewCard}>
            <PossessionStrip
              segments={preview}
              fps={demoMatch.fps}
              tall
              label="Demo data: twelve minutes of synthetic possession segments"
            />
            <div className={s.previewFoot}>
              <StateLegend />
              <p className={s.note}>
                The first twelve minutes of the demo fixture: fictional teams, from a seeded generator.
                It isn't the competition match, or any real one.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={s.editorial} aria-labelledby="problem-title">
        <div className={s.wrap}>
          <div className={s.editorialHead}>
            <SectionLabel>The problem</SectionLabel>
            <h2 id="problem-title" className={`display ${s.editorialTitle}`}>
              Possession is an <em>interval</em>, not a frame.
            </h2>
            <p>
              A system can label nine frames out of ten correctly and still report hundreds of
              possessions that never happened. The challenge ranks on whole possessions, so the
              work is in the structure: where one begins, where it ends, and when the ball is dead.
            </p>
          </div>
          <dl className={s.facts}>
            {FACTS.map((fact) => (
              <div key={fact.unit} className={s.fact}>
                <dt>
                  <span className={s.factValue}>{fact.value}</span>
                  <span className={s.factUnit}>{fact.unit}</span>
                </dt>
                <dd>{fact.text}</dd>
              </div>
            ))}
          </dl>
          <p className={s.factSource}>Challenge facts as published in the competition repository.</p>
        </div>
      </section>

      <section className={s.method} aria-labelledby="method-title">
        <div className={s.wrap}>
          <div className={s.methodHead}>
            <SectionLabel>Methodology</SectionLabel>
            <h2 id="method-title" className={`display ${s.h2}`}>
              Six steps, from tracking to a file
            </h2>
            <ButtonLink to="/methodology">
              Read the methodology <ArrowRight size={16} aria-hidden="true" />
            </ButtonLink>
          </div>
          <ol className={s.steps}>
            {STEPS.map(([title, text], index) => (
              <li key={title}>
                <span className={`mono ${s.stepNo}`}>{String(index + 1).padStart(2, "0")}</span>
                <span className={s.stepTitle}>{title}</span>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={s.results} aria-labelledby="results-title">
        <div className={`${s.wrap} ${s.resultsGrid}`}>
          <div>
            <SectionLabel>Results</SectionLabel>
            <h2 id="results-title" className={`display ${s.h2}`}>
              Submitted, awaiting the full-match score
            </h2>
            <p className={s.resultsText}>
              Only the organisers can score the full match, so no verified score of ours exists
              yet. On two open Metrica matches our pipeline scores spellF1 0.474, against 0.408
              for the nearest-player baseline. TECHNICAL.md has the details. The number shown here
              is the published baseline on the competition match.
            </p>
          </div>
          <div className={s.floorCard}>
            <SectionLabel>Published baseline · spellF1</SectionLabel>
            <span className={s.floorValue}>{score(baselineFloor.result.metrics.spellF1)}</span>
            <span className={s.floorNote}>Nearest player, ±50 frame vote, full match</span>
            <ProvenanceBadge provenance="published" />
          </div>
          <div className={s.legendCard}>
            <SectionLabel>Demo data vs measured results</SectionLabel>
            <ul>
              <li>
                <ProvenanceBadge provenance="demo" />
                <span>Illustrative only: generated for the interface and meaningless as a result.</span>
              </li>
              <li>
                <ProvenanceBadge provenance="published" />
                <span>Quoted from the competition's own documentation.</span>
              </li>
              <li>
                <ProvenanceBadge provenance="verified" />
                <span>Produced by the official scorer, with the run recorded and reproducible.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
