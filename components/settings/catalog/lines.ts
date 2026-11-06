import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "lines", key: "hiddenLines", inverted: true, label: { en: "Lines shown on the map", th: "สายที่แสดงบนแผนที่" }, hint: { en: "Hidden lines are still used for routes.", th: "สายที่ซ่อนยังใช้วางแผนเส้นทางได้" } },
  { kind: "toggle", key: "onlyRouteLines", label: { en: "Only the lines on my route", th: "เฉพาะสายที่อยู่บนเส้นทาง" }, hint: { en: "While a route is shown, draw only the lines it uses.", th: "เมื่อมีเส้นทาง แสดงเฉพาะสายที่ใช้" } },
];
