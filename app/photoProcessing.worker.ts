/// <reference lib="webworker" />

// This worker exists so background removal — and the resize/edge-cleanup/
// crop steps that follow it — never run on the main thread at all.
//
// Without this, @imgly/background-removal blocks the main thread by
// default: its own worker-proxying option (proxyToWorker) only actually
// takes effect when device is set to "gpu" AND the browser supports
// WebGPU (confirmed by reading the library's own source — proxyToWorker
// is silently ignored on the default "cpu" device). On CPU, or in any
// browser without WebGPU, its model inference always runs synchronously
// wherever it's called from — which is exactly what was freezing the page
// for a few seconds per upload even after the self-hosted-assets fix.
// Running the whole pipeline inside this dedicated worker instead
// guarantees the page stays clickable and animations keep running during
// every upload, regardless of GPU/WebGPU support.
//
// The library itself is worker-safe: its internal createCanvas() helper
// prefers OffscreenCanvas whenever it's available (which it is, inside a
// worker) and only falls back to document.createElement("canvas") — which
// would fail here — when OffscreenCanvas is missing. Same for
// createImageBitmap, fetch, and navigator.gpu/navigator.hardwareConcurrency
// — all available in a worker's global scope, so no code here needs any
// window/document-only API.

import { removeBackground } from "@imgly/background-removal"

// Same idea as the resize/edge-cleanup/crop helpers that used to live
// directly in app/page.tsx and app/item/[id]/page.tsx — identical logic,
// just built on OffscreenCanvas instead of a real <canvas> element, since
// document doesn't exist in a worker.

// Claude's vision API (convex/analyze.ts) caps images at 10MB, and a
// transparent PNG straight off a phone camera can blow past that easily.
// Shrinks so the longest edge is at most maxDimension; never enlarges.
async function resizeImage(blob: Blob, maxDimension = 1568): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  if (scale >= 1) {
    bitmap.close()
    return blob
  }
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return await canvas.convertToBlob({ type: "image/png" })
}

// Background removal sometimes leaves semi-transparent "ghost" pixels at the
// edges, which show up as a smudgy gray halo baked into the image. This
// snaps every pixel to fully transparent or fully opaque. Threshold is 200
// (not the more typical 128) because pixels in the 128-199 alpha range tend
// to be background-tinted, and promoting them to opaque at a low threshold
// bakes that tint in as a visible fringe.
async function hardenAlphaEdges(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] < 200 ? 0 : 255
  }
  ctx.putImageData(imageData, 0, 0)

  return await canvas.convertToBlob({ type: "image/png" })
}

// After background removal, the garment often sits in the middle of a huge
// transparent canvas. This scans the alpha channel for the bounding box of
// actual (non-transparent) content and re-frames the image to that box plus a
// fixed margin, so every processed photo ends up with its garment occupying
// the SAME fraction of its canvas — which is what makes tiles in the grid
// render at consistent sizes.
//
// That guarantee is the point, and it's what the previous version got wrong.
// It padded by widening the crop rectangle read out of the SOURCE photo, then
// clamped that rectangle to the source's edges:
//
//     symPadX = Math.min(padX, leftRoom, rightRoom)
//
// So the padding was best-effort. A photo shot with lots of whitespace had
// room to give and got the full 12%; a photo shot tight had none and got ~0.
// Measured on the two extremes, the first ends up with the garment filling
// 80.7% of its canvas and the second 99.2% — so two pieces in the same
// category, at the same scale value, render ~24% different in size. That was
// the cause of one tile in a row looking bigger than its neighbours, not
// anything about the category or the garment's shape.
//
// The fix is to stop treating padding as something that has to be found in
// the source. The output canvas is simply built larger than the content and
// the content drawn into the middle of it; the margin is transparent pixels
// that never needed to exist in the original. Centred by construction on both
// axes, so the old off-centre correction isn't needed either.
async function cropToContent(blob: Blob, paddingPercent = 0.12): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const width = bitmap.width
  const height = bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const { data } = ctx.getImageData(0, 0, width, height)

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Fully transparent image (background removal found nothing) — bail out
  // and leave the image as-is rather than crashing on an invalid crop.
  if (minX > maxX || minY > maxY) {
    return await canvas.convertToBlob({ type: "image/png" })
  }

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  const padX = Math.round(contentWidth * paddingPercent)
  const padY = Math.round(contentHeight * paddingPercent)

  // Output is exactly the content plus a full margin on all four sides, every
  // time — never clamped to what the source happened to have spare. At the
  // default 12% that fixes the garment at 1 / 1.24 = 80.6% of the canvas on
  // both axes for every photo that passes through here.
  const cropWidth = contentWidth + padX * 2
  const cropHeight = contentHeight + padY * 2

  const cropCanvas = new OffscreenCanvas(cropWidth, cropHeight)
  const cropCtx = cropCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D
  // Source rect is the content box exactly; destination is inset by the
  // margin. Everything outside stays as the canvas was born — transparent.
  cropCtx.drawImage(
    canvas,
    minX,
    minY,
    contentWidth,
    contentHeight,
    padX,
    padY,
    contentWidth,
    contentHeight
  )

  return await cropCanvas.convertToBlob({ type: "image/png" })
}

// Each incoming message is { file, publicPath } (see runInWorker() in
// app/page.tsx / app/item/[id]/page.tsx, which creates a fresh worker per
// upload — so there's never more than one job in flight on a given worker
// instance, and no request-id bookkeeping is needed here). Posts back
// either { blob } on success or { error } on failure.
self.onmessage = async (event: MessageEvent) => {
  const { file, publicPath } = event.data as { file: File; publicPath: string }
  try {
    const removedBgBlob = await removeBackground(file, {
      publicPath,
      output: { format: "image/png" },
    })
    const resizedBlob = await resizeImage(removedBgBlob)
    const hardenedBlob = await hardenAlphaEdges(resizedBlob)
    const finalBlob = await cropToContent(hardenedBlob)
    self.postMessage({ blob: finalBlob })
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}

export {}
