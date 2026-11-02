import { ArrowLeft } from "lucide-react";
import { ButtonLink, SectionLabel } from "../components/ui";
import { useTitle } from "../lib/useTitle";
import s from "./NotFound.module.css";

export function NotFound() {
  useTitle("Not found");
  return (
    <div className={s.page}>
      <SectionLabel rule>404</SectionLabel>
      <h1 className={`display ${s.title}`}>
        Off the <em>pitch</em>
      </h1>
      <p className={s.intro}>No page is at this address.</p>
      <ButtonLink to="/">
        <ArrowLeft size={16} aria-hidden="true" /> Home
      </ButtonLink>
    </div>
  );
}
