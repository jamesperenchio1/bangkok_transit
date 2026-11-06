import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "toggle", key: "showTrains", label: { en: "Show live trains", th: "แสดงรถไฟสด" }, hint: { en: "Estimated positions of BTS trains.", th: "ตำแหน่งโดยประมาณของรถไฟ BTS" } },
  {
    kind: "choice",
    key: "otherTrains",
    label: { en: "Trains off my route", th: "รถไฟที่ไม่อยู่บนเส้นทาง" },
    hint: { en: "While a route is shown.", th: "เมื่อมีเส้นทางแสดงอยู่" },
    options: [
      { value: "hide", label: { en: "Hide", th: "ซ่อน" } },
      { value: "dim", label: { en: "Grey out", th: "จางลง" } },
      { value: "show", label: { en: "Show", th: "แสดง" } },
    ],
  },
  {
    kind: "choice",
    key: "trainSize",
    label: { en: "Train marker size", th: "ขนาดเครื่องหมายรถไฟ" },
    advanced: true,
    options: [
      { value: "small", label: { en: "Small", th: "เล็ก" } },
      { value: "medium", label: { en: "Medium", th: "กลาง" } },
      { value: "large", label: { en: "Large", th: "ใหญ่" } },
    ],
  },
  { kind: "toggle", key: "trainLabels", label: { en: "Text beside trains", th: "ข้อความข้างรถไฟ" }, hint: { en: "Destination and next stop, when zoomed in.", th: "ปลายทางและสถานีถัดไป เมื่อซูมเข้า" }, advanced: true },
  {
    kind: "choice",
    key: "trainRate",
    label: { en: "Update rate", th: "ความถี่การอัปเดต" },
    hint: { en: "Battery saver redraws every 2 seconds.", th: "โหมดประหยัดแบตเตอรี่วาดใหม่ทุก 2 วินาที" },
    advanced: true,
    options: [
      { value: "smooth", label: { en: "Smooth", th: "ลื่นไหล" } },
      { value: "saver", label: { en: "Battery saver", th: "ประหยัดแบตเตอรี่" } },
    ],
  },
];
