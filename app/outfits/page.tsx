"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import MenuPanel from "@/components/MenuPanel"

// SORT BY options, in the order they appear in the dropdown. Deliberately
// shorter than the closet's list — an outfit has far fewer sortable
// attributes than a garment, and offering a COLOR sort here would mean
// inventing a colour for a set of four pieces.
type SortMode = "RECENTLY_ADDED" | "OLDEST" | "HIGHEST_RATED" | "NAME"

const sortOptions: { key: SortMode; label: string }[] = [
  { key: "RECENTLY_ADDED", label: "RECENTLY ADDED" },
  { key: "OLDEST", label: "OLDEST" },
  { key: "HIGHEST_RATED", label: "HIGHEST RATED" },
  { key: "NAME", label: "NAME" },
]

export default function OutfitsPage() {
  const outfits = useQuery(api.outfits.getAllOutfits)
  const deleteOutfit = useMutation(api.outfits.deleteOutfit)

  // Header state, mirroring the closet page so the two tabs behave
  // identically — same controls, same spots, same interactions.
  const [deleteMode, setDeleteMode] = useState(false)
  // Bumped on every trash click, independent of deleteMode itself. Used only
  // as a remount key so the press animation restarts from frame 0 even on two
  // rapid clicks in a row; the red/black colour change is driven by
  // deleteMode. Same technique as the closet page's trash button.
  const [trashPressCount, setTrashPressCount] = useState(0)
  const [sortMode, setSortMode] = useState<SortMode>("RECENTLY_ADDED")
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortContainerRef = useRef<HTMLDivElement>(null)
  const [showKindMenu, setShowKindMenu] = useState(false)
  const [activeKindFilter, setActiveKindFilter] = useState<string | null>(null)

  const [outfitPendingDelete, setOutfitPendingDelete] = useState<
    NonNullable<typeof outfits>[number] | null
  >(null)
  const [isDeletingOutfit, setIsDeletingOutfit] = useState(false)

  // Collapses the SORT BY dropdown on an outside click — same behaviour as
  // the closet page's. (The PIECE ANALYTICS bubble on the item page
  // deliberately does NOT do this; a menu you open to make one choice should
  // get out of the way, a panel you read alongside other things shouldn't.)
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

  // Filter options come from the outfits themselves rather than from the
  // fixed vocabulary the analyzer picks from (minimal, streetwear, workwear,
  // …). Listing all twelve would mean most of them match nothing and filter
  // to an empty grid; deriving them means every option in the row is one you
  // can actually select and get results for. Outfits analysed before `kind`
  // existed simply don't contribute an option.
  const kindOptions = Array.from(
    new Set((outfits ?? []).map((outfit) => outfit.kind).filter(Boolean) as string[])
  ).sort()

  // A filter can be left pointing at a kind that no longer exists — delete
  // the last "workwear" outfit and the filter would silently show nothing
  // with no way to tell why. Clearing it is better than rendering an empty
  // grid under a filter the row can't even display any more.
  useEffect(() => {
    if (activeKindFilter && !kindOptions.includes(activeKindFilter)) {
      setActiveKindFilter(null)
    }
  }, [activeKindFilter, kindOptions])

  const visibleOutfits = (outfits ?? [])
    .filter((outfit) => activeKindFilter === null || outfit.kind === activeKindFilter)
    .sort((a, b) => {
      switch (sortMode) {
        case "OLDEST":
          return a.createdAt - b.createdAt
        case "HIGHEST_RATED":
          // Unrated outfits sort last rather than as zero-rated, so a grid
          // that's mostly unanalysed doesn't bury the rated ones underneath.
          return (b.rating ?? -1) - (a.rating ?? -1)
        case "NAME": {
          const aName = (a.name ?? "").toLowerCase()
          const bName = (b.name ?? "").toLowerCase()
          return aName.localeCompare(bName)
        }
        case "RECENTLY_ADDED":
        default:
          return b.createdAt - a.createdAt
      }
    })

  // Changing sort or filter reuses the same DOM nodes, so the tiles' entrance
  // animation would never replay and the grid would silently rearrange.
  // Prefixing each key with a value that changes with the view forces a
  // remount, and a fresh node restarts a CSS animation from frame 0. Same
  // mechanism as the closet grid.
  const gridEpoch = `${activeKindFilter ?? ""}|${sortMode}`

  async function handleConfirmDelete() {
    if (!outfitPendingDelete) return
    setIsDeletingOutfit(true)
    try {
      await deleteOutfit({ id: outfitPendingDelete._id })
      setOutfitPendingDelete(null)
    } catch (err) {
      console.error(err)
      alert("Delete failed — check the terminal running npx convex dev for details.")
    } finally {
      setIsDeletingOutfit(false)
    }
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-black dark:bg-neutral-950 dark:text-white">
      {/* Header mirrors the closet page exactly: same py-3, same left group at
          gap-7 holding menu + filter + SORT BY, same right group at gap-6, and
          no bottom rule. Keeping the two tabs identical is the whole point —
          the menu button shouldn't move when you switch between them. */}
      <header className="flex items-center justify-between px-8 py-3">
        <div className="flex items-center gap-7">
          <MenuPanel />

          {/* Filter — grouped with SORT BY because both change the VIEW of the
              outfits, while trash and NEW OUTFIT change the outfits
              themselves. Hidden entirely until at least one outfit carries a
              kind, since a filter with nothing to filter by is just a dead
              control. */}
          {kindOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowKindMenu((prev) => !prev)}
              aria-label={showKindMenu ? "Hide kind filter" : "Filter by kind"}
              aria-pressed={showKindMenu}
              className={`inline-flex items-center justify-center transition-colors duration-200 ${
                showKindMenu || activeKindFilter
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
          )}

          <div ref={sortContainerRef} className="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={showSortMenu}
              /* pb-1 for the same reason as the closet page's SORT BY: it
                 aligns this text with controls that carry bottom padding of
                 their own. Kept here so the two tabs' headers sit on the same
                 baseline when you switch between them. */
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

        <div className="flex items-center gap-6">
          {/* Toggles delete mode. Identical to the closet page's, including
              the press animation — the only difference is what it deletes. */}
          <button
            type="button"
            onClick={() => {
              setDeleteMode((prev) => !prev)
              setTrashPressCount((count) => count + 1)
            }}
            aria-label={deleteMode ? "Exit delete mode" : "Delete outfits"}
            aria-pressed={deleteMode}
            className={`inline-flex items-center justify-center transition-colors duration-200 ${
              deleteMode
                ? "text-red-500 hover:text-red-600"
                : "text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
            }`}
          >
            {/* Keyed on trashPressCount to force a remount per click — a fresh
                DOM node always restarts the animation from frame 0, which a
                class toggle can't guarantee for two rapid clicks. The class is
                withheld until the first real click so the icon's first mount
                on page load is silent. */}
            <span
              key={trashPressCount}
              className={
                trashPressCount > 0
                  ? "animate-trash-press inline-block h-5 w-5"
                  : "inline-block h-5 w-5"
              }
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

          {/* Was a bare "+". Now reads as text, matching ADD ITEM in the same
              position on the closet page. */}
          <Link
            href="/outfits/new"
            className="text-xs tracking-widest text-black/60 transition-colors duration-200 hover:text-black dark:text-white/60 dark:hover:text-white"
          >
            NEW OUTFIT
          </Link>
        </div>
      </header>

      {/* Kind filter row — same collapsible grid-template-rows animation as the
          closet's TYPE row, so it slides rather than pops. Clicking the active
          kind clears the filter instead of needing a separate ALL option. */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
          showKindMenu ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <nav className="flex flex-wrap items-center gap-6 px-8 pt-1 pb-3">
            {kindOptions.map((kind) => (
              <button
                key={kind}
                onClick={() => setActiveKindFilter((prev) => (prev === kind ? null : kind))}
                className={`text-xs uppercase tracking-widest transition-colors duration-200 ${
                  kind === activeKindFilter
                    ? "text-black font-medium dark:text-white"
                    : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
                }`}
              >
                {kind}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-8 pb-14">
        {outfits === undefined ? (
          <p className="pt-4 text-sm text-black/40 dark:text-white/40">Loading...</p>
        ) : outfits.length === 0 ? (
          <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-black/40 dark:text-white/40">No outfits yet.</p>
            <Link
              href="/outfits/new"
              className="bg-black px-4 py-2 text-xs tracking-widest text-white transition-transform duration-150 hover:scale-105 active:scale-95 dark:bg-white dark:text-black"
            >
              BUILD AN OUTFIT
            </Link>
          </div>
        ) : visibleOutfits.length === 0 ? (
          // Distinct from "No outfits yet" — you have outfits, the filter just
          // hides them all. Saying so, and offering the way out, beats an
          // empty grid that looks like data loss.
          <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-black/40 dark:text-white/40">
              No {activeKindFilter} outfits.
            </p>
            <button
              type="button"
              onClick={() => setActiveKindFilter(null)}
              className="text-xs tracking-widest text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
            >
              CLEAR FILTER
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 pt-4 md:grid-cols-3">
            {visibleOutfits.map((outfit, index) => {
              const isPendingThisOutfit = outfitPendingDelete?._id === outfit._id
              // Same three-state rule as the closet tiles: pinned visible
              // while this outfit's confirm dialog is open (moving the mouse
              // toward the dialog would otherwise drop :hover), hover-only in
              // delete mode, and fully inert otherwise.
              const overlayVisibilityClasses = isPendingThisOutfit
                ? "opacity-100"
                : deleteMode
                  ? "opacity-0 group-hover:opacity-100"
                  : "pointer-events-none opacity-0"

              return (
                <Link
                  key={`${gridEpoch}-${outfit._id}`}
                  href={`/outfits/${outfit._id}`}
                  /* 4fr / 1fr splits the tile into the main 2x2 of garments and
                     a narrow accessory strip down the right — accessories land
                     at about 19% of the tile width, present without competing
                     with the clothes. The column is always rendered, even with
                     no accessories, so every tile is the same shape; the 2x2
                     already shows empty slots for outfits missing a jacket, so
                     a reserved-but-empty strip is consistent with that. */
                  className="group relative animate-fade-in-up grid max-w-[400px] grid-cols-[4fr_1fr] gap-1 bg-neutral-100 p-1 transition-transform duration-150 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] dark:bg-neutral-900"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      outfit.shirtImageUrl,
                      outfit.pantsImageUrl,
                      outfit.shoesImageUrl,
                      outfit.jacketImageUrl,
                    ]
                      .filter(Boolean)
                      .slice(0, 4)
                      .map((url, i) => (
                        <div
                          key={i}
                          className="aspect-square overflow-hidden bg-white dark:bg-neutral-800"
                        >
                          <img src={url as string} alt="" className="h-full w-full object-contain" />
                        </div>
                      ))}
                  </div>

                  {/* Accessories stack vertically and DIVIDE the column height
                      (flex-1 + min-h-0) rather than being fixed squares. That
                      matters for more than looks: square accessory tiles have
                      an intrinsic height, so four of them alongside a
                      single-row 2x2 made the whole tile taller than its
                      neighbours and stretched the row. Sizing them off the
                      available height instead means the garments alone decide
                      how tall a tile is, however many accessories it holds.

                      Capped at 4 — beyond that each slice gets too short to
                      read, and the cap matches the 2x2's own. */}
                  <div className="flex flex-col gap-1">
                    {(outfit.accessoryImageUrls ?? []).slice(0, 4).map((url, i) => (
                      <div
                        key={i}
                        className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-neutral-800"
                      >
                        <img src={url} alt="" className="h-full w-full object-contain" />
                      </div>
                    ))}
                  </div>

                  {/* Delete affordance. pointer-events-none rather than
                      `disabled` when delete mode is off — a disabled button
                      swallows the click instead of letting it bubble to the
                      surrounding Link, which would break navigation. */}
                  <button
                    type="button"
                    tabIndex={deleteMode ? 0 : -1}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setOutfitPendingDelete(outfit)
                    }}
                    aria-label={`Delete ${outfit.name ?? "outfit"}`}
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
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {outfitPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="flex w-80 flex-col gap-4 bg-white p-8 shadow-lg dark:bg-neutral-900">
            <h2 className="text-xs tracking-widest">DELETE OUTFIT</h2>
            {/* Says explicitly that the pieces survive. Deleting something
                assembled out of other things reasonably raises the question,
                and the answer is reassuring, so it belongs here. */}
            <p className="text-sm text-black/60 dark:text-white/60">
              This will permanently delete {outfitPendingDelete.name ?? "this outfit"}. The pieces in
              it stay in your closet. This can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmDelete}
                disabled={isDeletingOutfit}
                className="flex-1 bg-black py-2 text-xs tracking-widest text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
              >
                {isDeletingOutfit ? "DELETING..." : "DELETE"}
              </button>
              <button
                type="button"
                onClick={() => setOutfitPendingDelete(null)}
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
