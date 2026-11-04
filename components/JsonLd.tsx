// Structured data as an inline JSON-LD block. "<" is escaped so a station name
// can never close the script tag; the CSP already allows inline scripts, and a
// non-JS script type isn't executed anyway.
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
