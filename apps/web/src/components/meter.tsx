export function Meter({ label, value, max, tone = "banknote" }: { label: string; value: number; max: number; tone?: "banknote" | "intaglio" }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div>
      <div className="mb-1.5 text-sm">{label}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paper-deep" role="presentation">
        <div
          className={tone === "banknote" ? "h-full rounded-full bg-banknote" : "h-full rounded-full bg-intaglio"}
          style={{ width: `${ratio * 100}%`, transition: "width .5s ease" }}
        />
      </div>
    </div>
  );
}
