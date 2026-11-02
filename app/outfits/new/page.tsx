"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"

// These are the *stored* item.category values, not labels. OUTERWEAR (not
// JACKETS) is what convex/migrations.ts wrote to every jacket record, so
// comparing against "JACKETS" here would silently match nothing.
const CATEGORIES = ["SHIRTS", "PANTS", "SHOES", "OUTERWEAR", "ACCESSORIES"] as const
type Category = (typeof CATEGORIES)[number]

// Display-only rename, same map as app/page.tsx and app/item/[id]/page.tsx:
// SHOES stays the internal value, only the on-screen label reads FOOTWEAR.
const categoryDisplayNames: Partial<Record<Category, string>> = {
  SHOES: "FOOTWEAR",
}

function categoryDisplayName(category: Category): string {
  return categoryDisplayNames[category] ?? category
}

// ---------------------------------------------------------------------------
// Placeholder silhouettes
//
// Duplicated from app/page.tsx rather than imported — there's still no shared
// utils module, and the closet page keeps a subcategory-specific ladder this
// page can't use: a slot shows its icon *before* anything is picked, so no
// subcategory is known yet. Category level is the only level available here.
//
// Rendered as a CSS mask rather than an <img> so the shape takes its color
// from a background utility. That's what lets one asset serve as a light-grey
// placeholder on white and a dark-grey one on near-black without shipping two
// files or inverting anything.
// ---------------------------------------------------------------------------
const categoryIconSrc: Partial<Record<Category, string>> = {
  SHIRTS: "/category-icons/shirts.png",
  PANTS: "/category-icons/pants.png",
  SHOES: "/category-icons/shoes.png",
  OUTERWEAR: "/category-icons/outerwear.png",
}

// Only for categories with no photo-derived silhouette yet (currently just
// ACCESSORIES). Same path data as the closet page's fallback.
const fallbackIconPaths: Partial<Record<Category, string[]>> = {
  ACCESSORIES: [
    "M15,44 C15,34 23,26 34,26 C42,26 48,30 50,36 C52,30 58,26 66,26 C77,26 85,34 85,44 C85,56 76,63 64,63 C55,63 48,58 46,49 C44,58 37,63 28,63 C16,63 15,56 15,44 Z M4,38 L15,42 L15,46 L4,50 Z M96,38 L85,42 L85,46 L96,50 Z",
  ],
}

function categoryIconMaskUrl(category: Category): string {
  const src = categoryIconSrc[category]
  if (src) return `url("${src}")`
  const paths = fallbackIconPaths[category] ?? []
  const pathsMarkup = paths.map((d) => `<path d='${d}'/>`).join("")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${pathsMarkup}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// ---------------------------------------------------------------------------
// Carousel geometry
//
// ENTRY_W is the LAYOUT footprint of every entry and never changes — not for
// the marked one, not on hover. That's deliberate: the marked piece is drawn
// bigger with a transform, which doesn't affect layout, so the scroll-snap
// points stay exactly where they were. Growing a tile's real width instead
// would move the snap point out from under the thing you just scrolled to and
// the strip would fight itself.
//
// The spacers at both ends are calc(50% - TILE_PX/2) wide so the first and
// last entries can reach the centre. It also means scrollLeft: 0 lands the
// blank NONE entry exactly under the marker, which is what "starting from
// none" needs on every category switch.
const ENTRY_W = 168
const TILE_PX = 140
const UNMARKED_SCALE = 0.62

// An unmarked tile only occupies the bottom UNMARKED_PX of its box, because
// the scale transform below is anchored to the bottom edge. Every tile
// therefore shares one baseline, and the marked one — at full TILE_PX — is
// the only thing tall enough to reach above RULE_TOP.
//
// That's what puts the marker through the divider: the rule is drawn at
// RULE_TOP, which is just above where the small tiles start, so the band
// holds an unmarked tile and nothing more. The marked tile overhangs it by
// RULE_TOP px.
const UNMARKED_PX = Math.round(TILE_PX * UNMARKED_SCALE)
const RULE_TOP = TILE_PX - UNMARKED_PX - 6
const CHECK_PX = 40
// Lifts the round controls flanking the strip so they sit centred in the band
// BELOW the divider, level with the small tiles — not centred in the whole
// row, which is taller now that the marked tile overhangs it.
const CHECK_OFFSET = Math.round((TILE_PX - RULE_TOP - CHECK_PX) / 2)

// Per-category correction for how much empty margin a category's photos
// carry around the garment itself. Same ratios the closet grid uses
// (app/page.tsx: shirts .8, shoes .75, accessories .68 — i.e. .94 and .85
// relative to shirts), and they transfer directly because the hero is now a
// square box like the closet's tiles are.
//
// This is a trim, NOT the fix for footwear rendering huge. That was the hero
// being bounded by height alone: a photo's height filled the hero and its
// width followed from the aspect ratio, so a wide slide came out 1368px
// across while a tall boot came out 371px — same height, 3.8x the area.
// Bounding the hero to a square is what actually equalises them.
const HERO_SCALE: Partial<Record<Category, number>> = {
  SHOES: 0.94,
  ACCESSORIES: 0.85,
}

function heroScale(category: Category): number {
  return HERO_SCALE[category] ?? 1
}

function maskStyle(category: Category): React.CSSProperties {
  const url = categoryIconMaskUrl(category)
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

export default function NewOutfitPage() {
  const router = useRouter()
  const items = useQuery(api.items.getAllItems)
  const createOutfit = useMutation(api.outfits.createOutfit)

  type ItemType = NonNullable<typeof items>[number]

  // Which slot in row 3 is open. There's no text category nav any more, so
  // tapping a slot is the only thing that changes what the slider shows.
  const [activeCategory, setActiveCategory] = useState<Category>("SHIRTS")

  // The item currently under the centre marker — browsed, not yet committed.
  // null means the blank NONE entry is under it, which is how "no option" is
  // expressed. Committing a null clears the slot.
  //
  // This is DERIVED FROM SCROLL POSITION, not set by clicking: the scroll
  // handler below picks whichever entry is nearest the marker. Clicking a
  // tile just scrolls it to the centre and lets that handler do the marking,
  // so there is exactly one path to being marked and the two can't disagree.
  const [markedId, setMarkedId] = useState<Id<"items"> | null>(null)

  // Committed picks. Field names mirror the Convex outfits schema exactly so
  // handleSave can hand them over without a translation step.
  const [shirtId, setShirtId] = useState<Id<"items"> | null>(null)
  const [pantsId, setPantsId] = useState<Id<"items"> | null>(null)
  const [shoesId, setShoesId] = useState<Id<"items"> | null>(null)
  const [jacketId, setJacketId] = useState<Id<"items"> | null>(null)
  const [accessoryIds, setAccessoryIds] = useState<Id<"items">[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const stripRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null)

  const itemsById = new Map((items ?? []).map((item) => [item._id, item]))
  const categoryItems = (items ?? []).filter((item) => item.category === activeCategory)
  const markedItem: ItemType | undefined = markedId ? itemsById.get(markedId) : undefined

  function committedIdFor(category: Category): Id<"items"> | null {
    if (category === "SHIRTS") return shirtId
    if (category === "PANTS") return pantsId
    if (category === "SHOES") return shoesId
    if (category === "OUTERWEAR") return jacketId
    return null
  }

  // Is this item already sitting in row 3? Drives the small dot on a slider
  // tile — the only way to tell, for accessories especially, that pressing
  // the check would remove rather than add.
  function isCommitted(item: ItemType): boolean {
    if (item.category === "ACCESSORIES") return accessoryIds.includes(item._id)
    return committedIdFor(item.category as Category) === item._id
  }

  // Only sets the category. The effect further down rewinds the strip to
  // NONE and marks it, so every category opens the same way.
  function selectSlot(category: Category) {
    setActiveCategory(category)
  }

  // The circled check. "Once the check is pressed, the marked item moves into
  // the third row" — for the four single slots that's a straight assignment,
  // including assigning null to clear.
  //
  // ACCESSORIES is the one category you can wear several of at once, so the
  // check toggles membership instead of replacing: press it on an accessory
  // that's already in the set and it comes back out. Committing blank there
  // empties the set, which is the only way to clear several at once.
  function commitMarked() {
    if (activeCategory === "ACCESSORIES") {
      if (markedId === null) {
        setAccessoryIds([])
        return
      }
      const id = markedId
      setAccessoryIds((prev) =>
        prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
      )
      return
    }
    if (activeCategory === "SHIRTS") setShirtId(markedId)
    else if (activeCategory === "PANTS") setPantsId(markedId)
    else if (activeCategory === "SHOES") setShoesId(markedId)
    else if (activeCategory === "OUTERWEAR") setJacketId(markedId)
  }

  // Whichever entry's centre is nearest the strip's centre is the marked one.
  // Measured with getBoundingClientRect rather than offsetLeft because both
  // rects are in viewport coordinates with scroll already applied, so the
  // comparison holds regardless of what the offsetParent happens to be.
  //
  // rAF-throttled: a trackpad flick fires scroll events far faster than React
  // needs to re-render, and without this every one of them would set state.
  function readMarkedFromScroll() {
    const strip = stripRef.current
    if (!strip) return
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const current = stripRef.current
      if (!current) return
      const stripRect = current.getBoundingClientRect()
      const centerX = stripRect.left + stripRect.width / 2
      let bestId: Id<"items"> | null = null
      let bestDist = Infinity
      current.querySelectorAll<HTMLElement>("[data-entry]").forEach((el) => {
        const rect = el.getBoundingClientRect()
        const dist = Math.abs(rect.left + rect.width / 2 - centerX)
        if (dist < bestDist) {
          bestDist = dist
          const id = el.dataset.itemId
          bestId = id ? (id as Id<"items">) : null
        }
      })
      setMarkedId(bestId)
    })
  }

  function centerEntry(el: HTMLElement, behavior: ScrollBehavior) {
    const strip = stripRef.current
    if (!strip) return
    const stripRect = strip.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const delta = elRect.left + elRect.width / 2 - (stripRect.left + stripRect.width / 2)
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior })
  }

  // The chevrons. Finds whatever is currently nearest the marker and centres
  // its neighbour — reading position from the DOM rather than tracking an
  // index in state, so it stays correct after a free swipe that landed
  // between two entries.
  function step(direction: -1 | 1) {
    const strip = stripRef.current
    if (!strip) return
    const entries = Array.from(strip.querySelectorAll<HTMLElement>("[data-entry]"))
    if (entries.length === 0) return
    const stripRect = strip.getBoundingClientRect()
    const centerX = stripRect.left + stripRect.width / 2
    let index = 0
    let best = Infinity
    entries.forEach((el, i) => {
      const rect = el.getBoundingClientRect()
      const dist = Math.abs(rect.left + rect.width / 2 - centerX)
      if (dist < best) {
        best = dist
        index = i
      }
    })
    const next = entries[Math.min(entries.length - 1, Math.max(0, index + direction))]
    if (next) centerEntry(next, "smooth")
  }

  // Open a category on NONE. scrollLeft 0 is exactly the blank entry centred,
  // because of how the leading spacer is sized — see the note on ENTRY_W.
  // Depends on the item count too so it re-runs once the query resolves and
  // the entries actually exist to scroll past.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    strip.scrollTo({ left: 0, behavior: "auto" })
    setMarkedId(null)
  }, [activeCategory, categoryItems.length])

  // Pointer drag, for mice. Touch and trackpad already swipe natively through
  // overflow-x-auto, and are left alone — hijacking touch here would replace
  // momentum scrolling with something worse.
  //
  // Snapping is switched off for the duration of the drag. With snap-type
  // mandatory still active, every scrollLeft assignment would be yanked back
  // to the nearest snap point mid-gesture and the strip would feel glued.
  // Restoring the class on release is what triggers the settle.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return
    const strip = stripRef.current
    if (!strip) return
    dragRef.current = { startX: e.clientX, startScroll: strip.scrollLeft, moved: false }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const strip = stripRef.current
    if (!drag || !strip) return
    const dx = e.clientX - drag.startX
    // 5px of slack so a slightly shaky click still reads as a click.
    if (!drag.moved && Math.abs(dx) < 5) return
    if (!drag.moved) {
      drag.moved = true
      strip.style.scrollSnapType = "none"
      strip.setPointerCapture(e.pointerId)
    }
    strip.scrollLeft = drag.startScroll - dx
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const strip = stripRef.current
    if (drag?.moved && strip) {
      strip.releasePointerCapture(e.pointerId)
      strip.style.scrollSnapType = ""
    }
    // Cleared a tick late on purpose: the click event fires after pointerup,
    // and the tile's handler reads `moved` to tell a drag from a tap.
    setTimeout(() => {
      dragRef.current = null
    }, 0)
  }

  const canSave = shirtId && pantsId && shoesId

  async function handleSave() {
    if (!canSave || isSaving) return
    setIsSaving(true)
    try {
      await createOutfit({
        shirtId: shirtId ?? undefined,
        pantsId: pantsId ?? undefined,
        shoesId: shoesId ?? undefined,
        jacketId: jacketId ?? undefined,
        accessoryIds,
      })
      router.push("/outfits")
    } catch (err) {
      console.error(err)
      alert("Save failed — check the terminal running npx convex dev for details.")
      setIsSaving(false)
    }
  }

  // What the DETAILS expander lists. Empty fields are dropped rather than
  // shown as "-": on this screen the panel is a glance at the piece you're
  // about to pick, not the item page's full record, so a row that says
  // nothing is just noise. Colours come back separately because they render
  // as swatches, not text.
  const detailColors = markedItem
    ? markedItem.colors?.length
      ? markedItem.colors
      : markedItem.primaryColor
        ? [markedItem.primaryColor]
        : []
    : []

  const detailRows: { label: string; value: string }[] = []
  if (markedItem) {
    if (markedItem.subcategory) detailRows.push({ label: "TYPE", value: markedItem.subcategory })
    if (markedItem.brand) detailRows.push({ label: "BRAND", value: markedItem.brand })
    if (markedItem.colorShade) detailRows.push({ label: "TONE", value: markedItem.colorShade })
    if (markedItem.material) detailRows.push({ label: "MATERIAL", value: markedItem.material })
    if (markedItem.silhouette)
      detailRows.push({ label: "SILHOUETTE", value: markedItem.silhouette })
    if (markedItem.itemValue) detailRows.push({ label: "VALUE", value: markedItem.itemValue })
  }

  const slots = CATEGORIES.map((category) => {
    const committed = committedIdFor(category)
    if (category === "ACCESSORIES") {
      return {
        category,
        count: accessoryIds.length,
        thumbUrl: accessoryIds[0]
          ? itemsById.get(accessoryIds[0])?.frontImageUrl ?? null
          : null,
      }
    }
    return {
      category,
      count: committed ? 1 : 0,
      thumbUrl: committed ? itemsById.get(committed)?.frontImageUrl ?? null : null,
    }
  })

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-black dark:bg-neutral-950 dark:text-white">
      {/* The title is centred against the VIEWPORT, not against whatever space
          is left between the × and the save button — those two have different
          widths, so a plain justify-between would push the title off-centre.
          Absolute positioning keeps it true regardless of what flanks it. */}
      <header className="relative flex shrink-0 items-center justify-between border-b border-black/10 px-8 py-4 dark:border-white/10">
        <Link
          href="/outfits"
          aria-label="Close"
          className="z-10 text-3xl leading-none text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          ×
        </Link>

        <span className="pointer-events-none absolute inset-x-0 text-center text-xs tracking-[0.2em] text-black/60 dark:text-white/60">
          BUILD OUTFIT
        </span>

        <button
          onClick={handleSave}
          disabled={!canSave || isSaving}
          title={
            canSave
              ? undefined
              : "Pick a shirt, pants and footwear first"
          }
          className="z-10 flex items-center gap-2 rounded-full border border-black/20 px-5 py-2 text-xs tracking-[0.15em] text-black/80 transition-colors duration-150 hover:border-black/40 hover:text-black disabled:opacity-25 disabled:hover:border-black/20 dark:border-white/20 dark:text-white/80 dark:hover:border-white/40 dark:hover:text-white dark:disabled:hover:border-white/20"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-4 w-4"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
          </svg>
          {isSaving ? "SAVING" : "SAVE OUTFIT"}
        </button>
      </header>

      {/* ROW 1 — hero. Mirrors whatever is marked in the slider below. min-h-0
          is load-bearing: without it a flex child refuses to shrink below its
          content's intrinsic height and the slot row gets pushed off-screen. */}
      {/* ROW 1 — info panel + hero. The empty column on the right is load
          bearing: it's the same width as the panel, which is what keeps the
          hero centred on the PAGE rather than centred in the leftover space
          beside the panel. Both side columns drop away under lg and the hero
          takes the full width. */}
      <section className="flex min-h-0 flex-1 items-stretch gap-8 px-8 py-6">
        <div className="hidden w-72 shrink-0 flex-col justify-center lg:flex">
          {markedItem ? (
            <>
              <h2 className="text-xl tracking-wide">
                {markedItem.name ?? markedItem.code}
              </h2>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-black/20 px-3 py-1 text-[10px] tracking-widest text-black/70 dark:border-white/20 dark:text-white/70">
                  {markedItem.subcategory ?? categoryDisplayName(activeCategory)}
                </span>
                <span className="flex items-center gap-1.5 rounded-full border border-black/20 px-3 py-1 text-[10px] tracking-widest text-black/70 dark:border-white/20 dark:text-white/70">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-2.5 w-2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
                  </svg>
                  IN CLOSET
                </span>
              </div>

              <div className="mt-6 border-t border-black/10 dark:border-white/10" />

              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="flex w-full items-center justify-between py-4 text-xs tracking-widest text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
              >
                DETAILS
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={`h-4 w-4 transition-transform duration-300 ${
                    detailsOpen ? "rotate-180" : ""
                  }`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {/* grid-rows 0fr -> 1fr, the same collapse the rest of the app
                  uses, because height:auto isn't animatable. */}
              <div
                className={`grid transition-all duration-300 ease-out ${
                  detailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  {detailColors.length === 0 && detailRows.length === 0 ? (
                    <p className="pb-1 text-[10px] tracking-widest text-black/30 dark:text-white/30">
                      NOT ANALYZED YET
                    </p>
                  ) : (
                    <dl className="flex flex-col gap-3 pb-1">
                      {detailColors.length > 0 && (
                        <div className="flex items-start justify-between gap-4">
                          <dt className="text-[10px] tracking-widest text-black/40 dark:text-white/40">
                            COLOR(S)
                          </dt>
                          <dd className="flex flex-wrap items-center justify-end gap-1.5">
                            {detailColors.map((color) => (
                              <span
                                key={`${color.hex}-${color.name}`}
                                title={color.name}
                                className="h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/15"
                                style={{ backgroundColor: color.hex }}
                              />
                            ))}
                          </dd>
                        </div>
                      )}

                      {detailRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-start justify-between gap-4"
                        >
                          <dt className="text-[10px] tracking-widest text-black/40 dark:text-white/40">
                            {row.label}
                          </dt>
                          <dd className="text-right text-[10px] tracking-widest text-black/70 dark:text-white/70">
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs tracking-widest text-black/30 dark:text-white/30">
              NO {categoryDisplayName(activeCategory)} SELECTED
            </p>
          )}
        </div>

        {/* A SQUARE box, not the full width. object-contain fits a photo to
            whichever axis constrains it, so bounding only the height let a
            wide photo run as far sideways as it liked — that's why a slide
            dwarfed a boot. A square bounds both axes by the same number, so a
            tall piece fills it vertically, a wide one horizontally, and the
            two read at comparable weight. Same treatment the closet grid and
            the slider tiles already get. */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <div className="aspect-square h-full max-w-full">
            {markedItem?.frontImageUrl ? (
              <img
                src={markedItem.frontImageUrl}
                alt={markedItem.name ?? markedItem.code}
                className="h-full w-full object-contain"
                style={{ transform: `scale(${heroScale(activeCategory)})` }}
              />
            ) : (
              // Blank entry marked: the category's own silhouette, dimmed.
              // Holding the hero's size steady here is deliberate — sliding on
              // and off the blank shouldn't make the rows below jump.
              <div
                aria-hidden
                className="h-full w-full bg-black/10 dark:bg-white/10"
                style={{
                  ...maskStyle(activeCategory),
                  transform: `scale(${heroScale(activeCategory)})`,
                }}
              />
            )}
          </div>
        </div>

        <div className="hidden w-72 shrink-0 lg:block" aria-hidden />
      </section>

      {/* ROW 2 — the carousel. The marker is a fixed frame in the middle and
          the pieces scroll underneath it; whatever lands in the frame is
          marked. Swipe on a trackpad or touchscreen, drag with a mouse, or
          click a tile to bring it to the centre. */}
      <div className="relative shrink-0 border-b border-black/10 pb-3 dark:border-white/10">
        {/* The top divider, pushed down to sit just above the small tiles. It
            sits BEHIND the strip (z-0 against the strip's z-10), and every
            tile paints an opaque page-coloured background, so the marked tile
            hides the line where it crosses and the marker reads as breaking
            through it rather than being drawn over it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-0 border-t border-black/10 dark:border-white/10"
          style={{ top: RULE_TOP }}
        />

        <div className="flex items-end gap-4 px-8">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous piece"
            className="z-10 flex shrink-0 items-center justify-center rounded-full bg-white text-black/50 transition-colors duration-150 hover:text-black dark:bg-neutral-950 dark:text-white/50 dark:hover:text-white"
            style={{ height: CHECK_PX, width: CHECK_PX, marginBottom: CHECK_OFFSET }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
            </svg>
          </button>

          <div className="relative z-10 min-w-0 flex-1">
            {/* The marker. Drawn once, never moves, and doesn't take pointer
                events — the tiles underneath stay clickable through it.
                Anchored to the shared tile baseline, so its extra height all
                goes upward, past the divider. */}
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-black dark:border-white"
              style={{ height: TILE_PX, width: TILE_PX }}
            />

            <div
              ref={stripRef}
              onScroll={readMarkedFromScroll}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="no-scrollbar flex snap-x snap-mandatory items-end overflow-x-auto overscroll-x-contain"
              style={{ height: TILE_PX }}
            >
            <div className="shrink-0" style={{ width: `calc(50% - ${TILE_PX / 2}px)` }} />

            {/* NONE. Every category opens here. */}
            <button
              type="button"
              data-entry
              onClick={(e) => centerEntry(e.currentTarget, "smooth")}
              aria-label="No piece"
              className="flex shrink-0 snap-center items-center justify-center"
              style={{ width: ENTRY_W, height: TILE_PX }}
            >
              <span
                className="block rounded-xl border border-dashed border-black/20 bg-neutral-50 transition-transform duration-200 dark:border-white/20 dark:bg-neutral-900"
                style={{
                  height: TILE_PX,
                  width: TILE_PX,
                  // Bottom-anchored so shrinking never lifts the tile off the
                  // shared baseline — that baseline is what makes the divider
                  // land in the same place for every entry.
                  transformOrigin: "bottom",
                  transform: `scale(${markedId === null ? 1 : UNMARKED_SCALE})`,
                }}
              />
            </button>

            {categoryItems.map((item) => {
              const marked = markedId === item._id
              return (
                <button
                  key={item._id}
                  type="button"
                  data-entry
                  data-item-id={item._id}
                  onClick={(e) => {
                    // A drag ends in a click too. Ignore that one.
                    if (dragRef.current?.moved) return
                    centerEntry(e.currentTarget, "smooth")
                  }}
                  title={item.name ?? item.code}
                  className="flex shrink-0 snap-center items-center justify-center"
                  style={{ width: ENTRY_W, height: TILE_PX }}
                >
                  <span
                    // Opaque, not a translucent tint: this background is also
                    // what hides the divider where the marked tile crosses it.
                    // A tint would let the line show straight through.
                    className="relative block overflow-hidden rounded-xl bg-neutral-50 transition-transform duration-200 dark:bg-neutral-900"
                    style={{
                      height: TILE_PX,
                      width: TILE_PX,
                      transformOrigin: "bottom",
                      transform: `scale(${marked ? 1 : UNMARKED_SCALE})`,
                    }}
                  >
                    {item.frontImageUrl ? (
                      <img
                        src={item.frontImageUrl}
                        alt={item.name ?? item.code}
                        className="h-full w-full object-contain p-1"
                        draggable={false}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] tracking-widest text-black/20 dark:text-white/20">
                        {item.code}
                      </span>
                    )}

                    {/* Already in row 3. Matters most for accessories, where
                        the check toggles — this is the only cue that pressing
                        it would take the piece back out. */}
                    {isCommitted(item) && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                    )}
                  </span>
                </button>
              )
            })}

            <div className="shrink-0" style={{ width: `calc(50% - ${TILE_PX / 2}px)` }} />
          </div>

          {items !== undefined && categoryItems.length === 0 && (
            <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-xs tracking-widest text-black/30 dark:text-white/30">
              NO {categoryDisplayName(activeCategory)} YET
            </span>
          )}
        </div>

          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next piece"
            className="z-10 flex shrink-0 items-center justify-center rounded-full bg-white text-black/50 transition-colors duration-150 hover:text-black dark:bg-neutral-950 dark:text-white/50 dark:hover:text-white"
            style={{ height: CHECK_PX, width: CHECK_PX, marginBottom: CHECK_OFFSET }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            type="button"
            onClick={commitMarked}
            aria-label={`Put marked piece in the ${categoryDisplayName(activeCategory)} slot`}
            className="z-10 flex shrink-0 items-center justify-center rounded-full border border-black/30 bg-white text-black/70 transition-transform duration-150 hover:scale-105 active:scale-95 dark:border-white/30 dark:bg-neutral-950 dark:text-white/70"
            style={{ height: CHECK_PX, width: CHECK_PX, marginBottom: CHECK_OFFSET }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ROW 3 — the slots. Category icon until something is committed, then
          the piece itself. Tapping one opens that category in the slider. */}
      <div className="flex shrink-0 items-center justify-center px-8 py-5">
        <div className="flex items-stretch gap-1 rounded-2xl border border-black/10 p-1.5 dark:border-white/10">
          {slots.map((slot) => {
            const active = slot.category === activeCategory
            return (
              <button
                key={slot.category}
                type="button"
                onClick={() => selectSlot(slot.category)}
                className={`relative flex w-28 flex-col items-center justify-center gap-2 rounded-xl px-2 py-2.5 transition-colors duration-150 ${
                  active
                    ? "bg-black/[0.06] dark:bg-white/[0.08]"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
              >
                {slot.thumbUrl ? (
                  <img src={slot.thumbUrl} alt="" className="h-8 w-8 object-contain" />
                ) : (
                  <div
                    aria-hidden
                    className={`h-8 w-8 transition-colors duration-150 ${
                      active ? "bg-black/60 dark:bg-white/70" : "bg-black/25 dark:bg-white/25"
                    }`}
                    style={maskStyle(slot.category)}
                  />
                )}

                <span
                  className={`text-[10px] tracking-widest transition-colors duration-150 ${
                    active ? "text-black dark:text-white" : "text-black/40 dark:text-white/40"
                  }`}
                >
                  {categoryDisplayName(slot.category)}
                </span>

                {slot.count > 1 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[9px] text-white dark:bg-white dark:text-black">
                    {slot.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
