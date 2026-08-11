"use client";

/**
 * Station detail: live arrivals, accessibility, exits and service hours.
 *
 * The arrivals block is the reason the page exists, so it leads. It is styled
 * after a platform departure board — countdowns in tabular figures, destination
 * set Thai over English the way BTS station signage does — and it counts down
 * every second between network refreshes rather than sitting still for a minute.
 */
import { Accessibility, ArrowUpDown, Baby, Clock, DoorOpen, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { useArrivals } from "@/lib/use-arrivals";
import { currentEta, btsSchematic, type Platform } from "@/lib/bts";
import type { StationInfo } from "@/lib/station-info";
import { useMemo } from "react";

interface Props {
  code: string | null;
  info: StationInfo | undefined;
  onClose: () => void;
}

/** Below this the train is effectively at the platform. */
const ARRIVING_MIN = 0.5;

function lineFor(code: string) {
  return btsSchematic.lines.find((l) => l.stations.some((s) => s.code === code));
}

/**
 * Above this, seconds stop being actionable — you are not sprinting for a train
 * eleven minutes out — and `M:SS` starts being misread as a clock time, which is
 * a real hazard on something shaped like a departure board. Under it, the ticking
 * seconds are the point.
 */
const SECONDS_MATTER_BELOW_MIN = 10;

function formatEta(minutes: number): string {
  if (minutes >= SECONDS_MATTER_BELOW_MIN) return String(Math.round(minutes));
  const total = Math.max(0, Math.round(minutes * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function StationPanel({ code, info, onClose }: Props) {
  const { t, language } = useLanguage();
  const { data, now, fresh } = useArrivals(code);
  const line = useMemo(() => (code ? lineFor(code) : undefined), [code]);

  if (!code) return null;

  const th = language === "th";
  const name = info ? (th ? info.nameTh || info.nameEn : info.nameEn) : code;
  const secondary = info ? (th ? info.nameEn : info.nameTh) : "";

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={info?.nameEn ?? code}
      className="flex h-full w-full flex-col overflow-y-auto overscroll-contain bg-background"
    >
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span
          className="mt-0.5 shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular text-white"
          style={{ backgroundColor: line?.color ?? "var(--muted-foreground)" }}
        >
          {code}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{name}</h2>
          {secondary && <p className="truncate text-xs text-muted-foreground">{secondary}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closePanel")}
          className="-mr-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col gap-5 px-4 py-4">
        <section>
          <SectionTitle>{t("liveArrivals")}</SectionTitle>

          {!line?.hasLiveArrivals ? (
            <Muted>{t("noLiveArrivals")}</Muted>
          ) : !data ? (
            <Muted>{t("updating")}…</Muted>
          ) : !data.serviceActive ? (
            <Muted>
              {t("serviceEnded")}
              {data.nextService ? ` · ${data.nextService}` : ""}
            </Muted>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Times older than the freshness window would be actively wrong —
                  the trains they describe have already gone — so the board holds
                  its shape but stops claiming a number. */}
              {!fresh && <Muted>{t("updating")}…</Muted>}
              {data.platforms.map((platform) => (
                <PlatformBoard
                  key={platform.platform}
                  platform={platform}
                  dataAt={data.dataAt}
                  now={now}
                  fresh={fresh}
                  th={th}
                  arrivingLabel={t("arriving")}
                  towardsLabel={t("towards")}
                  minLabel={t("minutes")}
                />
              ))}
              {data.platforms.length === 0 && <Muted>{t("noTrainsScheduled")}</Muted>}
            </div>
          )}
        </section>

        {info?.access && (
          <section>
            <SectionTitle>{t("accessibility")}</SectionTitle>
            <ul className="flex flex-col gap-1.5 text-sm">
              <Fact
                icon={<Accessibility className="h-4 w-4" />}
                on={info.access.stepFree}
                label={info.access.stepFree ? t("stepFreeAccess") : t("noStepFreeAccess")}
              />
              {info.access.elevators > 0 && (
                <Fact
                  icon={<ArrowUpDown className="h-4 w-4" />}
                  on
                  label={`${info.access.elevators} ${t("elevators").toLowerCase()}`}
                />
              )}
              {info.access.babyChanging && (
                <Fact icon={<Baby className="h-4 w-4" />} on label={t("babyChanging")} />
              )}
            </ul>
          </section>
        )}

        {info?.exits?.length ? (
          <section>
            <SectionTitle>{t("exits")}</SectionTitle>
            <ul className="flex flex-col gap-2 text-sm">
              {info.exits.map((exit) => {
                const landmarks = th ? exit.landmarksTh : exit.landmarksEn;
                return (
                  <li key={exit.number} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-medium tabular">
                      {exit.number}
                    </span>
                    <span className="text-muted-foreground">
                      {landmarks.length ? landmarks.join(" · ") : <DoorOpen className="h-4 w-4" />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {info?.firstTrain && (
          <section>
            <SectionTitle>{t("firstLastTrain")}</SectionTitle>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="tabular">
                {info.firstTrain} – {info.lastTrain}
              </span>
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}

function PlatformBoard({
  platform,
  dataAt,
  now,
  fresh,
  th,
  arrivingLabel,
  towardsLabel,
  minLabel,
}: {
  platform: Platform;
  dataAt: number;
  now: number;
  fresh: boolean;
  th: boolean;
  arrivingLabel: string;
  towardsLabel: string;
  minLabel: string;
}) {
  const direction = th ? platform.directionTh : platform.directionEn;
  const alt = th ? platform.directionEn : platform.directionTh;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        className="flex items-baseline gap-2 border-l-[3px] px-3 py-2"
        style={{ borderLeftColor: platform.lineColor }}
      >
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {towardsLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{direction}</span>
        {alt && alt !== direction && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{alt}</span>
        )}
      </div>

      <ul className="divide-y">
        {platform.trains.map((train, i) => {
          const eta = currentEta(train, dataAt, now);
          const arriving = eta <= ARRIVING_MIN;
          return (
            <li key={`${train.trainNo}-${i}`} className="flex items-baseline gap-1.5 px-3 py-2">
              <span
                // Only colour it as arriving when the value is current; a stale
                // placeholder must not be highlighted as though a train is here.
                className={`tabular text-lg font-semibold ${
                  fresh && arriving ? "text-[var(--arriving)]" : ""
                }`}
                // Announce whole minutes only; a per-second live region would be
                // unusable with a screen reader.
                aria-label={`${Math.max(0, Math.round(eta))} minutes`}
              >
                {!fresh ? "—" : arriving ? arrivingLabel : formatEta(eta)}
              </span>
              {/* The unit is what stops a countdown like 18:53 being read as a
                  clock time on a panel shaped like a departure board. */}
              {fresh && !arriving && (
                <span aria-hidden className="text-[11px] text-muted-foreground">
                  {minLabel}
                </span>
              )}
              <span className="ml-auto text-[11px] tabular text-muted-foreground">
                {train.trainNo}
              </span>
            </li>
          );
        })}
        {platform.trains.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">—</li>
        )}
      </ul>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Fact({
  icon,
  on,
  label,
}: {
  icon: React.ReactNode;
  on: boolean;
  label: string;
}) {
  return (
    <li className={`flex items-center gap-2 ${on ? "" : "text-muted-foreground"}`}>
      <span className={on ? "text-[var(--ok)]" : "text-muted-foreground"}>{icon}</span>
      {label}
    </li>
  );
}
