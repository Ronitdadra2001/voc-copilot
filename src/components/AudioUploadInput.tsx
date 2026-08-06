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
      <label
        htmlFor="audioUpload"
        className="block text-sm font-medium mb-1.5"
        style={{ color: "var(--color-foreground)" }}
      >
        Upload audio feedback (transcribed automatically)
      </label>
      <input
        id="audioUpload"
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        disabled={busy}
        className="w-full text-sm cursor-pointer file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:px-3.5 file:py-2 file:text-sm file:font-medium"
        style={{ color: "var(--color-foreground)" }}
      />
      {busy && (
        <p className="text-sm mt-1.5 opacity-80" style={{ color: "var(--color-foreground)" }}>
          Transcribing {filename}…
        </p>
      )}
      {error && (
        <p className="text-sm mt-1.5" style={{ color: "var(--color-destructive)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
