"use client";

export default function LoadingIndicator({ statusMessage }: { statusMessage: string }) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-lg shadow-sm p-8 flex flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 rounded-full border-4 border-t-transparent border-l-transparent animate-spin" style={{ borderColor: "var(--color-primary, #1e40af) transparent transparent var(--color-primary, #1e40af)" }} />
      </div>
      <p className="text-sm font-medium text-slate-900">{statusMessage}</p>
    </div>
  );
}
