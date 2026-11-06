import type { Settings } from "@/lib/settings-store";

/** Text in both languages; the panel picks one. */
export interface Text {
  en: string;
  th: string;
}

interface Base {
  label: Text;
  hint?: Text;
  /** Shown only after "Show advanced options". */
  advanced?: boolean;
  /** Extra words the search box should match. */
  keywords?: string;
}

export type ActionId =
  | "testSound"
  | "downloadMap"
  | "clearMap"
  | "clearSaved"
  | "exportSettings"
  | "importSettings"
  | "storage"
  | "about";

export type Row =
  | (Base & { kind: "toggle"; key: keyof Settings })
  | (Base & { kind: "choice"; key: keyof Settings; options: { value: string; label: Text }[] })
  | (Base & { kind: "range"; key: keyof Settings; min: number; max: number; step: number; unit?: string; percent?: boolean })
  | (Base & { kind: "lines"; key: "hiddenLines" | "avoidLines"; inverted?: boolean })
  | (Base & { kind: "language" })
  | (Base & { kind: "action"; id: ActionId });

export type SectionId =
  | "quick"
  | "map"
  | "lines"
  | "trains"
  | "live"
  | "routing"
  | "alerts"
  | "places"
  | "display"
  | "data";

export interface SectionMeta {
  id: SectionId;
  title: Text;
  /** One line under the title while collapsed. */
  summary: Text;
}

/** Every section, in the order shown. Titles are tiny; the rows live in lazily loaded catalog modules. */
export const SECTIONS: SectionMeta[] = [
  { id: "quick", title: { en: "Quick settings", th: "ตั้งค่าด่วน" }, summary: { en: "The few you'll use most", th: "ที่ใช้บ่อยที่สุด" } },
  { id: "map", title: { en: "Map", th: "แผนที่" }, summary: { en: "Labels, markers, gestures, buttons", th: "ป้ายชื่อ เครื่องหมาย ท่าทาง ปุ่ม" } },
  { id: "lines", title: { en: "Lines", th: "สายรถไฟ" }, summary: { en: "Show or hide each line", th: "แสดงหรือซ่อนแต่ละสาย" } },
  { id: "trains", title: { en: "Live trains", th: "รถไฟสด" }, summary: { en: "Markers, size, update rate", th: "เครื่องหมาย ขนาด ความถี่" } },
  { id: "live", title: { en: "Live times", th: "เวลารถเข้า" }, summary: { en: "Arrival times, clock, updates", th: "เวลาเข้า นาฬิกา การอัปเดต" } },
  { id: "routing", title: { en: "Route planning", th: "วางแผนเส้นทาง" }, summary: { en: "Changes, walking, lines to avoid, fares", th: "การเปลี่ยนสาย การเดิน สายที่เลี่ยง ค่าโดยสาร" } },
  { id: "alerts", title: { en: "Station alert", th: "แจ้งเตือนสถานี" }, summary: { en: "Sound, repeats, screen, notifications", th: "เสียง ความถี่ หน้าจอ การแจ้งเตือน" } },
  { id: "places", title: { en: "Place search", th: "ค้นหาสถานที่" }, summary: { en: "Malls, hospitals, addresses", th: "ห้าง โรงพยาบาล ที่อยู่" } },
  { id: "display", title: { en: "Display", th: "การแสดงผล" }, summary: { en: "Theme, text size, motion, units", th: "ธีม ขนาดตัวอักษร การเคลื่อนไหว หน่วย" } },
  { id: "data", title: { en: "Data & privacy", th: "ข้อมูลและความเป็นส่วนตัว" }, summary: { en: "Offline map, storage, backup, reset", th: "แผนที่ออฟไลน์ พื้นที่เก็บ สำรอง รีเซ็ต" } },
];
