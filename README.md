# Outfit Picker

A digital closet. Photograph each item of clothing you own, and the app removes
the background, catalogues the piece, and helps you assemble and rate outfits
from it.

Built with Next.js, Convex and the Anthropic API.

<!-- Add 2-3 screenshots here: the closet grid, an item detail page, the outfit
     builder. They do more for a reader than any paragraph below. -->

## What it does

- **Catalogue.** Upload a photo; the background is removed in the browser and
  the garment is filed by category and type.
- **Analyse.** Claude tags colour, material, silhouette and brand, and suggests
  complementary colours for the rest of an outfit.
- **Fragrances** get their own treatment: note pyramid, longevity, projection,
  and when to wear them, grounded with live web search.
- **Build outfits** from the catalogue and have them scored across silhouette,
  colour, proportion, cohesion, and footwear/accessories.

## Stack

| | |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Convex — schema, queries, mutations, actions, file storage |
| AI | Anthropic API (Claude), with server-side web search for grounding |
| Images | `@imgly/background-removal` in a Web Worker |

## Notes on a few decisions

**Validation assumes the model is unreliable.** Analysis output is checked
server-side before it is stored: malformed time ranges are rejected, a
fragrance's projection cannot exceed its longevity, and colour suggestions are
resolved against a fixed palette so the model cannot return a colour the app is
unable to render.

**"I don't know" is a valid answer.** An early version had a validator that
rejected empty fragrance notes, which forced the model to invent them — two
unrelated fragrances came back with identical notes. The fix was an explicit
decline path plus web-search grounding, so the model returns nothing rather
than something plausible and wrong.

**Image processing runs off the main thread.** Background removal, edge
cleanup and content-aware cropping happen in a Web Worker so the interface
stays responsive during an upload. Crop padding is applied by expanding the
output canvas rather than borrowing margin from the source photo, so every
garment ends up at the same scale regardless of how its original was framed.

## Running locally

```bash
npm install
npx convex dev     # first run creates a deployment and writes .env.local
npm run dev        # in a second terminal
```

Set the Anthropic key on the Convex deployment (it is read server-side and
never reaches the browser):

```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
```

### Background-removal assets

`@imgly/background-removal` fetches ~300MB of ONNX/WASM model chunks at
runtime. They are cached under `public/bg-removal/` and excluded from this
repository. On a fresh clone they are re-fetched on first use; see
`BG_REMOVAL_PUBLIC_PATH` in `app/item/[id]/page.tsx` for how they are served.

## Status

A personal project, still in progress. There is no authentication yet, so all
data is shared by anyone with access to the deployment — it is built as a
single-user tool.
