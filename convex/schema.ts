import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  items: defineTable({
    category: v.string(),
    subcategory: v.optional(v.string()),
    code: v.string(),
    name: v.optional(v.string()),
    frontImageId: v.optional(v.id("_storage")),
    backImageId: v.optional(v.id("_storage")),
    silhouette: v.optional(v.string()),
    material: v.optional(v.string()),
    // User-provided hints from the Add Item form's "ADDITIONAL INFO" section.
    // These aren't shown as the final answer anywhere — they're passed into
    // the AI prompt as context clues alongside the photo.
    materialHint: v.optional(v.string()),
    silhouetteHint: v.optional(v.string()),
    // Also from "ADDITIONAL INFO", but unlike the hints above this is saved
    // and shown as-is (e.g. "$67") — it isn't fed to the AI prompt.
    itemValue: v.optional(v.string()),
    // Legacy single-color field. Kept for backward compatibility with items
    // analyzed/edited before multi-color support was added — the UI falls
    // back to [primaryColor] wherever `colors` below is empty/unset, so
    // nothing already saved disappears. New edits/analyses write to
    // `colors` instead (and mirror the first entry back into this field).
    primaryColor: v.optional(v.object({ hex: v.string(), name: v.string() })),
    // Ordered most-prominent-first.
    colors: v.optional(v.array(v.object({ hex: v.string(), name: v.string() }))),
    // "LIGHT" | "DARK", or unset (shown as "-" in the UI).
    colorShade: v.optional(v.string()),
    // Recommended colors for the OTHER pieces of an outfit built around
    // this item — see buildPairingGuidance/resolvePairColors in
    // convex/analyze.ts. Ordered strongest-first, at most one entry per
    // broad color family, and `name`/`hex` always come from the shared
    // ITEM_COLOR_PALETTE rather than from the model, so every suggestion is
    // a color the closet can actually contain.
    complementaryColors: v.optional(
      v.array(
        v.object({
          // Optional so older items analyzed before we removed clothing-type
          // tagging (e.g. "PANTS", "SHOES") still pass schema validation.
          // New analyses never set this field.
          category: v.optional(v.string()),
          hex: v.string(),
          name: v.string(),
          // "EXCELLENT" | "STRONG" | "GOOD" — how strong the pairing is,
          // so an excellent match is distinguishable from a merely
          // acceptable one rather than the list being a flat ranking.
          // Optional because items analyzed before tiers existed have
          // entries without it; the UI treats a missing tier as unlabeled
          // rather than guessing one.
          tier: v.optional(v.string()),
        })
      )
    ),
    // Shown as a "TIMES WORN" stat on the item detail page and used by the
    // grid's SORT BY → MOST WORN option. Always initialized to 0 at
    // createItem time; nothing increments it yet — that's a future feature
    // (e.g. a "log a wear" button) this field is just laying the groundwork
    // for.
    timesWorn: v.optional(v.number()),
    // Heart toggle on the closet grid tile. Optional rather than defaulted so
    // every item that already exists stays valid without a migration — an
    // unset value and `false` mean the same thing everywhere it's read, and
    // toggleFavorite in convex/items.ts writes an explicit boolean the first
    // time a piece is hearted. Set by hand only; nothing in the AI analysis
    // touches it.
    favorite: v.optional(v.boolean()),
    // Only ever set for SHOES items — true if the AI determined the shoe's
    // toe points left in the photo, so the display (grid + item detail) knows
    // to flip it horizontally so every shoe in the closet reads as pointing
    // right. Unset for every other category, and unset until the item has
    // been analyzed at least once.
    needsFlip: v.optional(v.boolean()),
    // The AI's best-effort guess at the item's BRAND alone — "Nike",
    // "New Era", "Dior" — never a specific product/model. Only ever
    // requested for SHOES and the ACCESSORIES/HATS and
    // ACCESSORIES/FRAGRANCES subcategories (see wantsBrand in
    // convex/analyze.ts), where a photo realistically carries a legible
    // logo or an iconic enough design. Left unset whenever the AI wasn't
    // confident, or the item's (category, subcategory) is out of scope —
    // never a placeholder/guessed value.
    brand: v.optional(v.string()),
    // DEPRECATED — superseded by `brand` above. Held a specific brand +
    // product/model guess ("Nike Air Force 1", "Dior Sauvage") back when
    // the AI was asked to pin the exact product. That proved both harder
    // and less useful than just the brand: naming the model required
    // evidence distinguishing it from everything else in the same brand's
    // lineup, so a plainly legible logo on its own still had to return
    // nothing.
    //
    // Kept in the schema ONLY so items still carrying an old value keep
    // passing schema validation — nothing reads it any more, and
    // saveAnalysis actively clears it whenever it writes `brand` (see
    // convex/items.ts), so it empties out on its own as in-scope items get
    // re-analyzed. Safe to drop from the schema once no document has it.
    productId: v.optional(v.string()),

    // ---- Fragrance-only analysis ----------------------------------------
    // Everything below is only ever set for ACCESSORIES/FRAGRANCES items
    // (see wantsFragranceProfile in convex/analyze.ts). A fragrance has no
    // meaningful silhouette or material, so the item detail page swaps those
    // rows out for these; they stay unset — and unrendered — for every other
    // category. All optional, so items analyzed before this shipped and
    // every non-fragrance item still validate.

    // The scent pyramid. Each tier holds a few short note names ("bergamot",
    // "oakmoss"), ordered most to least prominent within that tier.
    fragranceNotes: v.optional(
      v.object({
        top: v.array(v.string()),
        middle: v.array(v.string()),
        base: v.array(v.string()),
      })
    ),
    // How long the fragrance is detectable on skin at all, as a short range
    // e.g. "8-10 HOURS". This is what the PERFORMANCE row displays.
    longevity: v.optional(v.string()),
    // How long NOTICEABLE PROJECTION lasts before it drops to a skin scent —
    // always shorter than `longevity` above, and validated as such (see
    // resolveFragranceProfile in convex/analyze.ts).
    //
    // Not currently displayed: the panel shows projection strength and
    // longevity, which are the two figures people actually quote. It's still
    // stored because producing it is what forces the model to separate throw
    // from lifespan instead of reporting one number twice — and having it on
    // the document means it can be surfaced later without a re-analysis.
    projectionTime: v.optional(v.string()),
    // "STRONG" | "MEDIUM" | "LOW" — how far the fragrance throws overall.
    projection: v.optional(v.string()),
    // When this fragrance is most appropriate to wear. Each array holds the
    // AI's SELECTED recommendations for that category, ordered strongest
    // first, drawn from a fixed option list per category (see
    // FRAGRANCE_WHEN_CATEGORIES in convex/analyze.ts, mirrored in
    // app/item/[id]/page.tsx). The UI shows these selections collapsed by
    // default and reveals the unselected remainder of each list on click, so
    // what's stored here is deliberately just the picks, not the whole list.
    whenToApply: v.optional(
      v.object({
        timeOfDay: v.array(v.string()),
        season: v.array(v.string()),
        temperature: v.array(v.string()),
        setting: v.array(v.string()),
        // Outfit AESTHETICS this fragrance suits ("Elevated Casual",
        // "Dark / Edgy") — judged from the scent's character, never from the
        // color or look of the bottle.
        outfit: v.array(v.string()),
      })
    ),

    analyzedAt: v.optional(v.number()),
    createdAt: v.number(),
  }),

  outfits: defineTable({
    shirtId: v.optional(v.id("items")),
    pantsId: v.optional(v.id("items")),
    shoesId: v.optional(v.id("items")),
    jacketId: v.optional(v.id("items")),
    accessoryIds: v.array(v.id("items")),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    kind: v.optional(v.string()),
    rating: v.optional(v.number()),
    // Per-dimension sub-scores from the outfit evaluation rubric (section 18:
    // silhouette / color / proportion / cohesion / footwear+accessories).
    ratingBreakdown: v.optional(
      v.object({
        silhouette: v.number(),
        color: v.number(),
        proportion: v.number(),
        cohesion: v.number(),
        footwearAccessories: v.number(),
      })
    ),
    strengths: v.optional(v.array(v.string())),
    weaknesses: v.optional(v.array(v.string())),
    suggestions: v.optional(v.array(v.string())),
    // Single distilled highlights, distinct from the fuller strengths/
    // weaknesses/suggestions arrays above.
    biggestStrength: v.optional(v.string()),
    biggestWeakness: v.optional(v.string()),
    highestImpactImprovement: v.optional(v.string()),
    whenToWear: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
    createdAt: v.number(),
  }),
})