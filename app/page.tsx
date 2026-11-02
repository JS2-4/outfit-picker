"use client"

import { Suspense, useEffect, useRef, useState, ViewTransition } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { MenuPanel } from "@/components/MenuPanel"
import { usePendingUploads } from "./PendingUploadsContext"

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
// the ported resize/edge-cleanup/crop logic.
const BG_REMOVAL_PUBLIC_PATH = "/bg-removal/"

// Spins up a fresh worker per call (rather than one shared worker) so
// concurrent uploads — e.g. submitting a second Add Item while an earlier
// one is still processing, which this app's pendingUploads list explicitly
// supports — can never cross-talk with each other's postMessage responses.
// Worker start-up cost is negligible next to the multi-second model
// inference it's about to run.
function runInWorker(file: File, publicPath: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./photoProcessing.worker.ts", import.meta.url), {
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

type Category = "SHIRTS" | "PANTS" | "SHOES" | "OUTERWEAR" | "ACCESSORIES"

const categories: Category[] = ["SHIRTS", "PANTS", "SHOES", "OUTERWEAR", "ACCESSORIES"]

const categoryPrefix: Record<Category, string> = {
  SHIRTS: "SH",
  PANTS: "PT",
  SHOES: "SN",
  OUTERWEAR: "JK",
  ACCESSORIES: "AC",
}

// Display-only rename — SHOES stays the internal value (schema, database
// records, and the "SN" code prefix are all untouched), only the on-screen
// label reads "FOOTWEAR". Keeps this a pure UI change: no backend edits, no
// migration needed for items already saved under SHOES.
const categoryDisplayNames: Partial<Record<Category, string>> = {
  SHOES: "FOOTWEAR",
}

function categoryDisplayName(category: Category): string {
  return categoryDisplayNames[category] ?? category
}

// Subcategory ("TYPE") options, keyed by the internal category value —
// SHOES here means what displays as FOOTWEAR.
const subcategoryOptions: Record<Category, string[]> = {
  SHIRTS: ["T-SHIRTS", "LONG SLEEVE", "BUTTON UP", "OTHER"],
  PANTS: ["LONG PANTS", "SHORTS", "OTHER"],
  SHOES: ["SNEAKERS", "BOOTS", "SANDALS", "SLIDES", "OTHER"],
  OUTERWEAR: ["HOODIES", "JACKETS", "VESTS", "COATS"],
  ACCESSORIES: ["BELTS", "SUNGLASSES", "HATS", "JEWELRY", "FRAGRANCES", "OTHER"],
}

// Template photo per (category, subcategory) — same map as in
// app/item/[id]/page.tsx (duplicated here since there's no shared utils
// module yet). Used below to show a live reference preview next to the
// CATEGORY/TYPE dropdowns in the Add Item form, so you see an example of
// what you're about to categorize before uploading your own photo. Plain
// <img> tags pointing at static files under public/subcategory-templates/,
// not imports, so a photo can be swapped just by replacing the file at the
// same path. Subcategories with no entry here (T-SHIRTS, LONG PANTS, every
// OTHER, JACKETS) simply have no preview yet.
const subcategoryTemplateImages: Partial<Record<Category, Partial<Record<string, string>>>> = {
  SHIRTS: {
    "LONG SLEEVE": "/subcategory-templates/shirts-long-sleeve.png",
    "BUTTON UP": "/subcategory-templates/shirts-button-up.png",
  },
  PANTS: { SHORTS: "/subcategory-templates/pants-shorts.png" },
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

function getSubcategoryTemplateImage(category: Category, subcategory: string): string | null {
  return subcategoryTemplateImages[category]?.[subcategory] ?? null
}

// SORT BY options for the grid, in the order they appear in the dropdown.
type SortMode = "RECENTLY_ADDED" | "NAME" | "COLOR" | "MOST_WORN"

const sortOptions: { key: SortMode; label: string }[] = [
  { key: "RECENTLY_ADDED", label: "RECENTLY ADDED" },
  { key: "NAME", label: "NAME" },
  { key: "COLOR", label: "COLOR" },
  { key: "MOST_WORN", label: "MOST WORN" },
]

type ItemColor = { hex: string; name: string }

// Rainbow-ish family order for the COLOR sort mode: white, then warm-to-cool
// neutrals/hues, ending in gray/black — matching the order requested for
// the closet view as closely as possible using only the colors actually
// registered in the app's palette. Each hue's LIGHT/DARK TONE (PRIMARY)
// nudges an item earlier/later within its own family (see colorSortRank
// below). A few registered colors are themselves a fixed light/dark
// variant of another hue rather than a shade of it — TAN reads as a light
// brown, MAROON/NAVY/OLIVE as dark reds/blues/greens — so they get their
// own fixed slot instead of going through the shade offset. GOLD/SILVER
// (ACCESSORIES-only) weren't part of the requested order, so they're
// appended at the very end.
const COLOR_FAMILY_RANK: Record<string, number> = {
  WHITE: 0,
  CREAM: 10,
  BEIGE: 20,
  TAN: 27,
  BROWN: 30,
  RED: 40,
  MAROON: 46,
  ORANGE: 50,
  YELLOW: 60,
  GREEN: 70,
  OLIVE: 76,
  BLUE: 80,
  NAVY: 86,
  PURPLE: 90,
  PINK: 100,
  GRAY: 110,
  BLACK: 120,
  GOLD: 130,
  SILVER: 140,
}

// Items with no resolvable color sort to the very end (Infinity) rather
// than the front, so un-analyzed items don't crowd out WHITE.
function colorSortRank(item: {
  colors?: ItemColor[]
  primaryColor?: ItemColor
  colorShade?: string
}): number {
  const colors = item.colors && item.colors.length > 0 ? item.colors : item.primaryColor ? [item.primaryColor] : []
  if (colors.length === 0) return Infinity
  const base = COLOR_FAMILY_RANK[colors[0].name]
  if (base === undefined) return Infinity
  const shadeOffset = item.colorShade === "LIGHT" ? -3 : item.colorShade === "DARK" ? 3 : 0
  return base + shadeOffset
}

type ReturnHint = {
  id: string
  code: string
  name: string | null
  category: Category
  img: string | null
}

// Background-removed silhouettes traced from real reference photos (saved
// under public/category-icons/) — used as the loading skeleton's shape via
// CSS mask, so the placeholder actually looks like the garment instead of a
// generic icon. This is the CATEGORY-level fallback: categoryIconMaskUrl
// below checks the more specific subcategoryTemplateImages map first (e.g.
// SHIRTS + BUTTON UP gets the actual button-up silhouette, not just a
// generic shirt), and only falls back to these when that specific
// (category, subcategory) pair has no template yet. Categories without
// even a category-level reference photo fall back further, to a small
// hand-drawn shape below (currently just ACCESSORIES).
const categoryIconSrc: Partial<Record<Category, string>> = {
  SHIRTS: "/category-icons/shirts.png",
  PANTS: "/category-icons/pants.png",
  SHOES: "/category-icons/shoes.png",
  OUTERWEAR: "/category-icons/outerwear.png",
}

// Fallback line-art path data, only used for categories that don't have a
// photo-derived silhouette in categoryIconSrc yet.
const fallbackIconPaths: Partial<Record<Category, string[]>> = {
  ACCESSORIES: [
    "M15,44 C15,34 23,26 34,26 C42,26 48,30 50,36 C52,30 58,26 66,26 C77,26 85,34 85,44 C85,56 76,63 64,63 C55,63 48,58 46,49 C44,58 37,63 28,63 C16,63 15,56 15,44 Z M4,38 L15,42 L15,46 L4,50 Z M96,38 L85,42 L85,46 L96,50 Z",
  ],
}

// Per-category size correction for the REAL uploaded photo (the grid
// tile's img wrapper further down). By default the loading skeleton's
// silhouette reads the very same number, so a photo can't visually "pop"
// bigger or smaller than the skeleton it replaces — but that sharing is no
// longer unconditional: skeletonImageScaleOverride below can pin the
// skeleton to a different value per category, and PANTS now does exactly
// that. Anything NOT listed there still shares these numbers with its
// skeleton, so this stays the single knob for most categories.
//
// mask-size: contain (and, for real photos, object-contain) already fits
// each silhouette/photo to the tile along its own constraining axis at
// scale 1, so this scale number roughly doubles as "% of the tile's
// usable area" — but only roughly: every source image (template PNG or
// real photo) has its own amount of built-in empty margin around the
// actual garment, so the same scale value doesn't read as the same
// visual fullness across different shapes. These values are tuned to
// approximately hit this target guide (given as a % of the tile's usable
// area for the real garment photo):
//   Shirts 80%, Long pants 80-90%, Shorts 75-85%, Footwear 70-80%,
//   Accessories 60-75%
// — picking from within a range where one was given. Still first-pass
// visual estimates, not an exact conversion from the percentages above —
// tell me if any of these still look too big/small and I'll adjust the
// number.
const categoryImageScale: Partial<Record<Category, number>> = {
  SHIRTS: 0.8,
  // Raised 0.8 -> 0.9 (second pass): 0.8 sat at the very bottom of the
  // 80-90% target above and read visibly small in the tile. 0.9 is the TOP
  // of that documented range, so treat it as the ceiling — pushing past it
  // starts crowding the tile edges rather than just filling them. The
  // SHORTS override below was raised by the same ~12% in the same pass, so
  // the two keep the relative proportion described there.
  PANTS: 0.9,
  SHOES: 0.75,
  ACCESSORIES: 0.68,
}

// Overrides categoryImageScale for specific (category, subcategory) pairs
// that need their own correction instead of sharing the category-wide
// number. Currently just PANTS + SHORTS: SHORTS' silhouette/photo fills
// its own bounding box noticeably more than LONG PANTS' does (a wide,
// short garment vs. a narrow, tall one), so at the same scale shorts read
// as much bigger — the category-wide PANTS value above is tuned for LONG
// PANTS (which has no override here, so it falls through to that value),
// and shorts gets its own smaller number via getImageScale below.
//
// Raised 0.65 -> 0.73 in the same second pass that took PANTS to 0.9. Two
// reasons: it keeps the shorts-to-long-pants ratio essentially unchanged
// (0.65/0.8 = 0.81, 0.73/0.9 = 0.81), so the deliberate "shorts render
// smaller" correction described above still holds; and 0.65 was actually
// below the 75-85% target the guide above gives for shorts, so it was the
// one value here sitting outside its own documented range.
const categoryImageScaleBySubcategory: Partial<Record<Category, Partial<Record<string, number>>>> = {
  PANTS: { SHORTS: 0.73 },
}

// Looks up the (category, subcategory) pair's scale, falling back to the
// category-wide default, then to 1 (uncorrected) if the category has no
// entry either. This is the REAL PHOTO scale — the skeleton goes through
// getSkeletonImageScale below, which usually defers right back to this.
function getImageScale(category: Category, subcategory?: string): number {
  const override = subcategory ? categoryImageScaleBySubcategory[category]?.[subcategory] : undefined
  return override ?? categoryImageScale[category] ?? 1
}

// Skeleton-only scale overrides — the deliberate exception to the
// "skeleton and photo always share one number" rule described above.
//
// PANTS' photo scale was raised (0.8 -> 0.9, and SHORTS 0.65 -> 0.73)
// because the actual garment photos were reading too small in the tile.
// The silhouette templates those skeletons are masked from don't have the
// same problem — they're drawn with much less built-in empty margin than a
// real photo has, so at 0.9 the skeleton looked oversized rather than
// merely bigger. These entries hold the skeleton at the pre-bump values so
// only the real images grew.
//
// Consequence worth knowing: for PANTS the skeleton and the photo now
// render at different sizes on purpose, so a pants tile DOES visibly step
// up in size the moment its photo finishes uploading. That's accepted here
// rather than a bug to fix. Every category absent from these two maps still
// shares one number with its skeleton and still can't pop.
const skeletonImageScaleOverride: Partial<Record<Category, number>> = {
  PANTS: 0.8,
}

const skeletonImageScaleOverrideBySubcategory: Partial<
  Record<Category, Partial<Record<string, number>>>
> = {
  PANTS: { SHORTS: 0.65 },
}

// Same specificity ladder as getImageScale — exact (category, subcategory)
// first, then category-wide — except each rung looks in the skeleton
// override maps. Only if BOTH miss does it fall through to the photo scale,
// which is what keeps every un-overridden category sharing one number.
function getSkeletonImageScale(category: Category, subcategory?: string): number {
  const subOverride = subcategory
    ? skeletonImageScaleOverrideBySubcategory[category]?.[subcategory]
    : undefined
  if (subOverride !== undefined) return subOverride

  const categoryOverride = skeletonImageScaleOverride[category]
  if (categoryOverride !== undefined) return categoryOverride

  return getImageScale(category, subcategory)
}

// Falls through three levels of specificity: the exact (category,
// subcategory) template photo (now solid-black silhouettes, same visual
// treatment as categoryIconSrc below) if one exists, then the
// category-level silhouette, then the hand-drawn fallback shape. Passing no
// subcategory (or one with no template yet, like T-SHIRTS/LONG PANTS/
// JACKETS) just skips straight to the category-level check.
function categoryIconMaskUrl(category: Category, subcategory?: string): string {
  const templateSrc = subcategory ? getSubcategoryTemplateImage(category, subcategory) : null
  if (templateSrc) {
    return `url("${templateSrc}")`
  }
  const src = categoryIconSrc[category]
  if (src) {
    return `url("${src}")`
  }
  const paths = fallbackIconPaths[category] ?? []
  const pathsMarkup = paths.map((d) => `<path d='${d}'/>`).join("")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${pathsMarkup}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// Shared mask styling for both the solid base shape and the shimmer overlay
// in the skeleton tile — kept as one helper so the two layers can never
// drift out of sync with each other.
function maskStyle(category: Category, subcategory?: string): React.CSSProperties {
  const url = categoryIconMaskUrl(category, subcategory)
  return {
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  }
}

function HomePageContent() {
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get("category") as Category | null
  const backParam = searchParams.get("back")

  let returnHint: ReturnHint | null = null
  if (backParam) {
    try {
      const parsed = JSON.parse(backParam)
      if (parsed && typeof parsed === "object" && parsed.id && parsed.img) {
        returnHint = parsed as ReturnHint
      }
    } catch {
      // Malformed or missing hint — just skip the placeholder tile below.
    }
  }

  const [activeCategory, setActiveCategory] = useState<Category>(
    categoryParam && categories.includes(categoryParam) ? categoryParam : "SHIRTS"
  )
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItemName, setNewItemName] = useState("")
  const [newItemCategory, setNewItemCategory] = useState<Category>("SHIRTS")
  const [newItemSubcategory, setNewItemSubcategory] = useState<string>(subcategoryOptions.SHIRTS[0])
  // Remembers the last TYPE (subcategory) actually used in a submitted add
  // per category — e.g. once you've added a SHORTS item, opening the Add
  // Item form for PANTS again defaults TYPE to SHORTS instead of resetting
  // to LONG PANTS (that category's first option) every time. Updated in
  // handleAddItem right as a submission starts; read from
  // openAddFormForActiveCategory and the CATEGORY select's onChange below,
  // both of which otherwise just reset TYPE to subcategoryOptions[...][0].
  const [lastSubcategoryByCategory, setLastSubcategoryByCategory] = useState<
    Partial<Record<Category, string>>
  >({})
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null)
  const [backImageFile, setBackImageFile] = useState<File | null>(null)
  const [materialHint, setMaterialHint] = useState("")
  const [silhouetteHint, setSilhouetteHint] = useState("")
  const [itemValue, setItemValue] = useState("")
  const [frontPreviewUrl, setFrontPreviewUrl] = useState<string | null>(null)
  const [backPreviewUrl, setBackPreviewUrl] = useState<string | null>(null)
  // Placeholder toggle only — not wired to any AI photo-enhancement feature
  // yet. That feature is on hold pending a paid image-generation API; this
  // just reserves the UI spot and default state for when it's built.
  const [enhancePhotos, setEnhancePhotos] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Lives in PendingUploadsContext (provided from layout.tsx), not as local
  // state here — see that file's comment for why: local state would get
  // wiped every time this component unmounts, which happens on every
  // client-side navigation away from this page.
  const { pendingUploads, addPendingUpload, removePendingUpload, markRevealed, attachItemId } = usePendingUploads()
  // Bumped every time an add-item submission closes the modal, so the grid's
  // key changes and it remounts (replaying the fade-in-up stagger) even if
  // the active category didn't change — that's what gives the "refresh" feel.
  const [gridRefreshKey, setGridRefreshKey] = useState(0)
  // Toggled by the trash-can button in the header. While true, hovering an
  // individual tile covers it with an overlay and shows the delete icon;
  // while false, tiles never show the overlay no matter what.
  const [deleteMode, setDeleteMode] = useState(false)
  // Bumped on every trash-can click, independent of deleteMode itself —
  // used purely as a React `key` (see the button below) to force the icon
  // to remount and replay its grow-then-shrink press animation every
  // single click, even two rapid clicks in a row where a boolean flag
  // toggling true->false->true might not actually change anything for
  // React to notice. This is on top of (not instead of) the existing
  // red/black color change, which is driven by deleteMode as before.
  const [trashPressCount, setTrashPressCount] = useState(0)
  // Toggled from the switch in the Add Item modal's header. Controls
  // whether the "+" add-tile shows up in the grid next to the clothing
  // pieces (the header's "ADD ITEM" button always works regardless).
  const [showAddTile, setShowAddTile] = useState(true)
  // Toggled by the filter (funnel) button in the header. Controls whether
  // the subcategory row below the category nav is shown. The row is always
  // mounted now (see the grid-rows wrapper below) so it can animate open
  // and closed instead of just popping in and out.
  const [showSubcategoryMenu, setShowSubcategoryMenu] = useState(false)
  // The subcategory currently filtering the grid, or null when no filter is
  // applied. There's no separate "ALL" option — clicking the already-active
  // subcategory again clears this back to null.
  const [activeSubcategoryFilter, setActiveSubcategoryFilter] = useState<string | null>(null)
  // Search-by-name box at the right end of the subcategory row. Expanded
  // state is purely visual — the typed query keeps filtering the grid even
  // while the box is collapsed.
  const [showSearchInput, setShowSearchInput] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // SORT BY button + dropdown. Lives in the header next to the menu button
  // (see the JSX below) rather than inside the collapsible subcategory row —
  // that row uses overflow-hidden for its open/close animation, which was
  // clipping the dropdown before it could fully show.
  const [sortMode, setSortMode] = useState<SortMode>("RECENTLY_ADDED")
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (categoryParam && categories.includes(categoryParam)) {
      setActiveCategory(categoryParam)
    }
  }, [categoryParam])

  // Build a live preview URL whenever the front photo file changes, and
  // clean up the old one so we don't leak object URLs.
  useEffect(() => {
    if (!frontImageFile) {
      setFrontPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(frontImageFile)
    setFrontPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [frontImageFile])

  useEffect(() => {
    if (!backImageFile) {
      setBackPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(backImageFile)
    setBackPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [backImageFile])

  // Lets ESC close whichever overlay is on top: the Add Item modal first,
  // then the SORT BY dropdown.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (showAddForm) {
        setShowAddForm(false)
      } else if (showSortMenu) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showAddForm, showSortMenu])

  // Focuses the search input the moment it expands, so pressing the search
  // icon lands you straight into typing.
  useEffect(() => {
    if (showSearchInput) {
      searchInputRef.current?.focus()
    }
  }, [showSearchInput])

  // Collapses the search box when you click anywhere outside it, but only
  // if nothing's typed — if there's an active query, clicking away leaves
  // it open (and still filtering) rather than hiding it.
  useEffect(() => {
    if (!showSearchInput) return
    function handleClickOutside(e: MouseEvent) {
      if (searchQuery !== "") return
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchInput(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showSearchInput, searchQuery])

  // Collapses the SORT BY dropdown when you click anywhere outside it.
  useEffect(() => {
    if (!showSortMenu) return
    function handleClickOutside(e: MouseEvent) {
      if (sortContainerRef.current && !sortContainerRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showSortMenu])

  const items = useQuery(api.items.getAllItems)
  const createItem = useMutation(api.items.createItem)
  const generateUploadUrl = useMutation(api.items.generateUploadUrl)
  const analyzeItem = useAction(api.analyze.analyzeItem)
  const toggleFavorite = useMutation(api.items.toggleFavorite)
  const deleteItem = useMutation(api.items.deleteItem)

  // Item pending delete-confirmation from the grid's delete button. Holds
  // the whole item (not just an id) so the confirmation dialog can show its
  // name/code without an extra lookup.
  const [itemPendingDelete, setItemPendingDelete] = useState<NonNullable<typeof items>[number] | null>(null)
  // Which tile's ••• menu is open, by item id. Typed as a plain string rather
  // than Id<"items"> to avoid pulling the dataModel import in for one
  // comparison — it is only ever compared against item._id, never passed to
  // Convex.
  const [menuItemId, setMenuItemId] = useState<string | null>(null)
  const [isDeletingItem, setIsDeletingItem] = useState(false)

  const trimmedSearchQuery = searchQuery.trim().toLowerCase()

  // Filtered by category/subcategory/search, then sorted according to
  // whichever SORT BY option is active. RECENTLY ADDED is oldest-first
  // (the item you added longest ago comes first, most recent comes last);
  // COLOR uses the rainbow-ish family order defined above; MOST WORN reads
  // from the (currently always-zero, since nothing increments it yet)
  // timesWorn stat.
  const visibleItems = (items ?? [])
    .filter(
      (item) =>
        item.category === activeCategory &&
        (activeSubcategoryFilter === null || item.subcategory === activeSubcategoryFilter) &&
        (trimmedSearchQuery === "" || (item.name ?? "").toLowerCase().includes(trimmedSearchQuery)) &&
        // Keep a freshly-created item out of the real grid for as long as
        // its matching pending upload is still tracking it (see itemId in
        // PendingUploadsContext.tsx) — that upload only attaches its itemId
        // once AI analysis (color/material/name) is actually in flight, and
        // only gets removed once that analysis settles. Without this, the
        // item would appear here — bare, mid-analysis — at the same time
        // its own skeleton tile is still showing further down.
        !pendingUploads.some((pending) => pending.itemId === item._id)
    )
    .sort((a, b) => {
      switch (sortMode) {
        case "NAME": {
          const aName = (a.name ?? a.code).toLowerCase()
          const bName = (b.name ?? b.code).toLowerCase()
          return aName.localeCompare(bName)
        }
        case "COLOR":
          return colorSortRank(a) - colorSortRank(b)
        case "MOST_WORN":
          return (b.timesWorn ?? 0) - (a.timesWorn ?? 0)
        case "RECENTLY_ADDED":
        default:
          return a.createdAt - b.createdAt
      }
    })
  const visiblePendingUploads = pendingUploads.filter(
    (pending) => pending.category === activeCategory
  )

  // ---- grid entrance replay ------------------------------------------------
  // Tiles already stagger in with animate-fade-in-up, but only on MOUNT. Since
  // each tile is keyed by item._id, changing the sort order or narrowing a
  // filter reuses the very same DOM nodes — React just moves them — so the
  // animation never replays and the grid silently rearranges. Prefixing the
  // key with a value that changes whenever the VIEW changes forces a remount,
  // and a fresh node always restarts a CSS animation from frame 0. (Same
  // reason the header's trash icon is keyed on a click counter.)
  //
  // Switching category already re-animated on its own, because a different
  // category yields entirely different item ids and therefore new keys. Sort,
  // subcategory and search were the three that didn't.
  //
  // Search is debounced and the other inputs are not, which is the whole point
  // of keeping them separate: sort and subcategory are single deliberate
  // clicks, so they should replay instantly, while a search query changes on
  // every keystroke. Feeding raw keystrokes in would restart the animation
  // mid-flight on each letter and make the grid strobe while you type. This
  // way results still filter live as you type, and the entrance plays once,
  // when you pause.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(trimmedSearchQuery)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(trimmedSearchQuery), 200)
    return () => clearTimeout(timer)
  }, [trimmedSearchQuery])

  const gridEpoch = `${activeCategory}|${activeSubcategoryFilter ?? ""}|${sortMode}|${debouncedSearchQuery}`

  // While the real item list is still loading (e.g. right after navigating
  // back from an item page), show just the one item we came from — enough
  // for the reverse shared-element morph to have something to land on —
  // instead of a flash of an empty grid.
  const showReturnPlaceholder =
    items === undefined &&
    returnHint !== null &&
    returnHint.category === activeCategory

  // Real items stagger in at 40ms apart. A freshly-created pending/loading
  // tile waits for all of those to finish, then a deliberate extra beat —
  // see revealDelayMs in handleAddItem below, where this same math is used
  // once, at creation time, instead of being recomputed here on every
  // render (recomputing it here was what made the delay replay every time
  // the grid remounted, e.g. from switching category tabs).
  const pendingStagger = 150

  function openAddFormForActiveCategory() {
    setNewItemCategory(activeCategory)
    setNewItemSubcategory(lastSubcategoryByCategory[activeCategory] ?? subcategoryOptions[activeCategory][0])
    setShowAddForm(true)
  }

  // Clicking the already-active subcategory clears the filter; clicking any
  // other one switches to it. Either way, the search box collapses (it
  // keeps whatever was typed, it just visually tucks away).
  function toggleSubcategoryFilter(subcategory: string) {
    setActiveSubcategoryFilter((prev) => (prev === subcategory ? null : subcategory))
    setShowSearchInput(false)
  }

  async function handleConfirmDeleteFromGrid() {
    if (!itemPendingDelete) return
    setIsDeletingItem(true)
    try {
      await deleteItem({ id: itemPendingDelete._id })
      setItemPendingDelete(null)
    } catch (err) {
      console.error(err)
      alert("Delete failed — check the terminal running npx convex dev for details.")
    } finally {
      setIsDeletingItem(false)
    }
  }

  // Uploads a photo and returns the FINAL, processed storage id. All the
  // actual image work (background removal + resize + edge cleanup + crop)
  // happens inside runInWorker()'s dedicated Web Worker, not here — see
  // that function's comment above for why that's what actually keeps this
  // page responsive during upload. window.location.origin is only safe to
  // read inside this function (never at module scope), since this file's
  // top level also runs during server-side rendering, where window doesn't
  // exist.
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

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    const categoryForUpload = newItemCategory
    const subcategoryForUpload = newItemSubcategory
    const nameForUpload = newItemName || null
    const frontFile = frontImageFile
    const backFile = backImageFile
    const materialForUpload = materialHint || undefined
    const silhouetteForUpload = silhouetteHint || undefined
    const itemValueForUpload = itemValue || undefined

    // Remembers this TYPE as the one to default to next time the Add Item
    // form opens for this same category — see lastSubcategoryByCategory
    // above. Recorded here, right as the submission starts, rather than
    // e.g. only after a successful upload — the choice was still real even
    // if the upload happens to fail later.
    setLastSubcategoryByCategory((prev) => ({ ...prev, [categoryForUpload]: subcategoryForUpload }))

    // Computed up front so the skeleton tile and the real item end up
    // showing the same code (e.g. "SH-03") instead of the placeholder
    // saying something generic.
    const existingInCategory = (items ?? []).filter(
      (item) => item.category === categoryForUpload
    ).length
    const nextNumber = String(existingInCategory + 1).padStart(2, "0")
    const code = `${categoryPrefix[categoryForUpload]}-${nextNumber}`
    const localId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // One-time entrance delay for this tile — see the comment on
    // revealDelayMs in PendingUploadsContext.tsx. existingInCategory here
    // stands in for "how many real items this tile's entrance should wait
    // out"; pendingUploads.filter(...).length stands in for "how many
    // other pending tiles in this category are already mid-stagger",
    // mirroring the old index-based stagger but computed once, now,
    // instead of every render.
    const pendingInCategoryCount = pendingUploads.filter(
      (pending) => pending.category === categoryForUpload
    ).length
    const revealDelayMs = existingInCategory * 40 + 250 + pendingInCategoryCount * pendingStagger

    // Deliberate, visible pause — this is what lets "UPLOADING..." actually
    // show on the button for a beat before the modal closes. It's not
    // network/processing time (that happens further below).
    await new Promise((resolve) => setTimeout(resolve, 450))

    setShowAddForm(false)
    setActiveCategory(categoryForUpload)
    setGridRefreshKey((key) => key + 1)
    // The skeleton tile is only added here, after the modal has actually
    // closed — so it appears as part of the freshly-refreshed grid instead
    // of sneaking into view while the popup is still open.
    addPendingUpload({
      localId,
      category: categoryForUpload,
      subcategory: subcategoryForUpload,
      code,
      name: nameForUpload,
      revealDelayMs,
      revealed: false,
      itemId: null,
    })
    // A plain setTimeout, not a React effect — it has to keep running
    // (and still flip this tile over to "already shown" once the delay is
    // up) even if this component unmounts before then, e.g. because you
    // switched category tabs or navigated to an item page. markRevealed
    // itself is a no-op if this upload has already finished and been
    // removed by the time it fires.
    setTimeout(() => markRevealed(localId), revealDelayMs)
    setNewItemName("")
    setFrontImageFile(null)
    setBackImageFile(null)
    setMaterialHint("")
    setSilhouetteHint("")
    setItemValue("")
    setEnhancePhotos(true)
    setIsSubmitting(false)

    // Wait for the browser to actually paint the closed modal + refreshed
    // grid before starting the upload/processing pipeline below.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )

    try {
      const frontImageId = frontFile ? await uploadPhoto(frontFile) : undefined
      const backImageId = backFile ? await uploadPhoto(backFile) : undefined

      const newItemId = await createItem({
        category: categoryForUpload,
        subcategory: subcategoryForUpload,
        code,
        name: nameForUpload || undefined,
        frontImageId,
        backImageId,
        materialHint: materialForUpload,
        silhouetteHint: silhouetteForUpload,
        itemValue: itemValueForUpload,
      })

      if (frontImageId) {
        // Attaches the real item's id to this still-alive pending upload —
        // see itemId in PendingUploadsContext.tsx — which hides the bare,
        // just-created row from the real grid (visibleItems above) so only
        // this skeleton tile shows for it. Analysis is awaited (rather than
        // fire-and-forget) specifically so the skeleton tile — and the
        // hiding it causes — lasts exactly as long as AI analysis actually
        // takes, whether that's a quick single pass or a couple of
        // validation retries inside analyzeItem. A failure here is caught
        // on its own, separately from the outer try/catch below, so an
        // analysis error (e.g. a rate limit) can't make a successful photo
        // upload look like a failed one — the item just ends up shown
        // without AI-filled fields, same fallback as before this change.
        attachItemId(localId, newItemId)
        try {
          await analyzeItem({ id: newItemId })
        } catch (err) {
          console.error("Analysis failed:", err)
        }
      }
    } catch (err) {
      console.error(err)
      alert("Upload failed — check the terminal running npx convex dev for details.")
    } finally {
      removePendingUpload(localId)
    }
  }

  return (
    /* h-screen + overflow-hidden (rather than the old min-h-screen, which
       let the whole page grow taller than the viewport and scroll as one
       block) pins this to exactly the viewport height. Combined with the
       flex-1 overflow-y-auto wrapper further down around just the grid,
       the header and TYPE filter row below it stay fixed in place while
       only the grid itself scrolls — and that inner scroll uses
       no-scrollbar (already used the same way on the item detail page's
       info panel) so scrolling still works but no scrollbar is ever
       visibly drawn. */
    <main className="flex h-screen flex-col overflow-hidden bg-white text-black dark:bg-neutral-950 dark:text-white">
      {/* Top nav — no bottom rule, so the header, the TYPE row and the grid
          read as one continuous surface instead of three stacked panels.

          py-3 rather than py-4 lifts the controls 4px: with the rule gone
          there was nothing for the extra padding to hold them away from, and
          they sat low in open space.

          This height matters beyond this page. The item detail header is
          pinned to match it (h-[48px] there) so the two align during the
          shared-element transition between the pages — change the padding here
          and that number has to move with it. */}
      {/* Height pinned explicitly rather than left to padding + whatever the
          tallest child happens to be. The item detail header has to match this
          one for the shared-element transition between the pages, and it used
          to do that by hard-coding h-[48px] against a GUESS that the tallest
          child here was 24px (MenuPanel). Measured, MenuPanel's trigger is two
          1px bars with a 6px gap — 8px — and the real tallest child is 21px
          (a 20px icon in a button that builds a 21px line box). So this header
          was 45px while the other claimed 48: a silent 3px mismatch.
          Both are now pinned to the same literal, which can't drift. */}
      <header className="flex h-[72px] items-center justify-between px-8">
        {/* Gaps measured off the reference mockup: 40px inside this group,
            48px between the category tabs, 32px on the right. They differ on
            purpose — the tabs are pure text and need the most air to read as
            separate targets, while the right pair is icon-plus-text and reads
            correctly tighter. */}
        <div className="flex items-center gap-10">
          <MenuPanel />

          {/* Filter sits between the menu and SORT BY: it belongs with the
              controls that change WHICH pieces the grid shows, and SORT BY
              changes their order — two halves of the same idea. It used to
              live on the right next to DELETE and ADD ITEM, which are actions
              that change the closet itself rather than the view of it. */}
          <button
            type="button"
            onClick={() => setShowSubcategoryMenu((prev) => !prev)}
            aria-label={showSubcategoryMenu ? "Hide type filter" : "Filter by type"}
            aria-pressed={showSubcategoryMenu}
            className={`inline-flex items-center justify-center transition-colors duration-200 ${
              showSubcategoryMenu || activeSubcategoryFilter
                ? "text-black dark:text-white"
                : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6 7.5V18l-4 2v-7.5L4 5z" />
            </svg>
          </button>

          {/* SORT BY — lives here in the header, next to the menu button,
              instead of inside the collapsible subcategory row below. That
              row needs overflow-hidden for its own open/close animation to
              work, which was clipping this dropdown before it could fully
              render. Up here there's nothing clipping it. */}
          <div ref={sortContainerRef} className="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={showSortMenu}
              /* pb-1 exists purely to align this text with the category tabs
                 (SHIRTS, PANTS…) to the right. Those carry pb-1 of their own
                 to leave room for the active-tab underline, which makes each
                 tab 4px taller than its text. The header centers every child,
                 so that padding sits entirely below the tab label and lifts it
                 2px above the row's true centre — where an unpadded SORT BY
                 was sitting. Matching the padding matches the lift exactly,
                 rather than guessing at a nudge value.

                 Note this raises SORT BY 2px above the two icons to its LEFT,
                 which stay on the row's centre line. Adding the same pb-1 to
                 the group wrapper would bring all three up together. */
              className={`shrink-0 pb-1 text-xs tracking-widest transition-colors duration-200 ${
                showSortMenu
                  ? "text-black dark:text-white"
                  : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
              }`}
            >
              SORT BY
            </button>

            <div
              role="listbox"
              className={`absolute left-0 top-full z-20 mt-2 w-44 origin-top-left border border-black/10 bg-white py-1 shadow-lg transition-all duration-150 ease-out dark:border-white/10 dark:bg-neutral-900 ${
                showSortMenu ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
              }`}
            >
              {sortOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={option.key === sortMode}
                  onClick={() => {
                    setSortMode(option.key)
                    setShowSortMenu(false)
                  }}
                  className={`block w-full px-3 py-2 text-left text-xs tracking-widest transition-colors duration-200 ${
                    option.key === sortMode
                      ? "text-black font-medium dark:text-white"
                      : "text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <nav className="flex gap-12">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => {
                setActiveCategory(category)
                // Subcategory options are category-specific — clear any
                // active filter so a stale selection from the previous
                // category can't silently keep filtering the new one.
                setActiveSubcategoryFilter(null)
              }}
              className={`relative pb-1 text-xs tracking-widest transition-colors duration-200 ${
                category === activeCategory
                  ? "text-black font-medium dark:text-white"
                  : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
              }`}
            >
              {categoryDisplayName(category)}
              <span
                className={`absolute inset-x-0 -bottom-0.5 h-px origin-center bg-black transition-transform duration-300 dark:bg-white ${
                  category === activeCategory ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-8">
          {/* Toggles delete mode — while active, hovering a tile covers it
              with an overlay and reveals the delete icon. While inactive,
              tiles never show the overlay. */}
          <button
            type="button"
            onClick={() => {
              setDeleteMode((prev) => !prev)
              setTrashPressCount((count) => count + 1)
            }}
            aria-label={deleteMode ? "Exit delete mode" : "Delete items"}
            aria-pressed={deleteMode}
            className={`inline-flex items-center justify-center transition-colors duration-200 ${
              deleteMode
                ? "text-red-500 hover:text-red-600"
                : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
            }`}
          >
            {/* Keyed on trashPressCount purely to force a remount on every
                click — a fresh DOM node always restarts a CSS animation
                from frame 0, which a boolean/class-toggle approach can't
                guarantee for two rapid clicks in a row. animate-trash-press
                is the grow-then-shrink press feedback (see globals.css);
                the color change above is separate, driven by deleteMode.
                The class is only added once trashPressCount > 0 — a CSS
                animation plays as soon as an element carrying its class
                first mounts, which on page load meant this played once
                automatically on its very first render, unprompted, since
                trashPressCount started at 0 but the class was always
                present. Leaving the class off entirely until the first
                real click means the icon's first-ever mount is silent.

                The icon-sits-too-high bug lived on the BUTTON, not on this
                span, and the asymmetry that caused it is Tailwind Preflight's
                `svg { display: block }` rule. The FILTER button next to this
                one has its <svg> as a direct child, so that button holds only
                a BLOCK-level box: no line box, height exactly 20px. This
                button wraps its svg in an inline-block <span>, which IS
                inline-level content, so this button builds a line box sized
                by the inherited line-height (24px) plus room reserved below
                the baseline for text descenders — even though there is no
                text here at all. Measured: 28px tall vs the filter button's
                20px, with all 8 extra px hanging BELOW the icon. The row's
                items-center then centers each 28px/20px BUTTON against its
                siblings, so the trash button's icon — pinned to the top of
                its taller box — lands 4px high. Sizing the span could never
                fix this, since the extra space is in the button, not the span.

                inline-flex items-center justify-center on the button is the
                fix: a flex container blockifies its children, so the span
                stops participating in baseline/line-box layout entirely and
                the reserved descender space disappears regardless of
                line-height. Verified in an isolated repro: 4px offset before,
                0px after. (Dropping the span and putting the key/animation
                straight on the svg fixes it too — same reason — but the span
                is kept so the animation target stays separate from the icon.)
                h-5 w-5 below still pins the span to the svg's exact 20px as a
                second, independent safeguard. */}
            <span
              key={trashPressCount}
              className={trashPressCount > 0 ? "animate-trash-press inline-block h-5 w-5" : "inline-block h-5 w-5"}
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
            </span>
          </button>

          <button
            onClick={() => setShowAddForm(true)}
            className="text-xs tracking-widest text-black/60 transition-colors duration-200 hover:text-black dark:text-white/60 dark:hover:text-white"
          >
            ADD ITEM
          </button>
        </div>
      </header>

      {/* Subcategory ("TYPE") filter row — always mounted so it can animate
          open/closed via the grid-template-rows trick (0fr collapsed, 1fr
          expanded, both transitioned) instead of just popping in and out.
          Same tab styling as the category nav above (text-xs
          tracking-widest, same active/inactive colors, same
          transition-colors duration-200), just without the underline
          indicator. Options come from subcategoryOptions[activeCategory],
          so they change automatically with the active category. Clicking
          the already-active subcategory clears the filter instead of
          leaving a separate "ALL" option to click. */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
          showSubcategoryMenu ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {/* No bottom rule here either — this row slides open between the
              header and the grid, and a rule under it re-drew the same
              boundary the header's rule used to draw, just lower down.

              Padding is deliberately asymmetric (pt-1 / pb-3): the row sits
              directly beneath the header's own bottom padding, so the space
              above it was already being paid for twice. The bottom keeps its
              full padding because nothing below is contributing any. */}
          <nav className="flex items-center gap-6 px-8 pt-1 pb-3">
            {subcategoryOptions[activeCategory].map((subcategory) => (
              <button
                key={subcategory}
                onClick={() => toggleSubcategoryFilter(subcategory)}
                className={`text-xs tracking-widest transition-colors duration-200 ${
                  subcategory === activeSubcategoryFilter
                    ? "text-black font-medium dark:text-white"
                    : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
                }`}
              >
                {subcategory}
              </button>
            ))}

            {/* Search-by-name — the input's right edge stays fixed
                against the search icon, so growing its width visibly
                extends the box to the left instead of shifting the icon
                around. Collapses back to just the icon when it's empty
                and you click elsewhere, or the moment a subcategory is
                selected — either way, the icon stays tinted while a
                query is still active even though the box itself is
                tucked away. */}
            <div ref={searchContainerRef} className="ml-auto flex items-center gap-2">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH"
                className={`border-b border-black/20 bg-transparent text-xs tracking-widest text-black outline-none transition-all duration-300 ease-out placeholder:text-black/30 dark:border-white/20 dark:text-white dark:placeholder:text-white/30 ${
                  showSearchInput ? "w-32 opacity-100" : "w-0 opacity-0"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowSearchInput(true)}
                aria-label="Search by name"
                className={`shrink-0 transition-colors duration-200 ${
                  showSearchInput || searchQuery
                    ? "text-black dark:text-white"
                    : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-5 w-5"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                </svg>
              </button>
            </div>
          </nav>
        </div>
      </div>

      {/* Scrolls independently of the header/TYPE row above (see the
          h-screen/overflow-hidden comment on <main>) — flex-1 fills
          whatever height they don't take up, overflow-y-auto lets this
          area scroll when the grid is taller than that, and no-scrollbar
          keeps that scrolling invisible instead of drawing a track. */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {/* Item grid — keyed by activeCategory + gridRefreshKey so switching
            tabs, or completing an add-item submission, both remount the grid
            and replay the entrance animation on the tiles */}
        <section
          key={`${activeCategory}-${gridRefreshKey}`}
          /* pt-4, down from the original py-14. 56px of clearance made sense
             when a rule sat above the grid and needed room to breathe; with
             the rule gone it just read as a gap, and 32px still did. The
             bottom keeps pb-14 — that one is scroll comfort at the end of the
             list, not separation from anything above it. */
          /* One gap in both directions now, not gap-x-6/gap-y-10. The old
             split existed because a tile was a bare image with its caption
             floating beneath it, so rows needed extra separation to stop the
             caption reading as part of the tile below. Tiles are bordered
             cards now and carry their own caption inside, so the frame does
             that work and an even 22px gutter is what the mockup shows. */
          className="grid grid-cols-2 gap-[22px] px-8 pt-6 pb-14 sm:grid-cols-3 md:grid-cols-5"
        >
        {showReturnPlaceholder && returnHint ? (
          <Link
            key={returnHint.id}
            href={`/item/${returnHint.id}${returnHint.img ? `?img=${encodeURIComponent(returnHint.img)}` : ""}`}
            className="flex flex-col tile-spotlight rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.02]"
          >
            <ViewTransition name={`item-image-${returnHint.id}`}>
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden">
                <img
                  src={returnHint.img ?? undefined}
                  alt={returnHint.name ?? returnHint.code}
                  className="h-full w-full object-contain"
                />
              </div>
            </ViewTransition>
            <span className="mt-3 truncate text-xs tracking-widest uppercase">
              {returnHint.name ?? returnHint.code}
            </span>
          </Link>
        ) : (
          visibleItems.map((item, index) => {
            const isPendingThisItem = itemPendingDelete?._id === item._id
            const overlayVisibilityClasses = isPendingThisItem
              ? "opacity-100"
              : deleteMode
                ? "opacity-0 group-hover:opacity-100"
                : "pointer-events-none opacity-0"

            const itemHref = item.frontImageUrl
              ? `/item/${item._id}?img=${encodeURIComponent(item.frontImageUrl)}`
              : `/item/${item._id}`
            const menuOpen = menuItemId === item._id

            return (
              /* The card is a <div>, not a <Link>. The ••• and the heart are
                 real buttons and nesting an interactive control inside an <a>
                 is invalid markup that fights the anchor for the click — the
                 previous version had to preventDefault its way out of exactly
                 that. Navigation now lives on two inner Links (the image and
                 the name), so the buttons are siblings and need no escaping. */
              <div
                /* gridEpoch prefix is what makes the entrance replay when the
                   view changes — see the comment where it's defined. The item
                   id stays in the key so tiles remain individually stable for
                   everything else React does with them. */
                key={`${gridEpoch}-${item._id}`}
                className="group animate-fade-in-up relative flex flex-col tile-spotlight rounded-xl border border-black/10 bg-black/[0.02] p-3 transition-transform duration-150 hover:scale-[1.02] dark:border-white/10 dark:bg-white/[0.02]"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <button
                  type="button"
                  onClick={() => setMenuItemId(menuOpen ? null : item._id)}
                  aria-label={`Options for ${item.name ?? item.code}`}
                  aria-expanded={menuOpen}
                  className="absolute right-3 top-3 z-30 flex h-7 w-7 items-center justify-center rounded-full text-black/40 transition-colors duration-150 hover:bg-black/5 hover:text-black dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>

                {menuOpen && (
                  <>
                    {/* Full-screen catcher rather than a document-level
                        mousedown listener: it closes the menu on any outside
                        click including one that lands on another tile's •••,
                        and it unmounts with the menu, so there's no listener
                        to leak. */}
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => setMenuItemId(null)}
                      className="fixed inset-0 z-30 cursor-default"
                    />
                    <div className="absolute right-3 top-11 z-40 w-32 overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-neutral-900">
                      <Link
                        href={itemHref}
                        onClick={() => setMenuItemId(null)}
                        className="block px-3 py-2 text-left text-xs tracking-widest text-black/70 hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        EDIT
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuItemId(null)
                          setItemPendingDelete(item)
                        }}
                        className="block w-full px-3 py-2 text-left text-xs tracking-widest text-red-500 hover:bg-red-500/10"
                      >
                        DELETE
                      </button>
                    </div>
                  </>
                )}

                <Link href={itemHref} className="block">
                  {item.frontImageUrl ? (
                    <ViewTransition name={`item-image-${item._id}`}>
                      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
                        {/* Scaled by the same categoryImageScale used for
                            this category's loading skeleton, so the real
                            photo never visually "pops" bigger/smaller than
                            the skeleton it replaces once it finishes
                            loading. Only the image itself scales — the
                            delete-affordance button below stays at full
                            tile size so its click target doesn't shrink.
                            Footwear additionally gets a horizontal flip
                            (scaleX(-1)) when needsFlip was set by the AI
                            analysis, so every shoe in the closet reads as
                            pointing right regardless of which way it faced
                            in the original photo. */}
                        <div
                          className="relative h-full w-full"
                          style={{
                            transform: `scale(${getImageScale(item.category, item.subcategory)})${
                              item.needsFlip ? " scaleX(-1)" : ""
                            }`,
                          }}
                        >
                          <img
                            src={item.frontImageUrl}
                            alt={item.name ?? item.code}
                            className="h-full w-full object-contain"
                          />
                        </div>

                        {/* Delete affordance — only ever appears while delete
                            mode is on (header trash button is red), and even
                            then only on the specific tile being hovered: it
                            covers that tile with a theme-aware overlay and
                            centers a trash icon on it. Once you click it and
                            the confirmation dialog opens for THIS item,
                            isPendingThisItem forces the overlay to stay
                            visible even after your mouse leaves the tile
                            (moving toward the dialog's buttons would
                            otherwise drop the CSS :hover state) — it only
                            reverts to the normal hover rule once you cancel
                            (itemPendingDelete goes back to null), or is moot
                            once the item is actually deleted (the tile is
                            gone). Uses pointer-events-none (not `disabled`)
                            to go inert when delete mode is off — a disabled
                            button swallows clicks entirely and won't let
                            them bubble up to the surrounding Link, which is
                            what broke navigation last time. */}
                        <button
                          type="button"
                          tabIndex={deleteMode ? 0 : -1}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setItemPendingDelete(item)
                          }}
                          aria-label={`Delete ${item.name ?? item.code}`}
                          className={`absolute inset-0 z-10 flex items-center justify-center bg-white/80 transition-opacity duration-150 ease-out dark:bg-black/80 ${overlayVisibilityClasses}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className="h-12 w-12 text-neutral-700 dark:text-white"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a2 2 0 002 2h6a2 2 0 002-2V7H8z"
                            />
                          </svg>
                        </button>
                      </div>
                    </ViewTransition>
                  ) : (
                    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
                      <span className="text-xs text-black/20 dark:text-white/20">
                        {categoryDisplayName(item.category)}
                      </span>

                      <button
                        type="button"
                        tabIndex={deleteMode ? 0 : -1}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setItemPendingDelete(item)
                        }}
                        aria-label={`Delete ${item.name ?? item.code}`}
                        className={`absolute inset-0 z-10 flex items-center justify-center bg-white/80 transition-opacity duration-150 ease-out dark:bg-black/80 ${overlayVisibilityClasses}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="h-12 w-12 text-neutral-700 dark:text-white"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a2 2 0 002 2h6a2 2 0 002-2V7H8z"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </Link>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <Link
                    href={itemHref}
                    className="min-w-0 truncate text-xs tracking-widest uppercase"
                  >
                    {item.name ?? item.code}
                  </Link>

                  {/* Fill vs stroke is the entire state readout, so the icon
                      swaps `fill` rather than just dimming — a hollow heart at
                      low opacity and a hollow heart at high opacity are too
                      close to tell apart at 16px. */}
                  <button
                    type="button"
                    onClick={() => void toggleFavorite({ id: item._id })}
                    aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={!!item.favorite}
                    className={`shrink-0 transition-colors duration-150 ${
                      item.favorite
                        ? "text-black dark:text-white"
                        : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
                    }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill={item.favorite ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="h-4 w-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 20s-7-4.5-7-9.5A4 4 0 0112 8a4 4 0 017 2.5C19 15.5 12 20 12 20z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })
        )}

        {/* Skeleton tiles for items still being processed (background
            removal / upload / Convex save) — swapped out for the real tile
            automatically once the upload finishes and the query updates.
            No fill background (matches the background-removed real photos);
            the shimmer sweep is masked to the actual garment silhouette
            traced from a reference photo, filling the tile the same way a
            real photo does via object-contain. The shimmer's own
            animation-delay matches the tile's entrance delay, so it starts
            right when the tile becomes visible instead of already being
            mid-cycle from animating (invisibly) during the fade-in wait.
            The border shimmer that used to run on the image wrapper
            (animate-shimmer-border, still in globals.css) is gone: the
            border now belongs to the card frame that wraps the whole tile,
            caption included, so sweeping it would animate the entire tile
            outline rather than the picture's. The silhouette shimmer inside
            carries the loading state on its own.

            Each pending upload's entrance delay (pending.revealDelayMs) is
            computed once, at creation time, in handleAddItem — not
            recomputed here from array position — specifically so it only
            ever plays once. Once pending.revealed flips true (a real
            setTimeout fires markRevealed after revealDelayMs elapses,
            regardless of whether this page is even mounted at that moment)
            the tile skips the fade-in/delay entirely on every future
            render, including renders caused by this whole grid remounting
            when you switch category tabs or navigate away and back. */}
        {visiblePendingUploads.map((pending) => {
          // Skeleton-specific lookup, NOT getImageScale — for most
          // categories it returns the identical number, but PANTS is pinned
          // to its pre-bump size so only the real photos scaled up (see
          // skeletonImageScaleOverride).
          const scale = getSkeletonImageScale(pending.category, pending.subcategory)
          return (
            <div
              key={pending.localId}
              className={`relative flex flex-col tile-spotlight rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.02] ${
                pending.revealed ? "" : "animate-fade-in-up"
              }`}
              style={pending.revealed ? undefined : { animationDelay: `${pending.revealDelayMs}ms` }}
            >
              {/* The border shimmer moved off the image box and onto nothing —
                  the card's own frame is the border now, and animating it here
                  would sweep the whole tile rather than the picture. The
                  silhouette shimmer inside still carries the loading state. */}
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
                <div className="relative h-full w-full" style={{ transform: `scale(${scale})` }}>
                  <div
                    className="absolute inset-0 bg-neutral-200 dark:bg-neutral-700"
                    style={maskStyle(pending.category, pending.subcategory)}
                  />
                  <div
                    className="animate-shimmer absolute inset-0"
                    style={{
                      ...maskStyle(pending.category, pending.subcategory),
                      animationDelay: pending.revealed ? "0ms" : `${pending.revealDelayMs}ms`,
                    }}
                  />
                </div>
              </div>
              {pending.name ? (
                <span className="mt-3 truncate text-xs tracking-widest uppercase text-black/40 dark:text-white/40">
                  {pending.name}
                </span>
              ) : (
                // No name was typed in, so the AI-suggested one (see
                // needsName in convex/analyze.ts) is what will eventually
                // land here — well after this tile is gone, since analysis
                // keeps running in the background after the real item
                // already exists. Showing the code (e.g. "SH-03") as a
                // stand-in used to mean it briefly looked like the item's
                // actual name before silently being replaced later. A
                // shimmering placeholder reads as "still deciding" instead
                // — same shimmerSweep animation/timing as the icon and
                // border above, via the same revealDelayMs-based
                // animationDelay, so all three move in one rhythm.
                <div
                  className="animate-shimmer mt-3 h-3 w-24 rounded-sm bg-neutral-200 dark:bg-neutral-700"
                  style={{ animationDelay: pending.revealed ? "0ms" : `${pending.revealDelayMs}ms` }}
                />
              )}
            </div>
          )
        })}

        {/* Add-item tile — always the last "piece" in the grid for the
            active category, unless hidden via the SHOW ADD TILE switch in
            the Add Item modal. Waits out whichever pending tiles are still
            doing their one-time delayed entrance (see above); once none
            are, it just follows the real items' own stagger instead. */}
        {showAddTile && (
          <button
            /* Keyed on gridEpoch for the same reason as the item tiles — it
               sits at the end of their stagger, so if they replay their
               entrance and it doesn't, it's left conspicuously already-there
               at the tail of a grid that's still arriving. */
            key={gridEpoch}
            type="button"
            onClick={openAddFormForActiveCategory}
            className="animate-fade-in-up group flex flex-col rounded-xl border border-dashed border-black/15 p-3 transition-colors duration-150 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
            style={{
              animationDelay: `${(() => {
                const stillEntering = visiblePendingUploads.filter((pending) => !pending.revealed)
                if (stillEntering.length === 0) return visibleItems.length * 40
                const maxDelay = Math.max(...stillEntering.map((pending) => pending.revealDelayMs))
                return maxDelay + pendingStagger
              })()}ms`,
            }}
          >
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden">
              <span className="relative flex h-1/4 w-1/4 items-center justify-center transition-transform duration-150 group-hover:scale-110 group-active:scale-95">
                <span className="absolute h-full w-[8%] rounded-full bg-neutral-500 transition-colors group-hover:bg-neutral-700 dark:bg-neutral-500 dark:group-hover:bg-neutral-300" />
                <span className="absolute h-[8%] w-full rounded-full bg-neutral-500 transition-colors group-hover:bg-neutral-700 dark:bg-neutral-500 dark:group-hover:bg-neutral-300" />
              </span>
            </div>
            <span className="mt-3 text-center text-xs tracking-widest text-black/40 dark:text-white/40">
              ADD ITEM
            </span>
          </button>
        )}
        </section>
      </div>

      {/* Add item modal — always mounted (rather than conditionally rendered)
          so it can play an exit animation instead of just vanishing. It's
          invisible and non-interactive when closed. Clicking the backdrop
          (outside the form) closes it; the form itself stops that click
          from bubbling up so clicking inside doesn't accidentally close it.
          ESC also closes it, wired up in the useEffect above. */}
      <div
        aria-hidden={!showAddForm}
        onClick={() => setShowAddForm(false)}
        className={`fixed inset-0 z-40 flex items-center justify-center bg-black/20 transition-opacity duration-200 ${
          showAddForm ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <form
          onSubmit={handleAddItem}
          onClick={(e) => e.stopPropagation()}
          className={`flex w-[480px] flex-col gap-4 bg-white p-8 shadow-lg transition-all duration-200 ease-out dark:bg-neutral-900 ${
            showAddForm ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs tracking-widest">ADD ITEM</h2>

            {/* Switch — controls whether the "+" add-tile shows up in the
                grid next to the clothing pieces. On by default so the grid
                keeps its current always-has-an-ADD-tile behavior unless you
                turn it off. The header's "ADD ITEM" button still opens
                this same modal either way. */}
            <label className="flex items-center gap-2 text-[10px] tracking-widest text-black/60 dark:text-white/60">
              SHOW ADD TILE IN GRID
              <button
                type="button"
                role="switch"
                aria-checked={showAddTile}
                onClick={() => setShowAddTile((prev) => !prev)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                  showAddTile ? "bg-black dark:bg-white" : "bg-black/15 dark:bg-white/15"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-neutral-900 ${
                    showAddTile ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </label>
          </div>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              CATEGORY
              <select
                value={newItemCategory}
                onChange={(e) => {
                  const nextCategory = e.target.value as Category
                  setNewItemCategory(nextCategory)
                  // TYPE options are category-specific — a stale selection
                  // from the old category (e.g. "T-SHIRTS" while category is
                  // now FOOTWEAR) can't carry over. Falls back to whichever
                  // TYPE was last used for the new category (see
                  // lastSubcategoryByCategory above), same as opening the
                  // form fresh via openAddFormForActiveCategory, rather than
                  // always landing back on that category's first option.
                  setNewItemSubcategory(
                    lastSubcategoryByCategory[nextCategory] ?? subcategoryOptions[nextCategory][0]
                  )
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

            <label className="flex flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              TYPE
              <select
                value={newItemSubcategory}
                onChange={(e) => setNewItemSubcategory(e.target.value)}
                className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
              >
                {subcategoryOptions[newItemCategory].map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </label>

            {/* Reference preview for the exact CATEGORY/TYPE combo picked
                above — just a static template photo (see
                subcategoryTemplateImages up top), not tied to the actual
                PHOTO (FRONT)/(BACK) inputs below in any way. Falls back to
                the category's display label (e.g. "FOOTWEAR") when that
                subcategory has no template photo yet, same fallback used
                by the PIECES TO PAIR boxes on the item detail page. Fixed
                small size so it sits neatly next to the two dropdowns
                instead of stretching to match their height. */}
            <div className="flex w-16 shrink-0 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              REF
              <div className="flex h-9 w-16 items-center justify-center border border-black/10 bg-neutral-50 p-1 dark:border-white/10 dark:bg-neutral-800">
                {getSubcategoryTemplateImage(newItemCategory, newItemSubcategory) ? (
                  <img
                    src={getSubcategoryTemplateImage(newItemCategory, newItemSubcategory)!}
                    alt={`${newItemCategory} ${newItemSubcategory} reference`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-center text-[8px] uppercase leading-tight">
                    {categoryDisplayName(newItemCategory)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
            NAME (OPTIONAL)
            <input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Grey Adidas Shirt"
              className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              PHOTO (FRONT)
              {frontPreviewUrl ? (
                <img
                  src={frontPreviewUrl}
                  alt="Front preview"
                  className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                />
              ) : (
                <div className="aspect-square w-full border border-dashed border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-neutral-800" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFrontImageFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs"
              />
            </label>

            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs tracking-widest text-black/60 dark:text-white/60">
              PHOTO (BACK, OPTIONAL)
              {backPreviewUrl ? (
                <img
                  src={backPreviewUrl}
                  alt="Back preview"
                  className="aspect-square w-full border border-black/10 bg-neutral-50 object-contain dark:border-white/10 dark:bg-neutral-800"
                />
              ) : (
                <div className="aspect-square w-full border border-dashed border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-neutral-800" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setBackImageFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs"
              />
            </label>
          </div>

          {/* Placeholder toggle — not wired to a real feature yet. Reserves
              the spot for the AI photo-polish feature that's on hold
              pending a paid image-generation API. */}
          <label className="flex items-center justify-between text-xs tracking-widest text-black/60 dark:text-white/60">
            ENHANCE PHOTOS
            <input
              type="checkbox"
              checked={enhancePhotos}
              onChange={(e) => setEnhancePhotos(e.target.checked)}
              className="h-4 w-4 accent-black dark:accent-white"
            />
          </label>

          <details className="text-xs tracking-widest text-black/60 dark:text-white/60">
            <summary className="cursor-pointer">ADDITIONAL INFO</summary>
            <div className="mt-3 flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                MATERIAL (OPTIONAL)
                <input
                  value={materialHint}
                  onChange={(e) => setMaterialHint(e.target.value)}
                  placeholder="e.g. cotton, denim, leather"
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                />
              </label>

              <label className="flex flex-col gap-1">
                SILHOUETTE (OPTIONAL)
                <input
                  value={silhouetteHint}
                  onChange={(e) => setSilhouetteHint(e.target.value)}
                  placeholder="e.g. oversized, slim, wide-leg"
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                />
              </label>

              <label className="flex flex-col gap-1">
                ITEM VALUE (OPTIONAL)
                <input
                  value={itemValue}
                  onChange={(e) => setItemValue(e.target.value)}
                  placeholder="$67"
                  className="border border-black/10 bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                />
              </label>
            </div>
          </details>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-black py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
            >
              {isSubmitting ? "UPLOADING..." : "SAVE"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="flex-1 border border-black/10 py-2 text-xs tracking-widest dark:border-white/10"
            >
              CANCEL
            </button>
          </div>
        </form>
      </div>

      {/* Delete-item confirmation, triggered by the delete button on a
          grid tile. Mirrors the same confirmation UI used on the item
          detail page for consistency. */}
      {itemPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="flex w-80 flex-col gap-4 bg-white p-8 shadow-lg dark:bg-neutral-900">
            <h2 className="text-xs tracking-widest">DELETE ITEM</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              This will permanently delete {itemPendingDelete.name ?? itemPendingDelete.code}. This
              can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmDeleteFromGrid}
                disabled={isDeletingItem}
                className="flex-1 bg-black py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
              >
                {isDeletingItem ? "DELETING..." : "DELETE"}
              </button>
              <button
                type="button"
                onClick={() => setItemPendingDelete(null)}
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

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  )
}