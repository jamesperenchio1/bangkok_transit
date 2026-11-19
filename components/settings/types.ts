import type { Settings } from "@/lib/settings-store";

/** Text in both languages; the panel picks one. */
export interface Text {
  en: string;
  th: string;
}

interface Base {
  label: Text;
  hint?: Text;
  /** A small heading above this row and the ones after it that share it. */
  group?: Text;
  /** Extra words the search box should match. */
  keywords?: string;
  /** Only meaningful on one of the two maps: the row is hidden on the other. */
  provider?: "standard" | "google";
  /** Hidden when the thing it needs is not available in this build. */
  requires?: "googleKey";
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

export type ChoiceOption = { value: string; label: Text; requires?: "googleKey" };

export type Row =
  | (Base & { kind: "toggle"; key: keyof Settings })
  | (Base & { kind: "choice"; key: keyof Settings; options: ChoiceOption[] })
  | (Base & { kind: "range"; key: keyof Settings; min: number; max: number; step: number; unit?: string; percent?: boolean })
  /** One row per line with two switches: drawn on the map, and used for routes (two independent settings). */
  | (Base & { kind: "lineTable" })
  | (Base & { kind: "language" })
  | (Base & { kind: "action"; id: ActionId });

export type SectionId = "general" | "map" | "lines" | "trains" | "live" | "routing" | "alerts" | "places" | "data";

export type SectionIcon = "general" | "map" | "lines" | "trains" | "live" | "routing" | "alerts" | "places" | "data";

export interface SectionMeta {
  id: SectionId;
  title: Text;
  /** One line under the title in the list. */
  summary: Text;
  icon: SectionIcon;
}

/** Every section, in the order shown. Titles are tiny; the rows live in lazily loaded catalog modules. */
export const SECTIONS: SectionMeta[] = [
  { id: "general", icon: "general", title: { en: "General", th: "ทั่วไป" }, summary: { en: "Language, theme, text size", th: "ภาษา ธีม ขนาดตัวอักษร" } },
  { id: "map", icon: "map", title: { en: "Map", th: "แผนที่" }, summary: { en: "Map source, names, markers, location", th: "แหล่งแผนที่ ชื่อ เครื่องหมาย ตำแหน่ง" } },
  { id: "lines", icon: "lines", title: { en: "Lines", th: "สายรถไฟ" }, summary: { en: "Show or hide each line", th: "แสดงหรือซ่อนแต่ละสาย" } },
  { id: "trains", icon: "trains", title: { en: "Live trains", th: "รถไฟสด" }, summary: { en: "Markers, size, update rate", th: "เครื่องหมาย ขนาด ความถี่" } },
  { id: "live", icon: "live", title: { en: "Live times", th: "เวลารถเข้า" }, summary: { en: "Arrival times, clock, updates", th: "เวลาเข้า นาฬิกา การอัปเดต" } },
  { id: "routing", icon: "routing", title: { en: "Route planning", th: "วางแผนเส้นทาง" }, summary: { en: "Changes, walking, fares", th: "การเปลี่ยนสาย การเดิน ค่าโดยสาร" } },
  { id: "alerts", icon: "alerts", title: { en: "Station alert", th: "แจ้งเตือนสถานี" }, summary: { en: "Sound, screen, notifications", th: "เสียง หน้าจอ การแจ้งเตือน" } },
  { id: "places", icon: "places", title: { en: "Place search", th: "ค้นหาสถานที่" }, summary: { en: "Malls, hospitals, addresses", th: "ห้าง โรงพยาบาล ที่อยู่" } },
  { id: "data", icon: "data", title: { en: "Offline & data", th: "ออฟไลน์และข้อมูล" }, summary: { en: "Offline map, storage, backup, reset", th: "แผนที่ออฟไลน์ พื้นที่เก็บ สำรอง รีเซ็ต" } },
];

/**
 * The stored settings each section owns: what the "changed" dot looks at and
 * what "Reset this section" resets. Kept here (not derived from the catalogs)
 * so the list can show it without downloading every section; a test pins it to
 * the catalogs, and to the full list of settings, so nothing can be added
 * without a home.
 */
export const SECTION_KEYS: Record<SectionId, (keyof Settings)[]> = {
  general: ["theme", "textSize", "units", "reduceMotion", "compactHeader"],
  map: [
    "mapProvider",
    "googleMapType",
    "showLabels",
    "labelLanguage",
    "labelCodes",
    "labelMinZoom",
    "markerSize",
    "lineWidth",
    "routeWidth",
    "dimLines",
    "basemapLabels",
    "showLocation",
    "followMe",
    "autoZoom",
    "zoomButtons",
    "locateButton",
    "rotateGestures",
  ],
  lines: ["hiddenLines", "unusedLines", "onlyRouteLines"],
  trains: ["showTrains", "otherTrains", "trainSize", "trainLabels", "trainRate"],
  live: ["showLiveTimes", "upcomingCount", "clock", "pauseLive"],
  routing: ["fewerChanges", "avoidWalking", "walkSpeed", "changeMinutes", "showFare"],
  alerts: ["alertVolume", "alertRepeats", "alertKeepAwake", "alertNotify"],
  places: ["onlinePlaces", "placeResults"],
  data: ["dataSaver"],
};

/** Headings that group rows inside a section. */
export const GROUPS = {
  source: { en: "Map source", th: "แหล่งแผนที่" },
  names: { en: "Station names", th: "ชื่อสถานี" },
  markers: { en: "Markers and lines", th: "เครื่องหมายและเส้น" },
  basemap: { en: "Map background", th: "พื้นหลังแผนที่" },
  location: { en: "My location", th: "ตำแหน่งของฉัน" },
  controls: { en: "Buttons and gestures", th: "ปุ่มและท่าทาง" },
  offline: { en: "Offline map", th: "แผนที่ออฟไลน์" },
  backup: { en: "Backup", th: "สำรองข้อมูล" },
  device: { en: "This device", th: "เครื่องนี้" },
} as const satisfies Record<string, Text>;
