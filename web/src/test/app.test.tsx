// Route-level tests: every page renders without crashing, and the main workflows behave end to end.
// They render the real route table in a memory router, against an in-memory store.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "../Providers";
import { demoMatch } from "../data/fixtures/demoMatch";
import { memoryStorage } from "../lib/store/persistence";
import { createResearchStore } from "../lib/store/researchStore";
import { routes } from "../routes";

function renderAt(path: string, storage = memoryStorage()) {
  const store = createResearchStore(storage);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Providers store={store}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, store, router, storage };
}

const ROUTES: [string, RegExp][] = [
  ["/", /Who has/],
  ["/match", /Northbridge Athletic.*Harbour Rovers/],
  ["/methodology", /twenty-two dots/],
  ["/lab", /command/],
  ["/lab/models", /Model/],
  ["/lab/models?tab=compare", /Model/],
  ["/lab/models?tab=dimensions", /Model/],
  ["/lab/models/new", /New model version/],
  ["/lab/models/baseline-smooth50/edit", /Nearest-player baseline/],
  ["/lab/experiments", /Experiments/],
  ["/lab/experiments/new", /New experiment/],
  ["/lab/experiments/EXP-001", /Segment cleanup on a fragmented/],
  ["/lab/experiments/EXP-001/edit", /Segment cleanup on a fragmented/],
  ["/lab/experiments/compare?ids=EXP-001,EXP-002", /Side by side/],
  ["/lab/log", /Project/],
  ["/lab/runs", /Runs/],
  ["/lab/live", /Live/],
  ["/nowhere", /Off the/],
];

describe("every route renders", () => {
  it.each(ROUTES)("%s", async (path, heading) => {
    const errors = vi.spyOn(console, "error");
    renderAt(path);
    expect((await screen.findAllByRole("heading", { level: 1 }))[0]!.textContent).toMatch(heading);
    expect(errors).not.toHaveBeenCalled();
  });

  it("sets a page title per route", async () => {
    renderAt("/lab/experiments");
    await screen.findByRole("heading", { level: 1 });
    expect(document.title).toBe("Experiments · Barça Lab");
  });
});

describe("experiment workflow", () => {
  it("validates inline, then creates, persists and shows the experiment", async () => {
    const { storage, router } = renderAt("/lab/experiments/new");
    fireEvent.click(await screen.findByRole("button", { name: "Create experiment" }));

    // Inline errors are attached to their fields.
    const name = screen.getByLabelText(/Experiment name/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Name the experiment.")).toBeTruthy();

    fireEvent.change(name, { target: { value: "Ball-speed gate" } });
    fireEvent.change(screen.getByLabelText(/Hypothesis/), { target: { value: "Ignoring frames where the ball moves faster than 15 m/s removes fake possession changes." } });
    fireEvent.change(screen.getByLabelText(/Model version/), { target: { value: "baseline-smooth50" } });
    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: "motion" } });
    fireEvent.change(screen.getByLabelText("Parameter 1 name"), { target: { value: "max_speed" } });
    fireEvent.change(screen.getByLabelText("Parameter 1 value"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Create experiment" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Ball-speed gate" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/lab/experiments/EXP-004");
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);

    // Persisted: a fresh store over the same storage sees it.
    const reloaded = createResearchStore(storage).getState().experiments.find((e) => e.id === "EXP-004");
    expect(reloaded?.params).toEqual({ max_speed: 15 });
    expect(reloaded?.metrics).toEqual([]);
  });

  it("moves through statuses from the detail page and records history", async () => {
    const { store } = renderAt("/lab/experiments/EXP-003");
    expect(screen.queryByRole("button", { name: "Mark completed" })).toBeNull(); // planned can't jump to completed
    fireEvent.click(await screen.findByRole("button", { name: "Start running" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark completed" }));
    const e = store.getState().experiments.find((x) => x.id === "EXP-003")!;
    expect(e.statusHistory.map((h) => h.status)).toEqual(["planned", "running", "completed"]);
    expect(await screen.findByText(/Completed with no metric recorded/)).toBeTruthy();
  });

  it("asks before deleting", async () => {
    const { store } = renderAt("/lab/experiments/EXP-003");
    fireEvent.click(await screen.findByRole("button", { name: "Delete EXP-003" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(store.getState().experiments.some((e) => e.id === "EXP-003")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Delete EXP-003" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete experiment" }));
    expect(store.getState().experiments.some((e) => e.id === "EXP-003")).toBe(false);
  });

  it("filters the registry and enables comparison only with two selected", async () => {
    renderAt("/lab/experiments");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "planned" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "all" } });
    const compare = screen.getByRole("button", { name: /Compare/ });
    expect((compare as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Select EXP-001 for comparison"));
    fireEvent.click(screen.getByLabelText("Select EXP-002 for comparison"));
    expect((screen.getByRole("button", { name: /Compare/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("never declares a winner between synthetic results", async () => {
    renderAt("/lab/experiments/compare?ids=EXP-001,EXP-002,EXP-003");
    expect(await screen.findByText(/No winner can be declared/)).toBeTruthy();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  it("recovers from corrupt storage with a visible notice", async () => {
    renderAt("/lab", memoryStorage({ "barca-lab:research": "{oops" }));
    expect(await screen.findByText(/not valid JSON/)).toBeTruthy();
  });
});

describe("model lab", () => {
  it("compares two models with full-match evidence only and no winner", async () => {
    renderAt("/lab/models?tab=compare&a=baseline-smooth50&b=postprocess-v0-1");
    expect(await screen.findByText(/No winner can be declared/)).toBeTruthy();
    expect(screen.getByText("0.2433")).toBeTruthy(); // published baseline floor
  });

  it("refuses to delete a model that experiments use", async () => {
    const { store } = renderAt("/lab/models?model=postprocess-v0-1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/still in use/)).toBeTruthy();
    expect(store.getState().models.some((m) => m.id === "postprocess-v0-1")).toBe(true);
  });
});

describe("match centre", () => {
  it("selects segments with Next and the keyboard, from the fixture", async () => {
    renderAt("/match");
    expect(await screen.findByText("Nothing selected")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Next/ })[0]!);
    expect(screen.getByText(`Segment 1 of ${demoMatch.segments.length}`)).toBeTruthy();

    const track = screen.getByRole("group", { name: /Possession segments/ });
    await act(async () => {
      fireEvent.keyDown(track, { key: "ArrowRight" });
    });
    expect(screen.getByText(`Segment 2 of ${demoMatch.segments.length}`)).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(track, { key: "Escape" });
    });
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });

  it("explains a selection that a filter hides, and can reveal it", async () => {
    renderAt("/match");
    fireEvent.click((await screen.findAllByRole("button", { name: /Next/ }))[0]!);
    const first = demoMatch.segments[0]!;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${first.state === "H" ? "Home possession" : "Away possession"}: shown`) }));
    expect(screen.getByText(/hidden by the current filter/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Show ${first.state}` }));
    expect(screen.queryByText(/hidden by the current filter/)).toBeNull();
  });

  it("labels the page as demo data", async () => {
    renderAt("/match");
    expect((await screen.findAllByText(/Demo data/)).length).toBeGreaterThan(0);
  });
});

describe("runs & imports", () => {
  it("checks a picked submission in memory and stores nothing", async () => {
    const { storage } = renderAt("/lab/runs");
    const before = JSON.stringify(storage.dump());
    const input = (await screen.findByText("Choose CSV…")).parentElement!.querySelector("input")!;
    const file = new File(["frame,label\n0,H\n"], "tiny.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/row count 1 != 199319/)).toBeTruthy();
    expect(JSON.stringify(storage.dump())).toBe(before);
  });

  it("imports a well-formed report into an experiment as verified public-window metrics", async () => {
    const { store } = renderAt("/lab/runs");
    const report = JSON.stringify({
      submission: "test_entry", ground_truth: "BAR-ATH_possession_gt_public.csv", spell_f1_mean: 0.5, macro_f1: 0.6,
      n_frames: 199319, n_graded: 7500, n_gt_spells: 17, n_pred_spells: 20, spell_f1: {},
    });
    const input = (await screen.findByText("Choose report…")).parentElement!.querySelector("input")!;
    fireEvent.change(input, { target: { files: [new File([report], "test_entry.json", { type: "application/json" })] } });
    expect(await screen.findByText(/public 5-minute window/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Attach to experiment/), { target: { value: "EXP-003" } });
    fireEvent.click(screen.getByRole("button", { name: "Import metrics" }));
    const metrics = store.getState().experiments.find((e) => e.id === "EXP-003")!.metrics;
    expect(metrics.map((m) => [m.key, m.provenance, m.scope])).toContainEqual(["spellF1", "verified", "public-window"]);
  });
});

describe("live replay", () => {
  it("plays back the built-in synthetic replay and steps through it", async () => {
    const errors = vi.spyOn(console, "error");
    renderAt("/lab/live");
    const slider = (await screen.findByRole("slider", { name: "Position in replay" })) as HTMLInputElement;
    expect(screen.getAllByText("Synthetic").length).toBeGreaterThan(0);
    expect(screen.getByText(/Frames matching truth/)).toBeTruthy();
    expect(slider.value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Forward one second" }));
    expect(slider.value).toBe("25");
    fireEvent.change(slider, { target: { value: "500" } });
    expect(slider.value).toBe("500");
    expect(screen.getByRole("img", { name: /^Frame 2000\./ })).toBeTruthy(); // the clip starts at frame 1500
    expect(errors).not.toHaveBeenCalled();
  });

  it("rejects a picked file that is not a replay, and keeps the built-in one", async () => {
    const { storage } = renderAt("/lab/live");
    await screen.findByRole("slider", { name: "Position in replay" });
    const before = JSON.stringify(storage.dump());
    const input = screen.getByLabelText("Load a replay file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"format":"nope"}'], "wrong.json", { type: "application/json" })] } });
    expect(await screen.findByText(/wrong\.json: Not a replay file/)).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Position in replay" })).toBeTruthy();
    expect(JSON.stringify(storage.dump())).toBe(before);
  });
});
