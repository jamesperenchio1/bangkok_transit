import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "toggle", key: "showLiveTimes", label: { en: "Show live arrival times", th: "แสดงเวลารถเข้าแบบสด" }, hint: { en: "On station cards, search and the route sheet.", th: "ในการ์ดสถานี การค้นหา และรายละเอียดเส้นทาง" } },
  { kind: "range", key: "upcomingCount", label: { en: "Trains listed per platform", th: "จำนวนขบวนต่อชานชาลา" }, min: 1, max: 5, step: 1 },
  {
    kind: "choice",
    key: "clock",
    label: { en: "Clock", th: "รูปแบบนาฬิกา" },
    options: [
      { value: "auto", label: { en: "Automatic", th: "อัตโนมัติ" } },
      { value: "12h", label: { en: "12-hour", th: "12 ชั่วโมง" } },
      { value: "24h", label: { en: "24-hour", th: "24 ชั่วโมง" } },
    ],
  },
  { kind: "toggle", key: "pauseLive", label: { en: "Pause live updates", th: "หยุดอัปเดตเวลาสด" }, hint: { en: "Saves data and battery. Times age and are shown as last-known.", th: "ประหยัดข้อมูลและแบตเตอรี่ เวลาจะเก่าลงและแสดงเป็นค่าล่าสุด" }, keywords: "data saver battery" },
];
