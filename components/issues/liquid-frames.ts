// The split, baked.
//
// The live SVG filter produced exactly the right shape and cannot ship: Safari
// does not reliably re-rasterise a filter while the element under it animates,
// so the drop would freeze on its first frame and then jump. That is not a
// degradation anyone would read as a style choice.
//
// So the filter runs ONCE, here, off-screen and in plain arithmetic — the same
// blur and the same threshold — and what comes out is traced into ordinary SVG
// paths. Playback is then a `<path>` whose `d` is swapped, which every engine
// has drawn correctly for twenty years. The look is not an approximation of the
// filtered version; it is the filtered version, measured.
//
// ─── what "the same" means here ───────────────────────────────────────────
//
// A gooey join is the isoline of a blurred union. Rasterise each shape's
// coverage, keep the union, blur it, and take the contour where the result
// crosses one half: shapes that are close share one contour with a concave
// waist between them, and shapes that are far apart have two. Nothing in this
// file knows what a neck is, exactly as before.
//
// It also buys two things the filter could not give:
//   - a real stroke. The filter had to recover its border by thresholding the
//     blur twice and subtracting, because a blur destroys any stroke it is
//     given. A traced path just takes `stroke="1"`.
//   - honest separation. The filter's output is one image, so "two shapes" and
//     "one pinched shape" look alike; a traced frame is genuinely two subpaths.

export interface DockGeometry {
    /** Full span the animation occupies, button plus gap plus drop. */
    width: number
    height: number
    /** The fixed right-hand end. */
    buttonWidth: number
    /** What the drop opens into. */
    pillWidth: number
    /** Distance between the two once the drop has landed. */
    gap: number
    /** Corner radius of both ends when they are rectangles. */
    radius: number
}

/** How often the baked frames are sampled. 18ms is a shade over one frame at
 *  60Hz — close enough that playback never shows the same path twice in a row,
 *  and coarse enough to keep the baked string list small. */
export const FRAME_STEP_MS = 18
/** The drop's travel, and the opening that overlaps its tail. */
export const TRAVEL_MS = 380
export const WIDEN_FROM_MS = 300
export const WIDEN_MS = 240
/** Everything, start to finish. */
export const OPEN_MS = WIDEN_FROM_MS + WIDEN_MS

/** Spring with a little overshoot — a drop let go by surface tension. */
function springOut(t: number): number {
    if (t >= 1) return 1
    return 1 - Math.pow(2, -9 * t) * Math.cos(t * 9)
}

function easeOut(t: number): number {
    return t >= 1 ? 1 : 1 - Math.pow(1 - t, 3)
}

/** Where the two shapes are at `ms` into the gesture. The easings live here,
 *  so the baked frames already carry them and playback is a plain clock. */
export function shapesAt(geo: DockGeometry, ms: number) {
    const travel = springOut(Math.min(1, ms / TRAVEL_MS))
    const widen = easeOut(Math.max(0, Math.min(1, (ms - WIDEN_FROM_MS) / WIDEN_MS)))

    // At rest the drop sits exactly on the button's left end — same size, same
    // place — so the union is the button and nothing has to appear.
    const parkedRight = geo.width - (geo.buttonWidth - geo.height)
    const landedRight = geo.width - (geo.buttonWidth + geo.gap)
    const right = parkedRight + (landedRight - parkedRight) * travel
    const dropWidth = geo.height + (geo.pillWidth - geo.height) * widen

    return {
        button: { x: geo.width - geo.buttonWidth, w: geo.buttonWidth, r: geo.radius },
        // A circle while it is a drop; the button's own corner once it is a pill.
        drop: { x: right - dropWidth, w: dropWidth, r: geo.height / 2 + (geo.radius - geo.height / 2) * widen },
    }
}

/** Signed distance to a rounded rectangle: negative inside. */
function sdRoundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
    const qx = Math.abs(px - cx) - (hw - r)
    const qy = Math.abs(py - cy) - (hh - r)
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

/** Three box passes approximate a Gaussian closely enough that the difference
 *  is invisible at this size, and unlike a true Gaussian it is O(n) per pass.
 *  Width chosen so the result matches the filter's stdDeviation. */
function boxWidthFor(sigma: number): number {
    const w = Math.floor(Math.sqrt(4 * sigma * sigma + 1))
    return w % 2 === 0 ? w + 1 : w
}

function blurPass(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number, vertical: boolean) {
    const outer = vertical ? w : h
    const inner = vertical ? h : w
    const stride = vertical ? w : 1
    const jump = vertical ? 1 : w
    const norm = 1 / (radius * 2 + 1)
    for (let o = 0; o < outer; o++) {
        const base = o * jump
        let sum = 0
        for (let i = -radius; i <= radius; i++) {
            sum += src[base + Math.min(inner - 1, Math.max(0, i)) * stride]
        }
        for (let i = 0; i < inner; i++) {
            dst[base + i * stride] = sum * norm
            const out = base + Math.min(inner - 1, Math.max(0, i - radius)) * stride
            const inn = base + Math.min(inner - 1, Math.max(0, i + radius + 1)) * stride
            sum += src[inn] - src[out]
        }
    }
}

/** The blurred coverage field for one moment, on a 1px grid. */
export function fieldAt(geo: DockGeometry, ms: number, sigma: number, pad: number): { f: Float32Array; w: number; h: number } {
    const w = Math.ceil(geo.width) + pad * 2
    const h = Math.ceil(geo.height) + pad * 2
    const { button, drop } = shapesAt(geo, ms)

    const cov = new Float32Array(w * h)
    const cy = pad + geo.height / 2
    const hh = geo.height / 2
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5
            const py = y + 0.5
            const a = sdRoundRect(px, py, pad + button.x + button.w / 2, cy, button.w / 2, hh, button.r)
            const b = sdRoundRect(px, py, pad + drop.x + drop.w / 2, cy, drop.w / 2, hh, drop.r)
            // Antialiased coverage of the UNION, which is what the filter blurs.
            const d = Math.min(a, b)
            cov[y * w + x] = Math.max(0, Math.min(1, 0.5 - d))
        }
    }

    const r = (boxWidthFor(sigma) - 1) / 2
    const tmp = new Float32Array(w * h)
    blurPass(cov, tmp, w, h, r, false)
    blurPass(tmp, cov, w, h, r, true)
    blurPass(cov, tmp, w, h, r, false)
    blurPass(tmp, cov, w, h, r, true)
    blurPass(cov, tmp, w, h, r, false)
    blurPass(tmp, cov, w, h, r, true)
    return { f: cov, w, h }
}

type Pt = { x: number; y: number }

/** Marching squares: every cell contributes the segment(s) where the field
 *  crosses `iso`, with the crossing placed by linear interpolation so the
 *  result is smooth rather than stepped. */
function isoSegments(f: Float32Array, w: number, h: number, iso: number): [Pt, Pt][] {
    const segs: [Pt, Pt][] = []
    const at = (x: number, y: number) => f[y * w + x]
    const lerp = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): Pt => {
        const t = (iso - v0) / (v1 - v0 || 1e-6)
        return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }
    }

    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const v0 = at(x, y)
            const v1 = at(x + 1, y)
            const v2 = at(x + 1, y + 1)
            const v3 = at(x, y + 1)
            const idx = (v0 > iso ? 1 : 0) | (v1 > iso ? 2 : 0) | (v2 > iso ? 4 : 0) | (v3 > iso ? 8 : 0)
            if (idx === 0 || idx === 15) continue

            const top = () => lerp(x, y, v0, x + 1, y, v1)
            const right = () => lerp(x + 1, y, v1, x + 1, y + 1, v2)
            const bottom = () => lerp(x + 1, y + 1, v2, x, y + 1, v3)
            const left = () => lerp(x, y + 1, v3, x, y, v0)

            switch (idx) {
                case 1: case 14: segs.push([left(), top()]); break
                case 2: case 13: segs.push([top(), right()]); break
                case 3: case 12: segs.push([left(), right()]); break
                case 4: case 11: segs.push([right(), bottom()]); break
                case 6: case 9: segs.push([top(), bottom()]); break
                case 7: case 8: segs.push([left(), bottom()]); break
                // Saddles: resolved by the cell's average, so the two branches
                // never cross each other.
                case 5:
                    if ((v0 + v1 + v2 + v3) / 4 > iso) { segs.push([left(), top()]); segs.push([right(), bottom()]) }
                    else { segs.push([left(), bottom()]); segs.push([top(), right()]) }
                    break
                case 10:
                    if ((v0 + v1 + v2 + v3) / 4 > iso) { segs.push([top(), right()]); segs.push([left(), bottom()]) }
                    else { segs.push([left(), top()]); segs.push([right(), bottom()]) }
                    break
            }
        }
    }
    return segs
}

const KEY = (p: Pt) => `${Math.round(p.x * 64)},${Math.round(p.y * 64)}`

/** Stitch loose segments into closed loops. Two shapes give two loops, one
 *  shape gives one — which is how a baked frame can say "separated" outright,
 *  where the filter could only ever hand back a single picture. */
function stitch(segs: [Pt, Pt][]): Pt[][] {
    const from = new Map<string, number[]>()
    segs.forEach(([a], i) => {
        const k = KEY(a)
        const list = from.get(k)
        if (list) list.push(i)
        else from.set(k, [i])
    })

    const used = new Array(segs.length).fill(false)
    const loops: Pt[][] = []

    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue
        const loop: Pt[] = [segs[i][0]]
        let cur = i
        used[cur] = true
        for (let guard = 0; guard < segs.length + 2; guard++) {
            const end = segs[cur][1]
            loop.push(end)
            const next = (from.get(KEY(end)) ?? []).find((j) => !used[j])
            if (next === undefined) break
            used[next] = true
            cur = next
        }
        if (loop.length > 3) loops.push(loop)
    }
    return loops
}

/** Douglas–Peucker, so a contour that arrives as several hundred one-pixel
 *  steps ships as a few dozen points. */
function simplify(pts: Pt[], tol: number): Pt[] {
    if (pts.length < 3) return pts
    const keep = new Array(pts.length).fill(false)
    keep[0] = keep[pts.length - 1] = true
    const stack: [number, number][] = [[0, pts.length - 1]]
    while (stack.length) {
        const [a, b] = stack.pop()!
        let far = -1
        let best = tol
        const ax = pts[a].x
        const ay = pts[a].y
        const dx = pts[b].x - ax
        const dy = pts[b].y - ay
        const len = Math.hypot(dx, dy) || 1e-6
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((pts[i].x - ax) * dy - (pts[i].y - ay) * dx) / len
            if (d > best) { best = d; far = i }
        }
        if (far > 0) {
            keep[far] = true
            stack.push([a, far], [far, b])
        }
    }
    return pts.filter((_, i) => keep[i])
}

/** One frame's `d`, in the dock's own coordinates (the pad is subtracted back
 *  out so the path lines up with the controls on top of it). */
export function traceFrame(geo: DockGeometry, ms: number, sigma: number, pad: number): string {
    const { f, w, h } = fieldAt(geo, ms, sigma, pad)
    const loops = stitch(isoSegments(f, w, h, 0.5))
    const n = (v: number) => Math.round(v * 10) / 10
    return loops
        .map((loop) => simplify(loop, 0.28))
        .filter((loop) => loop.length > 3)
        .map((loop) => `M ${loop.map((p) => `${n(p.x - pad)} ${n(p.y - pad)}`).join(" L ")} Z`)
        .join(" ")
}

/** Every frame of the gesture, baked. Call once per geometry. */
export function bakeFrames(geo: DockGeometry, sigma = 3.5, pad = 12): string[] {
    const count = Math.ceil(OPEN_MS / FRAME_STEP_MS)
    return Array.from({ length: count + 1 }, (_, i) => traceFrame(geo, i * FRAME_STEP_MS, sigma, pad))
}
