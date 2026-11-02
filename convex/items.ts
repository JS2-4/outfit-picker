import { query, mutation, internalMutation } from "./_generated/server"
import { v } from "convex/values"

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const getAllItems = query({
  handler: async (ctx) => {
    const items = await ctx.db.query("items").order("asc").collect()
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        frontImageUrl: item.frontImageId
          ? await ctx.storage.getUrl(item.frontImageId)
          : null,
      }))
    )
  },
})

// Flips the heart on a closet tile. Reads the current value rather than
// taking one from the client so two quick clicks can't race to the same
// state — whatever the document says at the moment the mutation runs is what
// gets inverted. An unset `favorite` reads as false, so the first press on
// any pre-existing item turns it on.
export const toggleFavorite = mutation({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id)
    if (!item) return
    await ctx.db.patch(args.id, { favorite: !item.favorite })
  },
})

export const getItem = query({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id)
    if (!item) return null

    return {
      ...item,
      frontImageUrl: item.frontImageId
        ? await ctx.storage.getUrl(item.frontImageId)
        : null,
      backImageUrl: item.backImageId
        ? await ctx.storage.getUrl(item.backImageId)
        : null,
    }
  },
})

export const createItem = mutation({
  args: {
    category: v.string(),
    subcategory: v.optional(v.string()),
    code: v.string(),
    name: v.optional(v.string()),
    frontImageId: v.optional(v.id("_storage")),
    backImageId: v.optional(v.id("_storage")),
    materialHint: v.optional(v.string()),
    silhouetteHint: v.optional(v.string()),
    itemValue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("items", {
      category: args.category,
      subcategory: args.subcategory,
      code: args.code,
      name: args.name,
      frontImageId: args.frontImageId,
      backImageId: args.backImageId,
      materialHint: args.materialHint,
      silhouetteHint: args.silhouetteHint,
      itemValue: args.itemValue,
      // Starts every item at 0 — nothing increments this yet (see the
      // schema comment), but the grid's SORT BY → MOST WORN option and the
      // item detail page's TIMES WORN stat both read it, so it needs a
      // real starting value rather than staying unset.
      timesWorn: 0,
      createdAt: Date.now(),
    })
  },
})

// WRITE: update an existing item's editable fields from the item detail
// page's EDIT menu. Deliberately leaves `code` and `createdAt` untouched —
// switching category here does NOT renumber the item's code (e.g.
// "SH-03" stays "SH-03" even if you move it to PANTS). If a new photo was
// uploaded, the old stored file is deleted so it doesn't linger as an
// orphaned blob in Convex storage. `colors` is the ordered (most-to-least
// prominent) multi-color selection from the edit menu; its first entry is
// also mirrored into the legacy `primaryColor` field for anything else that
// might still read it.
export const updateItem = mutation({
  args: {
    id: v.id("items"),
    category: v.string(),
    subcategory: v.optional(v.string()),
    name: v.optional(v.string()),
    colors: v.optional(v.array(v.object({ hex: v.string(), name: v.string() }))),
    colorShade: v.optional(v.string()),
    frontImageId: v.optional(v.id("_storage")),
    backImageId: v.optional(v.id("_storage")),
    materialHint: v.optional(v.string()),
    silhouetteHint: v.optional(v.string()),
    itemValue: v.optional(v.string()),
    // Manual override for the AI's footwear left/right orientation guess
    // (see needsFlip in convex/analyze.ts / schema.ts). AI orientation
    // detection is inherently probabilistic and will occasionally get a
    // boot or slide backwards even with a carefully-worded prompt — this
    // lets you just fix it by hand from the EDIT menu instead of hoping a
    // re-analyze happens to guess right. Only ever sent for SHOES items
    // (see app/item/[id]/page.tsx) and left optional/undefined for every
    // other category, same convention as saveAnalysis below — omitting it
    // here leaves whatever's already stored untouched rather than wiping
    // it to false.
    needsFlip: v.optional(v.boolean()),
    // Hand-written note pyramid from the EDIT menu, for fragrances. Exists
    // because the pyramid is a factual claim the AI can get wrong or honestly
    // decline (see FRAGRANCE_GUIDANCE in convex/analyze.ts), and there needs
    // to be a way to just put the right answer in.
    //
    // Same null-vs-undefined convention as saveAnalysis: null clears the
    // stored notes (you emptied the fields), undefined leaves them alone (a
    // non-fragrance edit, which never sends this at all). Note that a manual
    // edit here IS overwritten by a later re-analysis — unlike `name`, which
    // analysis deliberately never touches once set — so correcting notes by
    // hand and then re-analyzing will lose the correction.
    fragranceNotes: v.optional(
      v.union(
        v.null(),
        v.object({
          top: v.array(v.string()),
          middle: v.array(v.string()),
          base: v.array(v.string()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return

    if (args.frontImageId && existing.frontImageId && args.frontImageId !== existing.frontImageId) {
      await ctx.storage.delete(existing.frontImageId)
    }
    if (args.backImageId && existing.backImageId && args.backImageId !== existing.backImageId) {
      await ctx.storage.delete(existing.backImageId)
    }

    await ctx.db.patch(args.id, {
      category: args.category,
      subcategory: args.subcategory,
      name: args.name,
      colors: args.colors,
      colorShade: args.colorShade,
      primaryColor: args.colors && args.colors.length > 0 ? args.colors[0] : undefined,
      frontImageId: args.frontImageId ?? existing.frontImageId,
      backImageId: args.backImageId ?? existing.backImageId,
      materialHint: args.materialHint,
      silhouetteHint: args.silhouetteHint,
      itemValue: args.itemValue,
      ...(args.needsFlip !== undefined ? { needsFlip: args.needsFlip } : {}),
      ...(args.fragranceNotes !== undefined
        ? { fragranceNotes: args.fragranceNotes ?? undefined }
        : {}),
    })
  },
})

// WRITE: delete an item and its uploaded photos
export const deleteItem = mutation({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id)
    if (!item) return

    if (item.frontImageId) {
      await ctx.storage.delete(item.frontImageId)
    }
    if (item.backImageId) {
      await ctx.storage.delete(item.backImageId)
    }

    await ctx.db.delete(args.id)
  },
})

export const saveAnalysis = internalMutation({
  args: {
    id: v.id("items"),
    silhouette: v.string(),
    material: v.string(),
    primaryColor: v.object({ hex: v.string(), name: v.string() }),
    // Only ever sent when the item had no name at analysis time (see
    // needsName in convex/analyze.ts) — left optional and only patched
    // when actually provided, so re-running analysis never overwrites a
    // name someone typed by hand, in the Add Item form or the edit menu.
    name: v.optional(v.string()),
    // Left optional and only patched when actually provided (see below) so
    // re-running analysis can't silently wipe out colors you set manually
    // via the edit menu.
    colors: v.optional(v.array(v.object({ hex: v.string(), name: v.string() }))),
    colorShade: v.optional(v.string()),
    // Only ever sent for SHOES items (see convex/analyze.ts) — left optional
    // and only patched when actually provided, so re-running analysis for a
    // non-footwear item (or an older run) can't accidentally wipe out a
    // previously-set flip flag.
    needsFlip: v.optional(v.boolean()),
    // The AI's brand guess — just the brand ("Nike", "New Era"), never a
    // specific product/model (see wantsBrand in convex/analyze.ts). Only
    // ever sent for in-scope categories, and ALWAYS sent (even as "")
    // whenever it is, unlike the other optional fields here. An empty
    // string is treated as "actively clear any previous guess" (see the
    // patch below), not "leave it alone" — re-analysis reflects the LATEST
    // attempt's confidence rather than preserving a possibly-stale answer
    // from an earlier run.
    brand: v.optional(v.string()),
    complementaryColors: v.array(
      v.object({
        category: v.optional(v.string()),
        hex: v.string(),
        name: v.string(),
        // See the schema — strongest-first pairing tier ("EXCELLENT" |
        // "STRONG" | "GOOD"). Optional here so an older caller that doesn't
        // send it still validates.
        tier: v.optional(v.string()),
      })
    ),
    // Fragrance-only analysis (see the schema for full field notes). Sent
    // ONLY for ACCESSORIES/FRAGRANCES items and left undefined for every
    // other category, so the patch below leaves these untouched rather than
    // writing empty structures onto items they make no sense for — same
    // optional-and-only-patched-when-provided convention as needsFlip.
    // Accepts an explicit null, unlike the others here. Analysis sends null
    // when it identified the fragrance but honestly doesn't recall its
    // published note pyramid (see resolveFragranceProfile in
    // convex/analyze.ts) — that's a real answer, and it CLEARS any stored
    // notes rather than leaving an earlier, possibly-invented pyramid in
    // place. undefined still means "not in scope, don't touch".
    fragranceNotes: v.optional(
      v.union(
        v.null(),
        v.object({
          top: v.array(v.string()),
          middle: v.array(v.string()),
          base: v.array(v.string()),
        })
      )
    ),
    longevity: v.optional(v.string()),
    projectionTime: v.optional(v.string()),
    projection: v.optional(v.string()),
    whenToApply: v.optional(
      v.object({
        timeOfDay: v.array(v.string()),
        season: v.array(v.string()),
        temperature: v.array(v.string()),
        setting: v.array(v.string()),
        outfit: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      silhouette: args.silhouette,
      material: args.material,
      primaryColor: args.primaryColor,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.colors !== undefined ? { colors: args.colors } : {}),
      ...(args.colorShade !== undefined ? { colorShade: args.colorShade } : {}),
      ...(args.needsFlip !== undefined ? { needsFlip: args.needsFlip } : {}),
      // Explicitly setting a key to `undefined` in a Convex patch clears
      // that field (removes it), unlike omitting the key entirely (which
      // leaves it untouched) — args.brand || undefined turns "" into that
      // clearing `undefined`, while still only including the key at all
      // when the category was in scope (args.brand !== undefined upstream,
      // i.e. analyze.ts actually sent something).
      //
      // `productId` rides along in the same branch purely to retire the
      // deprecated field it replaced (see convex/schema.ts): any in-scope
      // item that still carries an old "Nike Air Force 1"-style value gets
      // it cleared the next time it's analyzed, so the leftover data drains
      // away on its own instead of sitting around looking current. It is
      // unconditionally cleared rather than conditionally, because there is
      // no case where keeping it is right once `brand` is authoritative.
      ...(args.brand !== undefined
        ? { brand: args.brand || undefined, productId: undefined }
        : {}),
      complementaryColors: args.complementaryColors,
      // `?? undefined` is the clearing step: setting a key to undefined in a
      // Convex patch removes the field, so an explicit null from analysis
      // wipes stale notes, while omitting the key entirely (undefined arg)
      // leaves whatever's stored untouched.
      ...(args.fragranceNotes !== undefined
        ? { fragranceNotes: args.fragranceNotes ?? undefined }
        : {}),
      ...(args.longevity !== undefined ? { longevity: args.longevity } : {}),
      ...(args.projectionTime !== undefined ? { projectionTime: args.projectionTime } : {}),
      ...(args.projection !== undefined ? { projection: args.projection } : {}),
      ...(args.whenToApply !== undefined ? { whenToApply: args.whenToApply } : {}),
      analyzedAt: Date.now(),
    })
  },
})