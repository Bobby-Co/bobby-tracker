"use client"

import { cn } from "@/components/ui/cn"

// A minimal low-poly world for picking a region.
//
// The projection is EQUIRECTANGULAR and the viewBox is exactly 2:1, so
// longitude and latitude map to x and y linearly:
//
//     x = (lon + 180) * 2      y = (90 - lat) * 2
//
// That matters more than it looks. The landmasses below are deliberately coarse
// — low-poly is a style, not a claim of accuracy — but the PINS are projected
// from real coordinates, so a region sits where a reader expects it even though
// the coastline behind it is a dozen straight lines. Stylise the continents,
// never the positions.

/** lon/lat → viewBox units. */
const px = (lon: number) => (lon + 180) * 2
const py = (lat: number) => (90 - lat) * 2

/** Where each region's pin sits. Keyed by the open region slug, so an id nobody
 *  has mapped yet simply has no pin — it still appears in the list beneath the
 *  map rather than vanishing. Adding a region does not require touching this. */
const REGION_POINTS: Record<string, { lon: number; lat: number }> = {
    "north-america": { lon: -98, lat: 40 },
    "south-america": { lon: -58, lat: -15 },
    "europe": { lon: 10, lat: 52 },
    "eu-west": { lon: 2, lat: 48 },
    "eu-central": { lon: 14, lat: 50 },
    "africa": { lon: 20, lat: 2 },
    "middle-east": { lon: 45, lat: 27 },
    "south-asia": { lon: 78, lat: 22 },
    "south-east-asia": { lon: 106, lat: 4 },
    "east-asia": { lon: 120, lat: 35 },
    "oceania": { lon: 134, lat: -25 },
}

// Coarse continent outlines, authored directly in viewBox units. Angular on
// purpose: every vertex is a deliberate corner rather than a sampled coastline.
const LANDMASSES: string[] = [
    // North America — Alaska, the Canadian shield, the Gulf, down to Panama.
    "48,60 96,42 170,34 230,60 240,90 210,110 196,130 184,152 166,144 150,140 130,116 108,86 72,68",
    // Greenland
    "270,14 316,20 316,44 280,60 250,40",
    // South America — broad at the equator, tapering to Tierra del Fuego.
    "204,164 240,156 290,190 284,204 276,226 244,250 224,284 216,260 210,216 198,190",
    // Europe
    "342,94 350,64 370,38 416,40 440,64 432,90 400,100 384,90 360,80",
    // Africa — wide across the Sahara, narrowing past the Congo to the Cape.
    "326,138 360,108 424,118 446,156 462,158 440,196 428,230 406,248 392,236 380,190 350,170 326,152",
    // Asia — Siberia across the top, with Arabia and the Indian peninsula hanging
    // beneath. The two southward spurs are what stop it reading as one slab.
    "444,70 480,30 570,24 672,40 702,58 640,84 604,116 570,140 536,136 516,164 500,130 476,136 456,120 448,100",
    // Maritime Southeast Asia
    "552,170 596,166 610,184 640,188 624,196 570,194",
    // Australia
    "588,224 620,204 646,204 666,234 652,256 618,244 590,248",
]

export interface RegionOption {
    id: string
    label: string
}

export function RegionMap({
    regions,
    value,
    onChange,
    disabled,
}: {
    regions: RegionOption[]
    value: string
    onChange: (id: string) => void
    disabled?: boolean
}) {
    const pinned = regions.filter((r) => REGION_POINTS[r.id])
    const unpinned = regions.filter((r) => !REGION_POINTS[r.id])

    return (
        <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-overlay)]">
                <svg
                    viewBox="0 0 720 360"
                    className="block h-auto w-full"
                    role="radiogroup"
                    aria-label="Region"
                >
                    {LANDMASSES.map((points, i) => (
                        <polygon
                            key={i}
                            points={points}
                            className="fill-[color:var(--c-surface)] stroke-[color:var(--c-border-strong)]"
                            strokeWidth={1.25}
                            strokeLinejoin="round"
                        />
                    ))}

                    {pinned.map((r) => {
                        const { lon, lat } = REGION_POINTS[r.id]
                        const x = px(lon)
                        const y = py(lat)
                        const selected = r.id === value
                        return (
                            <g
                                key={r.id}
                                role="radio"
                                aria-checked={selected}
                                aria-label={r.label}
                                tabIndex={disabled ? -1 : 0}
                                onClick={() => !disabled && onChange(r.id)}
                                onKeyDown={(e) => {
                                    // Space and Enter both commit, matching a native radio.
                                    if (disabled) return
                                    if (e.key === " " || e.key === "Enter") {
                                        e.preventDefault()
                                        onChange(r.id)
                                    }
                                }}
                                className={cn(
                                    "outline-none",
                                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                                    "focus-visible:[&>circle:first-of-type]:stroke-[color:var(--c-ring)]",
                                )}
                            >
                                {/* Halo: the focus/selection ring AND a generous hit target —
                                    a 6px dot is far too small to click accurately. */}
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={18}
                                    fill="transparent"
                                    strokeWidth={3}
                                    className={cn(
                                        selected ? "stroke-[color:var(--c-ring)]" : "stroke-transparent",
                                    )}
                                />
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={selected ? 9 : 6}
                                    className={cn(
                                        "transition-all",
                                        selected
                                            ? "fill-[color:var(--c-primary)]"
                                            : "fill-[color:var(--c-text-muted)] hover:fill-[color:var(--c-text)]",
                                    )}
                                />
                                <text
                                    x={x}
                                    y={y - 20}
                                    textAnchor="middle"
                                    className={cn(
                                        "select-none text-[15px]",
                                        selected
                                            ? "fill-[color:var(--c-text)] font-semibold"
                                            : "fill-[color:var(--c-text-muted)]",
                                    )}
                                >
                                    {r.label}
                                </text>
                            </g>
                        )
                    })}
                </svg>
            </div>

            {/* A region the map has no coordinates for is still selectable. The id
                space is open by design — a new cell is a config change — so the UI
                must not silently drop what it hasn't been taught to draw. */}
            {unpinned.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {unpinned.map((r) => (
                        <button
                            key={r.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(r.id)}
                            className={cn(
                                "rounded-[8px] border px-2.5 py-1 text-[12px] transition-colors",
                                r.id === value
                                    ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary)] text-white"
                                    : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
