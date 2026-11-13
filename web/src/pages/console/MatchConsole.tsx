import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { Moon, Sun, Upload } from "lucide-react";
import { parseReplay } from "../../lib/replay";
import { useTitle } from "../../lib/useTitle";
import { ConsolePage, type Replay } from "./console";
import "./siteTheme.css";
import s from "./labConsole.module.css";

type Loaded = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; replay: Replay; name: string };

/** The bundled synthetic replay at full rate (the site uses a packed 12.5 fps copy of the same file). */
async function loadBuiltIn(): Promise<Loaded> {
  const module = await import("../../data/fixtures/liveReplay.json");
  const parsed = parseReplay(module.default);
  return parsed.ok ? { status: "ready", replay: parsed.replay, name: "built-in" } : { status: "error", error: `Built-in replay is invalid: ${parsed.error}` };
}

function initialDark() {
  try {
    const stored = localStorage.getItem("mc-theme");
    if (stored) return stored === "dark";
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/**
 * The lab's Match console: the same console.tsx the project site runs, inside the site's own
 * design system (siteTheme.css, scoped to .mc-site), plus a picker for replays made locally.
 */
export function MatchConsole() {
  useTitle("Match console");
  const [dark, setDark] = useState(initialDark);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBuiltIn().then((r) => alive && setLoaded(r));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mc-theme", dark ? "dark" : "light");
    } catch {
      // Not remembered; fine.
    }
  }, [dark]);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Read in this tab only: never stored, never uploaded.
    const parsed = parseReplay(await file.text());
    if (!parsed.ok) return setPickError(`${file.name}: ${parsed.error}`);
    setPickError(null);
    setLoaded({ status: "ready", replay: parsed.replay, name: file.name });
  };

  const picker = (
    <div className={`card ${s.loadCard}`}>
      <h3>Watch another replay</h3>
      <p>
        Any file written by <code>live_estimator.py --replay</code>. It is read in this tab and never stored or uploaded, so a real-match replay stays on this machine.
      </p>
      <label className="button button-secondary">
        <input type="file" accept=".json,application/json" onChange={onPick} className={s.fileInput} />
        <Upload size={16} aria-hidden="true" /> Choose a replay file
      </label>
      {pickError && <p className={s.error}>{pickError}</p>}
      {loaded.status === "ready" && loaded.name !== "built-in" && (
        <button type="button" className="text-link" onClick={() => loadBuiltIn().then(setLoaded)}>
          Back to the built-in synthetic match
        </button>
      )}
      <p className={s.command}>
        <code>python3 starter/live_estimator.py --synthetic --replay my_replay.json</code>
      </p>
    </div>
  );

  return (
    <div className={`mc-site ${s.shell}`} data-theme={dark ? "dark" : "light"}>
      <header className="site-header is-scrolled">
        <div className="header-inner">
          <Link to="/lab" className="wordmark">
            Barça <span>Lab</span>
          </Link>
          <nav className={`main-nav ${s.nav}`} aria-label="Lab">
            <Link to="/lab/console" aria-current="page">
              Console
            </Link>
            <Link to="/lab/live">Live replay</Link>
            <Link to="/lab">Lab</Link>
            <a href="https://mix-bloom-97447024.figma.site/console">Public site ↗</a>
          </nav>
          <div className="header-actions">
            <button type="button" className="icon-button" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
              {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
      {loaded.status === "ready" ? (
        <ConsolePage key={loaded.name} replay={loaded.replay} extra={picker} />
      ) : (
        <main className="page">
          <div className="container">
            <p className="muted">{loaded.status === "loading" ? "Loading replay…" : loaded.error}</p>
          </div>
        </main>
      )}
    </div>
  );
}
