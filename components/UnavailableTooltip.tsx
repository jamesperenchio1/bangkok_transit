"use client";

export interface UnavailableTooltipProps {
  stationName: string;
  point: { x: number; y: number };
  onDismiss: () => void;
}

export function UnavailableTooltip({ stationName, point, onDismiss }: UnavailableTooltipProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onDismiss} />
      <div
        className="fixed z-50 max-w-[220px] -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
        style={{ left: point.x, top: point.y - 12, transform: "translate(-50%, -100%)" }}
      >
        <p className="font-medium">{stationName}</p>
        <p className="mt-0.5 text-neutral-300 dark:text-neutral-600">
          Live arrivals are only available for BTS stations.
        </p>
      </div>
    </>
  );
}
