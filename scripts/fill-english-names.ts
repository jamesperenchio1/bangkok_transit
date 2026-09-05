/**
 * Fills in nameEn for the 75 new-line station drafts (data/raw/new-line-stations.json)
 * using known official English names for well-documented Bangkok Blue/Purple/ARL/Red
 * Line stations. A few smaller suburban stops (marked below) don't have a confidently-
 * known official English name and are given a plain phonetic transliteration instead -
 * worth a spot-check against official signage if precision matters later.
 *
 * Run: node --experimental-strip-types scripts/fill-english-names.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const FILE = path.join(ROOT, "data", "raw", "new-line-stations.json");

const NAME_EN: Record<string, string> = {
  // MRT Blue Line
  หลักสอง: "Lak Song",
  บางแค: "Bang Khae",
  ภาษีเจริญ: "Phasi Charoen",
  "เพชรเกษม 48": "Phetkasem 48",
  บางหว้า: "Bang Wa",
  บางไผ่: "Bang Phai",
  ท่าพระ: "Tha Phra",
  "จรัลสนิทวงศ์ 13": "Charan Sanitwong 13",
  อิสรภาพ: "Itsaraphap",
  สนามไชย: "Sanam Chai",
  สามยอด: "Sam Yot",
  วังมังกร: "Wat Mangkon",
  หัวลำโพง: "Hua Lamphong",
  สามย่าน: "Sam Yan",
  สีลม: "Si Lom",
  ลุมพินี: "Lumphini",
  คลองเตย: "Khlong Toei",
  ศูนย์การประชุมแห่งชาติสิริกิติ์: "Queen Sirikit National Convention Centre",
  สุขุมวิท: "Sukhumvit",
  เพชรบุรี: "Phetchaburi",
  "พระราม 9": "Phra Ram 9",
  ศูนย์วัฒนธรรมแห่งประเทศไทย: "Thailand Cultural Centre",
  ห้วยขวาง: "Huai Khwang",
  สุทธิสาร: "Sutthisan",
  รัชดาภิเษก: "Ratchadaphisek",
  ลาดพร้าว: "Lat Phrao",
  พหลโยธิน: "Phahon Yothin",
  หมอชิต: "Mo Chit",
  กำแพงเพชร: "Kamphaeng Phet",
  บางซื่อ: "Bang Sue",
  เตาปูน: "Tao Poon",
  บางโพ: "Bang Pho",
  บางอ้อ: "Bang O",
  บางพลัด: "Bang Phlat",
  สิรินธร: "Sirindhorn",
  บางยี่ขัน: "Bang Yi Khan",
  บางขุนนนท์: "Bang Khun Non",
  แยกไฟฉาย: "Fai Chai",

  // MRT Purple Line
  คลองบางไผ่: "Khlong Bang Phai",
  ตลาดบางใหญ่: "Talat Bang Yai",
  สามแยกบางใหญ่: "Sam Yaek Bang Yai",
  บางพลู: "Bang Phlu",
  บางรักใหญ่: "Bang Rak Yai",
  ท่าอิฐ: "Tha It",
  ไทรม้า: "Sai Ma",
  สะพานพระนั่งเกล้า: "Phra Nang Klao Bridge",
  "แยกนนทบุรี 1": "Yaek Nonthaburi 1",
  ศรีพรสวรรค์: "Si Phon Sawan", // best-effort transliteration, not a confidently-known official name
  ศูนย์ราชการนนทบุรี: "Nonthaburi Civic Center",
  กระทรวงสาธารณสุข: "Ministry of Public Health",
  แยกติวานนท์: "Yaek Tiwanon",
  วงศ์สว่าง: "Wong Sawang",

  // Airport Rail Link
  พญาไท: "Phaya Thai",
  ราชปรารถ: "Ratchaprarop",
  มักกะสัน: "Makkasan",
  รามคำแหง: "Ramkhamhaeng",
  หัวหมาก: "Hua Mak",
  บ้านทับช้าง: "Ban Thap Chang",
  ลาดกระบัง: "Lat Krabang",
  สุวรรณภูมิ: "Suvarnabhumi",

  // SRT Red Line
  บางซ่อน: "Bang Son",
  บางบำหรุ: "Bang Bamru",
  ตลิ่งชัน: "Taling Chan",
  กลางบางซื่อ: "Krung Thep Aphiwat (Bang Sue Grand)",
  จตุจักร: "Chatuchak",
  วัดเสมียนนารี: "Wat Samian Nari",
  บางเขน: "Bang Khen",
  ทุ่งสองห้อง: "Thung Song Hong",
  หลักสี่: "Lak Si",
  การเคหะ: "Kan Kheha",
  ดอนเมือง: "Don Mueang",
  หลักหก: "Lak Hok",
  รังสิต: "Rangsit",
};

const stations = JSON.parse(readFileSync(FILE, "utf8"));
const missing: string[] = [];
for (const s of stations) {
  const en = NAME_EN[s.nameTh];
  if (!en) {
    missing.push(`${s.code} "${s.nameTh}"`);
    continue;
  }
  s.nameEn = en;
}

if (missing.length) {
  console.log("Missing English names for:");
  missing.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}

writeFileSync(FILE, JSON.stringify(stations, null, 2));
console.log(`Filled English names for all ${stations.length} stations.`);
