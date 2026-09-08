import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The application root.
 *
 * Until the delivery audit this file was the unmodified `create-next-app` template — a Next.js
 * logo and an instruction to edit it — so the first thing anyone typing the product's own address
 * saw was the starter for the framework it happens to be built on. Every real surface existed and
 * none of them was reachable from here.
 *
 * A redirect rather than a second copy of the dashboard. `/today` is the Morning Brief and it
 * works; rendering its content again under `/` would be two places to change and two places to
 * disagree, which is the shape of defect this repository keeps finding in its own data layer.
 */
export default function Home() {
  redirect("/today");
}
