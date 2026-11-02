import { NavLink, Outlet, Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { Brand, Disclaimer } from "./Brand";
import s from "./layout.module.css";

const LINKS = [
  { to: "/match", label: "Match Centre" },
  { to: "/methodology", label: "Methodology" },
];

export function PublicLayout() {
  return (
    <div className={s.public}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={s.publicHeader}>
        <Brand />
        <nav aria-label="Primary" className={s.publicNav}>
          {LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? `${s.publicLink} ${s.publicActive}` : s.publicLink)}>
              {label}
            </NavLink>
          ))}
          {/* The Lab is a developer tool, so its link only exists in the dev server. */}
          {import.meta.env.DEV && (
            <Link to="/lab" className={s.devLink}>
              Lab <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className={s.publicFooter}>
        <Brand />
        <Disclaimer />
      </footer>
    </div>
  );
}
