"use client";

import { create } from "zustand";
import type { Station } from "@/data/stations";

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

const strings = {
  en: {
    appTitle: "Bangkok Transit",
    hintIdle: "Tap a station, then choose Start or Destination",
    hintStartSet: "Start set — now pick a destination",
    hintDestSet: "Destination set — now pick a start",
    hintRoute: "Route highlighted below",
    start: "Start",
    destination: "Destination",
    clearStart: "Clear start",
    clearDestination: "Clear destination",
    swap: "Swap start and destination",
    clear: "Clear",
    locationDenied: "Location access denied — enable it in your browser settings to see your position on the map.",
    nearest: "Nearest",
    viewRoute: "View route",
    close: "Close",
    googleMaps: "Get directions in Google Maps",
    noRoute: "No route found between these stations yet - try Google Maps above.",
    changeLine: "Change line",
    changeLineToward: (name: string) => `Change line, toward ${name}`,
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
  },
  th: {
    appTitle: "รถไฟฟ้ากรุงเทพฯ",
    hintIdle: "แตะสถานี แล้วเลือกต้นทางหรือปลายทาง",
    hintStartSet: "ตั้งต้นทางแล้ว — เลือกปลายทาง",
    hintDestSet: "ตั้งปลายทางแล้ว — เลือกต้นทาง",
    hintRoute: "แสดงเส้นทางด้านล่าง",
    start: "ต้นทาง",
    destination: "ปลายทาง",
    clearStart: "ล้างต้นทาง",
    clearDestination: "ล้างปลายทาง",
    swap: "สลับต้นทางและปลายทาง",
    clear: "ล้าง",
    locationDenied: "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดในการตั้งค่าเบราว์เซอร์เพื่อดูตำแหน่งของคุณบนแผนที่",
    nearest: "ใกล้ที่สุด",
    viewRoute: "ดูเส้นทาง",
    close: "ปิด",
    googleMaps: "ขอเส้นทางใน Google Maps",
    noRoute: "ยังไม่พบเส้นทางระหว่างสถานีนี้ - ลองใช้ Google Maps ด้านบน",
    changeLine: "เปลี่ยนสาย",
    changeLineToward: (name: string) => `เปลี่ยนสาย ไปทาง ${name}`,
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
  },
} satisfies Record<Lang, Record<string, unknown>>;

export type Strings = (typeof strings)["en"];

/** Current language plus its string table. */
export function useT(): { lang: Lang; t: Strings } {
  const lang = useLangStore((s) => s.lang);
  return { lang, t: strings[lang] };
}
