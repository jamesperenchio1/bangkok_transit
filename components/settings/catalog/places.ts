import type { Row } from "../types";

export const rows: Row[] = [
  { kind: "toggle", key: "onlinePlaces", label: { en: "Search places online", th: "ค้นหาสถานที่ออนไลน์" }, hint: { en: "Malls, hospitals, hotels, addresses… Sends what you type to Google Places.", th: "ห้าง โรงพยาบาล โรงแรม ที่อยู่… ข้อความที่พิมพ์จะถูกส่งไปที่ Google Places" }, keywords: "google privacy places" },
  { kind: "range", key: "placeResults", label: { en: "Places listed", th: "จำนวนสถานที่ที่แสดง" }, min: 3, max: 12, step: 1 },
];
