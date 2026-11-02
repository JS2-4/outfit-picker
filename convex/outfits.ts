import { query, mutation, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import { Id } from "./_generated/dataModel"

export const getAllOutfits = query({
  handler: async (ctx) => {
    const outfits = await ctx.db.query("outfits").order("desc").collect()

    return await Promise.all(
      outfits.map(async (outfit) => {
        const [shirt, pants, shoes, jacket] = await Promise.all([
          outfit.shirtId ? ctx.db.get(outfit.shirtId) : null,
          outfit.pantsId ? ctx.db.get(outfit.pantsId) : null,
          outfit.shoesId ? ctx.db.get(outfit.shoesId) : null,
          outfit.jacketId ? ctx.db.get(outfit.jacketId) : null,
        ])

        const [shirtImageUrl, pantsImageUrl, shoesImageUrl, jacketImageUrl] =
          await Promise.all([
            shirt?.frontImageId ? ctx.storage.getUrl(shirt.frontImageId) : null,
            pants?.frontImageId ? ctx.storage.getUrl(pants.frontImageId) : null,
            shoes?.frontImageId ? ctx.storage.getUrl(shoes.frontImageId) : null,
            jacket?.frontImageId ? ctx.storage.getUrl(jacket.frontImageId) : null,
          ])

        // Accessories are a variable-length list rather than four named slots,
        // so they resolve as an array. Only outfits built before accessories
        // existed lack the field, hence the ?? [].
        //
        // Items are fetched first and URLs second, in two waves, rather than
        // fetching and resolving each accessory in one pass — a deleted item
        // comes back null from db.get, and asking storage for its file would
        // throw rather than yield null. Nulls are dropped here so the grid
        // never has to reason about holes in the list.
        const accessories = await Promise.all(
          (outfit.accessoryIds ?? []).map((id) => ctx.db.get(id))
        )
        const accessoryImageUrls = (
          await Promise.all(
            accessories.map((accessory) =>
              accessory?.frontImageId ? ctx.storage.getUrl(accessory.frontImageId) : null
            )
          )
        ).filter((url): url is string => url !== null)

        return {
          ...outfit,
          shirtImageUrl,
          pantsImageUrl,
          shoesImageUrl,
          jacketImageUrl,
          accessoryImageUrls,
        }
      })
    )
  },
})

export const getOutfit = query({
  args: { id: v.id("outfits") },
  handler: async (ctx, args) => {
    const outfit = await ctx.db.get(args.id)
    if (!outfit) return null

    const ids = [
      outfit.shirtId,
      outfit.pantsId,
      outfit.shoesId,
      outfit.jacketId,
      ...outfit.accessoryIds,
    ].filter((id) => id !== undefined) as Id<"items">[]

    const items = await Promise.all(ids.map((id) => ctx.db.get(id)))

    const pieces = await Promise.all(
      items
        .filter((item) => item !== null)
        .map(async (item) => ({
          _id: item!._id,
          category: item!.category,
          code: item!.code,
          name: item!.name,
          frontImageUrl: item!.frontImageId
            ? await ctx.storage.getUrl(item!.frontImageId)
            : null,
        }))
    )

    return { ...outfit, pieces }
  },
})

export const createOutfit = mutation({
  args: {
    shirtId: v.optional(v.id("items")),
    pantsId: v.optional(v.id("items")),
    shoesId: v.optional(v.id("items")),
    jacketId: v.optional(v.id("items")),
    accessoryIds: v.array(v.id("items")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("outfits", {
      shirtId: args.shirtId,
      pantsId: args.pantsId,
      shoesId: args.shoesId,
      jacketId: args.jacketId,
      accessoryIds: args.accessoryIds,
      createdAt: Date.now(),
    })
  },
})

// Deletes an outfit and nothing else. Unlike items.deleteItem, which also
// removes the item's uploaded photos from storage, an outfit owns no files —
// it only holds references to items that still exist in the closet. Deleting
// the outfit must leave every piece in it untouched.
export const deleteOutfit = mutation({
  args: { id: v.id("outfits") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
  },
})

export const saveOutfitAnalysis = internalMutation({
  args: {
    id: v.id("outfits"),
    name: v.string(),
    description: v.string(),
    kind: v.string(),
    rating: v.number(),
    ratingBreakdown: v.object({
      silhouette: v.number(),
      color: v.number(),
      proportion: v.number(),
      cohesion: v.number(),
      footwearAccessories: v.number(),
    }),
    strengths: v.array(v.string()),
    weaknesses: v.array(v.string()),
    suggestions: v.array(v.string()),
    biggestStrength: v.string(),
    biggestWeakness: v.string(),
    highestImpactImprovement: v.string(),
    whenToWear: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      name: args.name,
      description: args.description,
      kind: args.kind,
      rating: args.rating,
      ratingBreakdown: args.ratingBreakdown,
      strengths: args.strengths,
      weaknesses: args.weaknesses,
      suggestions: args.suggestions,
      biggestStrength: args.biggestStrength,
      biggestWeakness: args.biggestWeakness,
      highestImpactImprovement: args.highestImpactImprovement,
      whenToWear: args.whenToWear,
      analyzedAt: Date.now(),
    })
  },
})