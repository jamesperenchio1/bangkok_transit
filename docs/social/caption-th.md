# แคปชันแนะนำแอป (ภาษาไทย) — เสียงคนทำแอป

ภาพที่แนบ (ตามลำดับ): `1-home-th.png`, `2-station-th.png`, `3-route-th.png`, `7-airport-route-th.png`, `5-zoom-th.png`, `6-search-th.png`

กลุ่มภาษาอังกฤษใช้ชุด `-en` (1-home, 2-station, 3-route, 7-airport-route, 5-zoom, 6-search)

หมายเหตุ: เวลาขบวนในภาพเป็นข้อมูลจำลอง ถ่ายตอนรถไฟฟ้ายังไม่เปิดให้บริการ

## Facebook (กลุ่มคนไทย)

สวัสดีครับ ผมทำแอปตัวหนึ่งมาแก้ปัญหาที่เจอเองเวลาขึ้นรถไฟฟ้าในกรุงเทพ

ปัญหาคือข้อมูลรถไฟฟ้ากระจัดกระจายมาก แต่ละสายแต่ละเจ้าก็คนละแอป คนละแผนที่ พอต้องต่อข้ามเจ้า เช่น BTS ไป MRT หรือไปแอร์พอร์ตลิงก์ ก็ต้องสลับไปมา ยังไม่นับเวลาอยู่ใต้ดินแล้วสัญญาณหาย

เลยทำ "Bangkok Transit" ขึ้นมา เป็นแผนที่รถไฟฟ้าทุกสายในหน้าเดียว
(BTS, MRT น้ำเงิน/ม่วง/เหลือง/ชมพู, สายสีทอง, แอร์พอร์ตเรลลิงก์, รถไฟสายสีแดง)

สิ่งที่แอปทำได้
• แตะต้นทางกับปลายทาง บอกเส้นทางทันที ต้องเปลี่ยนสายที่ไหน เดินต่อกี่เมตร ขึ้นขบวนไปทางไหน ใช้เวลาประมาณกี่นาที
• แสดงตำแหน่งของคุณบนแผนที่ และบอกว่าสถานีที่ใกล้ที่สุดคือสถานีไหน ห่างกี่เมตร
• เวลาขบวนถัดไปแบบสด ตอนนี้มี "เฉพาะ BTS เท่านั้น" เพราะ BTS มี API ให้ดึงข้อมูล ส่วน MRT แอร์พอร์ตลิงก์ และสายสีแดงยังไม่มีข้อมูลแบบนี้ให้ใช้ แต่ผมจะคอยจับตาดูอยู่ ถ้าเจ้าไหนเปิดให้เมื่อไหร่จะรีบเพิ่มให้
• เปิดครั้งแรกแล้วใช้ตอนไม่มีเน็ตได้ แผนที่ ค้นหา และเส้นทางยังทำงาน (เฉพาะเวลาสดที่จะหยุดไว้ก่อน)
• ตั้งเตือนก่อนถึงสถานีปลายทางได้
• ไทย/อังกฤษสลับได้ในปุ่มเดียว

👉 bangkok-transit.com

ยังเป็นงานที่กำลังปรับอยู่เรื่อย ๆ ใครลองแล้วเจออะไรไม่ตรง หรืออยากให้เพิ่มอะไร คอมเมนต์บอกได้เลยครับ

#รถไฟฟ้า #BTS #MRT #กรุงเทพ #BangkokTransit

## X (ทวิตเตอร์)

ผมทำแอปนี้เพราะข้อมูลรถไฟฟ้ากระจายอยู่หลายแอป ต่อข้ามสายทีต้องสลับไปมา
เลยรวมทุกสายไว้ในแผนที่เดียว บอกเส้นทางทันที เห็นตำแหน่งคุณเทียบกับสถานีใกล้สุด มีเวลาขบวนถัดไปสดเฉพาะ BTS (เพราะมี API) ส่วนสายอื่นผมจะคอยจับตาดูอยู่
bangkok-transit.com

## X ฉบับสั้น

ทำแอปนี้เพราะเบื่อสลับหลายแอปเวลาต่อรถไฟฟ้า รวมทุกสายในแผนที่เดียว เห็นตำแหน่งคุณเทียบกับสถานี เวลาสดมีเฉพาะ BTS ตอนนี้ สายอื่นจะคอยจับตาดูให้
bangkok-transit.com

---

# English (for expat / traveller groups)

Hi all, I built a small app to fix something that kept annoying me on the Bangkok rail network.

Every line has its own operator, its own app and its own map, so a trip like BTS → MRT → Airport Rail Link means juggling several of them, and signal drops once you're underground.

So I made Bangkok Transit: one map with every rail line (BTS, MRT Blue/Purple/Yellow/Pink, Gold, Airport Rail Link, SRT Red).

• Tap a start and a destination and it gives you the route: where to change, how far the walk is between stations, which direction to board, rough travel time
• Shows your live location on the map and your nearest station, with the distance
• Live next-train times, but ONLY for the BTS right now. That's because the BTS has an API I can pull from. The MRT, Airport Rail Link and SRT Red don't offer one yet, but I'm keeping an eye out and will add them as soon as any of them do
• Works offline after your first visit (map, search, routes; only live times pause)
• Optional "wake me before my stop" alert
• Thai / English in one tap

👉 bangkok-transit.com

Still improving it, so tell me what's missing or wrong in the comments.
