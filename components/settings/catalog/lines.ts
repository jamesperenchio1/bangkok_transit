import type { Row } from "../types";

export const rows: Row[] = [
  {
    kind: "lineTable",
    label: { en: "Each line", th: "แต่ละสาย" },
    hint: {
      en: "On map: draw the line. Routes: let route planning ride it. Each works on its own, so you can hide a line and still route on it.",
      th: "บนแผนที่: แสดงเส้นสายนั้น เส้นทาง: ให้การวางแผนเส้นทางใช้สายนั้นได้ ตั้งค่าแยกกัน จึงซ่อนสายจากแผนที่แต่ยังใช้วางเส้นทางได้",
    },
    keywords: "show hide lines map routes avoid exclude skip use not used",
  },
  { kind: "toggle", key: "onlyRouteLines", label: { en: "Only the lines on my route", th: "เฉพาะสายที่อยู่บนเส้นทาง" }, hint: { en: "While a route is shown, draw only the lines it uses.", th: "เมื่อมีเส้นทาง แสดงเฉพาะสายที่ใช้" } },
];
