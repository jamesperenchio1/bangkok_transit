import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Bangkok transit rules, fares and etiquette",
  description:
    "Official rules for BTS, MRT Blue and Purple, SRT Red and the Airport Rail Link: opening hours, child fares, time limits, food, pets, bicycles, tickets and fines.",
  path: "/info",
});

const operators = [
  {
    name: "BTS",
    lines: "Sukhumvit, Silom, Gold",
    hours: "06:00–24:00",
    limit: "300 minutes",
    child: "Under 90 cm",
    food: "No food or drink in the paid area or on trains",
    pets: "Guide dogs only",
    bikes: "Standard bikes in limited windows; foldables anytime",
  },
  {
    name: "MRT Blue / Purple",
    lines: "Blue, Purple (BEM)",
    hours: "06:00–24:00",
    limit: "180 minutes",
    child: "Under 90 cm, carried through the gate",
    food: "No food, drinks or snacks in the paid area",
    pets: "No pets",
    bikes: "No bicycles",
  },
  {
    name: "SRT Red",
    lines: "Light Red, Dark Red",
    hours: "05:30–24:00",
    limit: "120 minutes",
    child: "4 years or under and 90 cm or under",
    food: "Follow station notices",
    pets: "Follow station notices",
    bikes: "Follow station notices",
  },
  {
    name: "Airport Rail Link",
    lines: "Phaya Thai–Suvarnabhumi",
    hours: "About 05:30–24:00",
    limit: "Check station notices",
    child: "90 cm or under with an adult",
    food: "Follow station notices",
    pets: "Follow station notices",
    bikes: "Follow station notices",
  },
];

const btsFines = [
  ["Damaging or defacing system property", "Up to 5,000 THB"],
  ["Spitting, littering, smoking, unauthorised selling", "Up to 2,000 THB"],
  ["Animals, unreasonable noise, alcohol, lewd behaviour", "Up to 500 THB"],
  ["Deliberate pushing, panic or disturbance", "Up to 1 month or 1,000 THB, or both"],
];

export default function InfoPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Bangkok transit rules, fares and etiquette</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-300">
          Each operator sets its own rules, fares and ticket conditions. This page
          summarises the official English guidance for BTS, MRT Blue and Purple,
          SRT Red and the Airport Rail Link. Checked 12 November 2026 — always
          confirm current fares and notices at the station.
        </p>
      </header>

      <section aria-labelledby="quick">
        <h2 id="quick" className="text-lg font-semibold">
          Quick comparison
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
              <tr>
                <th className="p-3 font-medium">Operator</th>
                <th className="p-3 font-medium">Hours</th>
                <th className="p-3 font-medium">Paid-area limit</th>
                <th className="p-3 font-medium">Children</th>
                <th className="p-3 font-medium">Food and drink</th>
                <th className="p-3 font-medium">Pets and bikes</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((operator) => (
                <tr
                  key={operator.name}
                  className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
                >
                  <td className="p-3 align-top">
                    <span className="font-medium">{operator.name}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                      {operator.lines}
                    </span>
                  </td>
                  <td className="p-3 align-top">{operator.hours}</td>
                  <td className="p-3 align-top">{operator.limit}</td>
                  <td className="p-3 align-top">{operator.child}</td>
                  <td className="p-3 align-top">{operator.food}</td>
                  <td className="p-3 align-top">
                    {operator.pets}
                    <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                      {operator.bikes}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="bts">
        <h2 id="bts" className="text-lg font-semibold">
          BTS
        </h2>
        <div className="mt-2 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            Trains run daily from 06:00 to 24:00. Children under 90 cm travel
            free and must be carried through the automatic gate. A journey must
            be completed within 300 minutes; staying longer is charged the
            maximum single-journey fare.
          </p>
          <p>
            Eating and drinking are not allowed in the paid area or on trains.
            Pets are not allowed; guide dogs accompanying a blind passenger are
            the exception. Smoking, weapons, dangerous goods, alcohol, loud
            devices, selling, begging, leaflets and loitering are prohibited.
          </p>
          <p>
            Standard bicycles are allowed only on weekdays 06:00–06:30 and
            22:00–24:00, and on weekends and public holidays 06:00–09:00 and
            22:00–24:00. Foldable bicycles are allowed during all operating
            hours. Fold the bike at ground level, use the right side of the
            stairs, leave it in front of the manual gate, ask staff, and hold it
            at all times. Riding inside the system is prohibited.
          </p>
          <p>
            Single Journey tickets are valid only on the date of purchase.
            Leaving the paid area at the same station within five minutes can be
            refunded at the ticket office. A lost ticket is charged the maximum
            fare, and fare evasion can be fined up to 20 times the maximum fare.
            Rabbit cards can be used for stored value and passes, but a negative
            balance blocks travel until it is topped up.
          </p>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                <tr>
                  <th className="p-3 font-medium">BTS fine</th>
                  <th className="p-3 font-medium">Maximum</th>
                </tr>
              </thead>
              <tbody>
                {btsFines.map(([rule, fine]) => (
                  <tr
                    key={rule}
                    className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
                  >
                    <td className="p-3 align-top">{rule}</td>
                    <td className="p-3 align-top whitespace-nowrap">{fine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="mrt">
        <h2 id="mrt" className="text-lg font-semibold">
          MRT Blue and Purple
        </h2>
        <div className="mt-2 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            BEM operates the Blue and Purple lines. A Single Journey Token is
            valid only on the date and at the station where it was issued, and
            must be returned at the destination gate. The paid-area limit is 180
            minutes; overstaying is charged the maximum fare.
          </p>
          <p>
            Food, drinks and snacks are not allowed anywhere in the paid area.
            Pets, bicycles and roller shoes are not allowed. Queue behind the
            yellow line, let passengers leave first, hold a rail or strap, and do
            not lean on or block the doors. Lift luggage above the gate and pass
            one person at a time.
          </p>
          <p>
            Contactless EMV bank cards charge the standard adult fare, one card
            per traveller. Tap the same card in and out; if you forget to tap out
            or use a different card, the maximum fare is charged. Mastercard may
            show a 1 THB pre-authorisation on first use. Ticket offices do not
            top up bank cards, and disputes must be raised within 14 days.
          </p>
        </div>
      </section>

      <section aria-labelledby="srt">
        <h2 id="srt" className="text-lg font-semibold">
          SRT Red
        </h2>
        <div className="mt-2 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            SRT Red trains run daily from 05:30 to 24:00. Fares are distance
            based at 1.50 THB per kilometre: 12–42 THB for adults, 11–38 THB for
            students and 6–21 THB for seniors. Children aged four or under and
            90 cm or under travel free. Disabled passengers travel free with a
            government-issued disability card.
          </p>
          <p>
            The paid-area limit is 120 minutes; overstaying is charged the
            maximum fare. Single Journey tokens are valid on the purchase date
            and are not refundable. A stored-value card costs 300 THB (200 THB
            value, 50 THB deposit and 50 THB issuance). A 30-day, 30-trip card
            costs 800 THB.
          </p>
          <p>
            A through ticket is available between Rangsit and Taling Chan; change
            platforms at Krung Thep Aphiwat (Bang Sue Grand).
          </p>
        </div>
      </section>

      <section aria-labelledby="arl">
        <h2 id="arl" className="text-lg font-semibold">
          Airport Rail Link
        </h2>
        <div className="mt-2 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            The Airport Rail Link runs from Phaya Thai to Suvarnabhumi, eight
            stations, with fares of 15–45 THB. Trains run from about 05:30 to
            24:00, with the last train often leaving before midnight. Children
            90 cm or under travel free with an adult.
          </p>
          <p>
            Rabbit cards are not accepted. Contactless EMV bank cards have been
            accepted at all eight stations since 8 November 2025; each traveller
            needs their own card and must tap the same card in and out. The
            Airport Rail Link charges a separate fare from BTS and MRT, even at
            interchanges such as Phaya Thai, Makkasan and Hua Mak.
          </p>
        </div>
      </section>

      <section aria-labelledby="cross">
        <h2 id="cross" className="text-lg font-semibold">
          Across operators
        </h2>
        <div className="mt-2 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            There is no single Bangkok transit ticket. BTS, MRT, SRT Red and the
            Airport Rail Link each charge their own fare, so a transfer normally
            means exiting one system and paying again.
          </p>
          <p>
            From December 2025 to November 2026, MRT Purple and SRT Red journeys
            paid with a contactless EMV Visa, Mastercard or UnionPay card are
            capped at 40 THB per day for unlimited journeys. The cap applies to
            each line or both together; if the actual fare is lower, the lower
            fare is charged.
          </p>
        </div>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources" className="text-lg font-semibold">
          Official sources
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700 underline-offset-2 dark:text-neutral-300">
          <li>
            <a className="hover:underline" href="https://www.bts.co.th/eng/faq/faq-howto.html">
              BTS FAQ
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.bts.co.th/eng/suggestion/suggestion-04.html">
              BTS dos and don&apos;ts
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.bts.co.th/eng/suggestion/suggestion-03.html">
              BTS bicycle policy
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.bts.co.th/eng/service/AnnouncementandRegulations.html">
              BTS regulations and fines
            </a>
            {" · "}
            <a className="hover:underline" href="https://btsapp1.bts.co.th/website/eng/tickets/ticket-conditions.html">
              BTS ticket conditions
            </a>
          </li>
          <li>
            <a className="hover:underline" href="https://metro.bemplc.co.th/Terms-of-Use?lang=en">
              BEM terms of use
            </a>
            {" · "}
            <a className="hover:underline" href="https://metro.bemplc.co.th/Services-Detail?lang=en&pid=6">
              BEM safety and conduct
            </a>
            {" · "}
            <a className="hover:underline" href="https://metro.bemplc.co.th/Ticket-Type?lang=en">
              BEM ticket types
            </a>
          </li>
          <li>
            <a className="hover:underline" href="https://www.srtet.co.th/en/faq">
              SRT Red FAQ
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.srtet.co.th/en/ticket-types">
              SRT Red ticket types
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.srtet.co.th/en/fare-information">
              SRT Red fares
            </a>
            {" · "}
            <a className="hover:underline" href="https://www.mrta.co.th/en/ticket-transaction">
              MRTA daily fare policy
            </a>
          </li>
        </ul>
      </section>
    </article>
  );
}
