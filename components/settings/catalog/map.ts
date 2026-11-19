import { GROUPS, type Row } from "../types";

const sizes = [
  { value: "small", label: { en: "Small", th: "เล็ก" } },
  { value: "medium", label: { en: "Medium", th: "กลาง" } },
  { value: "large", label: { en: "Large", th: "ใหญ่" } },
];

export const rows: Row[] = [
  {
    kind: "choice",
    key: "mapProvider",
    group: GROUPS.source,
    label: { en: "Map", th: "แผนที่" },
    hint: {
      en: "Standard is saved on this device, so it works offline. Google Maps loads live from Google and needs the internet; if it can't load, Standard is shown instead.",
      th: "แผนที่มาตรฐานถูกเก็บไว้ในเครื่องจึงใช้ออฟไลน์ได้ ส่วน Google Maps โหลดสดจาก Google ต้องใช้อินเทอร์เน็ต หากโหลดไม่ได้จะแสดงแผนที่มาตรฐานแทน",
    },
    keywords: "provider basemap google offline",
    options: [
      { value: "standard", label: { en: "Standard (offline)", th: "มาตรฐาน (ออฟไลน์)" } },
      { value: "google", label: { en: "Google Maps", th: "Google Maps" }, requires: "googleKey" },
    ],
  },
  {
    kind: "choice",
    key: "googleMapType",
    provider: "google",
    label: { en: "Google map style", th: "รูปแบบแผนที่ Google" },
    keywords: "satellite hybrid roadmap terrain",
    options: [
      { value: "roadmap", label: { en: "Roadmap", th: "แผนที่ถนน" } },
      { value: "terrain", label: { en: "Terrain", th: "ภูมิประเทศ" } },
      { value: "hybrid", label: { en: "Hybrid", th: "ไฮบริด" } },
      { value: "satellite", label: { en: "Satellite", th: "ดาวเทียม" } },
    ],
  },

  { kind: "toggle", key: "showLabels", group: GROUPS.names, label: { en: "Station names", th: "ชื่อสถานี" } },
  {
    kind: "choice",
    key: "labelLanguage",
    label: { en: "Label language", th: "ภาษาของป้ายชื่อ" },
    options: [
      { value: "ui", label: { en: "Follow the app", th: "ตามภาษาแอป" } },
      { value: "en", label: { en: "English", th: "อังกฤษ" } },
      { value: "th", label: { en: "Thai", th: "ไทย" } },
      { value: "both", label: { en: "Both", th: "ทั้งสอง" } },
    ],
  },
  { kind: "toggle", key: "labelCodes", label: { en: "Station codes under names", th: "รหัสสถานีใต้ชื่อ" }, hint: { en: "Appears when zoomed in.", th: "แสดงเมื่อซูมเข้า" } },
  { kind: "range", key: "labelMinZoom", label: { en: "Show names from zoom", th: "แสดงชื่อตั้งแต่ระดับซูม" }, hint: { en: "Lower shows names sooner (busier map).", th: "ค่าต่ำแสดงชื่อเร็วขึ้น (แผนที่แน่นขึ้น)" }, min: 8, max: 15, step: 1 },

  { kind: "choice", key: "markerSize", group: GROUPS.markers, label: { en: "Station dot size", th: "ขนาดจุดสถานี" }, options: sizes },
  { kind: "range", key: "lineWidth", label: { en: "Line thickness", th: "ความหนาของเส้น" }, min: 2, max: 8, step: 1, unit: "px" },
  { kind: "range", key: "routeWidth", label: { en: "Route thickness", th: "ความหนาของเส้นทาง" }, min: 3, max: 10, step: 1, unit: "px" },
  { kind: "toggle", key: "dimLines", label: { en: "Grey out other lines on a route", th: "ทำให้สายอื่นจางลงเมื่อมีเส้นทาง" } },

  { kind: "toggle", key: "basemapLabels", group: GROUPS.basemap, label: { en: "Street and place names", th: "ชื่อถนนและสถานที่" }, hint: { en: "The map's own names, not stations.", th: "ชื่อบนแผนที่พื้นฐาน ไม่ใช่สถานี" }, keywords: "roads basemap" },

  { kind: "toggle", key: "showLocation", group: GROUPS.location, label: { en: "My location dot", th: "จุดตำแหน่งของฉัน" } },
  { kind: "toggle", key: "followMe", label: { en: "Follow my location", th: "ตามตำแหน่งของฉัน" }, hint: { en: "Dragging the map turns it off.", th: "ลากแผนที่เพื่อปิด" }, keywords: "gps tracking" },
  { kind: "toggle", key: "autoZoom", label: { en: "Zoom in on picked stations", th: "ซูมเข้าสถานีที่เลือก" }, hint: { en: "Off: the map only pans and keeps your zoom.", th: "ปิด: แผนที่เลื่อนไปที่สถานีและคงระดับซูมไว้" } },

  { kind: "toggle", key: "zoomButtons", group: GROUPS.controls, label: { en: "Zoom buttons (+ / −)", th: "ปุ่มซูม (+ / −)" } },
  { kind: "toggle", key: "locateButton", label: { en: "Locate-me button", th: "ปุ่มไปยังตำแหน่งของฉัน" } },
  { kind: "toggle", key: "rotateGestures", provider: "standard", label: { en: "Rotate and tilt gestures", th: "ท่าทางหมุนและเอียงแผนที่" }, hint: { en: "Off keeps the map north-up.", th: "ปิดเพื่อให้แผนที่หันทิศเหนือขึ้นบนเสมอ" } },
];
