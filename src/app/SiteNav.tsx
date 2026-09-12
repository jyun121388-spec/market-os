import Link from "next/link";
import { getCurrentUser, signOutAction } from "@/server/actions/auth";
import { isOperatorEmail } from "@/server/domain/operatorAccess";

/**
 * Global navigation. Every normal-user surface required by V1 is reachable without typing a URL.
 * Buffett Oracle is a research lens over Market OS evidence, not a second provider/data authority.
 */
export async function SiteNav() {
  const user = await getCurrentUser();
  const isOperator = isOperatorEmail(user?.email);

  return (
    <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 text-sm">
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
            <Link href="/oracle" className="font-medium text-amber-700 hover:underline dark:text-amber-400">
              Buffett Oracle
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
