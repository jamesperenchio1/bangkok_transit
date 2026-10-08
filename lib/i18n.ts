"use client";

import { create } from "zustand";
import type { LineKey, Station } from "@/data/stations";

export type Lang = "en" | "th";

const STORAGE_KEY = "lang";

/**
 * UI language. A zustand store rather than React context because the map's
 * station cards are separate React roots (rendered into MapLibre popups) and
 * still need to follow the toggle. Defaults to English; the choice is
 * remembered per device.
 */
export const useLangStore = create<{ lang: Lang; setLang: (lang: Lang) => void }>((set) => ({
  lang: "en",
  setLang: (lang) => {
    set({ lang });
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage blocked (private mode etc.) - the toggle still works this visit.
    }
    document.documentElement.lang = lang;
  },
}));

/**
 * Restore the saved choice. Called once on mount, not at module load: the
 * page is prerendered in English, and reading storage before hydration would
 * mismatch it.
 */
export function restoreLang() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (saved === "th" || saved === "en") useLangStore.getState().setLang(saved);
}

export function stationName(station: Station, lang: Lang): string {
  return lang === "th" ? station.nameTh || station.nameEn : station.nameEn;
}

const LINE_NAMES: Record<LineKey, { en: string; th: string; shortEn: string; shortTh: string }> = {
  sukhumvit: { en: "BTS Sukhumvit Line", th: "บีทีเอส สายสุขุมวิท", shortEn: "Sukhumvit", shortTh: "สุขุมวิท" },
  silom: { en: "BTS Silom Line", th: "บีทีเอส สายสีลม", shortEn: "Silom", shortTh: "สีลม" },
  gold: { en: "Gold Line", th: "สายสีทอง", shortEn: "Gold", shortTh: "สีทอง" },
  yellow: { en: "MRT Yellow Line", th: "รถไฟฟ้าสายสีเหลือง", shortEn: "Yellow", shortTh: "สีเหลือง" },
  pink: { en: "MRT Pink Line", th: "รถไฟฟ้าสายสีชมพู", shortEn: "Pink", shortTh: "สีชมพู" },
  blue: { en: "MRT Blue Line", th: "รถไฟฟ้ามหานคร สายสีน้ำเงิน", shortEn: "Blue", shortTh: "สีน้ำเงิน" },
  purple: { en: "MRT Purple Line", th: "รถไฟฟ้ามหานคร สายสีม่วง", shortEn: "Purple", shortTh: "สีม่วง" },
  arl: { en: "Airport Rail Link", th: "แอร์พอร์ต เรล ลิงก์", shortEn: "Airport Link", shortTh: "แอร์พอร์ตลิงก์" },
  srtRed: { en: "SRT Red Line", th: "รถไฟชานเมืองสายสีแดง", shortEn: "Red", shortTh: "สีแดง" },
};

/**
 * A line's name. Colors alone don't tell lines apart - Sukhumvit and Silom
 * are both green, Purple and the Airport Rail Link both purple - so wherever
 * a line is shown, its name goes with it.
 */
export function lineName(line: LineKey, lang: Lang, short = false): string {
  const n = LINE_NAMES[line];
  if (short) return lang === "th" ? n.shortTh : n.shortEn;
  return lang === "th" ? n.th : n.en;
}

const strings = {
  en: {
    appTitle: "Bangkok Transit",
    pickStart: "Tap a station on the map",
    pickDestination: "Then tap where you're going",
    nowPickStart: "Now tap your start station",
    nowPickDestination: "Now tap your destination",
    start: "Start",
    destination: "Destination",
    clearStart: "Remove start",
    clearDestination: "Remove destination",
    swap: "Swap start and destination",
    reset: "Reset",
    resetRoute: "Reset route",
    locationDenied: "Location access denied — enable it in your browser settings to see your position on the map.",
    nearest: "Nearest",
    viewRoute: "View route",
    close: "Close",
    googleMaps: "Get directions in Google Maps",
    noRoute: "No route found between these stations yet - try Google Maps above.",
    changeLine: "Change",
    changeTo: "Change to",
    walkTo: (m: string) => `Walk ${m} to`,
    toward: (name: string) => `toward ${name}`,
    stops: (n: number) => `${n} ${n === 1 ? "stop" : "stops"}`,
    changes: (n: number) => (n === 0 ? "no changes" : `${n} ${n === 1 ? "change" : "changes"}`),
    lastKnown: "last known",
    notRunning: (next: string) => `Not running — next ~${next}`,
    nextArrival: "Next arrival",
    then: "then",
    noLiveDataLine: "No live data for this line",
    timesUnavailable: "Live times unavailable right now — retrying…",
    checkingTimes: "Checking times…",
    updated: (ago: string) => `Updated ${ago}`,
    noArrivals: "No live arrivals right now",
    waitingTimes: "Waiting for new times…",
    noLiveData: "No live data",
    closed: "Closed",
    lastKnownDelayed: "Last known time - live updates are delayed",
    searchStations: "Search stations",
    closeSearch: "Close search",
    searchPlaceholder: "Search stations…",
    noStations: "No stations found.",
    centerOnMe: "Center on my location",
    waitingLocation: "Waiting for your location…",
    arriving: "Arriving",
    min: (n: number) => `${n} min`,
    justNow: "just now",
    secondsAgo: (n: number) => `${n}s ago`,
    minutesAgo: (n: number) => `${n} min ago`,
    stationDetails: "Station details",
    back: "Back",
    lines: "Lines",
    exits: "Exits",
    exitCount: (n: number) => `${n} ${n === 1 ? "entrance" : "entrances"} mapped`,
    moreUnnumbered: (n: number) => `+${n} unnumbered`,
    liftExit: "Exit with lift",
    accessibility: "Accessibility",
    wheelchairYes: "Wheelchair accessible",
    wheelchairLimited: "Partly wheelchair accessible",
    wheelchairNo: "Not wheelchair accessible",
    lifts: (n: number) => `${n} street-level ${n === 1 ? "lift" : "lifts"}`,
    toiletsYes: "Toilets",
    toiletsNo: "No public toilets",
    accessibleToilet: "Accessible toilet",
    busStops: (n: number) => `${n} bus ${n === 1 ? "stop" : "stops"} nearby`,
    connections: "Connections",
    walkToStation: (name: string, m: string) => `${name} — ${m} walk`,
    nearby: "Nearby",
    opened: (date: string) => `Opened ${date}`,
    readMore: "Read more on Wikipedia",
    openInMaps: "Open in Google Maps",
    noDetails: "No extra details for this station yet.",
    loadingDetails: "Loading…",
    photoCredit: "Photo",
    sources: "Photos & info: Wikimedia Commons, Wikipedia, © OpenStreetMap contributors.",
    liveTimes: "Next trains",
    placeKinds: {
      mall: "Shopping",
      attraction: "Attraction",
      museum: "Museum",
      hospital: "Hospital",
      university: "University",
      market: "Market",
      park: "Park",
      temple: "Temple",
      pier: "Boat pier",
      landmark: "Landmark",
    },
  },
  th: {
    appTitle: "รถไฟฟ้ากรุงเทพฯ",
    pickStart: "แตะสถานีบนแผนที่",
    pickDestination: "แล้วแตะสถานีที่จะไป",
    nowPickStart: "แตะเลือกสถานีต้นทาง",
    nowPickDestination: "แตะเลือกสถานีปลายทาง",
    start: "ต้นทาง",
    destination: "ปลายทาง",
    clearStart: "ลบต้นทาง",
    clearDestination: "ลบปลายทาง",
    swap: "สลับต้นทางและปลายทาง",
    reset: "เริ่มใหม่",
    resetRoute: "เริ่มเส้นทางใหม่",
    locationDenied: "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดในการตั้งค่าเบราว์เซอร์เพื่อดูตำแหน่งของคุณบนแผนที่",
    nearest: "ใกล้ที่สุด",
    viewRoute: "ดูเส้นทาง",
    close: "ปิด",
    googleMaps: "ขอเส้นทางใน Google Maps",
    noRoute: "ยังไม่พบเส้นทางระหว่างสถานีนี้ - ลองใช้ Google Maps ด้านบน",
    changeLine: "เปลี่ยนสาย",
    changeTo: "เปลี่ยนสายไป",
    walkTo: (m: string) => `เดิน ${m} ไป`,
    toward: (name: string) => `มุ่งหน้า ${name}`,
    stops: (n: number) => `${n} สถานี`,
    changes: (n: number) => (n === 0 ? "ไม่ต้องเปลี่ยนสาย" : `เปลี่ยนสาย ${n} ครั้ง`),
    lastKnown: "ข้อมูลล่าสุดที่มี",
    notRunning: (next: string) => `ไม่มีบริการ — รอบถัดไป ~${next}`,
    nextArrival: "ขบวนถัดไป",
    then: "ถัดไป",
    noLiveDataLine: "ไม่มีข้อมูลเรียลไทม์สำหรับสายนี้",
    timesUnavailable: "ยังไม่มีเวลาเรียลไทม์ — กำลังลองใหม่…",
    checkingTimes: "กำลังตรวจสอบเวลา…",
    updated: (ago: string) => `อัปเดต ${ago}`,
    noArrivals: "ยังไม่มีขบวนเข้าในขณะนี้",
    waitingTimes: "กำลังรอเวลาใหม่…",
    noLiveData: "ไม่มีข้อมูล",
    closed: "ปิด",
    lastKnownDelayed: "เวลาล่าสุดที่มี - การอัปเดตล่าช้า",
    searchStations: "ค้นหาสถานี",
    closeSearch: "ปิดการค้นหา",
    searchPlaceholder: "ค้นหาสถานี…",
    noStations: "ไม่พบสถานี",
    centerOnMe: "ไปยังตำแหน่งของฉัน",
    waitingLocation: "กำลังรอตำแหน่งของคุณ…",
    arriving: "กำลังเข้า",
    min: (n: number) => `${n} นาที`,
    justNow: "เมื่อสักครู่",
    secondsAgo: (n: number) => `${n} วินาทีที่แล้ว`,
    minutesAgo: (n: number) => `${n} นาทีที่แล้ว`,
    stationDetails: "ข้อมูลสถานี",
    back: "กลับ",
    lines: "สายที่ผ่าน",
    exits: "ทางออก",
    exitCount: (n: number) => `มีทางเข้าออก ${n} จุดในแผนที่`,
    moreUnnumbered: (n: number) => `+${n} จุดไม่มีหมายเลข`,
    liftExit: "ทางออกที่มีลิฟต์",
    accessibility: "การเข้าถึง",
    wheelchairYes: "รองรับรถเข็น",
    wheelchairLimited: "รองรับรถเข็นบางส่วน",
    wheelchairNo: "ไม่รองรับรถเข็น",
    lifts: (n: number) => `ลิฟต์ขึ้นลงถนน ${n} ตัว`,
    toiletsYes: "ห้องน้ำ",
    toiletsNo: "ไม่มีห้องน้ำสาธารณะ",
    accessibleToilet: "ห้องน้ำสำหรับผู้ใช้รถเข็น",
    busStops: (n: number) => `ป้ายรถเมล์ใกล้เคียง ${n} ป้าย`,
    connections: "การเชื่อมต่อ",
    walkToStation: (name: string, m: string) => `${name} — เดิน ${m}`,
    nearby: "สถานที่ใกล้เคียง",
    opened: (date: string) => `เปิดให้บริการ ${date}`,
    readMore: "อ่านเพิ่มเติมใน Wikipedia",
    openInMaps: "เปิดใน Google Maps",
    noDetails: "ยังไม่มีข้อมูลเพิ่มเติมสำหรับสถานีนี้",
    loadingDetails: "กำลังโหลด…",
    photoCredit: "ภาพ",
    sources: "ภาพและข้อมูล: Wikimedia Commons, Wikipedia, © ผู้ร่วมพัฒนา OpenStreetMap",
    liveTimes: "ขบวนถัดไป",
    placeKinds: {
      mall: "ห้างสรรพสินค้า",
      attraction: "สถานที่ท่องเที่ยว",
      museum: "พิพิธภัณฑ์",
      hospital: "โรงพยาบาล",
      university: "มหาวิทยาลัย",
      market: "ตลาด",
      park: "สวนสาธารณะ",
      temple: "วัด",
      pier: "ท่าเรือ",
      landmark: "สถานที่สำคัญ",
    },
  },
} satisfies Record<Lang, Record<string, unknown>>;

export type Strings = (typeof strings)["en"];

/** Current language plus its string table. */
export function useT(): { lang: Lang; t: Strings } {
  const lang = useLangStore((s) => s.lang);
  return { lang, t: strings[lang] };
}
