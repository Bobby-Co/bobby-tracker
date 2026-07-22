"use client"

// Client-side image compression for the AI composer. We resize to a
// max long-side and re-encode as JPEG before upload — saves bandwidth
// and keeps the API payload small. Token cost on the model side is
// already capped (we send images with detail:"low", ~85 tokens flat),
// so the compression is purely a transport optimization.

const DEFAULT_MAX_DIM = 1024  // pixels on the long side
const DEFAULT_QUALITY = 0.78  // JPEG quality

export interface CompressedImage {
    /** data: URI suitable for both <img src> and the OpenAI vision API. */
    dataUrl: string
    /** Encoded byte size — useful for showing the user how much was saved. */
    bytes: number
    width: number
    height: number
    mimeType: "image/jpeg"
}

export async function compressImage(
    file: File,
    opts: { maxDim?: number; quality?: number } = {},
): Promise<CompressedImage> {
    const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM
    const quality = opts.quality ?? DEFAULT_QUALITY

    const bitmap = await loadBitmap(file)
    try {
        const { width, height } = scaleDown(bitmap.width, bitmap.height, maxDim)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas 2D context unavailable.")
        ctx.drawImage(bitmap, 0, 0, width, height)

        const blob = await canvasToBlob(canvas, "image/jpeg", quality)
        const dataUrl = await blobToDataUrl(blob)
        return { dataUrl, bytes: blob.size, width, height, mimeType: "image/jpeg" }
    } finally {
        // ImageBitmap holds raw pixel data — release it so we don't
        // accumulate megabytes when the user picks a batch of photos.
        if ("close" in bitmap) bitmap.close()
    }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
    // createImageBitmap honors EXIF orientation in modern browsers
    // (`imageOrientation: "from-image"`); without that, photos from
    // phones come in rotated.
    return await createImageBitmap(file, { imageOrientation: "from-image" })
}

function scaleDown(srcW: number, srcH: number, maxDim: number) {
    if (srcW <= maxDim && srcH <= maxDim) return { width: srcW, height: srcH }
    const scale = maxDim / Math.max(srcW, srcH)
    return {
        width: Math.round(srcW * scale),
        height: Math.round(srcH * scale),
    }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed."))),
            type,
            quality,
        )
    })
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error ?? new Error("FileReader failed."))
        r.readAsDataURL(blob)
    })
}
