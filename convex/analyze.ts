"use node"

import { action } from "./_generated/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"

const MODEL = "claude-haiku-4-5-20251001"

// Fragrances only. Everything else this file asks for — silhouette, material,
// color — is read off the photo, which Haiku does fine. A fragrance's note
// pyramid is the opposite kind of question: nothing in the image contains the
// answer, so it's pure recall of a specific published composition, and that's
// exactly where a small fast model is weakest.
//
// The failure this fixes was not subtle. Asked for Creed Aventus and YSL Y
// EDP — two unrelated scents — Haiku returned the identical middle tier
// ("iris, ambroxan, cedar") for both, and missed apple and ginger, the two
// most distinctive notes in Y's opening. It wasn't recalling anything; it was
// emitting a plausible modern-masculine template. Sonnet is materially better
// at this kind of long-tail recall, and since fragrances are a small slice of
// a closet, the extra cost only lands on the items that need it.
const FRAGRANCE_MODEL = "claude-sonnet-5"
// The COLOR PAIRS row shows one swatch per suggested family. A range
// rather than the old fixed 6: the honest number of strong families varies
// by item, and padding to a fixed count forces weak suggestions in. The
// floor keeps the row from looking empty, the ceiling keeps it scannable.
const MIN_COMPLEMENT_COUNT = 5
const MAX_COMPLEMENT_COUNT = 8
const MAX_ATTEMPTS = 3

// Detailed silhouette taxonomy for shirts. Given to Claude so it evaluates
// width, length, shoulder shape, and structure using precise vocabulary
// instead of guessing a single vague word like "loose" or "fitted".
const SHIRT_SILHOUETTE_GUIDANCE = `Evaluate this shirt's silhouette using these four dimensions:

1. WIDTH + LENGTH relationship (pick the closest fit):
- Slim: fabric stays close to the body, narrow chest and sleeves, little excess fabric, follows the torso's natural shape.
- Regular: neutral room, neither tight nor oversized, moderate sleeve and body width, standard length.
- Boxy: wide relative to its length — broad chest, wide sleeves, relatively short body, straight/square sides, often a dropped shoulder. The key relationship is width up while length stays short.
- Oversized: everything is larger — more chest width, longer sleeves, lower shoulders, more body length, more fabric overall. Unlike boxy, oversized can also be long, not just wide. An oversized shirt can also be boxy.

2. LENGTH modifier (apply on top of the above, if it clearly applies):
- Cropped: ends higher than conventional length. Can combine with any of the above (e.g. "slim and cropped", "boxy and cropped").
- Longline: extends substantially farther down the torso than conventional, creating a stronger vertical line, can reduce visual emphasis on the waist.

3. SHOULDER (only mention if visibly distinct from a conventional shoulder seam):
- Dropped shoulder: the shoulder seam sits farther down the upper arm than the natural shoulder, making the shoulder area look wider, softer, and more relaxed. Often paired with oversized or boxy shirts.

4. STRUCTURE:
- Structured: holds its shape, defined shoulders, more rigid fabric, clear edges.
- Relaxed: drapes around the body, softer shoulders, more movement, less defined geometry.

Describe the silhouette as a short comma-separated phrase combining whichever of these dimensions clearly apply (e.g. "boxy, dropped shoulder, relaxed" or "slim, structured" or "oversized, longline, relaxed"). Don't force a dimension that doesn't clearly apply — only include what you can actually see.`

// Detailed silhouette taxonomy for pants. Given to Claude so it evaluates
// leg shape thigh-to-hem, rise, and length using precise vocabulary instead
// of guessing a single vague word.
const PANTS_SILHOUETTE_GUIDANCE = `Evaluate these pants' silhouette using these three dimensions:

1. LEG SHAPE (thigh width -> knee width -> hem width, pick the closest fit):
- Skinny: very close to the legs throughout, strongly emphasizes leg shape.
- Slim: close-fitting but with more room than skinny, leg stays relatively narrow from thigh to ankle.
- Straight: width stays relatively consistent from thigh to knee to ankle, a simple vertical column.
- Relaxed: more room than straight, particularly around seat/hips/thighs, but doesn't dramatically widen at the bottom.
- Tapered: progressively narrower toward the ankle — wide thigh, narrower knee, narrow hem.
- Wide-leg: substantially wider through the entire leg, doesn't narrow toward the ankle, strong vertical volume.
- Baggy: visibly more fabric than necessary to follow the body — can be baggy straight, baggy tapered, or baggy wide-leg, so combine with one of the above if useful.
- Flared: lower leg becomes wider, width concentrated toward the bottom (narrow-ish knee, wide hem).
- Balloon: full thigh and knee that curve outward then narrow back in at a tapered hem, rounded rather than a straight vertical line.

2. RISE (waistband height):
- Low rise: sits lower on the hips, longer-looking torso.
- Mid rise: neutral proportion.
- High rise: sits higher on the torso, shorter-looking torso, longer-looking legs.

3. LENGTH:
- Cropped: ends above the ankle, more separation between pants and footwear.
- Full-length: reaches around the ankle or footwear.
- Stacking: extra length creates folds around the lower leg, adds visual volume without more width.
- Pooling: extra fabric gathers around the footwear for an exaggerated, relaxed lower silhouette.

Describe the silhouette as a short comma-separated phrase combining leg shape + rise + length (e.g. "wide-leg, high-rise, full-length" or "tapered, mid-rise, cropped" or "baggy straight, low-rise, stacking"). Only include what you can actually see.`

// Generic fallback for categories without a detailed taxonomy (shoes,
// jackets, accessories).
const GENERIC_SILHOUETTE_GUIDANCE = `Describe the silhouette in one short word or phrase like baggy, boxy, straight, slim, loose, oversized, cropped, relaxed, or tapered.`

// Only asked when the item doesn't already have a name (see needsName in
// the handler below) — lets someone leave the Add Item form's name field
// blank and still end up with something more useful than the item's bare
// code (e.g. "SH-03") sitting in for a name indefinitely.
//
// The name is DELIBERATELY independent of the separate brand guess below:
// it stays a generic physical description ("Black Leather Sneakers") even
// when the brand is confidently known. An earlier version did the opposite
// — it overrode the name with the identified product whenever one was
// found, so the name became "Nike Air Force 1" — which collapsed two
// distinct fields into one restatement of the same string. Keeping them
// separate means the item detail page can show a real name AND a brand
// line under it, each carrying different information. That's also why the
// brand exclusion below is unconditional now.
const NAME_GUIDANCE = `This item doesn't have a name yet. Suggest a short, natural name for it — the kind of casual label someone would actually use to refer to this piece in their own closet, not a store listing title. Usually 2-4 words, built from whichever of color/material/silhouette are actually distinctive plus the garment type (e.g. "Navy Cotton Tee", "Black Leather Sneakers", "Beige Wide-Leg Trousers", "Olive Bomber Jacket"). Never include the brand in the name, even if you can read it clearly on the item and are asked about it separately below — the brand is stored in its own field and repeating it here would just duplicate it. Also leave out size, and any category label already redundant with the garment type in the name.`

// Only asked for categories/subcategories where a brand is both realistic
// to recognize from a photo and useful to know — see wantsBrand in the
// handler below (currently SHOES, and the ACCESSORIES/HATS and
// ACCESSORIES/FRAGRANCES subcategories). Explicitly prompted to prefer "I
// don't know" over a plausible-sounding guess, since a confidently wrong
// brand is worse than admitting the photo doesn't give enough to go on.
//
// This asks for the BRAND ONLY — deliberately less than the earlier
// version, which asked for brand + specific product/model ("Nike Air
// Force 1"). That had a real failure mode: recognizing the brand and a
// vague "vibe" (a dark, moody bottle) and free-associating to that brand's
// most famous similarly-vibed product, e.g. confidently calling a Yves
// Saint Laurent "Y" bottle "La Nuit de L'Homme" — a different YSL
// fragrance in a different-shaped bottle — just because both read as "dark
// YSL fragrance." Guarding against that required demanding evidence that
// distinguished the exact model from everything else in the same brand's
// catalog, which meant a plainly legible logo STILL had to return nothing.
// Asking only for the brand removes that whole class of error at the
// source: a readable logo is now sufficient rather than merely suggestive,
// so this both fails less and answers more often.
//
// "brandEvidence" is still asked BEFORE "brand" in the JSON shape below,
// for the same forces-actual-looking-before-answering reason as
// "toeAndHeelSides"/"facingDirection" below — it's just a much easier bar
// to clear honestly now, since reading a logo IS the evidence.
const BRAND_GUIDANCE = `Try to identify the BRAND of the item shown — just the brand on its own, e.g. "Nike", "Dior", "New Era", "Yves Saint Laurent". Do NOT name a specific product, model, line, or colorway: "Nike", not "Nike Air Force 1"; "Dior", not "Dior Sauvage". You have two separate ways to reach real confidence, and either alone is enough:
1. You can read or see the brand on the item itself — printed text, a label, an embroidered logo, a sole or box stamp, or an unmistakable logo mark with no text at all (a Nike swoosh, the adidas three stripes, a Jumpman silhouette).
2. The design alone is so distinctive and so strongly associated with one brand that you'd recognize the maker without needing to read anything, and you can point to the specific visual details that make it recognizable — not just a general style or mood.
If neither applies, don't guess. A wrong confident-sounding brand is worse than admitting you can't tell. Note that a brand's sub-label or collaboration line should be reported as the parent brand people would actually say out loud (e.g. "Jordan" or "Nike" rather than "Nike Air Jordan Retro High OG").`

// Only asked for footwear — determines whether the grid/detail display
// needs to flip the front photo so every shoe in the closet visually
// points the same direction (see the "toeAndHeelSides"/"facingDirection"
// fields further down, gated on item.category === "SHOES"). Kept as its
// own guidance block separate from silhouette/color/material since it's
// the one extra question that only applies to one category.
//
// Deliberately asks for a written-out description of which side the toe
// vs. heel/opening is on BEFORE asking for the final LEFT/RIGHT answer
// (see "toeAndHeelSides" in the JSON shape below). Left/right is a classic
// mirror-confusion failure mode for vision models — jumping straight to a
// one-word answer with no reasoning space measurably increases how often
// this gets called backwards on even a clean, unambiguous side-profile
// photo. Forcing the description out first (JSON is generated in order, so
// the description necessarily happens before the model commits to
// "facingDirection") gives the model a chance to actually look instead of
// pattern-matching to a guess.
const FOOTWEAR_ORIENTATION_GUIDANCE = `This is also a photo of footwear. Before answering, carefully identify the shoe's two ends:
- The TOE is the closed, tapered end where the toes sit — the forward-pointing end of the shoe.
- The HEEL/OPENING is the taller end with the ankle collar, where the foot goes in — usually taller and more vertical, often showing a tongue, laces, or an ankle cutout.

In a clean side-profile photo (the most common footwear product shot), these two ends sit on opposite sides of the image. This is easy to get backwards if you rush it — take a moment to actually trace the shoe's outline before deciding.

Then determine which SIDE OF THE IMAGE the TOE (not the heel/opening) is on, from the VIEWER's perspective looking at the photo: "LEFT" or "RIGHT". If the photo is a front-on, back, or top-down view where left/right isn't visually obvious, make your best guess from whatever asymmetry is visible (laces, logo placement, sole curve), and only default to "RIGHT" if you truly cannot tell at all.`

// The item's own color(s) — kept intentionally separate from
// COLOR_THEORY_GUIDANCE/buildPairingGuidance below, which only govern the
// complementary-color *suggestions*. Unlike those, the item's own color(s)
// must come from the exact palette the edit menu's color picker offers
// (see colorOptions/categoryColorOptions in app/item/[id]/page.tsx), so
// whatever the AI decides is always something a person could also pick by
// hand.
function buildItemColorGuidance(availableColorNames: string[]): string {
  return `Determine this item's own color(s) — this is a separate question from the complementary color suggestions described further below, and uses a different, much smaller, fixed list.

Choose the color name(s) ONLY from this exact list (nothing else is valid — do not invent a name that isn't on this list): ${availableColorNames.join(", ")}.

Also determine the item's overall SHADE as a whole: "LIGHT" or "DARK".

Most items are a single solid color — in that case return exactly one entry in "colors". Only return more than one color if it's visually apparent the item is genuinely multi-colored (e.g. a color-blocked shirt, striped pants, two-tone shoes) — don't force a second color onto an item that's basically one color with minor shading/highlights from lighting or fabric texture. If you do return multiple colors, list them in the "colors" array in order from most prominent (covers the most visible surface area) to least prominent.`
}

// Color theory framework given to Claude so complementary color picks are
// reasoned rather than arbitrary. Applies to every category, since color
// relationships aren't garment-shape-specific the way silhouette is.
const COLOR_THEORY_GUIDANCE = `When choosing complementary colors, reason using color theory rather than just guessing colors that "look nice":

- Hue relationships: monochromatic (different shades/tints/tones of the same hue — cohesive, minimal), analogous (hues next to each other on the color wheel — harmonious, low tension), complementary (hues directly opposite on the color wheel, like blue+orange or red+green — high contrast and energetic, best used as a small accent rather than an equal split), split-complementary (the two hues adjacent to the direct complement — strong contrast but easier to balance than direct complementary), and triadic (three hues evenly spaced — very high variety, harder to balance unless desaturated).
- Neutrals: black, white, gray, brown, and muted earth tones don't have strong hue relationships and pair easily with almost anything — always safe options.
- Value: how light or dark a color is. Pairing very different values (e.g. dark charcoal with light cream) creates contrast even within similar hues; similar values create a quieter, blended look.
- Temperature: warm (red, orange, yellow, warm beige, rust, warm brown) vs. cool (blue, blue-green, purple, cool gray). Matching temperature feels cohesive; intentionally mixing temperatures is a deliberate, bolder choice.
- Saturation: vivid/intense colors demand attention, muted/dusty colors are quieter and easier to combine — this is why earth tones work well together.
- Proportion: in a real outfit colors are rarely split evenly. A color that's dominant (worn as the main piece) plays a different role than one used sparingly as an accent — a color can be a great accent even if it would be overwhelming as a dominant piece.`

// Renders the 14 broad families (grouped out of the 17 palette names) as a
// bulleted list for the prompt, marking which ones are neutrals and which
// palette names collapse into a single family.
function buildPairingFamilyList(): string {
  const byFamily = new Map<string, string[]>()
  for (const name of Object.keys(ITEM_COLOR_PALETTE)) {
    const family = resolveFamily(name)
    byFamily.set(family, [...(byFamily.get(family) ?? []), name])
  }

  return Array.from(byFamily.entries())
    .map(([family, names]) => {
      const label = names.join(" / ")
      const neutral = NEUTRAL_FAMILIES.has(family) ? " — neutral" : ""
      const oneOf =
        names.length > 1 ? ` (one single family: pick at most ONE of these, never both)` : ""
      return `- ${label}${neutral}${oneOf}`
    })
    .join("\n")
}

// The pairing recommendation model. Replaces an earlier rule that asked
// for a free-form hex plus a name "simplified" down to one of eleven base
// words — which actively destroyed the distinctions that matter here, since
// it mapped cream to "white", navy to "dark blue", olive to "dark green"
// and burgundy to "dark red". Every item ended up suggesting the same
// handful of primaries.
//
// Three things changed. (1) Suggestions are now chosen from the SAME fixed
// palette the item's own colors use, so a suggestion is always a color the
// closet can actually contain, and the swatch hex is looked up rather than
// invented — no more near-duplicate shades of the same idea. (2) The
// question is DIRECTIONAL: it asks what to wear on the REST of the body
// given where this piece sits, so gray pants and a gray jacket produce
// different answers. (3) Answers are TIERED rather than a flat ranked list,
// so an excellent pairing is distinguishable from a merely acceptable one.
function buildPairingGuidance(category: string, itemPosition: string): string {
  return `Now recommend colors for OTHER pieces to wear WITH this item — the "complementaryColors" field.

Answer this question: "what colors of other clothing would most likely make a cohesive outfit with this piece?" — NOT "what colors technically match this color on a color wheel?" You are a recommendation model here, not a color-wheel lookup.

THE FAMILIES. Every suggestion must be one of these broad color families, written EXACTLY as spelled here (these are the same names the closet itself uses, so a suggestion is always a real, pickable color):
${buildPairingFamilyList()}

Think in families, not exact shades. A specific shade maps into its family: charcoal/slate map to GRAY, ivory/ecru map to CREAM, sand/khaki/camel map to BEIGE or TAN, midnight blue maps to NAVY, military green maps to OLIVE, wine maps to MAROON. Never suggest a shade name that isn't on the list above, and never suggest two colors from the same family.

DIRECTION MATTERS. This item is ${category}, worn on ${itemPosition}. Your suggestions are colors for the OTHER pieces of the outfit — mostly the parts of the body this item does NOT cover. The same color in a different position is a different recommendation: colors low on the body can be heavier and darker without dominating, colors on the upper body sit closer to the face and read as more prominent, and an outermost layer frames everything worn under it. Rank with that in mind rather than producing a symmetric "these two colors go together" answer.

TIERS, NOT PASS/FAIL. Give each suggestion a "tier" of exactly "EXCELLENT", "STRONG", or "GOOD":
- EXCELLENT — you'd confidently recommend this to anyone; hard to get wrong.
- STRONG — clearly works, a very safe choice.
- GOOD — genuinely works but is more situational, or asks a bit more of the rest of the outfit.
Order the array best-first, so all EXCELLENT entries come before STRONG, and STRONG before GOOD. Don't give everything the same tier — the point is to separate the excellent pairings from the merely acceptable ones.

NEUTRALS VS. ACCENTS. The families marked neutral above carry no strong hue commitment, so they pair broadly and should make up most of your suggestions for most items — they're what lets the rest of an outfit stay calm. Saturated families (blue, green/olive, red/burgundy, orange, yellow, purple, pink) have to earn their place: be more selective with them, and weigh how dark, how vivid, and how visually dominant the result would be. A saturated color that would overwhelm as a large piece can still be a fine accent.

DON'T OVERMATCH. Do not ask another piece to repeat this item's exact color. The goal is harmony, not repetition. Dark gray pants with a cream hoodie and black shoes is an excellent outfit even though nothing matches; an olive jacket over a black shirt with washed-black pants and black boots is excellent because neutrals support the one muted color. You may include this item's own family when it genuinely reads well — that's common for neutrals, where repeating black or gray across pieces looks deliberate — but never include it merely because it's an exact match.

PALETTE STRUCTURE. Picture the finished outfit: one dominant color, one or more supporting neutrals, and optionally one accent. Favor suggestions that fit that shape. Avoid combinations where several highly saturated colors compete for attention. This is a guideline about balance, not a strict numeric split.

HOW MANY. Return between ${MIN_COMPLEMENT_COUNT} and ${MAX_COMPLEMENT_COUNT} entries — only the strongest families for this specific piece, one entry per family, no near-duplicates. Fewer strong suggestions beats padding the list with weak ones.`
}

// Material is a separate field from silhouette/color. Applies to every
// category since fabric/material questions come up for shoes and
// accessories too, not just shirts and pants.
const MATERIAL_GUIDANCE = `Estimate the most likely material based on visual cues in the photo — texture, weave, sheen, thickness, drape, and stitching. Keep the answer short (one or two words). Depending on the item, this could be a fabric (cotton, denim, wool, linen, corduroy, fleece, knit, polyester, nylon, silk, satin, canvas) or a non-fabric material for things like shoes and accessories (leather, suede, rubber, metal, plastic, wood). A confident best guess is fine even when the exact material isn't 100% certain from a photo alone.`

// The item's own color palette — kept in sync with colorOptions in
// app/item/[id]/page.tsx. The AI picks names only from this list (see
// buildItemColorGuidance above); the hex values below are then looked up
// by name rather than trusting an AI-generated hex, so the saved swatch
// always matches exactly what picking that same color in the edit menu
// would show.
const ITEM_COLOR_PALETTE: Record<string, string> = {
  BLACK: "#000000",
  WHITE: "#FFFFFF",
  GRAY: "#808080",
  NAVY: "#1F2A44",
  BLUE: "#2563EB",
  RED: "#DC2626",
  MAROON: "#7F1D1D",
  PINK: "#EC4899",
  ORANGE: "#EA580C",
  YELLOW: "#EAB308",
  GREEN: "#16A34A",
  OLIVE: "#6B7B3A",
  PURPLE: "#7C3AED",
  BROWN: "#7C4A2D",
  TAN: "#D2B48C",
  BEIGE: "#E8DCC8",
  CREAM: "#F5F0E6",
}

// Extra item colors only offered for specific categories — mirrors
// categoryColorOptions in app/item/[id]/page.tsx (currently just the
// metallic tones for ACCESSORIES).
const CATEGORY_ITEM_COLOR_PALETTE: Partial<Record<string, Record<string, string>>> = {
  ACCESSORIES: {
    GOLD: "#D4AF37",
    SILVER: "#C0C0C0",
  },
}

// Groups the 17 palette names above into the 14 broad COLOR FAMILIES the
// pairing model reasons in. This is the whole point of the family layer:
// BEIGE and TAN are not two different recommendations, they're one
// "beige/tan" idea, and showing both would be exactly the near-duplicate
// clutter the pair list is supposed to avoid. Same for GREEN/OLIVE and
// RED/MAROON.
//
// Note this deliberately does NOT collapse further: CREAM stays distinct
// from WHITE, NAVY from BLUE, GRAY from BLACK. An earlier version of the
// naming rules mapped exactly those distinctions away (cream -> "white",
// navy -> "dark blue", olive -> "dark green", burgundy -> "dark red"),
// which is what made every suggestion list read as the same handful of
// primary colors. Cream vs. white and navy vs. blue are genuinely
// different outfit decisions and are kept apart on purpose.
//
// Every name in ITEM_COLOR_PALETTE must appear here — resolveFamily
// falls back to the raw name if one is ever missed, but the pairing
// dedupe below is only correct when this stays complete.
const COLOR_FAMILY: Record<string, string> = {
  BLACK: "BLACK",
  WHITE: "WHITE",
  GRAY: "GRAY",
  CREAM: "CREAM",
  BEIGE: "BEIGE_TAN",
  TAN: "BEIGE_TAN",
  BROWN: "BROWN",
  BLUE: "BLUE",
  NAVY: "NAVY",
  GREEN: "GREEN_OLIVE",
  OLIVE: "GREEN_OLIVE",
  RED: "RED_BURGUNDY",
  MAROON: "RED_BURGUNDY",
  ORANGE: "ORANGE",
  YELLOW: "YELLOW",
  PURPLE: "PURPLE",
  PINK: "PINK",
}

// Families that behave as neutrals: they carry no strong hue commitment,
// so they pair broadly and can repeat across several pieces of one outfit
// without competing. The pairing guidance leans on this to justify why a
// neutral can be suggested for almost any item while a saturated family
// has to earn its place.
const NEUTRAL_FAMILIES = new Set(["BLACK", "WHITE", "GRAY", "CREAM", "BEIGE_TAN", "BROWN"])

// Where each category sits in a finished outfit. This is what makes the
// recommendations DIRECTIONAL rather than a symmetric "these two colors go
// together" lookup — a gray piece worn on the lower body is a different
// pairing problem from the same gray worn as an outer layer, because the
// candidate colors being suggested are for different parts of the body and
// carry different visual weight.
const OUTFIT_POSITION: Record<string, string> = {
  SHIRTS: "the upper body, as the base layer",
  PANTS: "the lower body",
  SHOES: "the feet, grounding the outfit",
  OUTERWEAR: "the upper body, as the outermost layer worn over a top",
  // Phrased to read correctly after "worn on ..." in buildPairingGuidance,
  // same as every other entry here — "worn on a small accent" doesn't parse.
  ACCESSORIES: "the body as a small accent, covering very little surface area",
}

// Resolves a palette color name to its broad family key.
function resolveFamily(paletteName: string): string {
  return COLOR_FAMILY[paletteName] ?? paletteName
}

// Resolves an AI-returned color name against the fixed palette, case- and
// whitespace-insensitively, returning the palette's canonical (uppercase)
// name + hex — or null if it's not actually on the list, so a hallucinated
// name can be filtered out rather than saved as-is.
function resolveItemColor(
  rawName: string,
  availablePalette: Record<string, string>
): { name: string; hex: string } | null {
  const normalized = String(rawName).trim().toUpperCase()
  const hex = availablePalette[normalized]
  if (!hex) return null
  return { name: normalized, hex }
}

// ---- Fragrance profile -------------------------------------------------
// Only asked for ACCESSORIES/FRAGRANCES. A perfume has no useful silhouette
// or material, so the item detail page replaces those rows with the notes /
// performance / when-to-apply data produced here.

// The fixed option lists for WHEN TO APPLY. Each category's `options` is the
// complete menu; the AI returns a SELECTION from it, and the UI shows the
// selection collapsed with the unselected remainder revealed on click —
// which is why these have to be a closed list rather than free text, and why
// the exact strings matter.
//
// MUST stay in sync with WHEN_TO_APPLY_CATEGORIES in
// app/item/[id]/page.tsx, which renders the same options. The resolver below
// throws out anything not on these lists, so a drift between the two files
// shows up as missing options in the expanded view rather than as a crash.
// `maxPicks` is a CEILING, not a target — see the selectivity rule in
// FRAGRANCE_GUIDANCE. The numbers were raised (season 2->3, setting 3->5,
// outfit 3->4) because the old ones were tighter than real answers: a genuinely
// three-season fragrance couldn't say so, and a versatile daily wearer that
// suits everyday, work, casual, a date and going out had to drop two of the
// five. A cap that forces a true recommendation to be trimmed isn't
// selectivity, it's distortion — selectivity is the model declining to pad,
// which the prompt asks for directly.
const FRAGRANCE_WHEN_CATEGORIES: {
  key: "timeOfDay" | "season" | "temperature" | "setting" | "outfit"
  label: string
  options: string[]
  maxPicks: number
}[] = [
  {
    key: "timeOfDay",
    label: "TIME OF DAY",
    options: ["Morning", "Afternoon", "Late Afternoon", "Evening", "Night", "All Day"],
    maxPicks: 3,
  },
  {
    key: "season",
    label: "SEASON",
    options: ["Spring", "Summer", "Fall", "Winter"],
    maxPicks: 3,
  },
  {
    key: "temperature",
    label: "TEMPERATURE",
    options: ["Hot", "Warm", "Mild", "Cool", "Cold"],
    maxPicks: 3,
  },
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
    maxPicks: 5,
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
    maxPicks: 4,
  },
]

const PROJECTION_LEVELS = ["STRONG", "MEDIUM", "LOW"]

// Its own list rather than read off FRAGRANCE_WHEN_CATEGORIES so the ranking
// step below stays readable, but it must match that entry's options exactly —
// resolveSeasonRanking compares selections against both.
const SEASON_OPTIONS = ["Spring", "Summer", "Fall", "Winter"]

// Ordered best-first; the order is load-bearing, since resolved season picks
// are sorted by it so IDEAL seasons lead. Only the first two are selectable —
// POSSIBLE means "wearable but not a natural choice", which is exactly the
// non-recommendation that made the old output useless, where a fragrance
// quietly accumulated seasons it merely tolerated.
const SEASON_RANKS = ["IDEAL", "GOOD", "POSSIBLE", "NO"]
const SELECTABLE_SEASON_RANKS = ["IDEAL", "GOOD"]

// The fragrance prompt. The framing matters as much as the field list here:
// the failure mode this is written against is treating each field as an
// independent tag lookup — "strong projection, therefore night" — instead of
// reading the scent as one character and letting every recommendation follow
// from it. Hence the explicit worked counter-example, and the explicit
// instruction that outfit aesthetics come from how the fragrance SMELLS, not
// from what the bottle looks like (the bottle is the only thing actually
// visible in the photo, so that's the pull to resist).
const FRAGRANCE_GUIDANCE = `This item is a FRAGRANCE. Identify it from the bottle, then describe the SCENT — not the bottle. Everything below is about how it smells and how it's worn.

IDENTIFY IT FIRST. Read the bottle and name the specific fragrance in "fragranceId" — brand plus the specific name and concentration where you can tell, e.g. "Creed Aventus", "Yves Saint Laurent Y Eau de Parfum", "Dior Sauvage Elixir". In "fragranceIdEvidence", write the actual text or design detail you used. If the bottle doesn't give you enough to name a specific fragrance, set "fragranceId" to null — a brand on its own is not enough, because two fragrances from one house smell nothing alike.

THEN DECIDE IF YOU ACTUALLY KNOW IT. "notesKnown" is a separate, honest question: do you genuinely recall THIS specific fragrance's published note pyramid? Not "can you produce something plausible for a fragrance like this" — do you actually know it. Answer false whenever the honest answer is "I'd be reconstructing this."

This is the single most important instruction here. A note pyramid is a factual claim about a specific product, and nothing in the photo contains the answer — so if you don't recall it, there is nothing to fall back on but invention, and the person reading it has no way to tell the difference. Wrong notes are worse than no notes.

In particular, do NOT assemble a pyramid out of notes that merely suit the style of bottle, the brand's house style, or "what a modern masculine fragrance smells like." A previous version of this prompt produced the exact same heart — iris, ambroxan, cedar — for two completely unrelated fragrances, and missed apple and ginger, the two most distinctive notes in one of their openings. If what you're about to write would fit a dozen other bottles equally well, that is the signal that you're generating rather than recalling: set "notesKnown" to false instead.

NOTES. Only if "notesKnown" is true, break the scent into its pyramid in "fragranceNotes": "top" (the opening, first 15-30 minutes), "middle" (the heart, once it settles), "base" (what's left hours in). Give 2-4 short note names per tier, most prominent first, lowercase — e.g. "bergamot", "blackcurrant", "birch", "oakmoss", "vanilla". Plain note names only, no sentences or adjectives like "fresh" or "warm". If "notesKnown" is false, set "fragranceNotes" to null and leave it at that — that's a perfectly good answer and the app displays it honestly.

CHARACTER FIRST — DO THIS BEFORE ANY RECOMMENDATION. Fill in "fragranceFamily" (the olfactory family, e.g. "aromatic fougère", "woody amber", "fresh citrus aromatic", "oriental gourmand") and "fragranceCharacter" (two or three sentences on how the whole thing actually reads).

"fragranceCharacter" is the piece everything else hangs off, so write it properly. Cover: where it sits on fresh vs. warm, clean vs. dark, dry vs. sweet, light vs. heavy; how it develops from the opening through the drydown and whether the base takes over or stays a backdrop; how loud and how mature it reads; and the kind of person and occasion it suggests. Then derive every recommendation below from THAT paragraph, not from scanning the note list.

The distinction that matters most is between what a fragrance CONTAINS and what it IS. Notes are ingredients, not conclusions. A fresh aromatic can hold tonka, amberwood, cedar and vetiver in its base and still be, as a whole, a bright versatile daytime scent — because those materials are there to give a clean composition depth and staying power, not to make it a heavy winter fragrance. Judge the finished impression.

PERFORMANCE — THREE DIFFERENT THINGS, ANSWERED IN THIS ORDER.

1. "longevity" — how long the fragrance is detectable on skin AT ALL, from spray to nothing. Give an hour range, e.g. "8-10 HOURS". Answer this FIRST, before the two fields below, so you have the full lifespan in view before you carve the projecting part out of it.

2. "projection" — how far it radiates at its peak. Exactly one of ${PROJECTION_LEVELS.join(", ")}, calibrated by how far away someone notices it unprompted:
- STRONG — fills a room; noticed by people who never came near you; a clear scent bubble well past arm's length.
- MEDIUM — noticed at conversational distance, a few feet; people you sit or stand with will comment on it.
- LOW — sits close to the skin; only noticed by someone leaning in or hugging you.
Judge this against what wearers consistently report. Do NOT hedge to MEDIUM because it feels like the safe answer — many well-regarded modern designer fragrances genuinely are STRONG performers, and calling one of those MEDIUM is just as wrong as calling a skin scent STRONG. Pick the level the consensus actually describes.

3. "projectionTime" — how long that radiating lasts. Measure from application to the point it becomes a SKIN SCENT (still there, but only noticeable to someone close). This is the WHOLE projecting phase, not just the loud opening blast: a fragrance that fills a room for two hours and is still noticeable across a desk for another three has roughly five hours of projection, not two. Give an hour range in hours, e.g. "4-6 HOURS".

The relationship between them matters. Projection time is always SHORTER than longevity, usually meaningfully so — a typical well-performing modern EDP might last 8-10 hours while projecting for 4-6, and a light fresh EDT might last 4-5 hours while projecting for 1-2. Never report longevity in "projectionTime"; the app rejects any answer where projection time exceeds longevity.

Both duration fields must be actual hour ranges — a word like "moderate" or "medium" is not an answer to either, and will be rejected. Estimate from what wearers actually report, take the consensus where reports vary rather than the most flattering or most extreme figure, and ignore the brand's own performance claims, which are advertising.

SEASON — RANK ALL FOUR INDEPENDENTLY. In "seasonRanking", give every one of Spring, Summer, Fall, Winter exactly one of:
- "IDEAL" — this is what the fragrance was made for; it works beautifully.
- "GOOD" — clearly works well.
- "POSSIBLE" — wearable, but not a natural choice; you wouldn't reach for it first.
- "NO" — actively works against the fragrance.
Then in "whenToApply.season", select ONLY seasons you ranked IDEAL or GOOD, strongest first. A season ranked POSSIBLE must not be selected — "you could wear it then" is not a recommendation. The app enforces this, so a POSSIBLE season will be stripped from your answer anyway.

WHEN TO APPLY. For the remaining categories, select the options that genuinely fit, using the exact spellings shown, strongest first.

${FRAGRANCE_WHEN_CATEGORIES.map(
    (c) =>
      `- ${c.key} (${c.label}) — at most ${c.maxPicks} of: ${c.options.join(", ")}`
  ).join("\n")}

TEMPERATURE. Think about what heat and cold actually do to this specific composition: heat amplifies projection and pushes sweetness and heaviness forward, cold mutes projection and can flatten delicate citrus and aromatics. A loud fragrance is not automatically a cold-weather fragrance — if the composition is fresh enough, strong projection in the heat is a feature. Conversely a dense, sweet, resinous scent can become cloying in heat no matter how well-made it is.

TIME OF DAY. Judge the personality and the context, not the volume. Strong projection does not mean night. Sweetness does not mean night. A dark base does not mean night. A loud fresh citrus-aromatic is a daytime office scent; a quiet skin-scent amber can be perfect for an intimate evening. A genuinely versatile fragrance should get the full daytime span it deserves — "Morning · Afternoon · Evening" is a perfectly good answer and is more useful than artificially narrowing to one slot.

SETTING. Weigh how the fragrance behaves around other people — a loud one is a liability in a shared office or a classroom regardless of how good it is. Do NOT pick "Formal" because the fragrance is expensive or the house is prestigious; formality is about how the scent reads, not what it cost.

OUTFIT. Judge which outfit AESTHETICS match the fragrance's identity — the impression it creates. Fresh, clean, modern compositions tend toward Minimal, Clean / Refined, Smart Casual, Elevated Casual. Dark, warm, sweet ones tend toward Dark / Edgy, Luxury, Formal, evening-leaning looks. Dry rugged woods tend toward Workwear, Rugged, Casual. Those are illustrations, not rules — judge this fragrance. And do NOT base any of it on the bottle's color or packaging: a dark bottle does not mean "Dark / Edgy", a minimal bottle does not mean "Minimal", and an expensive one does not mean "Luxury".

NEVER USE THESE SHORTCUTS. Each of these is wrong often enough to be worse than useless: vanilla means winter; tonka means winter; amber means winter; woods mean fall or winter; citrus means summer; aquatic means summer; strong projection means night; sweet means night; fresh means summer only; expensive means formal. Any of these characteristics can INFORM a judgement, but none of them decides one on its own, and a recommendation that could have been produced by applying one of these rules to a single note is a recommendation you have not actually thought about.

BEST USE CASES, NOT POSSIBLE ONES. The question you are answering is "under what conditions would this genuinely be one of my best choices?" — not "when could this technically be worn?" Before including anything, ask whether it would be among the first situations an experienced wearer would reach for this fragrance. If not, leave it out.

That means the per-category numbers above are CEILINGS, not targets, and you should usually come in under them. Two confident picks beat five hedged ones. A fragrance that is excellent in spring, summer and fall should say exactly that and stop — adding winter because it's survivable indoors makes the whole recommendation less useful, because it tells the reader nothing about when the fragrance is actually good.

THINK ABOUT IT AS ONE FRAGRANCE. None of these fields is an independent tag. Season, temperature, time of day, setting and outfit should all be recognisably the same fragrance described from five angles, and all of them should follow from the character paragraph you wrote at the top. If your season answer and your outfit answer imply two different fragrances, one of them is wrong.`

// Ordered strongest-first — also used to sort the resolved list below.
const PAIR_TIERS: string[] = ["EXCELLENT", "STRONG", "GOOD"]

// Turns the model's raw "complementaryColors" array into entries safe to
// save. This is where the family model is actually ENFORCED, rather than
// merely requested in the prompt:
//
// - The name is resolved against the shared palette and the hex comes from
//   that lookup, never from the model. A suggestion is therefore always a
//   color the closet can really contain, and its swatch is pixel-identical
//   to the same color in the edit menu's picker. A hallucinated name (or
//   an old free-form one like "dark teal") resolves to nothing and is
//   dropped instead of being saved as an unpickable shade.
// - At most one entry survives per FAMILY, so BEIGE and TAN — or GREEN and
//   OLIVE — can't both take up a swatch saying near enough the same thing.
// - Tiers are normalized, with anything unrecognized treated as the weakest
//   tier rather than being trusted or discarded.
// - The list is stable-sorted by tier, so even if the model returns them
//   slightly out of order, a GOOD swatch can never sit ahead of an
//   EXCELLENT one. Stability means ties keep the model's own ranking.
//
// Capped at MAX_COMPLEMENT_COUNT; the caller enforces the lower bound,
// since too FEW resolved entries is a retry-worthy problem while too many
// is just trimming.
function resolvePairColors(raw: unknown): { name: string; hex: string; tier: string }[] {
  if (!Array.isArray(raw)) return []

  const seenFamilies = new Set<string>()
  const resolved: { name: string; hex: string; tier: string }[] = []

  for (const entry of raw) {
    // Tolerates both { name, tier } objects and a bare string, so a model
    // that forgets the wrapper still contributes a usable suggestion.
    const isObject = entry !== null && typeof entry === "object"
    const rawName = isObject ? (entry as any).name : entry
    if (typeof rawName !== "string") continue

    const color = resolveItemColor(rawName, ITEM_COLOR_PALETTE)
    if (!color) continue

    const family = resolveFamily(color.name)
    if (seenFamilies.has(family)) continue
    seenFamilies.add(family)

    const rawTier = isObject ? (entry as any).tier : undefined
    const normalizedTier = String(rawTier ?? "").trim().toUpperCase()
    const tier = PAIR_TIERS.includes(normalizedTier) ? normalizedTier : "GOOD"

    resolved.push({ name: color.name, hex: color.hex, tier })
  }

  resolved.sort((a, b) => PAIR_TIERS.indexOf(a.tier) - PAIR_TIERS.indexOf(b.tier))
  return resolved.slice(0, MAX_COMPLEMENT_COUNT)
}

// Normalizes one tier of the scent pyramid: short lowercase note names only,
// deduped, capped. Anything that isn't a plain string is dropped, and an
// over-long entry is discarded rather than truncated — a model that answers
// "warm woody base with hints of amber" has written a description, not a
// note name, and silently trimming it would save a fragment mid-word.
function resolveNoteTier(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const notes: string[] = []

  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const note = entry.trim().toLowerCase()
    if (!note || note.length > 24) continue
    if (seen.has(note)) continue
    seen.add(note)
    notes.push(note)
    if (notes.length >= 4) break
  }

  return notes
}

// Constrains one WHEN TO APPLY category to its fixed option list. Matching is
// case- and whitespace-insensitive but the CANONICAL option string is what
// gets stored, so the UI can compare selections against its own copy of the
// list by equality — that comparison is what decides which options render as
// selected vs. as the dimmed remainder, so a stored "late afternoon" that
// didn't round-trip through the canonical casing would silently show up as
// neither.
//
// Order is the model's own (strongest first) and is preserved; extras beyond
// maxPicks are dropped from the end.
function resolveWhenCategory(raw: unknown, options: string[], maxPicks: number): string[] {
  if (!Array.isArray(raw)) return []

  const canonicalByNormalized = new Map(options.map((o) => [o.trim().toLowerCase(), o]))
  const seen = new Set<string>()
  const picks: string[] = []

  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const canonical = canonicalByNormalized.get(entry.trim().toLowerCase())
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    picks.push(canonical)
    if (picks.length >= maxPicks) break
  }

  return picks
}

// How many searches the research pass may run. Each one bills separately, so
// this is the per-fragrance cost ceiling: enough for identification plus a
// couple of angles (performance, seasonality), not enough to wander.
const FRAGRANCE_RESEARCH_MAX_SEARCHES = 5

const FRAGRANCE_RESEARCH_PROMPT = `Identify the fragrance in this photo, then research it on the web and report what you find. Do not answer from memory — search, and report what the sources actually say.

First identify it from the bottle: brand, specific name, and concentration (EDT vs EDP vs Parfum matters enormously for performance, so pin it down if the bottle shows it). If the bottle genuinely doesn't identify a specific fragrance, say exactly that and stop — do not research a guess.

Then search for, and report:
1. The published note pyramid — top, middle/heart, base.
2. Longevity — how many hours it lasts on skin, as reported by wearers.
3. Sillage / projection — how strongly it radiates, and how long it keeps projecting before sitting close to the skin. Keep these separate if the sources do.
4. Seasonality and temperature — which seasons and weather wearers actually reach for it in.
5. Typical occasions — office, casual, evening, formal, and whether it is considered versatile or situational.
6. Its overall character in wearers' words — fresh, sweet, dark, heavy, clean, loud, mature, and so on.

WHICH SOURCES TO TRUST. Prefer community rating aggregates with many votes (Parfumo, Basenotes and similar) over any single reviewer, because one person's skin and nose is not a consensus. Where a site publishes vote counts or numeric ratings, quote the number and the sample size — "sillage 5.9/10 from 237 votes" is far more useful to me than "moderate sillage".

Cross-check several independent sources. Where they disagree, say so explicitly and give the range and where the weight of opinion sits, rather than silently picking one. Enthusiast reviewers systematically rate performance higher than large community votes do; when those two conflict, report both.

IGNORE THE BRAND'S OWN CLAIMS. Marketing copy about lasting "up to 12 hours" is advertising, not data. Do not repeat it as a finding.

Write the findings as compact plain notes with a source for each. No JSON, no preamble, no conclusion — just the findings. If a search turns up nothing usable for one of the points above, write "no reliable data found" for that point rather than filling it in from memory.`

// Runs ONE search-grounded call to gather published facts about the bottle,
// whose findings are then handed to the structured analysis as context.
//
// Deliberately a separate call from the JSON analysis, for two reasons:
//
// 1. Cost. This sits OUTSIDE the retry loop, so a response that fails
//    validation re-runs only the cheap structured call. Folding search into
//    the analysis call would re-search on every attempt — up to MAX_ATTEMPTS
//    times — and searches bill per use.
// 2. Parsing. A search-enabled response interleaves `text`, `server_tool_use`
//    and `web_search_tool_result` blocks, and the model narrates its searching
//    in prose before answering. The analysis call must return strictly
//    parseable JSON, so keeping it tool-free means the response shape stays
//    exactly what the parser already expects.
//
// Returns "" on any failure. Research is an ENHANCEMENT — if search is
// unavailable, the key lacks permission for it, or nothing useful comes back,
// analysis still proceeds on the model's own knowledge rather than the item
// failing to analyze at all.
async function researchFragrance(
  apiKey: string,
  base64Image: string,
  contentType: string
): Promise<string> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FRAGRANCE_MODEL,
        max_tokens: 3000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: FRAGRANCE_RESEARCH_MAX_SEARCHES,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
              { type: "text", text: FRAGRANCE_RESEARCH_PROMPT },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      console.warn(`Fragrance research skipped — search call failed: ${await response.text()}`)
      return ""
    }

    const data = await response.json()

    // Same all-text-blocks collection as the analysis call: this response
    // carries tool-use and tool-result blocks between the prose, and the
    // findings themselves can be split across several text blocks.
    const findings = Array.isArray(data.content)
      ? data.content
          .filter((block: any) => block?.type === "text" && typeof block.text === "string")
          .map((block: any) => block.text)
          .join("\n")
          .trim()
      : ""

    return findings
  } catch (err) {
    console.warn("Fragrance research skipped — search call threw:", err)
    return ""
  }
}

// Parses a duration answer into a real hour range, or null if it isn't one.
//
// This exists because the field used to accept any non-empty string, so a
// model that answered "MEDIUM" — or reported longevity, or wrote "moderate" —
// had that stored and printed into the PERFORMANCE row verbatim. A duration
// field that accepts words isn't validated at all.
//
// Deliberately permissive about SHAPE and strict about MEANING: "4-6 hours",
// "about 4 to 6 hrs" and "4\u20136 HOURS" (en dash) all parse, since arguing with
// phrasing just burns retries, while anything without a number and an hour
// unit is rejected outright. The canonical text is what gets stored, so the
// panel renders one consistent format however the answer was phrased.
function parseHourRange(raw: unknown): { low: number; high: number; text: string } | null {
  const value = String(raw ?? "").trim().toLowerCase()
  if (!value) return null

  // Must actually be expressed in hours — this is the check that rejects
  // "MEDIUM" and friends.
  if (!/\bh(?:ou)?rs?\b/.test(value)) return null

  const numbers = value.match(/\d+(?:\.\d+)?/g)
  if (!numbers || numbers.length === 0) return null

  const low = parseFloat(numbers[0])
  const high = numbers.length > 1 ? parseFloat(numbers[1]) : low

  // Catches nonsense that would still match the pattern: a reversed range, a
  // zero, or a figure no fragrance plausibly reaches.
  if (!(low > 0) || !(high >= low) || high > 24) return null

  const text =
    low === high ? `${low} HOUR${low === 1 ? "" : "S"}` : `${low}-${high} HOURS`

  return { low, high, text }
}

// Normalizes the per-season ranking into { Spring: "IDEAL", ... }. Returns
// null unless all four seasons carry a recognized rank, which makes the
// ranking step mandatory rather than optional — the whole point is to force an
// independent verdict on each season BEFORE any get selected, so a partially
// filled ranking is a failed attempt, not something to paper over.
function resolveSeasonRanking(raw: unknown): Record<string, string> | null {
  if (raw === null || typeof raw !== "object") return null

  const canonicalSeason = new Map(SEASON_OPTIONS.map((s) => [s.trim().toLowerCase(), s]))
  const ranking: Record<string, string> = {}

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const season = canonicalSeason.get(String(key).trim().toLowerCase())
    if (!season) continue
    const rank = String(value ?? "").trim().toUpperCase()
    if (!SEASON_RANKS.includes(rank)) continue
    ranking[season] = rank
  }

  return SEASON_OPTIONS.every((s) => ranking[s]) ? ranking : null
}

// Where "don't recommend a season it's merely wearable in" stops being a
// request and becomes a rule. The model both ranks every season AND picks
// some, so the two can disagree — and the disagreement is precisely the old
// failure mode, where a fragrance was honestly judged POSSIBLE for winter and
// then listed winter anyway. Picks are intersected with the ranking, so only
// IDEAL and GOOD survive.
//
// Ordering is done in two passes, because the season row is the one place
// where "strongest first" and "reads correctly" disagree. Rank decides WHICH
// seasons survive the cap — when more than maxPicks qualify, the weakest go.
// But the survivors are then put back into calendar order for display, since
// seasons are a cycle everyone reads in a fixed sequence: a spring/summer/fall
// fragrance sorted by strength renders as "Spring · Fall · Summer", which
// looks like a bug rather than a ranking. The strength information is already
// carried by which seasons appear at all.
function resolveSeasonPicks(
  rawPicks: unknown,
  ranking: Record<string, string>,
  maxPicks: number
): string[] {
  const picked = resolveWhenCategory(rawPicks, SEASON_OPTIONS, SEASON_OPTIONS.length)
  const allowed = picked.filter((season) =>
    SELECTABLE_SEASON_RANKS.includes(ranking[season])
  )

  // Strongest first, then trim to the cap — stable, so equal ranks keep the
  // model's own order and the tie-break stays its judgement rather than ours.
  const strongestFirst = [...allowed].sort(
    (a, b) => SEASON_RANKS.indexOf(ranking[a]) - SEASON_RANKS.indexOf(ranking[b])
  )
  const kept = strongestFirst.slice(0, maxPicks)

  return SEASON_OPTIONS.filter((season) => kept.includes(season))
}

// Assembles the fragrance profile from a raw candidate response.
//
// Two independent confidence gates, because they're genuinely different
// questions and an earlier version conflated them:
//
//   identified — could it name the specific fragrance off the bottle? If not,
//     there's no subject to describe, and nothing here is saved.
//   notesKnown — does it actually recall THIS fragrance's published pyramid?
//     If not, the notes come back absent and everything ELSE (projection,
//     when to apply) is still kept, since those follow from knowing which
//     fragrance it is and roughly what family it's in.
//
// The gates exist because the previous version had no way to express "I don't
// know": empty notes failed validation, which retried, which pressured the
// model into inventing a pyramid — reliably producing the same generic
// modern-masculine heart for unrelated fragrances. Declining is now a
// first-class, non-retryable outcome. `notesDeclined` is reported back so the
// caller can tell "the model passed" apart from "the model returned garbage",
// and only retry the second.
function resolveFragranceProfile(candidate: any): {
  fragranceNotes: { top: string[]; middle: string[]; base: string[] } | null
  notesDeclined: boolean
  longevity: string
  projectionTime: string
  projection: string
  whenToApply: Record<string, string[]>
} | null {
  // A brand alone is deliberately not enough (see FRAGRANCE_GUIDANCE) — two
  // fragrances from one house smell nothing alike, so "Yves Saint Laurent"
  // can't ground any of what follows.
  const identified = String(candidate?.fragranceId ?? "").trim().length > 0
  if (!identified) return null

  const notesKnown = candidate?.notesKnown === true

  const rawNotes = candidate?.fragranceNotes ?? {}
  const resolvedNotes = {
    top: resolveNoteTier(rawNotes?.top),
    middle: resolveNoteTier(rawNotes?.middle),
    base: resolveNoteTier(rawNotes?.base),
  }
  const everyTierHasNotes =
    resolvedNotes.top.length > 0 && resolvedNotes.middle.length > 0 && resolvedNotes.base.length > 0

  // Claiming knowledge and then failing to produce a full pyramid is a
  // malformed response, not a decline — that one IS worth a retry, so it
  // fails the whole profile rather than quietly downgrading to "unknown".
  if (notesKnown && !everyTierHasNotes) return null

  const projection = PROJECTION_LEVELS.includes(String(candidate?.projection ?? "").trim().toUpperCase())
    ? String(candidate.projection).trim().toUpperCase()
    : ""

  // Longevity is both displayed (it's the PERFORMANCE row's second stat) and
  // load-bearing for validation: asking for it FIRST is what forces the model
  // to settle "how long is this detectable at all" before answering "how long
  // does it throw", which is the conflation that produced wrong numbers. That
  // ordering is why the two can be checked against each other below.
  const longevityRange = parseHourRange(candidate?.longevity)
  const projectionRange = parseHourRange(candidate?.projectionTime)
  if (!longevityRange || !projectionRange) return null

  // Projection must be strictly shorter than longevity, not merely not-longer.
  // Equal is the tell for the exact conflation this whole field split exists
  // to catch: a model that hasn't separated the two concepts puts the same
  // range in both. And equality isn't physically real either — projection
  // always fades some while the scent is still detectable up close, so there
  // is no honest fragrance whose throw ends the instant it becomes
  // undetectable.
  if (projectionRange.high >= longevityRange.high) return null

  // Canonical text for both, so the panel renders one format however the
  // answer was phrased.
  const longevity = longevityRange.text
  const projectionTime = projectionRange.text

  // The character read is required, not decorative. It's the step that makes
  // the recommendations follow from the fragrance as a whole instead of from
  // whichever note the model noticed first, so a response that skipped it
  // hasn't done the reasoning the rest of this depends on — fail it and retry
  // rather than accept recommendations with nothing behind them. Not stored:
  // it exists to shape the answers, and the panel has no place to show it.
  const fragranceFamily = String(candidate?.fragranceFamily ?? "").trim()
  const fragranceCharacter = String(candidate?.fragranceCharacter ?? "").trim()
  // Long enough to be actual reasoning rather than a two-word label.
  if (!fragranceFamily || fragranceCharacter.length < 40) return null

  const seasonRanking = resolveSeasonRanking(candidate?.seasonRanking)
  if (!seasonRanking) return null

  const rawWhen = candidate?.whenToApply ?? {}
  const whenToApply: Record<string, string[]> = {}
  for (const category of FRAGRANCE_WHEN_CATEGORIES) {
    // Season goes through the ranking filter; everything else takes the
    // model's picks as given (constrained to the option list).
    whenToApply[category.key] =
      category.key === "season"
        ? resolveSeasonPicks(rawWhen.season, seasonRanking, category.maxPicks)
        : resolveWhenCategory(rawWhen[category.key], category.options, category.maxPicks)
  }

  const everyCategoryHasPicks = FRAGRANCE_WHEN_CATEGORIES.every(
    (category) => whenToApply[category.key].length > 0
  )

  if (!everyCategoryHasPicks || !projection || !projectionTime) {
    return null
  }

  return {
    fragranceNotes: notesKnown ? resolvedNotes : null,
    notesDeclined: !notesKnown,
    longevity,
    projectionTime,
    projection,
    whenToApply: whenToApply as {
      timeOfDay: string[]
      season: string[]
      temperature: string[]
      setting: string[]
      outfit: string[]
    },
  }
}

export const analyzeItem = action({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(api.items.getItem, { id: args.id })
    if (!item || !item.frontImageUrl) {
      throw new Error("This item has no front photo to analyze")
    }

    // Footwear gets one extra question (facing direction) so the grid and
    // item detail page can auto-flip the photo to always point right — see
    // FOOTWEAR_ORIENTATION_GUIDANCE and the "facingDirection" field below.
    // Every other category skips this entirely.
    const isFootwear = item.category === "SHOES"

    // Only ask for a name suggestion when the item doesn't already have one
    // — covers both "left the name field blank when adding it" and a
    // manual re-analyze later. Never overwrites a name someone actually
    // typed in (here or via the edit menu), same convention as the
    // optional-and-only-patched-when-provided fields in saveAnalysis.
    const needsName = !item.name || item.name.trim() === ""

    // Whether to ask for a brand guess (see BRAND_GUIDANCE) — only for
    // categories/subcategories where a photo realistically carries enough
    // evidence (legible text, a logo mark, an iconic design) to make a
    // confident guess worthwhile: footwear, and two accessory
    // subcategories with usually-distinctive packaging/design. Every other
    // category/subcategory skips this entirely. Unlike needsName above,
    // this is asked every time (not just when missing) — re-analyzing gets
    // a fresh attempt each time rather than trusting a possibly stale
    // guess.
    //
    // Kept in sync with the identical check in app/item/[id]/page.tsx,
    // which decides whether the brand line renders under the item name.
    const wantsBrand =
      item.category === "SHOES" ||
      (item.category === "ACCESSORIES" && (item.subcategory === "HATS" || item.subcategory === "FRAGRANCES"))

    // Fragrances get an entirely different analysis (notes, performance,
    // when to apply) in place of the silhouette/material reading that's
    // meaningless for a bottle. Kept in sync with isFragrance in
    // app/item/[id]/page.tsx, which decides which panel to render.
    const wantsFragranceProfile =
      item.category === "ACCESSORIES" && item.subcategory === "FRAGRANCES"

    const imageResponse = await fetch(item.frontImageUrl)
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg"
    const buffer = await imageResponse.arrayBuffer()
    const base64Image = Buffer.from(buffer).toString("base64")

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Run: npx convex env set ANTHROPIC_API_KEY sk-ant-..."
      )
    }

    let silhouetteGuidance = GENERIC_SILHOUETTE_GUIDANCE
    if (item.category === "SHIRTS") {
      silhouetteGuidance = SHIRT_SILHOUETTE_GUIDANCE
    } else if (item.category === "PANTS") {
      silhouetteGuidance = PANTS_SILHOUETTE_GUIDANCE
    }

    // The set of valid item-color names for THIS item's category — the
    // shared palette plus whatever's category-specific (e.g. GOLD/SILVER
    // only for ACCESSORIES).
    const availablePalette: Record<string, string> = {
      ...ITEM_COLOR_PALETTE,
      ...(CATEGORY_ITEM_COLOR_PALETTE[item.category] ?? {}),
    }
    const itemColorGuidance = buildItemColorGuidance(Object.keys(availablePalette))

    // Pair suggestions are drawn from the SHARED palette only — deliberately
    // not availablePalette above. The category extras are colors this item
    // can BE, not colors worth recommending for the rest of an outfit: the
    // metallics exist so an ACCESSORIES item can be gold or silver, and
    // "wear gold pants with this" is not a suggestion worth making.
    //
    // The position string is what makes the recommendation directional (see
    // OUTFIT_POSITION) — an unknown category falls back to generic wording
    // rather than dropping the directional framing entirely.
    const itemPosition = OUTFIT_POSITION[item.category] ?? "the body"
    const pairingGuidance = buildPairingGuidance(item.category, itemPosition)

    // Optional notes the person typed in when adding this item (the
    // "ADDITIONAL INFO" section of the Add Item form). These are context
    // clues, not ground truth — the prompt below tells Claude to weigh them
    // alongside the photo rather than trust them blindly.
    const userContextLines: string[] = []
    if (item.materialHint) {
      userContextLines.push(`- Material note from the person who added this item: "${item.materialHint}"`)
    }
    if (item.silhouetteHint) {
      userContextLines.push(`- Silhouette note from the person who added this item: "${item.silhouetteHint}"`)
    }
    const userContextGuidance =
      userContextLines.length > 0
        ? `The person who added this item to their closet provided these optional notes when uploading it. Treat them as helpful context clues, not ground truth — weigh them alongside what you actually see in the photo, and feel free to disagree with a note if the photo clearly shows something different:\n${userContextLines.join("\n")}`
        : ""

    // ONE search-grounded pass, before the retry loop — deliberately not
    // inside it, so a validation retry re-runs only the cheap structured call
    // instead of paying for the searches again (see researchFragrance).
    // Returns "" when search is unavailable or finds nothing, in which case
    // the prompt below simply omits the findings block and analysis falls back
    // to the model's own knowledge.
    const fragranceResearch = wantsFragranceProfile
      ? await researchFragrance(apiKey, base64Image, contentType)
      : ""

    const fragranceResearchGuidance = fragranceResearch
      ? `
RESEARCH FINDINGS — gathered from the web for THIS bottle, just now:

${fragranceResearch}

HOW TO USE THESE. This is published data about the actual fragrance; your own recollection is not. Where the two conflict, the findings win — including when they contradict what you would otherwise have said about its notes, its performance, or when to wear it.

Read them critically rather than copying them. Where the findings give a numeric community rating with a sample size, weight it above any single reviewer's opinion. Where they report disagreement between sources, take the middle of the range rather than either extreme, and let that uncertainty show as a more moderate answer rather than a confident one. Where they say "no reliable data found" for something, fall back to your own knowledge for that point and be correspondingly careful with it.

If the findings identify the fragrance and include a note pyramid, you may treat "notesKnown" as true — a pyramid from a source is exactly the established fact this research exists to supply, and it beats one from memory.
`
      : ""

    const basePromptText = `You are analyzing a photo of a single piece of clothing (category: ${item.category}) for a digital closet app.

${silhouetteGuidance}

${itemColorGuidance}

${COLOR_THEORY_GUIDANCE}

${pairingGuidance}

${MATERIAL_GUIDANCE}
${isFootwear ? `\n${FOOTWEAR_ORIENTATION_GUIDANCE}\n` : ""}
${needsName ? `\n${NAME_GUIDANCE}\n` : ""}
${wantsBrand ? `\n${BRAND_GUIDANCE}\n` : ""}
${wantsFragranceProfile ? `\n${FRAGRANCE_GUIDANCE}\n${fragranceResearchGuidance}` : ""}
${userContextGuidance}

Respond with ONLY valid JSON, no other text, in exactly this shape:
{
  "silhouette": "the silhouette description described above, as a single short comma-separated phrase",
  "material": "the material guess described above, as a short 1-2 word phrase",
  "colors": ["BLACK"],
  "colorShade": "DARK",${isFootwear ? `\n  "toeAndHeelSides": "e.g. toe on the left, heel/opening on the right",\n  "facingDirection": "LEFT",` : ""}${needsName ? `\n  "name": "______",` : ""}${wantsBrand ? `\n  "brandEvidence": "e.g. the specific text or logo mark you can actually see — not a general brand vibe",\n  "brand": "the brand name on its own, or null if not confident enough to name one",` : ""}
  "complementaryColors": [
    { "name": "______", "tier": "EXCELLENT" },
    { "name": "______", "tier": "EXCELLENT" },
    { "name": "______", "tier": "STRONG" },
    { "name": "______", "tier": "STRONG" },
    { "name": "______", "tier": "GOOD" }
  ]${
    wantsFragranceProfile
      ? `,
  "fragranceIdEvidence": "the actual text or design detail on the bottle you used to identify it",
  "fragranceId": "the specific fragrance, brand + name + concentration, or null if the bottle doesn't say enough",
  "notesKnown": true or false — do you actually recall THIS fragrance's published pyramid,
  "fragranceNotes": {
    "top": ["______", "______"],
    "middle": ["______", "______"],
    "base": ["______", "______"]
  } or null if notesKnown is false,
  "fragranceFamily": "the olfactory family, e.g. aromatic fougère",
  "fragranceCharacter": "2-3 sentences on how the whole fragrance reads — write this BEFORE the recommendations below and derive them from it",
  "longevity": "total time detectable on skin at all, as an hour range, e.g. 8-10 HOURS — answer this before the two below",
  "projection": "${PROJECTION_LEVELS.join(" | ")}",
  "projectionTime": "how long it PROJECTS before becoming a skin scent, as an hour range and always shorter than longevity, e.g. 4-6 HOURS",
  "seasonRanking": {
${SEASON_OPTIONS.map((s) => `    "${s}": "${SEASON_RANKS.join(" | ")}"`).join(",\n")}
  },
  "whenToApply": {
${FRAGRANCE_WHEN_CATEGORIES.map((c) => `    "${c.key}": ["______"]`).join(",\n")}
  }`
      : ""
  }
}

For "colors", follow the item-color instructions above — an array of 1 or more names chosen only from that exact list, ordered most-to-least prominent. For "colorShade", return exactly "LIGHT" or "DARK".
${isFootwear ? `\nFor "toeAndHeelSides", write one short phrase actually describing what you see — which side of the image has the toe, which side has the heel/opening — before you answer facingDirection. Do this reasoning honestly based on the photo, not by copying the example text above. For "facingDirection", based on that reasoning, return exactly "LEFT" or "RIGHT" — whichever side the TOE is on, as described above.\n` : ""}${needsName ? `\nFor "name", follow the naming instructions above — a short, natural, descriptive name for this item, describing what it physically looks like and never naming the brand.\n` : ""}${wantsBrand ? `\nFor "brandEvidence", write one short phrase naming the SPECIFIC thing that justifies your answer — actual text you can read, or an actual logo mark or design detail you recognize. "This looks like the kind of thing that brand makes" is not evidence and doesn't count — if that's genuinely all you have, say so plainly (e.g. "no visible branding") and then "brand" below must be null. For "brand", based on that evidence, the brand name on its own if you're actually confident, otherwise the JSON literal null. Never include a product, model, or line name — "Nike", not "Nike Air Force 1". Don't return an empty string or a vague guess like "some sportswear brand" — either a real brand or null.\n` : ""}
For "complementaryColors", follow the pairing instructions above. Between ${MIN_COMPLEMENT_COUNT} and ${MAX_COMPLEMENT_COUNT} entries, best-first, at most one per family. Each "name" must be spelled exactly as one of the family names listed above — do NOT include a hex code, the app looks the swatch color up from the name itself. Each "tier" must be exactly "EXCELLENT", "STRONG", or "GOOD".

Use the color theory reasoning above to decide which families make the list and how they rank — weigh value (light/dark), temperature (warm/cool), saturation (vivid/muted) and how visually dominant the result would be, not just hue. Vary the reasoning across the list rather than repeating one idea: mostly neutrals that keep the outfit calm, plus any saturated family that genuinely earns a spot for this specific piece.

Remember these are colors for the OTHER pieces of an outfit built around this item, given where on the body this item sits — not a general list of colors that technically match its hue. Use real family names, not placeholders.
${
  wantsFragranceProfile
    ? `
For the fragrance fields, follow the fragrance instructions above. Write "fragranceIdEvidence" before "fragranceId", and answer "notesKnown" honestly — false is a perfectly good answer and is much better than a reconstructed pyramid. If "notesKnown" is true, every note tier must contain at least one real note; if it's false, "fragranceNotes" must be null. Every "whenToApply" list must contain at least one entry, spelled exactly as one of that category's listed options, strongest first. "projection" must be exactly one of ${PROJECTION_LEVELS.join(", ")}.
`
    : ""
}`

    // Claude (especially the fast Haiku model) doesn't always reliably hold
    // exact instructions just from prompt wording. Rather than trust it
    // blindly, we validate the response in code and retry with an explicit
    // correction if something's wrong, instead of silently saving whatever
    // came back. Checks: the complementary-color count, that at least one
    // returned item-color actually matches the fixed palette, that
    // colorShade is exactly "LIGHT" or "DARK", and (footwear only) that
    // facingDirection is exactly "LEFT" or "RIGHT".
    let parsed: any = null
    let resolvedItemColors: { name: string; hex: string }[] = []
    let resolvedPairColors: { name: string; hex: string; tier: string }[] = []
    let resolvedFragranceProfile: ReturnType<typeof resolveFragranceProfile> = null
    let lastAttemptDescription = ""

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const correctionNote =
        attempt === 1
          ? ""
          : `IMPORTANT CORRECTION: your previous attempt had a problem: ${lastAttemptDescription}. Re-read the instructions carefully and fix this on this attempt.\n\n`

      const promptText = correctionNote + basePromptText

      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // Per-call override rather than a global switch, so only fragrance
          // analysis pays for the stronger model (see FRAGRANCE_MODEL).
          model: wantsFragranceProfile ? FRAGRANCE_MODEL : MODEL,
          // Fragrances ask for three note tiers plus five selection lists on
          // top of everything every item returns, which doesn't fit in the
          // standard budget — and an over-long response is cut off mid-JSON,
          // which surfaces as "the response was cut off by the token limit"
          // and burns all three attempts on a problem retrying can't fix.
          //
          // The fragrance figure is well above what the JSON itself needs
          // because that path runs on a Claude 5 model with adaptive thinking
          // (see FRAGRANCE_MODEL), and THINKING TOKENS COUNT AGAINST THIS
          // BUDGET. Sizing it for the visible output alone would let the
          // model reason its way through the whole allowance and emit no text
          // at all — which is exactly the empty-response case handled below.
          max_tokens: wantsFragranceProfile ? 4000 : 600,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: contentType,
                    data: base64Image,
                  },
                },
                {
                  type: "text",
                  text: promptText,
                },
              ],
            },
          ],
        }),
      })

      if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text()
        throw new Error(`Claude API error: ${errorText}`)
      }

      const claudeData = await claudeResponse.json()

      // Do NOT assume content[0] is the text block. Claude 5 models run
      // adaptive thinking, so the response arrives as one or more `thinking`
      // blocks FOLLOWED by the text — content[0] is then a thinking block
      // whose `.text` is undefined, and reading it blindly throws "Cannot
      // read properties of undefined (reading 'replace')". (Those blocks also
      // come back with an empty `thinking` string, since display defaults to
      // "omitted", so they aren't even readable — they just occupy the
      // leading slots.) Collecting every text block is correct for both
      // shapes, so this handles Haiku and Sonnet alike.
      const textBlocks: any[] = Array.isArray(claudeData.content)
        ? claudeData.content.filter(
            (block: any) => block?.type === "text" && typeof block.text === "string"
          )
        : []
      const rawText = textBlocks.map((block: any) => block.text).join("")

      // An empty result is a real outcome worth retrying rather than crashing
      // on — most often the token budget got spent before any text was
      // emitted, which is newly possible now that thinking tokens count
      // against max_tokens.
      if (!rawText.trim()) {
        lastAttemptDescription =
          claudeData.stop_reason === "max_tokens"
            ? "the response ran out of tokens before writing any output — answer more concisely"
            : "the response contained no text content"
        continue
      }

      const cleanedText = rawText.replace(/```json\n?|```/g, "").trim()

      let candidate: any
      try {
        candidate = JSON.parse(cleanedText)
      } catch (err) {
        // Distinguishes truncation from genuine malformation, because the
        // two need opposite fixes: one a shorter answer, the other a
        // better-formed one.
        lastAttemptDescription =
          claudeData.stop_reason === "max_tokens"
            ? "the response was cut off by the token limit before the JSON was closed — answer more concisely"
            : "the response wasn't valid JSON"
        continue
      }

      // Validated on the RESOLVED list, not the raw one: a response with
      // eight entries that are mostly hallucinated names or three different
      // ways of saying "beige" hasn't actually produced eight suggestions,
      // and retrying is the right move. Counting the raw array would let
      // that through.
      const rawComplementCount = Array.isArray(candidate.complementaryColors)
        ? candidate.complementaryColors.length
        : 0
      const candidatePairColors = resolvePairColors(candidate.complementaryColors)
      const complementValid = candidatePairColors.length >= MIN_COMPLEMENT_COUNT

      const rawColors: unknown[] = Array.isArray(candidate.colors) ? candidate.colors : []
      const candidateResolvedColors = rawColors
        .map((name) => resolveItemColor(String(name), availablePalette))
        .filter((c): c is { name: string; hex: string } => c !== null)

      const shadeValid = candidate.colorShade === "LIGHT" || candidate.colorShade === "DARK"
      const facingValid =
        !isFootwear || candidate.facingDirection === "LEFT" || candidate.facingDirection === "RIGHT"
      const nameValid =
        !needsName || (typeof candidate.name === "string" && candidate.name.trim().length > 0)
      // Doesn't try to judge whether the evidence is actually GOOD (that's
      // what the prompt instructions above are for) — just enforces the
      // structural rule that a brand can't exist without some accompanying
      // brandEvidence at all. Catches the model skipping straight to a
      // brand name without writing out what justifies it, which is the
      // shortcut that produced brand-vibe-only guesses before this field
      // existed (see the comment above BRAND_GUIDANCE).
      const hasBrand = typeof candidate.brand === "string" && candidate.brand.trim().length > 0
      const brandValid =
        !wantsBrand ||
        !hasBrand ||
        (typeof candidate.brandEvidence === "string" && candidate.brandEvidence.trim().length > 0)

      // Null means the profile came back genuinely unusable — unidentifiable
      // bottle, an empty selection list, an unrecognized projection level, or
      // a claim of note knowledge not backed by an actual pyramid (see
      // resolveFragranceProfile). Retrying those is right.
      //
      // Note what is NOT null: honestly declining the notes. That returns a
      // profile with fragranceNotes: null and sails through, because pressing
      // the model to try again is exactly what produced invented pyramids.
      const candidateFragranceProfile = wantsFragranceProfile
        ? resolveFragranceProfile(candidate)
        : null
      const fragranceValid = !wantsFragranceProfile || candidateFragranceProfile !== null

      if (
        fragranceValid &&
        complementValid &&
        candidateResolvedColors.length > 0 &&
        shadeValid &&
        facingValid &&
        nameValid &&
        brandValid
      ) {
        parsed = candidate
        resolvedItemColors = candidateResolvedColors
        resolvedPairColors = candidatePairColors
        resolvedFragranceProfile = candidateFragranceProfile
        break
      }

      const issues: string[] = []
      if (!complementValid) {
        // Names the actual failure so the retry can act on it. Losing
        // entries between the raw count and the resolved count means the
        // names were either off-list or duplicate families — a different
        // mistake from simply returning too few, and worth saying out loud
        // rather than just repeating the required count back.
        issues.push(
          rawComplementCount > candidatePairColors.length
            ? `"complementaryColors" only produced ${candidatePairColors.length} usable entries out of ${rawComplementCount} — the rest were either not spelled exactly as one of the listed family names, or were a second color from a family already used. Return at least ${MIN_COMPLEMENT_COUNT} entries, each from a different family, each spelled exactly as listed`
            : `"complementaryColors" had ${candidatePairColors.length} entries, fewer than the minimum of ${MIN_COMPLEMENT_COUNT}`
        )
      }
      if (candidateResolvedColors.length === 0) {
        issues.push(`"colors" didn't contain any names from the allowed item-color list`)
      }
      if (!shadeValid) {
        issues.push(`"colorShade" must be exactly "LIGHT" or "DARK"`)
      }
      if (!facingValid) {
        issues.push(`"facingDirection" must be exactly "LEFT" or "RIGHT"`)
      }
      if (!nameValid) {
        issues.push(`"name" must be a short, non-empty string`)
      }
      if (!brandValid) {
        issues.push(
          `"brand" was set without "brandEvidence" explaining what specifically justifies it — either provide real evidence or set "brand" to null`
        )
      }
      if (!fragranceValid) {
        // Names the specific empty parts rather than just "the fragrance
        // data was invalid", so the retry knows what to fix. Re-resolves
        // here (cheap, pure) because the combined resolver returns null
        // without saying which piece failed.
        const missing: string[] = []
        if (!String(candidate.fragranceId ?? "").trim()) {
          missing.push(
            `"fragranceId" was empty — name the specific fragrance from the bottle, or if you truly can't, say so in "fragranceIdEvidence"`
          )
        }
        // Only complained about when the model CLAIMED to know the pyramid.
        // An honest notesKnown:false never reaches here, so this can't turn
        // into pressure to invent one.
        if (candidate.notesKnown === true) {
          const rawNotes = candidate.fragranceNotes ?? {}
          for (const tier of ["top", "middle", "base"] as const) {
            if (resolveNoteTier(rawNotes?.[tier]).length === 0) {
              missing.push(
                `"notesKnown" was true but "fragranceNotes.${tier}" had no usable note names — either give the real notes for this specific fragrance, or set "notesKnown" to false and "fragranceNotes" to null`
              )
            }
          }
        }
        if (!String(candidate.fragranceFamily ?? "").trim()) {
          missing.push(`"fragranceFamily" was empty — name the olfactory family`)
        }
        if (String(candidate.fragranceCharacter ?? "").trim().length < 40) {
          missing.push(
            `"fragranceCharacter" was missing or too short — write 2-3 real sentences on how the whole fragrance reads, since every recommendation has to follow from it`
          )
        }

        const candidateRanking = resolveSeasonRanking(candidate.seasonRanking)
        if (!candidateRanking) {
          missing.push(
            `"seasonRanking" must give every one of ${SEASON_OPTIONS.join(", ")} exactly one of ${SEASON_RANKS.join(", ")}`
          )
        }

        const rawWhen = candidate.whenToApply ?? {}
        for (const category of FRAGRANCE_WHEN_CATEGORIES) {
          // Season is checked against the ranking, so "you picked seasons but
          // ranked them all POSSIBLE" reports the real problem rather than
          // the misleading "no entries matched the allowed options".
          if (category.key === "season" && candidateRanking) {
            if (resolveSeasonPicks(rawWhen.season, candidateRanking, category.maxPicks).length === 0) {
              missing.push(
                `"whenToApply.season" had no seasons that you ranked IDEAL or GOOD — rank at least one season IDEAL or GOOD and select it, rather than only offering seasons the fragrance merely tolerates`
              )
            }
            continue
          }
          if (resolveWhenCategory(rawWhen[category.key], category.options, category.maxPicks).length === 0) {
            missing.push(
              `"whenToApply.${category.key}" had no entries matching its allowed options (${category.options.join(", ")})`
            )
          }
        }
        if (!PROJECTION_LEVELS.includes(String(candidate.projection ?? "").trim().toUpperCase())) {
          missing.push(`"projection" must be exactly one of ${PROJECTION_LEVELS.join(", ")}`)
        }
        const candidateLongevity = parseHourRange(candidate.longevity)
        const candidateProjection = parseHourRange(candidate.projectionTime)
        if (!candidateLongevity) {
          missing.push(
            `"longevity" must be an hour range like "8-10 HOURS" — a word like "long" or "moderate" is not an answer`
          )
        }
        if (!candidateProjection) {
          missing.push(
            `"projectionTime" must be an hour range like "4-6 HOURS" — a word like "medium" is not an answer, and it must be a duration rather than a strength`
          )
        }
        if (
          candidateLongevity &&
          candidateProjection &&
          candidateProjection.high >= candidateLongevity.high
        ) {
          missing.push(
            `"projectionTime" (${candidateProjection.text}) was not shorter than "longevity" (${candidateLongevity.text}) — projection always fades before the scent stops being detectable, so these must differ; if they came out the same you have reported longevity twice`
          )
        }
        issues.push(missing.join("; "))
      }
      lastAttemptDescription = issues.join("; ")
    }

    if (!parsed) {
      throw new Error(
        `Claude could not return a valid response after ${MAX_ATTEMPTS} attempts (last attempt: ${lastAttemptDescription}). Try again, or check the terminal for details.`
      )
    }

    // Not part of the strict validation/retry gate above — a null/absent
    // guess is an expected, legitimate outcome (see BRAND_GUIDANCE), not a
    // malformed response worth burning a retry attempt over. Just
    // normalized here: a real non-empty string is used as-is, anything
    // else (null, missing, empty string) becomes "" — saveAnalysis
    // interprets "" as "actively clear any previous guess", distinct from
    // undefined below meaning "this category isn't in scope, don't touch
    // the field at all" (see convex/items.ts).
    const identifiedBrand =
      typeof parsed.brand === "string" && parsed.brand.trim().length > 0
        ? parsed.brand.trim()
        : ""

    await ctx.runMutation(internal.items.saveAnalysis, {
      id: args.id,
      silhouette: parsed.silhouette,
      material: parsed.material,
      // Only ever sent when this item had no name going in — never
      // overwrites one someone actually typed. saveAnalysis only patches
      // `name` when it's actually provided (see convex/items.ts), same
      // optional-and-only-patched convention as needsFlip below.
      name: needsName ? String(parsed.name).trim() : undefined,
      // Only sent for in-scope categories (see wantsBrand above) — every
      // other item leaves brand untouched. When in scope, this is ALWAYS
      // sent (even as ""), unlike name, so a re-analysis that can't
      // confidently identify the brand this time actively clears a stale
      // guess instead of leaving it looking current.
      brand: wantsBrand ? identifiedBrand : undefined,
      // Mirrors the most prominent item color into the legacy single-color
      // field, so anything still reading primaryColor stays consistent
      // with the new colors[0].
      primaryColor: resolvedItemColors[0],
      colors: resolvedItemColors,
      colorShade: parsed.colorShade,
      // Only ever set for footwear — every other category leaves this
      // untouched (saveAnalysis only patches it when explicitly provided,
      // see convex/items.ts).
      needsFlip: isFootwear ? parsed.facingDirection === "LEFT" : undefined,
      // The resolved/deduped/tier-sorted list, NOT parsed.complementaryColors
      // — every hex here came from the fixed palette rather than the model
      // (see resolvePairColors), so a saved swatch always matches the same
      // color in the edit menu's picker exactly.
      complementaryColors: resolvedPairColors,
      // Only sent for fragrances — every other item leaves these untouched
      // (saveAnalysis omits the keys entirely when they're undefined), so a
      // non-fragrance never gets an empty scent profile written onto it.
      ...(resolvedFragranceProfile
        ? {
            // Sent even when null — saveAnalysis reads an explicit null as
            // "clear the notes" (see convex/items.ts), so a re-analysis that
            // honestly can't recall the pyramid actively removes a stale one
            // rather than leaving previously-invented notes sitting there
            // looking authoritative.
            fragranceNotes: resolvedFragranceProfile.fragranceNotes,
            longevity: resolvedFragranceProfile.longevity,
            projectionTime: resolvedFragranceProfile.projectionTime,
            projection: resolvedFragranceProfile.projection,
            whenToApply: resolvedFragranceProfile.whenToApply as {
              timeOfDay: string[]
              season: string[]
              temperature: string[]
              setting: string[]
              outfit: string[]
            },
          }
        : {}),
    })
  },
})