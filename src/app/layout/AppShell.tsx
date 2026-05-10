import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  nav?: ReactNode;
  headerTrailing?: ReactNode;
};

export function AppShell({ children, nav, headerTrailing }: AppShellProps) {
  return (
    <div className="min-h-screen bg-st-bg text-st-fg">
      <header className="border-b border-st-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <h1 className="text-xl font-semibold tracking-wide">StarTrade V1</h1>
            {nav}
          </div>
          {headerTrailing ? (
            <div className="flex shrink-0 items-center gap-2">{headerTrailing}</div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl p-4">{children}</main>
    </div>
  );
}
