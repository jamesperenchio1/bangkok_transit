import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "toggle", key: "dataSaver", label: { en: "Data saver", th: "ประหยัดข้อมูล" }, hint: { en: "Don't pre-download map tiles for offline use.", th: "ไม่ดาวน์โหลดแผนที่ล่วงหน้าไว้ใช้แบบออฟไลน์" } },
  { kind: "action", id: "downloadMap", label: { en: "Download the map for offline use now", th: "ดาวน์โหลดแผนที่ไว้ใช้ออฟไลน์ตอนนี้" }, advanced: true },
  { kind: "action", id: "clearMap", label: { en: "Delete the downloaded map", th: "ลบแผนที่ที่ดาวน์โหลดไว้" }, advanced: true },
  { kind: "action", id: "storage", label: { en: "Storage used", th: "พื้นที่ที่ใช้" }, advanced: true },
  { kind: "action", id: "exportSettings", label: { en: "Back up settings", th: "สำรองการตั้งค่า" }, advanced: true },
  { kind: "action", id: "importSettings", label: { en: "Restore settings", th: "กู้คืนการตั้งค่า" }, advanced: true },
  { kind: "action", id: "clearSaved", label: { en: "Clear saved data on this device", th: "ล้างข้อมูลที่บันทึกในเครื่องนี้" }, hint: { en: "Settings, language, last-known times and the alert choices.", th: "การตั้งค่า ภาษา เวลาล่าสุด และตัวเลือกแจ้งเตือน" } },
  { kind: "action", id: "about", label: { en: "About and credits", th: "เกี่ยวกับและเครดิต" } },
];
