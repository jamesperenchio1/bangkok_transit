import { markdownFor, markdownPages } from "@/lib/markdown";

// One static file per markdown twin (lib/markdown.ts), under /md/. A route
// handler's headers are not kept in a static export, so the Content-Type comes
// from public/_headers (`/md/*`).
export const dynamic = "force-static";
export const dynamicParams = false;

export const generateStaticParams = () => markdownPages().map((p) => ({ path: p.segments }));

export async function GET(_request: Request, { params }: RouteContext<"/md/[...path]">) {
  const body = markdownFor((await params).path);
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
