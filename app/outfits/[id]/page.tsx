"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useAction, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"

// Display-only rename — keep in sync with the same mapping in app/page.tsx.
// SHOES stays the internal/stored value; only the on-screen label changes.
function categoryDisplayName(category?: string | null): string {
  if (category === "SHOES") return "FOOTWEAR"
  return category ?? ""
}

type Tab = "strengths" | "suggestions" | "whenToWear"

const tabs: { key: Tab; label: string }[] = [
  { key: "strengths", label: "STRENGTHS & WEAKNESSES" },
  { key: "suggestions", label: "SUGGESTIONS" },
  { key: "whenToWear", label: "WHEN TO WEAR" },
]

export default function OutfitDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as Id<"outfits">
  const outfit = useQuery(api.outfits.getOutfit, { id })
  const analyzeOutfit = useAction(api.analyzeOutfit.analyzeOutfit)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>("strengths")

  // ESC leaves the page, same destination as the × button. Placed above
  // the early returns below (rather than after) since hooks can't be
  // called conditionally — this one doesn't depend on `outfit` anyway.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        router.push("/outfits")
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [router])

  async function handleAnalyze() {
    setIsAnalyzing(true)
    try {
      await analyzeOutfit({ id })
    } catch (err) {
      console.error(err)
      alert("Analysis failed — check the terminal running npx convex dev for details.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (outfit === undefined) {
    return (
      <main className="min-h-screen bg-white text-black dark:bg-neutral-950 dark:text-white">
        <p className="p-8 text-sm text-black/40 dark:text-white/40">Loading...</p>
      </main>
    )
  }

  if (outfit === null) {
    return (
      <main className="min-h-screen bg-white text-black dark:bg-neutral-950 dark:text-white">
        <p className="p-8 text-sm text-black/40 dark:text-white/40">Outfit not found.</p>
      </main>
    )
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-black dark:bg-neutral-950 dark:text-white">
      <header className="flex items-center justify-between border-b border-black/10 px-8 py-4 dark:border-white/10">
        <Link
          href="/outfits"
          aria-label="Close"
          className="text-3xl leading-none text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          ×
        </Link>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Images — scrolls independently, scrollbar hidden */}
        <div className="no-scrollbar overflow-y-auto md:w-1/2">
          <div className="flex min-h-full flex-col items-center gap-6 p-12">
            {outfit.pieces.map((piece, index) => (
              <div
                key={piece._id}
                className="animate-fade-in-up flex w-full max-w-xl flex-col items-center gap-3"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden">
                  {piece.frontImageUrl ? (
                    <img
                      src={piece.frontImageUrl}
                      alt={piece.name ?? piece.code}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-black/20 dark:text-white/20">
                      {categoryDisplayName(piece.category)}
                    </span>
                  )}
                </div>
                <p className="text-xs tracking-widest text-black/40 dark:text-white/40">
                  {categoryDisplayName(piece.category)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Info panel — stays put */}
        <div className="no-scrollbar flex flex-1 flex-col justify-start gap-6 overflow-y-auto px-8 pt-14 pb-14 md:pt-28">
          <div>
            <p className="text-xs tracking-widest text-black/40 dark:text-white/40">OUTFIT</p>
            <h1 className="mt-1 text-2xl tracking-wide">
              {outfit.name ?? outfit.pieces.map((piece) => piece.code).join(" · ")}
            </h1>
            {outfit.description && (
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                {outfit.description}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 text-xs tracking-widest">
            <div className="flex justify-between border-b border-black/10 py-2 dark:border-white/10">
              <span className="text-black/40 dark:text-white/40">KIND</span>
              <span className="uppercase">{outfit.kind ?? "Not analyzed yet"}</span>
            </div>
            <div className="flex justify-between border-b border-black/10 py-2 dark:border-white/10">
              <span className="text-black/40 dark:text-white/40">RATING</span>
              <span>{outfit.rating ? `${outfit.rating}/10` : "Not analyzed yet"}</span>
            </div>
          </div>

          {outfit.analyzedAt ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-6 border-b border-black/10 pb-3 dark:border-white/10">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative pb-1 text-xs tracking-widest transition-colors duration-200 ${
                      activeTab === tab.key
                        ? "text-black dark:text-white"
                        : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`absolute inset-x-0 -bottom-0.5 h-px origin-center bg-black transition-transform duration-300 dark:bg-white ${
                        activeTab === tab.key ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div key={activeTab} className="animate-fade-in">
                {activeTab === "strengths" && (
                  <div className="flex flex-col gap-4 text-sm">
                    <div>
                      <p className="text-xs tracking-widest text-black/40 dark:text-white/40">
                        STRENGTHS
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {outfit.strengths?.map((strength, i) => (
                          <li key={i}>+ {strength}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs tracking-widest text-black/40 dark:text-white/40">
                        WEAKNESSES
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {outfit.weaknesses?.map((weakness, i) => (
                          <li key={i}>− {weakness}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {activeTab === "suggestions" && (
                  <ul className="flex flex-col gap-2 text-sm">
                    {outfit.suggestions?.map((suggestion, i) => (
                      <li key={i}>
                        {i + 1}. {suggestion}
                      </li>
                    ))}
                  </ul>
                )}

                {activeTab === "whenToWear" && <p className="text-sm">{outfit.whenToWear}</p>}
              </div>
            </div>
          ) : (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="self-start bg-black px-4 py-2 text-xs tracking-widest text-white transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 dark:bg-white dark:text-black"
            >
              {isAnalyzing ? "ANALYZING..." : "ANALYZE OUTFIT"}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}