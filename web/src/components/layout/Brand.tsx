import { Link } from "react-router";
import s from "./layout.module.css";

export function Brand({ to = "/", sub }: { to?: string; sub?: string }) {
  return (
    <Link to={to} className={s.brand} aria-label="Barça Lab home">
      <svg className={s.brandMark} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="none" stroke="var(--gold-400)" strokeWidth="1.4" />
        <path d="M16 3v26" stroke="var(--cream-100)" strokeWidth="1" opacity=".5" />
        <circle cx="16" cy="16" r="3.2" fill="var(--burgundy-600)" stroke="var(--cream-100)" strokeWidth=".9" />
      </svg>
      <span className={s.brandText}>
        <span className={s.brandName}>
          Barça <em>Lab</em>
        </span>
        {sub && <span className={s.brandSub}>{sub}</span>}
      </span>
    </Link>
  );
}

export function Disclaimer() {
  return (
    <p className={s.disclaimer}>
      An independent student project for More than a Hack 2027. It is not affiliated with or endorsed
      by FC Barcelona, Metrica Sports or Mobile World Capital Barcelona.
    </p>
  );
}
