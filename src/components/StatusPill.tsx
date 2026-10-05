type StatusPillProps = {
  label: string;
  tone?: "good" | "review" | "neutral" | "danger";
};

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const tones = {
    good: "bg-emerald-100 text-emerald-700 ring-emerald-500/20",
    review: "bg-amber-100 text-amber-700 ring-amber-500/20",
    neutral: "bg-slate-100 text-slate-700 ring-slate-500/20",
    danger: "bg-rose-100 text-rose-700 ring-rose-500/20",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
      {label}
    </span>
  );
}
