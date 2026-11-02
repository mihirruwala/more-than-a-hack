// Match Centre interaction state as a pure reducer: selection, hover, filters, zoom and the
// focus window. Kept out of React so navigation rules can be unit-tested.

import type { MatchFixture, PossessionState, TimelineFilter } from "../types";
import { defaultFilter, firstVisible, isVisible, lastVisible, step, viewRange, windowAround } from "./match";

export const ZOOMS = [4, 8, 16] as const; // minutes shown in the focus track
export type Zoom = (typeof ZOOMS)[number];

export interface TimelineState {
  filter: TimelineFilter;
  selected: number | null;
  hovered: number | null;
  zoom: Zoom;
  /** Frame the focus window is centred on. */
  focus: number;
}

export type TimelineAction =
  | { type: "select"; index: number | null }
  | { type: "hover"; index: number | null }
  | { type: "step"; dir: 1 | -1 }
  | { type: "edge"; edge: "first" | "last" }
  | { type: "toggleState"; state: PossessionState }
  | { type: "showState"; state: PossessionState }
  | { type: "period"; period: TimelineFilter["period"] }
  | { type: "zoom"; zoom: Zoom }
  | { type: "pan"; dir: 1 | -1 }
  | { type: "focusFrame"; frame: number }
  | { type: "clearSelection" }
  | { type: "reset" };

export function initialTimeline(fixture: MatchFixture): TimelineState {
  const range = viewRange(fixture, defaultFilter());
  return { filter: defaultFilter(), selected: null, hovered: null, zoom: 8, focus: range.start + (8 * 60 * fixture.fps) / 2 };
}

const mid = (s: { start: number; end: number }) => Math.round((s.start + s.end) / 2);

export function timelineReducer(fixture: MatchFixture) {
  const widthOf = (zoom: Zoom) => zoom * 60 * fixture.fps;

  /** Keep focus inside the current range, so the window never points at nothing. */
  const clampFocus = (state: TimelineState): TimelineState => {
    const range = viewRange(fixture, state.filter);
    const w = windowAround(state.focus, widthOf(state.zoom), range);
    return { ...state, focus: mid(w) };
  };

  const selectIndex = (state: TimelineState, index: number | null): TimelineState => {
    if (index === null) return { ...state, selected: null };
    const segment = fixture.segments[index];
    if (!segment) return state;
    // Bring the selection into view, unless it is already inside the window.
    const w = windowAround(state.focus, widthOf(state.zoom), viewRange(fixture, state.filter));
    const inside = segment.start >= w.start && segment.end <= w.end;
    return clampFocus({ ...state, selected: index, focus: inside ? state.focus : mid(segment) });
  };

  return (state: TimelineState, action: TimelineAction): TimelineState => {
    switch (action.type) {
      case "select":
        return selectIndex(state, action.index);
      case "hover":
        return state.hovered === action.index ? state : { ...state, hovered: action.index };
      case "step": {
        const next = step(fixture, state.filter, state.selected, action.dir);
        return next ? selectIndex(state, next.index) : state;
      }
      case "edge": {
        const target = action.edge === "first" ? firstVisible(fixture, state.filter) : lastVisible(fixture, state.filter);
        return target ? selectIndex(state, target.index) : state;
      }
      case "toggleState":
        return { ...state, filter: { ...state.filter, states: { ...state.filter.states, [action.state]: !state.filter.states[action.state] } } };
      case "showState":
        return { ...state, filter: { ...state.filter, states: { ...state.filter.states, [action.state]: true } } };
      case "period": {
        const filter = { ...state.filter, period: action.period };
        const range = viewRange(fixture, filter);
        const keep = state.selected !== null && isVisible(fixture.segments[state.selected]!, filter);
        const focus = keep ? mid(fixture.segments[state.selected!]!) : range.start + widthOf(state.zoom) / 2;
        return clampFocus({ ...state, filter, focus });
      }
      case "zoom":
        return clampFocus({ ...state, zoom: action.zoom, focus: state.selected !== null ? mid(fixture.segments[state.selected]!) : state.focus });
      case "pan":
        return clampFocus({ ...state, focus: state.focus + (action.dir * widthOf(state.zoom)) / 2 });
      case "focusFrame":
        return clampFocus({ ...state, focus: action.frame });
      case "clearSelection":
        return { ...state, selected: null };
      case "reset":
        return initialTimeline(fixture);
    }
  };
}

export function focusWindow(fixture: MatchFixture, state: TimelineState) {
  return windowAround(state.focus, state.zoom * 60 * fixture.fps, viewRange(fixture, state.filter));
}
