"use client";

import { useRef, useState } from "react";
import AudioUploadInput from "@/components/AudioUploadInput";
import Dashboard from "@/components/Dashboard";
import LoadingIndicator from "@/components/LoadingIndicator";

function deriveCompanyName(companyOrLink: string): string {
  try {
    const url = new URL(companyOrLink);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return companyOrLink;
  }
}

export default function Home() {
  const [companyOrLink, setCompanyOrLink] = useState("");
  const [description, setDescription] = useState("");

  const [fileText, setFileText] = useState("");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [audioText, setAudioText] = useState("");
  const [audioStatus, setAudioStatus] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setFileText(data.text);
      setFileStatus(`${data.filename} — ${data.text.length.toLocaleString()} characters extracted`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleAudioTranscript(text: string) {
    setAudioText((prev) => (prev ? `${prev}\n${text}` : text));
    setAudioStatus(`Transcribed — ${text.length.toLocaleString()} characters`);
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAnalysisId(null);

    try {
      setStatusMessage("Gathering real customer feedback…");
      const gatherRes = await fetch("/api/gather-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyOrLink, description }),
      });
      const gatherData = await gatherRes.json();
      const gatheredText: string = gatherRes.ok ? gatherData.markdown : "";

      const combined = [gatheredText, fileText, audioText].filter(Boolean).join("\n\n");

      if (!combined.trim()) {
        throw new Error(
          gatherData.error ??
            "No review data found automatically. Upload a file or audio recording of feedback and try again."
        );
      }

      setStatusMessage("Analyzing reviews…");
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: deriveCompanyName(companyOrLink),
          rawReviews: combined,
          competitors: gatherRes.ok ? gatherData.competitors : [],
          ownFinancialContext: gatherRes.ok ? gatherData.ownFinancialContext : "",
          userQuestion: description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setAnalysisId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }

  const hasResults = loading || analysisId;

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4">
      <div className={hasResults ? "max-w-[1600px] mx-auto" : "max-w-3xl mx-auto"}>
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Voice-of-Customer Copilot</h1>
          <p className="text-slate-700 text-sm mt-1">
            Give a company/competitor name or link — the copilot searches the web for real
            reviews, analyzes them, and produces a live dashboard plus a downloadable PDF.
          </p>
        </header>

        <div className={hasResults ? "max-w-3xl mb-8" : ""}>
          <form
            onSubmit={handleAnalyze}
            className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-900 mb-1">
                Company / competitor product name or link <span className="text-red-600">*</span>
              </label>
              <input
                required
                value={companyOrLink}
                onChange={(e) => setCompanyOrLink(e.target.value)}
                placeholder="e.g. RivalMeals, or https://www.g2.com/products/example/reviews"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-1">
                Product details / specification <span className="text-red-600">*</span>
              </label>
              <input
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. food delivery app in India — or ask something: how are the reviews? what do customers need?"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
              <p className="text-xs text-slate-500 mt-1">
                Describe the product, and/or ask a direct question about the company or its
                customers — we&apos;ll answer it up top in the dashboard.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-1">
                Upload a file of past reviews/grievances (any format)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                className="w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-300"
              />
              {uploading && <p className="text-sm text-slate-600 mt-1">Parsing file…</p>}
              {uploadError && <p className="text-sm text-red-600 mt-1">{uploadError}</p>}
              {fileStatus && <p className="text-sm text-emerald-700 mt-1">✓ {fileStatus}</p>}
            </div>

            <AudioUploadInput onTranscript={handleAudioTranscript} />
            {audioStatus && <p className="text-sm text-emerald-700 -mt-2">✓ {audioStatus}</p>}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? statusMessage ?? "Working…" : "Analyze reviews"}
            </button>
          </form>
        </div>

        {loading && !analysisId && <LoadingIndicator statusMessage={statusMessage ?? "Working…"} />}
        {analysisId && <Dashboard analysisId={analysisId} />}
      </div>
    </main>
  );
}
