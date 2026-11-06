import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "language", label: { en: "Language", th: "ภาษา" } },
  { kind: "toggle", key: "showLabels", label: { en: "Station names on the map", th: "ชื่อสถานีบนแผนที่" } },
  { kind: "toggle", key: "showTrains", label: { en: "Live trains", th: "รถไฟสด" } },
  {
    kind: "choice",
    key: "otherTrains",
    label: { en: "Trains off my route", th: "รถไฟที่ไม่อยู่บนเส้นทาง" },
    options: [
      { value: "hide", label: { en: "Hide", th: "ซ่อน" } },
      { value: "dim", label: { en: "Grey out", th: "จางลง" } },
      { value: "show", label: { en: "Show", th: "แสดง" } },
    ],
  },
  { kind: "toggle", key: "showLocation", label: { en: "My location", th: "ตำแหน่งของฉัน" } },
  { kind: "toggle", key: "autoZoom", label: { en: "Zoom in on picked stations", th: "ซูมเข้าสถานีที่เลือก" }, hint: { en: "Off: the map only pans and keeps your zoom.", th: "ปิด: แผนที่เลื่อนไปที่สถานีและคงระดับซูมไว้" } },
  { kind: "toggle", key: "fewerChanges", label: { en: "Fewer line changes", th: "เปลี่ยนสายให้น้อยที่สุด" } },
  {
    kind: "choice",
    key: "theme",
    label: { en: "Theme", th: "ธีม" },
    options: [
      { value: "system", label: { en: "System", th: "ตามระบบ" } },
      { value: "light", label: { en: "Light", th: "สว่าง" } },
      { value: "dark", label: { en: "Dark", th: "มืด" } },
    ],
  },
];
