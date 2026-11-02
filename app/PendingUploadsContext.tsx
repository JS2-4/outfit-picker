"use client"

import { createContext, ReactNode, useContext, useState } from "react"

// Kept in sync with app/page.tsx's own Category type — duplicated here
// rather than imported, same convention as the rest of this project (see
// e.g. the Category duplication note in app/item/[id]/page.tsx), so this
// file doesn't need to import from a page file.
type Category = "SHIRTS" | "PANTS" | "SHOES" | "OUTERWEAR" | "ACCESSORIES"

// Tracks an add-item submission that's still being processed (background
// removal, upload, Convex write) so the grid can show a skeleton tile for
// it instead of blocking the whole form until everything finishes.
//
// This lives up here — provided once from layout.tsx, wrapping every route
// — rather than as local state inside app/page.tsx, specifically so it
// survives client-side navigation. An upload keeps running in the
// background (in its own worker + Convex calls) even after you navigate
// away from the grid page; React just unmounts app/page.tsx's component
// instance when you do. When pendingUploads lived as local state inside
// that component, unmounting wiped the list along with it, so navigating
// back to the grid showed nothing until the real item suddenly popped in —
// looked like the upload had silently vanished, even though it was still
// working the whole time. Hoisting the state up here means the same list
// (and the same skeleton tile) is still there when you come back.
export type PendingUpload = {
  localId: string
  category: Category
  subcategory: string
  code: string
  name: string | null
  // One-time entrance delay (ms), computed once in app/page.tsx's
  // handleAddItem right when the tile is created — the "wait for the rest
  // of the grid to finish its own entrance, then a deliberate beat" pause.
  // Paired with `revealed` below: a real setTimeout (also started in
  // handleAddItem, independent of anything mounted) fires markRevealed
  // after exactly this many ms. Until then the tile plays its delayed
  // fade-in; after, it just renders immediately, every time, including
  // after a remount caused by switching category tabs or navigating away
  // and back — so that deliberate pause only ever happens once, right
  // after SAVE, not on every subsequent grid remount.
  revealDelayMs: number
  revealed: boolean
  // The real Convex item's _id, filled in by attachItemId once
  // createItem resolves — null up until then, while the upload/background
  // removal work is still in flight and no row exists yet. Typed as a
  // plain string rather than Convex's Id<"items"> so this file doesn't
  // need to import from convex/_generated — same reasoning as the
  // Category duplication above.
  //
  // While this is set (and this pending upload hasn't been removed yet),
  // app/page.tsx's visibleItems filters the matching real item OUT of the
  // main grid — so a freshly-created item stays hidden behind this same
  // skeleton tile until AI analysis (color/material/name) actually
  // finishes, instead of popping in bare and quietly filling in a moment
  // later.
  itemId: string | null
}

type PendingUploadsContextValue = {
  pendingUploads: PendingUpload[]
  addPendingUpload: (upload: PendingUpload) => void
  removePendingUpload: (localId: string) => void
  markRevealed: (localId: string) => void
  attachItemId: (localId: string, itemId: string) => void
}

const PendingUploadsContext = createContext<PendingUploadsContextValue | null>(null)

export function PendingUploadsProvider({ children }: { children: ReactNode }) {
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])

  function addPendingUpload(upload: PendingUpload) {
    setPendingUploads((prev) => [...prev, upload])
  }

  function removePendingUpload(localId: string) {
    setPendingUploads((prev) => prev.filter((pending) => pending.localId !== localId))
  }

  function markRevealed(localId: string) {
    setPendingUploads((prev) =>
      prev.map((pending) => (pending.localId === localId ? { ...pending, revealed: true } : pending))
    )
  }

  function attachItemId(localId: string, itemId: string) {
    setPendingUploads((prev) =>
      prev.map((pending) => (pending.localId === localId ? { ...pending, itemId } : pending))
    )
  }

  return (
    <PendingUploadsContext.Provider
      value={{ pendingUploads, addPendingUpload, removePendingUpload, markRevealed, attachItemId }}
    >
      {children}
    </PendingUploadsContext.Provider>
  )
}

export function usePendingUploads() {
  const ctx = useContext(PendingUploadsContext)
  if (!ctx) {
    throw new Error("usePendingUploads must be used within a PendingUploadsProvider")
  }
  return ctx
}
