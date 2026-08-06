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
          companyName:
            (gatherRes.ok && gatherData.resolvedCompanyName) || deriveCompanyName(companyOrLink),
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
    <main className="min-h-screen py-10 px-4" style={{ backgroundColor: "var(--color-background)" }}>
      <div className={hasResults ? "max-w-[1600px] mx-auto" : "max-w-3xl mx-auto"}>
        <header className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>
            How MBA Professors Would Respond
          </h1>
          <p className="text-sm mt-1 opacity-80" style={{ color: "var(--color-foreground)" }}>
            Give a company/competitor name or link — the copilot scrapes real reviews from across
            the web, app stores, and Play Store, then answers the way an MBA professor would: a
            structured diagnosis grounded in real customer evidence, not generic advice.
          </p>
        </header>

        <div className={hasResults ? "max-w-3xl mb-8" : ""}>
          <form
            onSubmit={handleAnalyze}
            className="rounded-xl shadow-sm p-6 space-y-5 border"
            style={{
              backgroundColor: "var(--color-on-primary)",
              borderColor: "var(--color-border)",
            }}
          >
            <div>
              <label
                htmlFor="companyOrLink"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-foreground)" }}
              >
                Company / competitor product name or link{" "}
                <span style={{ color: "var(--color-destructive)" }}>*</span>
              </label>
              <input
                id="companyOrLink"
                required
                value={companyOrLink}
                onChange={(e) => setCompanyOrLink(e.target.value)}
                placeholder="e.g. RivalMeals, or https://www.g2.com/products/example/reviews"
                className="w-full rounded-md border px-3.5 py-2.5 text-base focus-visible:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}
              />
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-foreground)" }}
              >
                Product details / specification{" "}
                <span style={{ color: "var(--color-destructive)" }}>*</span>
              </label>
              <input
                id="description"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. food delivery app in India — or ask something: how are the reviews? what do customers need?"
                className="w-full rounded-md border px-3.5 py-2.5 text-base focus-visible:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}
              />
              <p className="text-xs mt-1.5 opacity-70" style={{ color: "var(--color-foreground)" }}>
                Describe the product, and/or ask a direct question about the company or its
                customers — we&apos;ll answer it up top in the dashboard.
              </p>
            </div>

            <div>
              <label
                htmlFor="fileUpload"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-foreground)" }}
              >
                Upload a file of past reviews/grievances (any format)
              </label>
              <input
                id="fileUpload"
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                className="w-full text-sm cursor-pointer file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:px-3.5 file:py-2 file:text-sm file:font-medium"
                style={{ color: "var(--color-foreground)" }}
              />
              {uploading && (
                <p className="text-sm mt-1.5 opacity-80" style={{ color: "var(--color-foreground)" }}>
                  Parsing file…
                </p>
              )}
              {uploadError && (
                <p className="text-sm mt-1.5" style={{ color: "var(--color-destructive)" }}>
                  {uploadError}
                </p>
              )}
              {fileStatus && (
                <p className="text-sm mt-1.5" style={{ color: "var(--color-success)" }}>
                  ✓ {fileStatus}
                </p>
              )}
            </div>

            <AudioUploadInput onTranscript={handleAudioTranscript} />
            {audioStatus && (
              <p className="text-sm -mt-2" style={{ color: "var(--color-success)" }}>
                ✓ {audioStatus}
              </p>
            )}

            {error && (
              <p className="text-sm" style={{ color: "var(--color-destructive)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md py-3 text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-on-primary)" }}
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
