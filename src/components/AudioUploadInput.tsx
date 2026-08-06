"use client";

import { useRef, useState } from "react";

export default function AudioUploadInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setFilename(file.name);
    try {
      const formData = new FormData();
      formData.append("audio", file, file.name);
      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transcription failed");
      onTranscript(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        Upload audio feedback (transcribed automatically)
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        disabled={busy}
        className="w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-300"
      />
      {busy && <p className="text-sm text-slate-600 mt-1">Transcribing {filename}…</p>}
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
