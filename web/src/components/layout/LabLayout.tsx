import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  BookOpen,
  Activity,
  FlaskConical,
  Globe,
  LayoutDashboard,
  ListChecks,
  FileCheck2,
  Menu,
  NotebookPen,
  Radio,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "./Brand";
import s from "./layout.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const LAB: NavItem[] = [
  { to: "/lab", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/lab/models", label: "Model Lab", icon: FlaskConical },
  { to: "/lab/experiments", label: "Experiments", icon: ListChecks },
  { to: "/lab/runs", label: "Runs & imports", icon: FileCheck2 },
  { to: "/lab/live", label: "Live replay", icon: Radio },
  { to: "/lab/log", label: "Project Log", icon: NotebookPen },
];

const PUBLIC: NavItem[] = [
  { to: "/", label: "Landing page", icon: Globe, end: true },
  { to: "/match", label: "Match Centre", icon: Activity },
  { to: "/methodology", label: "Methodology", icon: BookOpen },
];

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className={s.navGroup}>
      <span className={s.navGroupTitle}>{title}</span>
      <ul>
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={({ isActive }) => (isActive ? `${s.navLink} ${s.navActive}` : s.navLink)}>
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LabLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on navigation and on Escape, so it never traps the small-screen user.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={s.lab}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={s.labTopbar}>
        <Brand to="/lab" sub="Research console" />
        <button
          type="button"
          className={s.iconButton}
          aria-expanded={open}
          aria-controls="lab-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span className="visually-hidden">{open ? "Close navigation" : "Open navigation"}</span>
        </button>
      </header>

      <nav id="lab-nav" className={s.sidebar} data-open={open} aria-label="Lab">
        <div className={s.sidebarBrand}>
          <Brand to="/lab" sub="Research console" />
        </div>
        <NavGroup title="Lab" items={LAB} />
        <NavGroup title="Public site" items={PUBLIC} />
        <div className={s.sidebarFoot}>
          <span className={s.localTag}>Local only</span>
          <p>
            This console has no authentication. It runs on your machine and should not be deployed
            as it is.
          </p>
        </div>
      </nav>
      {open && <div className={s.scrim} onClick={() => setOpen(false)} aria-hidden="true" />}

      <main id="main" className={s.labMain} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
