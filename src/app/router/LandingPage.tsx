import { Link } from "react-router-dom";

const links = [
  { to: "/eplayer1", label: "Empire Player 1" },
  { to: "/eplayer2", label: "Empire Player 2" },
  { to: "/admin", label: "Admin" },
] as const;

export function LandingPage() {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.16),transparent_38%),linear-gradient(180deg,#07111f_0%,#040814_100%)] text-st-fg">
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        <img
          src="/starstrat1.png"
          alt="StarStrat"
          className="mb-8 w-1/4 min-w-44 max-w-56 object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
        />
        <h1 className="text-4xl font-semibold tracking-[0.2em] text-white sm:text-6xl">
          Welcome to Starstrat
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-st-muted sm:text-base">
          Choose a preview empire or enter the admin shell.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="rounded-full border border-st-border/80 bg-st-panel/70 px-5 py-2 text-sm font-medium text-st-fg transition-colors hover:border-st-accent hover:bg-st-accent hover:text-slate-950"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}