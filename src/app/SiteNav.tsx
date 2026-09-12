import Link from "next/link";
import { getCurrentUser, signOutAction } from "@/server/actions/auth";
import { isOperatorEmail } from "@/server/domain/operatorAccess";

/**
 * The global navigation, and the reason it exists is the delivery audit's first finding: before
 * this, navigation lived only on `/today`, only when signed in, and reached three routes. Every
 * other surface — the company index, system health, the app's own root — was reachable only by
 * typing a URL, which is a terminal by another name.
 *
 * Server component, so it reads the session directly rather than duplicating auth state into the
 * client. `/admin` appears only for an operator, matching `isOperatorEmail`'s own fail-closed
 * allowlist: a link to a page that will redirect is worse than no link.
 */
export async function SiteNav() {
  const user = await getCurrentUser();
  const isOperator = isOperatorEmail(user?.email);

  return (
    <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 text-sm">
        <Link href="/" className="font-semibold tracking-tight">
          Market OS
        </Link>
        {user ? (
          <>
            <Link href="/today" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Today
            </Link>
            <Link href="/company" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Companies
            </Link>
            <Link
              href="/oracle"
              className="font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              Oracle
            </Link>
            <Link href="/macro" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Macro
            </Link>
            <Link href="/watchlist" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Watchlist
            </Link>
            <Link href="/ask" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Ask Market
            </Link>
            {/*
              The ORDINARY user's health surface. `/admin` below is a different thing and stays
              operator-only: it renders raw adapter errors and run internals, which is right for
              whoever is debugging the pipeline and wrong for everybody else.
            */}
            <Link href="/status" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Status
            </Link>
            {isOperator ? (
              <Link href="/admin" className="text-zinc-600 hover:underline dark:text-zinc-400">
                System health
              </Link>
            ) : null}
            <form action={signOutAction} className="ml-auto flex items-center gap-3">
              <span className="text-zinc-500">{user.email}</span>
              {/*
                `data-nav` marks this as chrome rather than the page's own action. It exists
                because the nav's submit button sits before every page's form in the document, so
                a generic `button[type="submit"]` selector — which the E2E walkthrough had used
                unambiguously for months — started signing the user out instead of submitting the
                form they were looking at.
              */}
              <button type="submit" data-nav="logout" className="underline">
                Log out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/today" className="text-zinc-600 hover:underline dark:text-zinc-400">
              Today
            </Link>
            <Link href="/login" className="ml-auto font-medium underline">
              Log in
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
