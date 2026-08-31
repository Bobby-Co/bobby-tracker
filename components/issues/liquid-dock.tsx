"use client"

// The liquid, done the way liquid is actually done.
//
// Two earlier attempts DREW the split: a path with a hand-built waist, morphed
// keyframe to keyframe. Both looked wrong, and they were wrong for the same
// reason — a tearing neck is not a shape you can author, it is what you get
// when two round things are near each other. Authoring it means guessing the
// answer, and every guess was visibly a guess: a raindrop, a stretched thread,
// a semicircle that could never become a circle.
//
// So: draw the two shapes, and let the merge emerge.
//
// Blur a group of solid shapes and their edges bleed into one another; push the
// result's alpha through a steep contrast curve and that haze snaps back to a
// hard edge. Where two shapes were close, the re-hardened outline joins them
// with a concave neck. Move one away and the neck thins, necks in, and lets go
// — with the surface-tension shape that only falls out of the maths. Nothing
// here describes a neck. There is a circle, a capsule, and a filter.
//
// ─── why this layer exists at all ─────────────────────────────────────────
//
// The filter blurs everything inside it, so no text and no border can live
// here: they would turn to mush. This layer is therefore the BACKGROUND of
// both controls — the actual fill you see — and the real button and the real
// label render on top of it with transparent backgrounds. Which also means
// there is no handoff anywhere in the sequence: the same two blobs are the
// button before the gesture and the button-plus-pill after it.
//
// An earlier version put filtered blobs BEHIND controls that had their own
// backgrounds, so the goo could never merge with the thing it was supposed to
// be part of, and all it contributed was a grey smudge at the edges.

/** The blobs are the ember fill, not the faint tint an earlier version used.
 *  A filtered layer cannot carry a border — the blur destroys it — and the tint
 *  alone is within a few points of the panel colour, so without the border the
 *  control simply disappeared. A solid fill is the only version of this that is
 *  visible at all, and it is also what makes the liquid readable: the reference
 *  is one bold colour on one ground, for exactly this reason.
 *
 *  Room around the blobs for the blur to spill into. A filter is clipped to
 *  its region, and the default region would cut the neck off flat. */
const PAD = 16

/** How far apart the two blobs sit once the pill has landed. Small, because
 *  the filter has to still see them as neighbours to have drawn a neck at all;
 *  push them further and the join is already gone before the motion is. */
export const GOO_GAP = 7

export function LiquidBackdrop({
    open,
    /** The button's width — the fixed blob. */
    buttonWidth,
    /** Height of both controls, which is also the ball's diameter. */
    height,
    /** How wide the pill ends up once it has opened. */
    pillWidth,
}: {
    open: boolean
    buttonWidth: number
    height: number
    pillWidth: number
}) {
    if (buttonWidth === 0 || height === 0) return null

    // At rest the ball sits exactly on the button's left cap — same centre,
    // same diameter — so the two blobs are one shape and what you see is the
    // button. That is why nothing has to fade in when the gesture starts.
    const parked = -(buttonWidth - height)
    const landed = -(buttonWidth + GOO_GAP)

    return (
        <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{ inset: -PAD, filter: "url(#liquid-goo)" }}
        >
            {/* The button. Never moves. */}
            <div
                className="absolute rounded-full bg-[color:var(--c-primary)]"
                style={{ right: PAD, bottom: PAD, width: buttonWidth, height }}
            />
            {/* The drop. Travels first, then opens — one property at a time, so
                the neck has finished tearing before anything starts widening.
                Right-anchored, so opening grows it away from the button rather
                than back toward it. */}
            <div
                className="absolute rounded-full bg-[color:var(--c-primary)]"
                style={{
                    right: PAD,
                    bottom: PAD,
                    height,
                    width: open ? pillWidth : height,
                    transform: `translateX(${open ? landed : parked}px)`,
                    transition: open
                        ? // Out: a spring that overshoots and settles, which is
                          // what a drop released by surface tension does. The
                          // widening waits for the travel to finish.
                          "transform 460ms cubic-bezier(0.34, 1.4, 0.5, 1), width 260ms cubic-bezier(0.16, 1, 0.3, 1) 380ms"
                        : // Back: width first, then home. Retracting while still
                          // wide drags a long tongue across the gap.
                          "transform 300ms cubic-bezier(0.4, 0, 0.2, 1) 120ms, width 160ms ease-in",
                }}
            />
        </div>
    )
}

/** The threshold filter, mounted once alongside the blobs.
 *
 *  stdDeviation sets how far apart two shapes can be and still be seen as one
 *  — it is the reach of the neck. The colour matrix's last row is the contrast:
 *  a large alpha multiplier with an offset that drops everything below the
 *  midpoint to nothing and lifts everything above it to solid. Together they
 *  turn a soft haze back into a hard outline, and the shape of that outline
 *  between two neighbours IS the neck.
 *
 *  Tuned for a control about 30px tall. A blur too small never bridges the gap;
 *  too large and the blobs look inflated and the join never breaks. */
export function LiquidGooFilter() {
    return (
        <svg aria-hidden focusable="false" width="0" height="0" className="absolute">
            <defs>
                <filter id="liquid-goo" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="haze" />
                    <feColorMatrix
                        in="haze"
                        type="matrix"
                        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -10"
                    />
                </filter>
            </defs>
        </svg>
    )
}
