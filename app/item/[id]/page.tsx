"use client"

import { Suspense, useEffect, useRef, useState, ViewTransition, type ReactNode } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"

// Background removal + resize/edge-cleanup/crop all run inside
// app/photoProcessing.worker.ts — a dedicated Web Worker — via runInWorker()
// below, rather than here on the main thread. That's not just about
// reaching self-hosted assets (see BG_REMOVAL_PUBLIC_PATH): the
// @imgly/background-removal library blocks the calling thread by default no
// matter where it's called from — its own worker-proxying option only
// kicks in when device is "gpu" AND the browser supports WebGPU (confirmed
// by reading the library's source). On CPU it's always synchronous. Running
// the whole pipeline inside our own worker is what actually keeps this page
// clickable and its animations running throughout every upload, regardless
// of GPU/WebGPU support. See the worker file for the full explanation and
// the ported resize/edge-cleanup/crop logic. Kept in sync with the same
// constant/helper in app/page.tsx since there's no shared utils module yet.
const BG_REMOVAL_PUBLIC_PATH = "/bg-removal/"

// Spins up a fresh worker per call (rather than one shared worker) so it
// can never cross-talk with another upload's postMessage response. Worker
// start-up cost is negligible next to the multi-second model inference
// it's about to run. Kept in sync with the same helper in app/page.tsx.
function runInWorker(file: File, publicPath: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../photoProcessing.worker.ts", import.meta.url), {
      type: "module",
    })
    worker.onmessage = (event: MessageEvent) => {
      worker.terminate()
      if (event.data?.error) {
        reject(new Error(event.data.error))
      } else {
        resolve(event.data.blob as Blob)
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate()
      reject(event.error ?? new Error(event.message))
    }
    worker.postMessage({ file, publicPath })
  })
}

// Display-only rename — keep in sync with the same mapping in app/page.tsx.
// SHOES stays the internal/stored value; only the on-screen label changes.
function categoryDisplayName(category?: string | null): string {
  if (category === "SHOES") return "FOOTWEAR"
  return category ?? ""
}

// Whether this (category, subcategory) pair is one the AI attempts a brand
// guess for — kept in sync with the identical wantsBrand check in
// convex/analyze.ts, which is what actually decides whether item.brand
// gets set at all. Used below purely to decide whether the brand line
// under the item name renders — an item outside this scope simply never
// has brand set, but checking category/subcategory directly (rather than
// just "is brand truthy") means the line can still show "Not identified"
// for an in-scope item that hasn't been (re-)analyzed since this feature
// shipped, instead of only ever appearing once a guess happens to exist.
function wantsBrand(category?: string | null, subcategory?: string | null): boolean {
  return category === "SHOES" || (category === "ACCESSORIES" && (subcategory === "HATS" || subcategory === "FRAGRANCES"))
}

// Fragrances get a different info panel entirely — NOTES / PERFORMANCE /
// WHEN TO APPLY instead of SILHOUETTE / COLOR(S) / MATERIAL, none of which
// describe a scent. Kept in sync with wantsFragranceProfile in
// convex/analyze.ts, which decides whether that data gets generated at all.
function isFragrance(category?: string | null, subcategory?: string | null): boolean {
  return category === "ACCESSORIES" && subcategory === "FRAGRANCES"
}

// The full option list behind each WHEN TO APPLY row. The AI stores only its
// SELECTED options (see whenToApply in convex/schema.ts); these are what the
// row reveals underneath them when expanded, so you can see what wasn't
// picked as well as what was.
//
// MUST stay in sync with FRAGRANCE_WHEN_CATEGORIES in convex/analyze.ts —
// same keys, same option strings. Selections are matched against this list by
// exact string equality (the analyzer stores the canonical spelling for that
// reason), so a drift between the two files shows up as an option that never
// renders as selected.
const WHEN_TO_APPLY_CATEGORIES: {
  key: "timeOfDay" | "season" | "temperature" | "setting" | "outfit"
  label: string
  options: string[]
}[] = [
  {
    key: "timeOfDay",
    label: "TIME OF DAY",
    options: ["Morning", "Afternoon", "Late Afternoon", "Evening", "Night", "All Day"],
  },
  { key: "season", label: "SEASON", options: ["Spring", "Summer", "Fall", "Winter"] },
  { key: "temperature", label: "TEMPERATURE", options: ["Hot", "Warm", "Mild", "Cool", "Cold"] },
  {
    key: "setting",
    label: "SETTING",
    options: [
      "Everyday",
      "School / Work",
      "Casual",
      "Date",
      "Formal",
      "Going Out",
      "Party / Nightlife",
      "Outdoor",
    ],
  },
  {
    key: "outfit",
    label: "OUTFIT",
    options: [
      "Minimal",
      "Streetwear",
      "Smart Casual",
      "Formal",
      "Elevated Casual",
      "Workwear",
      "Rugged",
      "Sporty",
      "Preppy",
      "Relaxed",
      "Luxury",
      "Dark / Edgy",
      "Avant-Garde",
      "Clean / Refined",
    ],
  },
]

// Line-art glyph per WHEN TO APPLY category. Same drawing language as the
// chevrons and header icons already in the app (24-unit viewBox, no fill,
// currentColor stroke) so they sit at the same weight as everything else
// rather than reading as imported iconography.
const WHEN_TO_APPLY_ICONS: Record<string, ReactNode> = {
  timeOfDay: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  season: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  temperature: <path d="M14 14.76V5a2 2 0 10-4 0v9.76a4 4 0 104 0z" />,
  setting: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  outfit: <path d="M12 7a2.5 2.5 0 112.5 2.5c-1.5 0-2.5.8-2.5 2M12 11.5 3.5 17.2A1.5 1.5 0 004.4 20h15.2a1.5 1.5 0 00.9-2.8L12 11.5z" />,
}

function WhenToApplyIcon({ categoryKey }: { categoryKey: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      {WHEN_TO_APPLY_ICONS[categoryKey]}
    </svg>
  )
}

// One option inside an expanded category. A filled check marks a pick and a
// hollow ring marks one that wasn't chosen — which is more informative than
// just dimming the text, because it shows the option was CONSIDERED and
// passed over rather than simply being absent from a list.
function WhenToApplyOption({ label, selected }: { label: string; selected: boolean }) {
  return (
    <span
      className={`flex items-center gap-2 ${
        selected ? "" : "text-black/30 dark:text-white/30"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
          selected
            ? "bg-black dark:bg-white"
            : "border border-black/15 dark:border-white/15"
        }`}
      >
        {selected && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-2 w-2 text-white dark:text-black"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="uppercase">{label}</span>
    </span>
  )
}

// One collapsible WHEN TO APPLY row.
//
// Collapsed it shows just the icon, label and the AI's picks — which is the
// whole point: the panel has five of these and printing every option by
// default would bury the recommendation in a wall of text. The picks stay
// visible in BOTH states, so expanding adds context rather than replacing
// what you were already reading.
//
// Expansion is CONTROLLED from the panel rather than held here, so the single
// SHOW MORE / SHOW LESS control at the bottom and the per-row chevrons can
// drive the same state instead of fighting over two competing sources of
// truth. "Expand all" is then literally every row's own expanded flag set at
// once, which is why the two never disagree about what's open.
//
// The open/close animation uses the grid-template-rows 0fr -> 1fr trick
// (same one the subcategory filter row on the closet page uses) rather than
// animating height, because the content's height isn't known ahead of time
// and `height: auto` isn't animatable. The grid row resolves to the content's
// natural height, and 0fr/1fr interpolate, so it slides instead of snapping —
// and because it's a real layout collapse rather than an overlay, only the
// rows below this one move. Nothing above it shifts.
function WhenToApplyRow({
  categoryKey,
  label,
  options,
  selected,
  expanded,
  onToggle,
}: {
  categoryKey: string
  label: string
  options: string[]
  selected: string[]
  expanded: boolean
  onToggle: () => void
}) {
  const selectedSet = new Set(selected)

  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 py-2 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-black/30 dark:text-white/30">
            <WhenToApplyIcon categoryKey={categoryKey} />
          </span>
          {/* The picks line is shown ONLY while collapsed. Once the row is
              open, the very same selections are visible below as the ticked
              options, so keeping the summary would state them twice — and the
              checkmarks say it better, since they show what was passed over as
              well as what was chosen. Collapsing restores it, which is what
              makes the collapsed row still worth reading at a glance.

              Driven by `expanded` rather than by the SHOW MORE button, so a
              row opened by its own chevron behaves identically to one opened
              by SHOW MORE — the two controls share one state, so there's only
              ever one rule here. */}
          <span className="flex flex-col gap-0.5">
            <span className="text-black/40 dark:text-white/40">{label}</span>
            {!expanded && (
              <span className="uppercase">
                {selected.length > 0 ? selected.join(" · ") : "Not analyzed yet"}
              </span>
            )}
          </span>
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-2.5 w-2.5 shrink-0 text-black/40 transition-transform duration-200 dark:text-white/40 ${
            expanded ? "rotate-90" : ""
          }`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {/* Options wrap into columns rather than stacking in one tall
              list. OUTFIT alone has 14 of them, so a single column would add
              14 lines to the panel and make "expand all" unreadably long;
              in columns the same content costs about five. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pb-3 pl-6 sm:grid-cols-3">
            {options.map((option) => (
              <WhenToApplyOption
                key={option}
                label={option}
                selected={selectedSet.has(option)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// The whole fragrance analytics panel: NOTES and PERFORMANCE side by side,
// then the WHEN TO APPLY rows.
//
// NOTES and PERFORMANCE share a row because both are short — stacking them
// would spend twice the vertical space to display the same handful of words,
// and this page's whole constraint is adding information without adding
// scrolling. They collapse to stacked on a narrow window, where two columns
// would squeeze the note lists into unreadable slivers.
function FragrancePanel({
  notes,
  projection,
  longevity,
  whenToApply,
  analyzed,
}: {
  notes?: { top: string[]; middle: string[]; base: string[] } | null
  projection?: string | null
  longevity?: string | null
  whenToApply?: Record<string, string[]> | null
  analyzed: boolean
}) {
  // One shared source of truth for what's open (see WhenToApplyRow): a row's
  // own chevron toggles just its key, SHOW MORE fills the set, SHOW LESS
  // empties it. Because both write to the same place, opening every row by
  // hand leaves the footer reading SHOW LESS, which is what it should say.
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const allExpanded = expandedKeys.length === WHEN_TO_APPLY_CATEGORIES.length

  const toggleKey = (key: string) =>
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )

  const toggleAll = () =>
    setExpandedKeys(allExpanded ? [] : WHEN_TO_APPLY_CATEGORIES.map((c) => c.key))

  const noteTiers = [
    ["TOP", notes?.top],
    ["MIDDLE", notes?.middle],
    ["BASE", notes?.base],
  ] as const

  // Distinguishes "hasn't run yet" from "ran, and honestly didn't know this
  // fragrance's pyramid" — the second is now a real outcome rather than a
  // gap (see resolveFragranceProfile in convex/analyze.ts), and calling it
  // "Not analyzed yet" would misreport it as work still pending. The edit
  // menu is named because that's the actual fix available to the reader.
  const missingNotesLabel = analyzed ? "Not identified — add in EDIT" : "Not analyzed yet"

  return (
    /* gap-8 between the panel's two blocks, one step up from the gap-6 used
       inside them. It drops WHEN TO APPLY and everything below it by 8px —
       enough to separate the fixed facts at the top from the interactive rows
       underneath, without opening a gap that reads as a missing section. */
    <div className="flex flex-col gap-8 text-xs tracking-widest">
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <div className="flex flex-col gap-2">
          <span className="text-black/60 dark:text-white/60">NOTES</span>
          {noteTiers.map(([label, tierNotes]) => (
            <div
              key={label}
              className="flex flex-col gap-0.5 border-b border-hairline py-2"
            >
              <span className="text-black/40 dark:text-white/40">{label}</span>
              <span
                className={`uppercase ${
                  tierNotes && tierNotes.length > 0 ? "" : "text-black/30 dark:text-white/30"
                }`}
              >
                {tierNotes && tierNotes.length > 0 ? tierNotes.join(", ") : missingNotesLabel}
              </span>
            </div>
          ))}
        </div>

        {/* The single vertical hairline separating the two blocks — kept
            because it's what makes them read as two columns rather than one
            run-on grid, and dropped below md where they stack and it would
            sit in the middle of nothing. */}
        <div className="flex flex-col gap-2 md:border-l md:border-hairline md:pl-8">
          <span className="text-black/60 dark:text-white/60">PERFORMANCE</span>
          {/* PROJECTION first, then LONGEVITY. The left slot used to hold
              PROJECTION TIME — how long the scent keeps throwing — which is a
              real figure but a specialist one; longevity is what people
              actually quote about a fragrance.

              Note the swap changed the VALUE as well as the label: relabelling
              the projection-duration number as "longevity" would have printed
              the wrong figure under the right word, which is precisely the
              conflation the analysis works to prevent. Projection time is
              still produced and validated against longevity, it just isn't
              displayed any more (see convex/schema.ts). */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-0.5 border-b border-hairline py-2">
              <span className="text-black/40 dark:text-white/40">PROJECTION</span>
              <span className="uppercase">{projection ?? "Not analyzed yet"}</span>
            </div>
            <div className="flex flex-col gap-0.5 border-b border-hairline py-2">
              <span className="text-black/40 dark:text-white/40">LONGEVITY</span>
              <span className="uppercase">{longevity ?? "Not analyzed yet"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-black/60 dark:text-white/60">WHEN TO APPLY</span>
        {WHEN_TO_APPLY_CATEGORIES.map((category) => (
          <WhenToApplyRow
            key={category.key}
            categoryKey={category.key}
            label={category.label}
            options={category.options}
            selected={whenToApply?.[category.key] ?? []}
            expanded={expandedKeys.includes(category.key)}
            onToggle={() => toggleKey(category.key)}
          />
        ))}

        <button
          type="button"
          onClick={toggleAll}
          aria-expanded={allExpanded}
          className="flex items-center justify-center gap-2 py-1 text-black/40 transition-colors duration-200 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
        >
          {allExpanded ? "SHOW LESS" : "SHOW MORE"}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${
              allExpanded ? "rotate-180" : ""
            }`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Kept in sync with app/page.tsx's Category type/options — duplicated here
// since there's no shared utils module yet. Used by the EDIT menu's
// CATEGORY/TYPE dropdowns.
type Category = "SHIRTS" | "PANTS" | "SHOES" | "OUTERWEAR" | "ACCESSORIES"

const categories: Category[] = ["SHIRTS", "PANTS", "SHOES", "OUTERWEAR", "ACCESSORIES"]

const subcategoryOptions: Record<Category, string[]> = {
  SHIRTS: ["T-SHIRTS", "LONG SLEEVE", "BUTTON UP", "OTHER"],
  PANTS: ["LONG PANTS", "SHORTS", "OTHER"],
  SHOES: ["SNEAKERS", "BOOTS", "SANDALS", "SLIDES", "OTHER"],
  OUTERWEAR: ["HOODIES", "JACKETS", "VESTS", "COATS"],
  ACCESSORIES: ["BELTS", "SUNGLASSES", "HATS", "JEWELRY", "FRAGRANCES", "OTHER"],
}

// Default color palette for the EDIT menu's COLOR(S) picker — easy to edit:
// it's just this array.
const colorOptions: { name: string; hex: string }[] = [
  { name: "BLACK", hex: "#000000" },
  { name: "WHITE", hex: "#FFFFFF" },
  { name: "GRAY", hex: "#808080" },
  { name: "NAVY", hex: "#1F2A44" },
  { name: "BLUE", hex: "#2563EB" },
  { name: "RED", hex: "#DC2626" },
  { name: "MAROON", hex: "#7F1D1D" },
  { name: "PINK", hex: "#EC4899" },
  { name: "ORANGE", hex: "#EA580C" },
  { name: "YELLOW", hex: "#EAB308" },
  { name: "GREEN", hex: "#16A34A" },
  { name: "OLIVE", hex: "#6B7B3A" },
  { name: "PURPLE", hex: "#7C3AED" },
  { name: "BROWN", hex: "#7C4A2D" },
  { name: "TAN", hex: "#D2B48C" },
  { name: "BEIGE", hex: "#E8DCC8" },
  { name: "CREAM", hex: "#F5F0E6" },
]

// Extra colors only offered for specific categories — currently just the
// metallic tones for ACCESSORIES, which don't make sense as general
// clothing colors in the shared list above.
const categoryColorOptions: Partial<Record<Category, { name: string; hex: string }[]>> = {
  ACCESSORIES: [
    { name: "GOLD", hex: "#D4AF37" },
    { name: "SILVER", hex: "#C0C0C0" },
  ],
}

// Template photo per (category, subcategory) — one stand-in photo for each
// specific type of piece (a hoodie photo, a boots photo, a sunglasses
// photo, etc.), not just one generic photo per category. Used below to
// pick PIECES TO PAIR's per-category representative photo, and also meant
// to be read from app/page.tsx's Add Item form to preview the exact
// CATEGORY/TYPE combo you've selected there. Plain <img> tags pointing at
// static files under public/subcategory-templates/, not imports, so any
// photo can be swapped just by replacing the file at the same path —
// nothing in either component needs to change. Subcategories with no
// entry here (T-SHIRTS, LONG PANTS, every OTHER, JACKETS) simply have no
// preview yet — add one any time by dropping in a new file and adding a
// line below. Duplicated in app/page.tsx since there's no shared utils
// module yet.
const subcategoryTemplateImages: Partial<Record<Category, Partial<Record<string, string>>>> = {
  SHIRTS: {
    "LONG SLEEVE": "/subcategory-templates/shirts-long-sleeve.png",
    "BUTTON UP": "/subcategory-templates/shirts-button-up.png",
  },
  PANTS: {
    SHORTS: "/subcategory-templates/pants-shorts.png",
  },
  SHOES: {
    SNEAKERS: "/subcategory-templates/shoes-sneakers.png",
    BOOTS: "/subcategory-templates/shoes-boots.png",
    SANDALS: "/subcategory-templates/shoes-sandals.png",
    SLIDES: "/subcategory-templates/shoes-slides.png",
  },
  OUTERWEAR: {
    HOODIES: "/subcategory-templates/outerwear-hoodies.png",
    VESTS: "/subcategory-templates/outerwear-vests.png",
    COATS: "/subcategory-templates/outerwear-coats.png",
  },
  ACCESSORIES: {
    BELTS: "/subcategory-templates/accessories-belts.png",
    SUNGLASSES: "/subcategory-templates/accessories-sunglasses.png",
    HATS: "/subcategory-templates/accessories-hats.png",
    JEWELRY: "/subcategory-templates/accessories-jewelry.png",
    FRAGRANCES: "/subcategory-templates/accessories-fragrances.png",
  },
}

// Looks up subcategoryTemplateImages above, returning null instead of
// undefined when there's no photo yet for that (category, subcategory)
// pair — lets callers use a plain `? :` instead of also checking undefined.
function getSubcategoryTemplateImage(category: Category, subcategory: string): string | null {
  return subcategoryTemplateImages[category]?.[subcategory] ?? null
}

// PIECES TO PAIR below shows one box per OTHER category (not per
// subcategory — that'd be a lot of boxes), so each category needs exactly
// one representative photo. This just picks the first subcategory (in
// subcategoryOptions order above) that has a template photo yet. There's
// no per-item logic here — every SHIRTS item sees the same PANTS photo,
// etc. — change the subcategory name in any line below to swap which
// photo represents that category's box.
type PieceToPairCategory = {
  category: Category
  label: string
  imageSrc: string | null
}

const pieceToPairCategories: PieceToPairCategory[] = [
  { category: "SHIRTS", label: "SHIRTS", imageSrc: getSubcategoryTemplateImage("SHIRTS", "LONG SLEEVE") },
  { category: "PANTS", label: "PANTS", imageSrc: getSubcategoryTemplateImage("PANTS", "SHORTS") },
  { category: "SHOES", label: "FOOTWEAR", imageSrc: getSubcategoryTemplateImage("SHOES", "SNEAKERS") },
  { category: "OUTERWEAR", label: "OUTERWEAR", imageSrc: getSubcategoryTemplateImage("OUTERWEAR", "HOODIES") },
  { category: "ACCESSORIES", label: "ACCESSORIES", imageSrc: getSubcategoryTemplateImage("ACCESSORIES", "BELTS") },
]

// Mixes a hex color 35% of the way toward black (DARK) or white (LIGHT),
// so the primary color's swatch dot actually looks like "dark gray" or
// "light gray" instead of showing the same flat swatch no matter what
// TONE (PRIMARY) is set to. Returns the color unchanged if shade isn't
// exactly "LIGHT" or "DARK".
function shadeHex(hex: string, shade?: string | null): string {
  if (shade !== "LIGHT" && shade !== "DARK") return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mixTarget = shade === "DARK" ? 0 : 255
  const amount = 0.35
  const blend = (channel: number) => Math.round(channel + (mixTarget - channel) * amount)
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0")
  return `#${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`
}

// Formats a stored `createdAt` timestamp (a Date.now() value set once at
// createItem time — see convex/items.ts) as MM/DD/YYYY for the PIECE
// ANALYTICS panel's DATE ADDED row. Written out explicitly with
// getMonth()/getDate()/getFullYear() rather than toLocaleDateString(), so
// the format stays fixed as MM/DD/YYYY regardless of the browser's locale.
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const year = date.getFullYear()
  return `${month}/${day}/${year}`
}

function ItemDetailPageContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as Id<"items">
  const previewImageUrl = searchParams.get("img")

  const item = useQuery(api.items.getItem, { id })
  const analyzeItem = useAction(api.analyze.analyzeItem)
  const deleteItem = useMutation(api.items.deleteItem)
  const updateItem = useMutation(api.items.updateItem)
  const generateUploadUrl = useMutation(api.items.generateUploadUrl)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  // PIECE ANALYTICS — a small info bubble (DATE ADDED, TIMES WORN, ITEM
  // VALUE) anchored to a button that sits just below the header's divider.
  // Positioned absolutely (the wrapper below is `relative`) so opening it
  // pops the bubble out over the page instead of pushing the rest of the
  // layout down — same technique as the SORT BY dropdown on the grid page.
  const [showAnalytics, setShowAnalytics] = useState(false)

  // EDIT menu state — mirrors the Add Item form's fields (CATEGORY, TYPE,
  // NAME, PHOTOS, MATERIAL/SILHOUETTE/ITEM VALUE), plus COLOR(S) and
  // TONE (PRIMARY) which Add Item doesn't have. Pre-filled from the current
  // item each time the menu opens. editColors is ordered most-to-least
  // prominent — click order determines that order (see toggleEditColor
  // below).
  const [showEditForm, setShowEditForm] = useState(false)
  const [editCategory, setEditCategory] = useState<Category>("SHIRTS")
  const [editSubcategory, setEditSubcategory] = useState<string>(subcategoryOptions.SHIRTS[0])
  const [editName, setEditName] = useState("")
  const [editColors, setEditColors] = useState<{ name: string; hex: string }[]>([])
  const [editColorShade, setEditColorShade] = useState<string>("")
  const [editFrontImageFile, setEditFrontImageFile] = useState<File | null>(null)
  const [editBackImageFile, setEditBackImageFile] = useState<File | null>(null)
  const [editFrontPreviewUrl, setEditFrontPreviewUrl] = useState<string | null>(null)
  const [editBackPreviewUrl, setEditBackPreviewUrl] = useState<string | null>(null)
  const [editMaterialHint, setEditMaterialHint] = useState("")
  const [editSilhouetteHint, setEditSilhouetteHint] = useState("")
  const [editItemValue, setEditItemValue] = useState("")
  // Manual override for the AI's footwear orientation guess (needsFlip) —
  // only ever meaningful while editCategory is SHOES (FOOTWEAR), gated in
  // the JSX below. AI left/right detection is never going to be perfectly
  // reliable, so this is the reliable fallback: flip it by hand and it's
  // fixed for good, no re-analyze roulette required.
  const [editNeedsFlip, setEditNeedsFlip] = useState(false)
  // Fragrance notes, held as raw comma-separated text rather than string[]
  // so typing "bergamot, " mid-entry doesn't get eagerly split into an empty
  // second note and fight the cursor. Parsed on save (see parseNoteList).
  const [editNotesTop, setEditNotesTop] = useState("")
  const [editNotesMiddle, setEditNotesMiddle] = useState("")
  const [editNotesBase, setEditNotesBase] = useState("")
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  // While the real item is still loading, fall back to the image URL passed
  // in from the grid tile so the shared-element morph has something to
  // match against right away. Once the Convex query resolves, item.frontImageUrl
  // takes over (it'll be the same image, just from the authoritative source).
  const displayImageUrl = item?.frontImageUrl ?? previewImageUrl ?? undefined

  // Carries this item's essentials back to the grid page so it can render a
  // stand-in tile immediately (before its own item list has reloaded),
  // giving the reverse shared-element morph something to match against
  // instead of flashing an empty grid.
  const backHint = item
    ? encodeURIComponent(
        JSON.stringify({
          id,
          code: item.code,
          name: item.name ?? null,
          category: item.category,
          img: displayImageUrl ?? null,
        })
      )
    : null

  const closeHref = item ? `/?category=${item.category}&back=${backHint}` : "/"

  // What color(s) currently determine every colors displayed — a legacy
  // single-color item just shows that one color. Falls back to the old
  // primaryColor field when `colors` hasn't been set yet, so nothing
  // already-saved disappears.
  const displayColors = item
    ? item.colors && item.colors.length > 0
      ? item.colors
      : item.primaryColor
        ? [item.primaryColor]
        : []
    : []

  // Options offered in the EDIT menu's COLOR(S) picker: the shared palette
  // plus whatever's category-specific for the category currently selected
  // in the form, plus (if it's not already in either list) any color this
  // item already has — so opening/saving the edit form without touching
  // color can't silently drop something set outside the fixed palette
  // (e.g. by AI analysis).
  const existingItemColors =
    item?.colors && item.colors.length > 0
      ? item.colors
      : item?.primaryColor
        ? [item.primaryColor]
        : []
  const baseColorOptions = [...colorOptions, ...(categoryColorOptions[editCategory] ?? [])]
  const editColorOptions = [
    ...baseColorOptions,
    ...existingItemColors.filter((c) => !baseColorOptions.some((o) => o.name === c.name)),
  ]

  // ESC closes whichever layer is "on top": the delete confirmation first,
  // then the edit menu, then the PIECE ANALYTICS bubble, and only falls
  // through to leaving the page entirely if none of those are open.
  // Computed above the `item === null` early return below since hooks
  // can't be called conditionally.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (showDeleteConfirm) {
        setShowDeleteConfirm(false)
      } else if (showEditForm) {
        setShowEditForm(false)
      } else if (showAnalytics) {
        setShowAnalytics(false)
      } else {
        router.push(closeHref)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showDeleteConfirm, showEditForm, showAnalytics, closeHref, router])

  // PIECE ANALYTICS deliberately has NO click-outside handler, unlike the
  // SORT BY dropdown on the grid page. The bubble is a panel you read
  // alongside the rest of the item — you'll click the photo, scroll the info
  // column, open a WHEN TO APPLY row — and closing it on the first stray
  // click made it impossible to keep the stats visible while doing any of
  // that. It closes on its own button, on Escape, or when you leave the page,
  // which unmounts this component and resets the state with it.
  //
  // SORT BY keeps its click-outside because it's a menu: you open it to make
  // one choice, and it should get out of the way the moment you're done.

  // Live preview URLs for the edit menu's photo inputs, same pattern as the
  // Add Item form in app/page.tsx.
  useEffect(() => {
    if (!editFrontImageFile) {
      setEditFrontPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(editFrontImageFile)
    setEditFrontPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [editFrontImageFile])

  useEffect(() => {
    if (!editBackImageFile) {
      setEditBackPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(editBackImageFile)
    setEditBackPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [editBackImageFile])

  function openEditForm() {
    if (!item) return
    setEditCategory(item.category as Category)
    setEditSubcategory(item.subcategory ?? subcategoryOptions[item.category as Category][0])
    setEditName(item.name ?? "")
    setEditColors(
      item.colors && item.colors.length > 0
        ? item.colors
        : item.primaryColor
          ? [item.primaryColor]
          : []
    )
    setEditColorShade(item.colorShade ?? "")
    setEditMaterialHint(item.materialHint ?? "")
    setEditSilhouetteHint(item.silhouetteHint ?? "")
    setEditItemValue(item.itemValue ?? "")
    setEditNeedsFlip(item.needsFlip ?? false)
    setEditNotesTop((item.fragranceNotes?.top ?? []).join(", "))
    setEditNotesMiddle((item.fragranceNotes?.middle ?? []).join(", "))
    setEditNotesBase((item.fragranceNotes?.base ?? []).join(", "))
    setEditFrontImageFile(null)
    setEditBackImageFile(null)
    setShowEditForm(true)
  }

  // Clicking an unselected color appends it (making it the least prominent
  // so far); clicking a selected one removes it. The resulting array order
  // is what gets saved as the most-to-least-prominent order.
  function toggleEditColor(color: { name: string; hex: string }) {
    setEditColors((prev) => {
      const exists = prev.some((c) => c.name === color.name)
      if (exists) return prev.filter((c) => c.name !== color.name)
      return [...prev, color]
    })
  }

  async function handleAnalyze() {
    setIsAnalyzing(true)
    try {
      await analyzeItem({ id })
    } catch (err) {
      console.error(err)
      alert("Analysis failed — check the terminal running npx convex dev for details.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleDelete() {
    if (!item) return
    setIsDeleting(true)
    try {
      await deleteItem({ id })
      router.push(`/?category=${item.category}`)
    } catch (err) {
      console.error(err)
      alert("Delete failed — check the terminal running npx convex dev for details.")
      setIsDeleting(false)
    }
  }

  // Uploads a photo and returns the FINAL, processed storage id. Same
  // client-side pipeline as app/page.tsx's uploadPhoto — see the longer
  // comment there for why self-hosting the background-removal assets (not
  // moving the work server-side) is what actually fixes the freeze.
  async function uploadPhoto(file: File): Promise<any> {
    const finalBlob = await runInWorker(file, `${window.location.origin}${BG_REMOVAL_PUBLIC_PATH}`)

    const uploadUrl = await generateUploadUrl()
    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: finalBlob,
    })
    const { storageId } = await result.json()

    return storageId
  }

  // Splits a comma-separated note field into clean note names, dropping empty
  // fragments so a trailing comma or a double comma doesn't save a blank note.
  function parseNoteList(raw: string): string[] {
    return raw
      .split(",")
      .map((note) => note.trim().toLowerCase())
      .filter((note) => note.length > 0)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return

    const top = parseNoteList(editNotesTop)
    const middle = parseNoteList(editNotesMiddle)
    const base = parseNoteList(editNotesBase)
    // null (clear) only when ALL three are empty. A partially-filled pyramid
    // is still saved as-is, so you can fill in just the tier you know.
    const editedFragranceNotes =
      top.length === 0 && middle.length === 0 && base.length === 0
        ? null
        : { top, middle, base }

    setIsSavingEdit(true)
    try {
      const frontImageId = editFrontImageFile ? await uploadPhoto(editFrontImageFile) : undefined
      const backImageId = editBackImageFile ? await uploadPhoto(editBackImageFile) : undefined

      await updateItem({
        id,
        category: editCategory,
        subcategory: editSubcategory,
        name: editName || undefined,
        colors: editColors.length > 0 ? editColors : undefined,
        colorShade: editColorShade || undefined,
        frontImageId,
        backImageId,
        materialHint: editMaterialHint || undefined,
        silhouetteHint: editSilhouetteHint || undefined,
        itemValue: editItemValue || undefined,
        needsFlip: editCategory === "SHOES" ? editNeedsFlip : undefined,
        // Only sent for fragrances, so editing a shirt never touches this.
        // All three fields empty sends null, which clears stored notes — that
        // way emptying the fields is a real "remove these" action rather than
        // silently leaving the old pyramid in place.
        fragranceNotes: isFragrance(editCategory, editSubcategory)
          ? editedFragranceNotes
          : undefined,
      })

      setShowEditForm(false)
    } catch (err) {
      console.error(err)
      alert("Update failed — check the terminal running npx convex dev for details.")
    } finally {
      setIsSavingEdit(false)
    }
  }

  if (item === null) {
    return (
      <main className="min-h-screen bg-white text-black dark:bg-neutral-950 dark:text-white">
        <p className="p-8 text-sm text-black/40 dark:text-white/40">Item not found.</p>
      </main>
    )
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-black dark:bg-neutral-950 dark:text-white">
      {/* Height is pinned explicitly rather than left to size itself from
          content, because this header's children (icon buttons) are shorter
          than the grid page's, so content-sizing makes the two pages' headers
          different heights — and they have to match, or the header visibly
          jumps during the shared-element transition between the pages.

          The grid header (app/page.tsx) is now pinned to this SAME literal
          rather than deriving its height from padding plus whatever its
          tallest child happens to be. That's what the old h-[48px] here was
          trying to track, via a chain of arithmetic off a guess that
          MenuPanel was 24px tall. It isn't: its trigger is two 1px bars with
          a 6px gap, so 8px, and the grid header's real tallest child is 21px.
          The old grid header measured 45px against the 48 claimed here — a
          silent 3px mismatch that the transition was quietly absorbing.

          Both sides now name the same number, so the only way they can drift
          apart is if someone edits one and not the other. */}
      <header className="flex h-[72px] items-center justify-between px-8">
        <Link
          href={closeHref}
          aria-label="Close"
          className="text-xl leading-none text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          ×
        </Link>

        <div className="flex items-center gap-6">
          <button
            onClick={openEditForm}
            disabled={!item}
            aria-label="Edit item"
            className="text-black/70 hover:text-black disabled:opacity-30 dark:text-white/70 dark:hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"
              />
            </svg>
          </button>

          <button
            onClick={() => item && setShowDeleteConfirm(true)}
            disabled={!item}
            aria-label="Delete item"
            className="text-black/70 hover:text-black disabled:opacity-30 dark:text-white/70 dark:hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a2 2 0 002 2h6a2 2 0 002-2V7H8z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* PIECE ANALYTICS — sits just under the header's divider, right-
          aligned to roughly the same spot the EDIT/DELETE icons sit above
          it. Clicking it pops an info bubble out of the bottom of the
          button (absolute position inside the relative wrapper) instead of
          pushing the image/info panel below it down — same
          floating-dropdown technique as SORT BY on the grid page, right-
          aligned here (right-0) instead of left-aligned since this button
          sits at the right edge of the page. */}
      <div className="flex justify-end px-8 pt-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAnalytics((prev) => !prev)}
            disabled={!item}
            aria-haspopup="true"
            aria-expanded={showAnalytics}
            className={`flex items-center gap-2 text-xs tracking-widest transition-colors duration-200 disabled:opacity-30 ${
              showAnalytics
                ? "text-black dark:text-white"
                : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
            }`}
          >
            PIECE ANALYTICS
            {/* Chevron points right when closed, rotates 90° to point
                down when open — driven directly by showAnalytics since
                this is a real React toggle (not a native <details>), so
                no group-open trick needed here like COLOR PAIRS/PIECES TO
                PAIR below use. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${
                showAnalytics ? "rotate-90" : ""
              }`}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>

          <div
            className={`absolute right-0 top-full z-20 mt-2 w-64 origin-top-right border border-black/10 bg-white p-4 shadow-lg transition-all duration-150 ease-out dark:border-white/10 dark:bg-neutral-900 ${
              showAnalytics ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
            }`}
          >
            <div className="flex flex-col gap-2 text-xs tracking-widest">
              <div className="flex justify-between border-b border-hairline py-2">
                <span className="text-black/40 dark:text-white/40">DATE ADDED</span>
                <span className="uppercase">{item ? formatDate(item.createdAt) : "···"}</span>
              </div>
              <div className="flex justify-between border-b border-hairline py-2">
                <span className="text-black/40 dark:text-white/40">TIMES WORN</span>
                <span className="uppercase">{item ? item.timesWorn ?? 0 : "···"}</span>
              </div>
              <div className="flex justify-between border-b border-hairline py-2">
                <span className="text-black/40 dark:text-white/40">ITEM VALUE</span>
                <span className="uppercase">{item ? item.itemValue ?? "Not set" : "···"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Images — scrolls independently, scrollbar hidden */}
        <div className="no-scrollbar overflow-y-auto md:w-1/2">
          <div className="flex min-h-full flex-col items-center justify-center gap-6 p-12">
            {displayImageUrl ? (
              <ViewTransition name={`item-image-${id}`}>
                <div className="flex aspect-square w-full max-w-2xl items-center justify-center overflow-hidden">
                  {/* Footwear gets a horizontal flip (scaleX(-1)) when
                      needsFlip was set by the AI analysis, so every shoe
                      reads as pointing right — matches the same flip
                      applied to this item's grid tile on the closet page. */}
                  <img
                    src={displayImageUrl}
                    alt={item?.name ?? item?.code ?? "Item"}
                    className="h-full w-full object-contain"
                    style={item?.needsFlip ? { transform: "scaleX(-1)" } : undefined}
                  />
                </div>
              </ViewTransition>
            ) : (
              <div className="flex aspect-square w-full max-w-2xl items-center justify-center overflow-hidden">
                <span className="text-xs text-black/20 dark:text-white/20">
                  {item ? categoryDisplayName(item.category) : ""}
                </span>
              </div>
            )}

            {item?.backImageUrl && (
              <div className="flex aspect-square w-full max-w-2xl items-center justify-center overflow-hidden">
                <img
                  src={item.backImageUrl}
                  alt={`${item.name ?? item.code} (back)`}
                  className="h-full w-full object-contain"
                />
              </div>
            )}
          </div>
        </div>

        {/* Info panel — stays put */}
        {/* gap-8 rather than the gap-6 the rest of this panel used to run
            at: the header block below now carries a third line (the brand),
            and at gap-6 the stat list started reading as part of that block
            instead of a separate group. One step up is enough to
            re-establish the break without pushing the stats visibly down
            the panel. */}
        <div className="no-scrollbar flex flex-1 flex-col justify-start gap-8 overflow-y-auto px-8 pt-14 pb-14 md:pt-28">
          <div>
            <p className="text-xs tracking-widest text-black/40 dark:text-white/40">
              {item ? (
                <>
                  {categoryDisplayName(item.category)}
                  {item.subcategory ? ` · ${item.subcategory}` : ""}
                </>
              ) : (
                "···"
              )}
            </p>
            <h1 className="mt-1 text-2xl tracking-wide">
              {item ? item.name ?? item.code : "···"}
            </h1>

            {/* Brand — moved here from what used to be a "PRODUCT" row down
                in the stat list. It sits under the name rather than among
                the stats because it identifies the piece itself, the same
                way the category line above it does, instead of describing
                an attribute of it the way SILHOUETTE/COLOR(S)/MATERIAL do.

                Only rendered for the categories/subcategories the AI
                actually attempts a brand guess for (see wantsBrand, kept in
                sync with the identical check in convex/analyze.ts) — every
                other item never has brand set at all, so this would just
                permanently read "Not identified" for them.

                "Not identified" (rather than "Not analyzed yet" like the
                stat rows) covers both "hasn't been analyzed since this
                shipped" and "was analyzed but the AI wasn't confident
                enough" — brand is cleared, not left stale, whenever a
                re-analysis can't confirm a guess (see convex/items.ts), so
                both cases look identical here and that's the honest summary
                either way. It's dimmed to /30 in that case so an actual
                brand reads as content while the placeholder recedes,
                instead of an absence drawing the eye. */}
            {item && wantsBrand(item.category, item.subcategory) && (
              <p
                className={`mt-2 text-xs uppercase tracking-widest ${
                  item.brand
                    ? "text-black/60 dark:text-white/60"
                    : "text-black/30 dark:text-white/30"
                }`}
              >
                {item.brand ?? "Not identified"}
              </p>
            )}
          </div>

          {/* Fragrance panel — swapped in for the SILHOUETTE/COLOR(S)/
              MATERIAL rows below, which describe a garment and say nothing
              useful about a scent ("CYLINDRICAL, STRUCTURED" / "GLASS" is
              true of the bottle and irrelevant to the perfume). The item's
              colors are still analyzed and still drive the grid tile and the
              edit menu; they're just not what you want to read on this page
              for a fragrance.

              Section order is NOTES + PERFORMANCE (sharing one row) and then
              WHEN TO APPLY: the compact factual blocks first, then the five
              collapsible rows, so the part of the panel that changes height
              sits at the bottom and expanding never pushes anything above it
              around. */}
          {item && isFragrance(item.category, item.subcategory) ? (
            <FragrancePanel
              notes={item.fragranceNotes}
              projection={item.projection}
              longevity={item.longevity}
              whenToApply={item.whenToApply}
              analyzed={item.analyzedAt !== undefined}
            />
          ) : (
          <div className="flex flex-col gap-2 text-xs tracking-widest">
            <div className="flex justify-between border-b border-hairline py-2">
              <span className="text-black/40 dark:text-white/40">SILHOUETTE</span>
              <span className="uppercase">
                {item ? item.silhouette ?? "Not analyzed yet" : "···"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-hairline py-2">
              <span className="text-black/40 dark:text-white/40">COLOR(S)</span>
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 uppercase">
                {item ? (
                  displayColors.length > 0 ? (
                    displayColors.map((color, index) => (
                      <span key={index} className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-full border border-black/10 dark:border-white/10"
                          style={{
                            backgroundColor:
                              index === 0 ? shadeHex(color.hex, item.colorShade) : color.hex,
                          }}
                        />
                        {index === 0 && item.colorShade ? `${item.colorShade} ${color.name}` : color.name}
                      </span>
                    ))
                  ) : (
                    "Not analyzed yet"
                  )
                ) : (
                  "···"
                )}
              </span>
            </div>
            <div className="flex justify-between border-b border-hairline py-2">
              <span className="text-black/40 dark:text-white/40">MATERIAL</span>
              <span className="uppercase">
                {item ? item.material ?? "Not analyzed yet" : "···"}
              </span>
            </div>

          </div>
          )}

          {/* Hidden for fragrances. These swatches answer "what colors go
              with this piece", which for a bottle of perfume could only be
              derived from the bottle's own colors — and a fragrance's real
              answer to that question is the OUTFIT row in WHEN TO APPLY,
              which reasons from the scent instead. PIECES TO PAIR below
              still shows, since linking out to other categories is just as
              useful for a fragrance. */}
          {item && !isFragrance(item.category, item.subcategory) && (
            <details open className="group/color-pairs text-xs tracking-widest">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-2.5 w-2.5 shrink-0 transition-transform duration-200 group-open/color-pairs:rotate-90"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                COLOR PAIRS
              </summary>
              {item.complementaryColors && item.complementaryColors.length > 0 ? (
                /* flex-wrap + gap-y: this row used to be exactly 6 swatches
                   and now runs 5-8 (see MIN/MAX_COMPLEMENT_COUNT in
                   convex/analyze.ts), which at 8 can overrun the info
                   panel's width on a narrow window. Wrapping keeps the
                   panel from scrolling sideways; at the usual counts it
                   still renders as one row exactly as before. */
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-4">
                  {item.complementaryColors.map((color, index) => (
                    <div
                      key={index}
                      className="group relative flex flex-col items-center gap-1"
                    >
                      <span
                        className="block h-6 w-6 rounded-full border border-black/10 dark:border-white/10"
                        style={{ backgroundColor: color.hex }}
                      />
                      {/* Tooltip carries the tier alongside the name — the
                          swatches are already ordered strongest-first, but
                          order alone doesn't say whether #5 is still a
                          great option or merely an acceptable one. Falls
                          back to just the name for items analyzed before
                          tiers existed, rather than inventing a tier for
                          them. */}
                      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-[10px] uppercase text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-black">
                        {color.tier ? `${color.name} · ${color.tier}` : color.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-black/40 dark:text-white/40">Not analyzed yet.</p>
              )}
            </details>
          )}

          {/* PIECES TO PAIR — one box per OTHER category (the item's own
              category is filtered out, so this is always exactly 4 boxes).
              Boxes are a fixed h-24 w-24 (not stretched to fill the row via
              grid-cols like the first version) — closer to the compact
              size in the sketch, just a bit bigger so the photos are still
              legible. `flex flex-wrap` instead of `grid` is what lets them
              stay that fixed size instead of stretching to divide the row
              evenly. Each box shows that category's representative
              template photo (see pieceToPairCategories above, which pulls
              from subcategoryTemplateImages) with its name revealed on
              hover, same tooltip technique as the COLOR PAIRS swatches
              above. A box only falls back to showing plain text if that
              category has no template photo at all yet. */}
          {item && (
            <details className="group/pieces text-xs tracking-widest">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-2.5 w-2.5 shrink-0 transition-transform duration-200 group-open/pieces:rotate-90"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                PIECES TO PAIR
              </summary>
              <div className="mt-3 flex flex-wrap gap-3">
                {pieceToPairCategories
                  .filter((piece) => piece.category !== item.category)
                  .map((piece) => (
                    <div
                      key={piece.category}
                      className="group relative flex h-24 w-24 shrink-0 items-center justify-center border border-black/10 bg-neutral-50 p-2 text-black/70 dark:border-white/10 dark:bg-neutral-800 dark:text-white/70"
                    >
                      {piece.imageSrc ? (
                        <>
                          <img
                            src={piece.imageSrc}
                            alt={piece.label}
                            className="h-full w-full object-contain"
                          />
                          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-[10px] uppercase text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-black">
                            {piece.label}
                          </span>
                        </>
                      ) : (
                        <span className="text-center text-[9px] uppercase tracking-widest">
                          {piece.label}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </details>
          )}

          {item && !item.analyzedAt && (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="self-start bg-black px-4 py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {isAnalyzing ? "ANALYZING..." : "ANALYZE WITH AI"}
            </button>
          )}

          {/* ============================================================
              TEMPORARY — delete this block once all existing items have
              been refreshed under the latest AI prompt. This just lets you
              re-run analysis on an already-analyzed item (e.g. after a
              silhouette/complements prompt change) without deleting and
              re-uploading it. Nothing else in this file depends on it —
              safe to remove the whole `{item && item.analyzedAt && (...)}`
              block below whenever you're done backfilling.
              ============================================================ */}
          {item && item.analyzedAt && (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="self-start border border-black/20 px-4 py-2 text-xs tracking-widest text-black/60 hover:text-black disabled:opacity-50 dark:border-white/20 dark:text-white/60 dark:hover:text-white"
            >
              {isAnalyzing ? "RE-ANALYZING..." : "RE-ANALYZE (TEMP)"}
            </button>
          )}
        </div>
      </div>

      {/* Edit item overlay — a centered popup/modal (dimmed backdrop,
          click-outside-to-close, fade+scale entrance), same convention as
          the Add Item modal elsewhere in the app. Sized wider than a basic
          form card (max-w-4xl) with a two-column layout inside (fields on
          the left, photos on the right) so there's room to breathe instead
          of everything cramped into one narrow stack. Clicking the dimmed
          backdrop closes it; clicking inside the card does not (the
          stopPropagation on the form). Still always mounted (rather than
          conditionally rendered) so it can fade/scale in and out instead of
          just popping. */}
      <div
        aria-hidden={!showEditForm}
        onClick={() => setShowEditForm(false)}
        className={`fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-6 transition-opacity duration-200 ${
          showEditForm ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <form
          onSubmit={handleSaveEdit}
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-[90vh] w-full max-w-4xl flex-col gap-10 overflow-y-auto bg-white p-10 text-black shadow-lg transition-all duration-200 ease-out dark:bg-neutral-900 dark:text-white ${
            showEditForm ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <h2 className="text-xs tracking-widest">EDIT ITEM</h2>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
            <div className="flex flex-col gap-5">
              <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                CATEGORY
                <select
                  value={editCategory}
                  onChange={(e) => {
                    const nextCategory = e.target.value as Category
                    setEditCategory(nextCategory)
                    setEditSubcategory(subcategoryOptions[nextCategory][0])
                  }}
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {categoryDisplayName(category)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                TYPE
                <select
                  value={editSubcategory}
                  onChange={(e) => setEditSubcategory(e.target.value)}
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                >
                  {subcategoryOptions[editCategory].map((subcategory) => (
                    <option key={subcategory} value={subcategory}>
                      {subcategory}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                NAME (OPTIONAL)
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Grey Adidas Shirt"
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                />
              </label>

              {/* COLOR(S) and TONE are hidden for fragrances. A perfume's
                  "color" is the bottle's, which says nothing about the scent
                  and isn't what the fragrance panel shows anyway.

                  The VALUES are still submitted unchanged on save: the state
                  stays prefilled from the item, and updateItem patches
                  `colors`/`colorShade` unconditionally, so sending undefined
                  here would clear them — and the grid tile still uses an
                  item's colors to render its silhouette. Hiding the control
                  is not the same as dropping the data. */}
              {!isFragrance(editCategory, editSubcategory) && (
                <>
                <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                  COLOR(S)
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditColors([])}
                      className={`border px-2 py-1 text-xs tracking-widest transition-colors duration-200 ${
                        editColors.length === 0
                          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                          : "border-black/10 text-black/60 hover:text-black dark:border-white/10 dark:text-white/60 dark:hover:text-white"
                      }`}
                    >
                      -
                    </button>
                    {editColorOptions.map((color) => {
                      const selectedIndex = editColors.findIndex((c) => c.name === color.name)
                      const isSelected = selectedIndex !== -1
                      return (
                        <button
                          key={color.name}
                          type="button"
                          onClick={() => toggleEditColor(color)}
                          className={`flex items-center gap-1.5 border px-2 py-1 text-xs tracking-widest transition-colors duration-200 ${
                            isSelected
                              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                              : "border-black/10 text-black/60 hover:text-black dark:border-white/10 dark:text-white/60 dark:hover:text-white"
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/10"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name}
                          {isSelected && <span className="text-[10px] opacity-70">{selectedIndex + 1}</span>}
                        </button>
                      )
                    })}
                  </div>
                </label>

                <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                  TONE (PRIMARY)
                  <select
                    value={editColorShade}
                    onChange={(e) => setEditColorShade(e.target.value)}
                    className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                  >
                    <option value="">-</option>
                    <option value="LIGHT">LIGHT</option>
                    <option value="DARK">DARK</option>
                  </select>
                </label>
                </>
              )}

              {/* Manual flip override — only makes sense for footwear, so
                  it's gated on editCategory here rather than always shown.
                  Toggling it immediately mirrors the FRONT preview below
                  (see the style prop on both branches of that image) so you
                  can see the result before saving, same as how the flip
                  actually renders on the grid tile and this page's own
                  display image once saved. Same pill-switch styling as the
                  "SHOW ADD TILE IN GRID" switch in the Add Item modal
                  (app/page.tsx), for visual consistency. */}
              {editCategory === "SHOES" && (
                <label className="flex items-center justify-between text-xs tracking-widest text-black/60 dark:text-white/60">
                  FLIP IMAGE (FACE RIGHT)
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editNeedsFlip}
                    onClick={() => setEditNeedsFlip((prev) => !prev)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      editNeedsFlip ? "bg-black dark:bg-white" : "bg-black/15 dark:bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-neutral-900 ${
                        editNeedsFlip ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
              )}

              {/* Hand-written note pyramid — fragrances only. A note pyramid
                  is a factual claim about a specific product that the AI can
                  get wrong, or now honestly decline to guess at (see
                  FRAGRANCE_GUIDANCE in convex/analyze.ts), so there has to be
                  a way to just type the right answer. Comma-separated to stay
                  a plain text field rather than a tag editor, matching how
                  every other field in this form works.

                  Worth knowing: a re-analysis DOES overwrite what you type
                  here, unlike NAME, which analysis leaves alone once set. */}
              {isFragrance(editCategory, editSubcategory) && (
                <div className="flex flex-col gap-5">
                  {([
                    ["TOP NOTES", editNotesTop, setEditNotesTop, "bergamot, lemon, cardamom"],
                    ["MIDDLE NOTES", editNotesMiddle, setEditNotesMiddle, "sage, juniper, geranium"],
                    ["BASE NOTES", editNotesBase, setEditNotesBase, "amberwood, tonka, vetiver"],
                  ] as const).map(([label, value, setValue, placeholder]) => (
                    <label
                      key={label}
                      className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60"
                    >
                      {label}
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="border-b border-black/20 bg-transparent py-1 text-sm tracking-normal text-black placeholder:text-black/25 focus:border-black focus:outline-none dark:border-white/20 dark:text-white dark:placeholder:text-white/25 dark:focus:border-white"
                      />
                    </label>
                  ))}
                  <p className="text-xs tracking-widest text-black/30 dark:text-white/30">
                    COMMA-SEPARATED · LEAVE ALL THREE EMPTY TO CLEAR
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-5">
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                  PHOTO (FRONT)
                  {editFrontPreviewUrl ? (
                    <img
                      src={editFrontPreviewUrl}
                      alt="Front preview"
                      className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                      style={editCategory === "SHOES" && editNeedsFlip ? { transform: "scaleX(-1)" } : undefined}
                    />
                  ) : item?.frontImageUrl ? (
                    <img
                      src={item.frontImageUrl}
                      alt="Current front photo"
                      className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                      style={editCategory === "SHOES" && editNeedsFlip ? { transform: "scaleX(-1)" } : undefined}
                    />
                  ) : (
                    <div className="aspect-square w-full border border-dashed border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-neutral-800" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setEditFrontImageFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs"
                  />
                </label>

                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
                  PHOTO (BACK, OPTIONAL)
                  {editBackPreviewUrl ? (
                    <img
                      src={editBackPreviewUrl}
                      alt="Back preview"
                      className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                    />
                  ) : item?.backImageUrl ? (
                    <img
                      src={item.backImageUrl}
                      alt="Current back photo"
                      className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                    />
                  ) : (
                    <div className="aspect-square w-full border border-dashed border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-neutral-800" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setEditBackImageFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs"
                  />
                </label>
              </div>

              <details className="group/info text-xs tracking-widest text-black/60 dark:text-white/60">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-2.5 w-2.5 shrink-0 transition-transform duration-200 group-open/info:rotate-90"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  ADDITIONAL INFO
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  {/* MATERIAL and SILHOUETTE are hints for the AI's garment
                      reading — "cotton", "oversized". Neither applies to a
                      scent, and the fragrance panel replaces both rows, so
                      they'd only be dead inputs here. ITEM VALUE below stays,
                      since a bottle has a price like anything else. Same
                      prefilled-and-resubmitted behaviour as COLOR(S) above. */}
                  {!isFragrance(editCategory, editSubcategory) && (
                    <>
                    <label className="flex flex-col gap-1">
                      MATERIAL (OPTIONAL)
                      <input
                        value={editMaterialHint}
                        onChange={(e) => setEditMaterialHint(e.target.value)}
                        placeholder="e.g. cotton, denim, leather"
                        className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      SILHOUETTE (OPTIONAL)
                      <input
                        value={editSilhouetteHint}
                        onChange={(e) => setEditSilhouetteHint(e.target.value)}
                        placeholder="e.g. oversized, slim, wide-leg"
                        className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                      />
                    </label>
                    </>
                  )}

                  <label className="flex flex-col gap-1">
                    ITEM VALUE (OPTIONAL)
                    <input
                      value={editItemValue}
                      onChange={(e) => setEditItemValue(e.target.value)}
                      placeholder="$67"
                      className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                    />
                  </label>
                </div>
              </details>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowEditForm(false)}
              className="border border-black/10 px-8 py-2 text-xs tracking-widest dark:border-white/10"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={isSavingEdit}
              className="bg-black px-8 py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
            >
              {isSavingEdit ? "SAVING..." : "SAVE"}
            </button>
          </div>
        </form>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="flex w-80 flex-col gap-4 bg-white p-8 shadow-lg dark:bg-neutral-900">
            <h2 className="text-xs tracking-widest">DELETE ITEM</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              This will permanently delete {item.name ?? item.code}. This can&apos;t be
              undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 bg-black py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
              >
                {isDeleting ? "DELETING..." : "DELETE"}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 border border-black/10 py-2 text-xs tracking-widest dark:border-white/10"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function ItemDetailPage() {
  return (
    <Suspense fallback={null}>
      <ItemDetailPageContent />
    </Suspense>
  )
}