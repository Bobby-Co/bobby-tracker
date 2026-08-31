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

/** The blobs are painted by the FILTER, not by these elements — see
 *  LiquidGooFilter, which floods the body and its recovered outline separately.
 *  The background set on them is only what a browser that dropped the flood
 *  would fall back to, so it matches the intended body colour.
 *
 *  Room around the blobs for the blur to spill into. A filter is clipped to
 *  its region, and the default region would cut the neck off flat. */
const PAD = 16

// ─── the beats, shared with the label that rides on top ────────────────────
//
// The label has to move with the blob exactly and reveal itself only once the
// blob has opened, so both read from the same numbers. Split across two files
// they drift, and the drift shows up as text sliding around outside its own
// background.

/** The drop's travel: a spring that overshoots and settles, which is what a
 *  drop released by surface tension does. */
export const TRAVEL_MS = 380
/** The opening, which starts just before the travel finishes and runs on. */
export const WIDEN_DELAY_MS = 300
export const WIDEN_MS = 240

const BLOB_OUT =
    `transform ${TRAVEL_MS}ms cubic-bezier(0.34, 1.4, 0.5, 1),` +
    ` width ${WIDEN_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${WIDEN_DELAY_MS}ms`
// Back: width first, then home. Retracting while still wide drags a long
// tongue across the gap.
const BLOB_BACK = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1) 100ms, width 150ms ease-in"

/** The label's transform, so it rides the drop rather than chasing it. */
export const LABEL_TRAVEL = `transform ${TRAVEL_MS}ms cubic-bezier(0.34, 1.4, 0.5, 1)`
export const LABEL_TRAVEL_BACK = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1) 100ms"

/** When the label's parts show themselves: WITH the opening, so the words
 *  arrive as the circle becomes a button rather than after it already is one.
 *
 *  Riding out from the start was the bug this fixes — the drop is a CIRCLE for
 *  its whole journey, so a full-width label on top of it is a line of text
 *  crossing empty panel, which reads as text sliding rather than as a drop
 *  being thrown. Nothing appears until there is a pill opening to hold it, and
 *  then it appears while that is still happening. */
export const ICON_DELAY_MS = WIDEN_DELAY_MS + 40
export const TEXT_DELAY_MS = WIDEN_DELAY_MS + 90

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
                className="absolute rounded-full bg-[color:var(--c-surface-2)]"
                style={{ right: PAD, bottom: PAD, width: buttonWidth, height }}
            />
            {/* The drop. Travels first, then opens — one property at a time, so
                the neck has finished tearing before anything starts widening.
                Right-anchored, so opening grows it away from the button rather
                than back toward it. */}
            <div
                className="absolute rounded-full bg-[color:var(--c-surface-2)]"
                style={{
                    right: PAD,
                    bottom: PAD,
                    height,
                    width: open ? pillWidth : height,
                    transform: `translateX(${open ? landed : parked}px)`,
                    transition: open ? BLOB_OUT : BLOB_BACK,
                }}
            />
        </div>
    )
}

/** The threshold filter, mounted once alongside the blobs.
 *
 *  ─── how a filtered shape gets a border ───────────────────────────────────
 *
 *  It cannot have one in the ordinary way: the blur destroys any stroke the
 *  source carries, which is why the first version of this had to be a solid
 *  fill with no outline at all. But the edge can be RECOVERED from the blur
 *  itself.
 *
 *  Threshold the same haze twice at slightly different levels. The lower cut
 *  keeps a fraction more of the blur's skirt, so it yields a marginally larger
 *  silhouette; subtract the tighter one from it and what is left is a ring
 *  exactly tracking the outline — including around the neck, which is the whole
 *  point, since that outline is the part nothing could have drawn.
 *
 *  Each half is then flooded with its own colour: a light fill for the body, the
 *  accent for the ring. Two thresholds, one subtraction, two floods.
 *
 *  The GAP between the thresholds is the border's thickness. A Gaussian's edge
 *  falls at about 1/(sigma·sqrt(2·pi)) per pixel — near 0.066 here — so the 0.08
 *  of alpha between these two cuts is worth a little over a pixel. */
export function LiquidGooFilter() {
    return (
        <svg aria-hidden focusable="false" width="0" height="0" className="absolute">
            <defs>
                <filter id="liquid-goo" x="-30%" y="-30%" width="160%" height="160%">
                    {/* stdDeviation is the reach of the neck: how far apart two
                        shapes can be and still be seen as one. */}
                    <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="haze" />

                    {/* The looser cut — the outer edge of the border. */}
                    <feColorMatrix
                        in="haze"
                        type="matrix"
                        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -9.5"
                        result="outer"
                    />
                    {/* The tighter cut — the body, and the border's inner edge. */}
                    <feColorMatrix
                        in="haze"
                        type="matrix"
                        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -11.1"
                        result="body"
                    />
                    <feComposite in="outer" in2="body" operator="out" result="ring" />

                    {/* surface-2, not surface: the panel this sits on IS surface, so a
                        control filled with it would read as a hole with an outline. */}
                    <feFlood style={{ floodColor: "var(--c-surface-2)" }} result="fillPaint" />
                    <feComposite in="fillPaint" in2="body" operator="in" result="filled" />

                    <feFlood style={{ floodColor: "var(--c-primary)" }} result="ringPaint" />
                    <feComposite in="ringPaint" in2="ring" operator="in" result="stroked" />

                    <feMerge>
                        <feMergeNode in="filled" />
                        <feMergeNode in="stroked" />
                    </feMerge>
                </filter>
            </defs>
        </svg>
    )
}
