import { mutation } from "./_generated/server"

// ============================================================
// TEMPORARY — one-time migration. Run this once from a terminal
// with:
//   npx convex run migrations:renameJacketsToOuterwear
// Then delete this file. It updates any existing item still
// tagged with the old "JACKETS" category so it shows up under
// the renamed "OUTERWEAR" tab instead of silently disappearing.
// ============================================================
export const renameJacketsToOuterwear = mutation({
  handler: async (ctx) => {
    const items = await ctx.db.query("items").collect()
    let updated = 0
    for (const item of items) {
      if (item.category === "JACKETS") {
        await ctx.db.patch(item._id, { category: "OUTERWEAR" })
        updated++
      }
    }
    return `Renamed ${updated} item(s) from JACKETS to OUTERWEAR`
  },
})