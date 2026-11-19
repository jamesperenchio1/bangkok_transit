import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "toggle", key: "fewerChanges", label: { en: "Fewer line changes", th: "เปลี่ยนสายให้น้อยที่สุด" }, hint: { en: "Prefer fewer changes, even if slightly slower.", th: "เลือกเปลี่ยนสายน้อยกว่า แม้จะช้ากว่าเล็กน้อย" } },
  { kind: "toggle", key: "avoidWalking", label: { en: "Avoid walking transfers", th: "หลีกเลี่ยงการเดินเปลี่ยนสถานี" }, hint: { en: "Walks are used only when needed.", th: "เดินเมื่อจำเป็นเท่านั้น" } },
  { kind: "range", key: "walkSpeed", label: { en: "Walking speed", th: "ความเร็วในการเดิน" }, hint: { en: "For walking transfers. 75 is average.", th: "สำหรับการเดินเปลี่ยนสถานี ค่าเฉลี่ย 75" }, min: 40, max: 120, step: 5, unit: "m/min" },
  { kind: "range", key: "changeMinutes", label: { en: "Time for a change", th: "เวลาที่ใช้เปลี่ยนสาย" }, hint: { en: "Platform change and wait. Default 5.", th: "เปลี่ยนชานชาลาและรอ ค่าเริ่มต้น 5" }, min: 1, max: 15, step: 1, unit: "min" },
  { kind: "toggle", key: "showFare", label: { en: "Show fares", th: "แสดงค่าโดยสาร" }, hint: { en: "In the header and the route sheet.", th: "ที่ส่วนหัวและรายละเอียดเส้นทาง" } },
];
