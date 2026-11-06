import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "action", id: "testSound", label: { en: "Test the alert sound", th: "ทดสอบเสียงแจ้งเตือน" } },
  { kind: "range", key: "alertVolume", label: { en: "Chime volume", th: "ระดับเสียง" }, hint: { en: "On top of your phone's volume.", th: "เพิ่มจากระดับเสียงของเครื่อง" }, min: 0.1, max: 1, step: 0.1, percent: true },
  { kind: "range", key: "alertRepeats", label: { en: "Chime repeats", th: "จำนวนครั้งที่เสียงดัง" }, min: 1, max: 5, step: 1, advanced: true },
  { kind: "toggle", key: "alertKeepAwake", label: { en: "Keep the screen on", th: "เปิดหน้าจอค้างไว้" }, hint: { en: "While an alert is watching your trip. A web page can't track you while the phone sleeps.", th: "ขณะแจ้งเตือนกำลังติดตามการเดินทาง เว็บติดตามไม่ได้ขณะเครื่องดับหน้าจอ" }, advanced: true },
  { kind: "toggle", key: "alertNotify", label: { en: "System notification", th: "การแจ้งเตือนของระบบ" }, hint: { en: "Where the browser allows it (installed app).", th: "เมื่อเบราว์เซอร์อนุญาต (แอปที่ติดตั้ง)" }, advanced: true },
];
