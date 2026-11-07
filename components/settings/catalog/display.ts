import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "language", label: { en: "Language", th: "ภาษา" } },
  {
    kind: "choice",
    key: "theme",
    label: { en: "Theme", th: "ธีม" },
    options: [
      { value: "system", label: { en: "System", th: "ตามระบบ" } },
      { value: "light", label: { en: "Light", th: "สว่าง" } },
      { value: "dark", label: { en: "Dark", th: "มืด" } },
    ],
    keywords: "dark mode night",
  },
  { kind: "range", key: "textSize", label: { en: "Text size", th: "ขนาดตัวอักษร" }, min: 90, max: 150, step: 5, unit: "%", keywords: "font larger accessibility" },
  { kind: "toggle", key: "reduceMotion", label: { en: "Reduce motion", th: "ลดการเคลื่อนไหว" }, hint: { en: "No camera or sheet animations.", th: "ไม่มีแอนิเมชันกล้องและแผ่นข้อมูล" } },
  { kind: "toggle", key: "compactHeader", label: { en: "Compact header", th: "ส่วนหัวแบบกะทัดรัด" }, hint: { en: "Hides the hint line under the title.", th: "ซ่อนบรรทัดคำแนะนำใต้ชื่อ" }, advanced: true },
  {
    kind: "choice",
    key: "units",
    label: { en: "Distance units", th: "หน่วยระยะทาง" },
    options: [
      { value: "metric", label: { en: "Metres / km", th: "เมตร / กม." } },
      { value: "imperial", label: { en: "Feet / miles", th: "ฟุต / ไมล์" } },
    ],
    advanced: true,
  },
];
