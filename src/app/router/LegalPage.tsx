import type { ReactNode } from "react";
import { AppShell } from "@/app/layout/AppShell";

type LegalSection = {
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
};

export function LegalPage({ title, updatedAt, intro, sections }: LegalPageProps) {
  return (
    <AppShell
      nav={null}
      headerTrailing={null}
      mainClassName="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <article className="space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-st-accent">
            StarStrat legal notice
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-st-fg sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-3xl text-sm text-st-muted">Updated {updatedAt}</p>
          <p className="max-w-3xl text-base leading-7 text-slate-200">{intro}</p>
        </header>

        <div className="space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-st-border bg-st-panel/70 p-6 shadow-[0_0_0_1px_rgba(15,23,42,0.18)] backdrop-blur"
            >
              <h2 className="text-xl font-semibold text-st-fg">{section.title}</h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-slate-200">
                {section.content}
              </div>
            </section>
          ))}
        </div>
      </article>
    </AppShell>
  );
}