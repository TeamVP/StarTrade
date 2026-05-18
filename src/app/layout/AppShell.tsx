import { Link } from "react-router-dom";
import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  nav?: ReactNode;
  headerTrailing?: ReactNode;
  /** Classes for the main content wrapper (width, padding). */
  mainClassName?: string;
  /** When false, the default "StarStrat" product title in the header is hidden (player / embedded layouts). */
  showProductTitle?: boolean;
  /** Override inner header flex container (width constraints). */
  headerContentClassName?: string;
  /** Classes for `<header>` (border, padding). Overrides default padding when set. */
  headerClassName?: string;
  /** Classes for the outer page wrapper (e.g. `min-h-dvh flex flex-col` for fill-height layouts). */
  rootClassName?: string;
};

export function AppShell({
  children,
  nav,
  headerTrailing,
  mainClassName = "mx-auto w-full max-w-7xl p-4",
  showProductTitle = true,
  headerContentClassName = "mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
  headerClassName = "border-b border-st-border px-6 py-4",
  rootClassName = "min-h-screen bg-st-bg text-st-fg",
}: AppShellProps) {
  return (
    <div className={rootClassName}>
      <header className={headerClassName}>
        <div className={headerContentClassName}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            {showProductTitle ? (
              <Link to="/" className="text-xl font-semibold tracking-wide">
                StarStrat
              </Link>
            ) : null}
            {nav}
          </div>
          {headerTrailing ? (
            <div className="flex shrink-0 items-center gap-2">{headerTrailing}</div>
          ) : null}
        </div>
      </header>
      <main className={mainClassName}>{children}</main>
    </div>
  );
}
