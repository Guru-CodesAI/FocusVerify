import { calibrationPoints } from "@/lib/config";

export function CalibrationGrid({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="grid w-full max-w-lg grid-cols-3 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
      {calibrationPoints.map((point, index) => {
        const active = index === currentIndex;
        return (
          <div key={point.label} className="flex items-center justify-center">
            <div
              className={[
                "flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all duration-200",
                active
                  ? "border-amber-500 bg-amber-100 scale-110 shadow-md"
                  : "border-slate-300 bg-white text-slate-500",
              ].join(" ")}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">{point.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
