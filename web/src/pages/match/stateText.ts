import type { MatchFixture, PossessionState } from "../../types";

export const STATE_NAME: Record<PossessionState, string> = {
  H: "Home possession",
  A: "Away possession",
  D: "Dead ball",
  X: "No answer (abstain)",
};

export const STATE_MEANING: Record<PossessionState, string> = {
  H: "The home side has the ball, and it is in play.",
  A: "The away side has the ball, and it is in play.",
  D: "The ball is out of play. This is a stoppage, never a possession.",
  X: "The system declines to guess. It is distinct from a dead ball: the scorer fills X with the previous label.",
};

export const teamName = (fixture: MatchFixture, state: PossessionState) =>
  state === "H" ? fixture.home.name : state === "A" ? fixture.away.name : null;
