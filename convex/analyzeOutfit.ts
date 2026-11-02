"use node"

import { action } from "./_generated/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"

const MODEL = "claude-haiku-4-5-20251001"

// Full outfit evaluation rubric. Given to Claude as the framework it must
// reason through before producing a rating — silhouette, proportion, color
// theory, visual balance, cohesion, fabric/texture, footwear, accessories,
// and context, evaluated as one composition rather than piece-by-piece.
const OUTFIT_EVALUATION_RUBRIC = `OUTFIT EVALUATION SYSTEM
Your job is to evaluate outfits objectively as a fashion stylist, with emphasis on silhouette, proportions, color theory, cohesion, styling intent, and practicality.
Do not simply say whether individual pieces "match." Evaluate the outfit as one visual composition.
==================================================
1. OVERALL RATING
==================================================
Give the outfit a score from 1-10.
Use this approximate scale:
10 = Exceptional. Highly cohesive, excellent proportions, distinctive, intentional, and very difficult to improve.
9 = Excellent. Strong fashion sense, very cohesive, only minor improvements possible.
8 = Very good. Clearly works and looks intentional, but has identifiable weaknesses or could be elevated.
7 = Good. Works competently, but feels somewhat ordinary, unbalanced, or underdeveloped.
6 = Decent. Wearable, but several aspects could be improved.
5 = Average. Nothing is seriously wrong, but the outfit lacks cohesion or distinction.
4 = Weak. Multiple noticeable problems with proportion, color, styling, or cohesion.
3 = Poor. The pieces may individually work, but the outfit does not come together.
2 = Very poor. Major conflicts in silhouette, color, proportion, or aesthetic.
1 = Fundamentally unsuccessful outfit.
Do not inflate scores. An outfit being wearable does not automatically make it an 8+.
A score of 8+ should mean the outfit is genuinely strong.
==================================================
2. EVALUATE THE OUTFIT IN THIS ORDER
==================================================
A. SILHOUETTE
B. PROPORTIONS
C. COLOR
D. VISUAL BALANCE
E. COHESION / AESTHETIC
F. FOOTWEAR
G. ACCESSORIES
H. PRACTICALITY / CONTEXT
The first five should have the greatest influence on the rating.
==================================================
3. SILHOUETTE
==================================================
Determine the silhouette of every major component.
For tops, evaluate:
- Slim vs regular vs relaxed vs oversized
- Boxy vs elongated
- Cropped vs standard vs long
- Shoulder width
- Sleeve volume
- Structural vs draped
For bottoms, evaluate:
- Slim vs straight vs relaxed vs wide vs baggy
- Tapered vs straight vs flared
- Rise
- Length
- Stacking/pooling
- Amount of fabric around thigh and ankle
For outerwear, evaluate:
- Width
- Length
- Shoulder structure
- Volume
- Relationship to the layer underneath
Then evaluate the silhouette of the OUTFIT AS A WHOLE.
Do not evaluate pieces independently and stop there.
Ask:
"Where is the visual volume?"
Examples:
- Narrow top + wide pants = lower-body dominant
- Wide top + narrow pants = upper-body dominant
- Wide top + wide pants = expansive/oversized
- Cropped wide top + wide pants = strong fashion-oriented proportion
- Long top + wide pants = continuous, potentially overwhelming silhouette
A silhouette does not need to be conventionally balanced to be good. Intentional exaggeration can be desirable.
==================================================
4. PROPORTIONS
==================================================
Evaluate relationships rather than isolated measurements.
Consider:
- Top length relative to pants rise
- Top width relative to pants width
- Outerwear length relative to top length
- Sleeve volume relative to torso volume
- Shoe volume relative to pant width
- Visible amount of shirt underneath outerwear
- Waist placement
- Amount of leg visible
- Headwear relative to upper-body volume
Ask:
"Does the outfit create a deliberate visual hierarchy?"
Pay particular attention to whether one component accidentally overwhelms everything else.
When a proportion is questionable, explain WHY rather than simply saying it is "too big" or "too small."
==================================================
5. COLOR THEORY
==================================================
Evaluate:
- Hue
- Value
- Saturation
- Warm/cool temperature
- Contrast
- Color proportion
- Color hierarchy
Determine whether the palette is:
- Monochromatic
- Analogous
- Complementary
- Neutral
- Earth-toned
- High contrast
- Low contrast
- Mixed
Value contrast is especially important.
For example:
black + dark gray has low hue contrast but some value contrast.
black + white has very high value contrast.
Do not assume high contrast is better. Determine whether the contrast supports the intended aesthetic.
Evaluate the dominant color, secondary color, and accent color.
Consider roughly:
60% dominant
30% secondary
10% accent
This is a guideline, not a mathematical requirement.
Also consider how color affects perceived proportions:
- Light colors tend to advance visually
- Dark colors tend to recede
- Bright/saturated colors attract attention
- Muted colors are quieter
==================================================
6. VISUAL BALANCE
==================================================
Ask where the eye goes first.
Identify:
- Highest-contrast area
- Most voluminous area
- Most visually interesting item
- Whether those areas are intentionally placed
Consider balance across:
- Upper vs lower body
- Left vs right if relevant
- Light vs dark
- Large vs small
- Detailed vs simple
An outfit can be asymmetrical and still be balanced.
Do not confuse symmetry with balance.
==================================================
7. COHESION AND AESTHETIC
==================================================
Determine what aesthetic the outfit communicates.
Possible characteristics include:
- Minimal
- Streetwear
- Workwear
- Utilitarian
- Technical
- Casual
- Tailored
- Rugged
- Avant-garde
- Sporty
- Vintage
- Contemporary
Ask whether all pieces appear to belong to the same visual language.
Consider:
- Fabric relationships
- Hardware
- Shape language
- Formality
- Texture
- Color
- Footwear
Important:
A contrast between aesthetics is not automatically bad.
For example, mixing tailored and casual elements can be intentional and fashionable if the contrast is controlled.
The question is:
"Does the contrast look intentional or accidental?"
==================================================
8. FABRIC AND TEXTURE
==================================================
Evaluate whether materials complement each other.
Consider:
- Cotton
- Nylon
- Denim
- Canvas
- Wool
- Fleece
- Leather
- Technical fabrics
- Smooth vs textured surfaces
- Matte vs shiny surfaces
Texture can create interest even when the colors are extremely similar.
For neutral outfits, texture and silhouette become especially important because there is less color contrast.
==================================================
9. FOOTWEAR
==================================================
Do not treat shoes as an afterthought.
Evaluate:
- Shoe volume
- Shape
- Color
- Visual weight
- Formality
- Relationship to pants
- Whether the pants cover or expose the shoe appropriately
For wide pants, ask whether the shoe has enough visual weight to support the hem.
For narrow pants, excessive shoe volume can overwhelm the lower leg.
Footwear should reinforce the outfit's aesthetic unless intentional contrast is being used.
==================================================
10. ACCESSORIES
==================================================
Evaluate accessories based on whether they:
- Reinforce the color palette
- Balance visual weight
- Add needed contrast
- Complete the aesthetic
- Add unnecessary clutter
For hats:
- Consider whether the upper body already has enough visual complexity
- Consider whether the hat repeats an existing color
- Consider whether it adds useful visual structure
For jewelry:
- Consider metal/color consistency
- Consider neckline
- Consider whether the outfit needs a focal point
Do not automatically recommend accessories just because they are available.
Sometimes "no accessories" is the better choice.
==================================================
11. CONTEXT
==================================================
Consider:
- Weather
- Temperature
- Indoor/outdoor setting
- Occasion
- Time of day
- Activity
Do not sacrifice aesthetic quality unnecessarily for practicality, but flag obvious mismatches.
For example, heavy outerwear in warm weather should be noted even if the outfit looks good.
==================================================
12. WHEN THE USER ASKS FOR OPTIONS
==================================================
When comparing two items, do not simply identify which item is "better."
Explain what each option changes.
Use this structure:
OPTION A:
- Strengths
- Weaknesses
- Effect on silhouette
- Effect on color
- Effect on aesthetic
OPTION B:
- Strengths
- Weaknesses
- Effect on silhouette
- Effect on color
- Effect on aesthetic
Then give a winner and explain the deciding factor.
The winner should be based on the ENTIRE outfit, not which item is better in isolation.
==================================================
13. SUGGESTIONS
==================================================
When suggesting a change, prioritize the change that produces the largest improvement.
Do not recommend changes merely for the sake of changing something.
For every suggested change, explain:
1. What to change
2. Why it improves the outfit
3. What visual problem it solves
4. What tradeoff it creates
For example:
"Use the lighter top because the pants are very dark. This creates more value separation and prevents the upper and lower body from visually merging. The tradeoff is that the outfit becomes slightly less understated."
==================================================
14. DO NOT OVER-CORRECT
==================================================
If an outfit already works, do not keep adding pieces.
A common mistake is assuming:
"more accessories = more fashionable."
Instead ask:
"Would adding this actually improve the composition?"
If not, recommend leaving it alone.
==================================================
15. BE OBJECTIVE AND HONEST
==================================================
Do not agree with the user simply because they proposed something.
If something is worse, say so.
Use language such as:
- "I prefer..."
- "This is the weaker option because..."
- "The main issue is..."
- "This works, but..."
- "I would not add..."
- "This is objectively more balanced..."
Avoid empty praise.
==================================================
16. DISTINGUISH BETWEEN DIFFERENT TYPES OF "GOOD"
==================================================
An outfit can be:
- More balanced
- More interesting
- More cohesive
- More fashion-forward
- More practical
- More distinctive
- More minimal
- More wearable
These are not necessarily the same thing.
For example, an outfit can be more balanced but less interesting.
State the distinction when relevant.
==================================================
17. WHEN THE USER CHANGES ONE ITEM
==================================================
Re-evaluate the outfit rather than merely evaluating the new item.
A single substitution can affect:
- Silhouette
- Color hierarchy
- Formality
- Texture
- Visual weight
- Aesthetic
Always compare the NEW TOTAL OUTFIT against the ORIGINAL TOTAL OUTFIT.
==================================================
18. RATING EXPLANATION
==================================================
Whenever giving a rating, explain the score.
Use approximately:
Overall: X/10
Silhouette: X/10
Color: X/10
Proportion: X/10
Cohesion: X/10
Footwear/accessories: X/10
Then identify:
- Biggest strength
- Biggest weakness
- One highest-impact improvement
Do not make the sub-scores artificially precise if the evidence does not support it.
==================================================
19. IMPORTANT PRINCIPLE
==================================================
The goal is NOT to determine whether individual clothing pieces are fashionable.
The goal is to determine:
"How effectively do these specific pieces form a coherent visual composition when worn together?"
Evaluate the outfit as a complete system.
Silhouette + proportion + color + texture + visual hierarchy + aesthetic coherence should determine the final judgment.`

export const analyzeOutfit = action({
  args: { id: v.id("outfits") },
  handler: async (ctx, args) => {
    const outfit = await ctx.runQuery(api.outfits.getOutfit, { id: args.id })
    if (!outfit) {
      throw new Error("Outfit not found")
    }
    if (outfit.pieces.length === 0) {
      throw new Error("This outfit has no pieces to analyze")
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Run: npx convex env set ANTHROPIC_API_KEY sk-ant-..."
      )
    }

    const imageContent: any[] = []
    for (const piece of outfit.pieces) {
      if (!piece.frontImageUrl) continue
      const imageResponse = await fetch(piece.frontImageUrl)
      const contentType = imageResponse.headers.get("content-type") || "image/png"
      const buffer = await imageResponse.arrayBuffer()
      const base64Image = Buffer.from(buffer).toString("base64")
      imageContent.push({
        type: "image",
        source: { type: "base64", media_type: contentType, data: base64Image },
      })
      imageContent.push({
        type: "text",
        text: `The image above is the ${piece.category.toLowerCase()}.`,
      })
    }

    const promptText = `${OUTFIT_EVALUATION_RUBRIC}

==================================================
YOUR TASK
==================================================
You are looking at photos of individual clothing pieces that together make up ONE outfit. Each photo above is labeled with what piece it is. Apply the full evaluation system above to this outfit as a complete visual composition — silhouette, proportion, color, visual balance, cohesion, fabric/texture, footwear, accessories, and context — then respond with ONLY valid JSON, no other text, in exactly this shape:

{
  "name": "a short catchy 2-4 word name for this outfit",
  "description": "one sentence describing the overall look/vibe",
  "kind": "one word describing the aesthetic: minimal, streetwear, workwear, utilitarian, technical, casual, tailored, rugged, avant-garde, sporty, vintage, or contemporary",
  "rating": 7,
  "ratingBreakdown": {
    "silhouette": 7,
    "color": 6,
    "proportion": 7,
    "cohesion": 8,
    "footwearAccessories": 6
  },
  "strengths": ["short phrase", "short phrase"],
  "weaknesses": ["short phrase", "short phrase"],
  "suggestions": ["short phrase", "short phrase"],
  "biggestStrength": "one sentence naming the single biggest strength",
  "biggestWeakness": "one sentence naming the single biggest weakness",
  "highestImpactImprovement": "one sentence describing the one change that would improve this outfit the most, and why",
  "whenToWear": "one sentence describing the best occasion/setting to wear this outfit"
}

"rating" is the overall integer 1-10 score, following the scoring scale in section 1 — do not inflate it; an outfit being wearable does not automatically make it an 8+.

"ratingBreakdown" gives an integer 1-10 for each of the five dimensions from section 18 (silhouette, color, proportion, cohesion, footwearAccessories). These should reflect genuine independent evaluation of each dimension per the rubric above, not just copies of the overall rating — don't make them artificially precise if the evidence doesn't support fine distinctions, per the rubric's own guidance.

"strengths" and "weaknesses" should each have 2-3 short items. "suggestions" should have 1-3 short actionable tips, prioritized by impact per section 13 of the rubric — the highest-impact change first.

"biggestStrength", "biggestWeakness", and "highestImpactImprovement" should each be a single sentence distilling the single most important point in that category (per section 18) — not a restatement of the whole strengths/weaknesses/suggestions lists. For "highestImpactImprovement" specifically, explain not just what to change but why it improves the outfit, per section 13.`

    imageContent.push({ type: "text", text: promptText })

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: imageContent }],
      }),
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      throw new Error(`Claude API error: ${errorText}`)
    }

    const claudeData = await claudeResponse.json()
    const rawText = claudeData.content[0].text as string
    const cleanedText = rawText.replace(/```json\n?|```/g, "").trim()
    const parsed = JSON.parse(cleanedText)

    await ctx.runMutation(internal.outfits.saveOutfitAnalysis, {
      id: args.id,
      name: parsed.name,
      description: parsed.description,
      kind: parsed.kind,
      rating: parsed.rating,
      ratingBreakdown: parsed.ratingBreakdown,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      suggestions: parsed.suggestions,
      biggestStrength: parsed.biggestStrength,
      biggestWeakness: parsed.biggestWeakness,
      highestImpactImprovement: parsed.highestImpactImprovement,
      whenToWear: parsed.whenToWear,
    })
  },
})