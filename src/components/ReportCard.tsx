type ReportCardProps = {
  title: string;
  value: string;
  helper: string;
};

export function ReportCard({ title, value, helper }: ReportCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-600">{helper}</div>
    </div>
  );
}
