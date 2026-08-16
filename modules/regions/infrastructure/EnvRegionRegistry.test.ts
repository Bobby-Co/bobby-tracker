import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { EnvRegionRegistry } from "./EnvRegionRegistry"
import type { CellId } from "../domain/CellId"
import type { RegionId } from "../domain/RegionId"

const KEYS = [
    "BOBBY_HOME_CELL",
    "BOBBY_HOME_REGION",
    "BOBBY_CELLS",
    "BOBBY_ANALYSER_URL",
    "BOBBY_ANALYSER_TOKEN",
    "BOBBY_ANALYSER_URL_ASHBURN_0",
    "BOBBY_ANALYSER_TOKEN_ASHBURN_0",
    "BOBBY_ANALYSER_URL_BANGKOK_0",
    "BOBBY_ANALYSER_TOKEN_BANGKOK_0",
    "BOBBY_ANALYSER_URL_BANGKOK_1",
    "BOBBY_CELL_LABEL_BANGKOK_0",
    "BOBBY_REGION_LABEL_SOUTH_EAST_ASIA",
] as const

const ASHBURN = "ashburn-0" as CellId
const BANGKOK_0 = "bangkok-0" as CellId
const BANGKOK_1 = "bangkok-1" as CellId
const SEA = "south-east-asia" as RegionId
const NA = "north-america" as RegionId

let saved: Record<string, string | undefined> = {}
const registry = new EnvRegionRegistry()

beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

// A deployment that predates all of this has only the unsuffixed pair set and
// must keep working with no config change whatsoever.
describe("zero config", () => {
    test("synthesises a single home cell served by the legacy vars", () => {
        process.env.BOBBY_ANALYSER_URL = "https://analyser.example"
        process.env.BOBBY_ANALYSER_TOKEN = "tok"

        expect(registry.homeCell()).toBe(ASHBURN)
        const cell = registry.cell(ASHBURN)
        expect(cell.analyserUrl).toBe("https://analyser.example")
        expect(cell.analyserToken).toBe("tok")
        expect(cell.region).toBe(NA)
        expect(registry.configuredCells().map((c) => c.id)).toEqual([ASHBURN])
    })

    test("offers exactly one region", () => {
        process.env.BOBBY_ANALYSER_URL = "https://analyser.example"
        const regions = registry.regions()
        expect(regions).toHaveLength(1)
        expect(regions[0].id).toBe(NA)
        expect(regions[0].label).toBe("North America")
    })
})

describe("manifest", () => {
    beforeEach(() => {
        process.env.BOBBY_CELLS = "ashburn-0:north-america,bangkok-0:south-east-asia"
        process.env.BOBBY_ANALYSER_URL = "https://ashburn.example"
        process.env.BOBBY_ANALYSER_URL_BANGKOK_0 = "https://bangkok.example"
        process.env.BOBBY_ANALYSER_TOKEN_BANGKOK_0 = "bkk-tok"
    })

    test("places each cell in its declared region", () => {
        expect(registry.cell(BANGKOK_0).region).toBe(SEA)
        expect(registry.cell(ASHBURN).region).toBe(NA)
    })

    test("groups configured cells into regions", () => {
        const regions = registry.regions()
        expect(regions.map((r) => r.id).sort()).toEqual([NA, SEA])
        expect(regions.find((r) => r.id === SEA)?.label).toBe("South East Asia")
    })

    // One malformed entry must not take routing down for every other cell.
    test("drops unparseable entries and keeps the rest", () => {
        process.env.BOBBY_CELLS = "ashburn-0:north-america,BAD ENTRY,bangkok-0:south-east-asia"
        expect(registry.configuredCells().map((c) => c.id).sort()).toEqual([ASHBURN, BANGKOK_0])
    })

    test("declares the home cell even when the manifest omits it", () => {
        process.env.BOBBY_CELLS = "bangkok-0:south-east-asia"
        expect(registry.cell(ASHBURN).analyserUrl).toBe("https://ashburn.example")
        expect(registry.configuredCells().map((c) => c.id)).toContain(ASHBURN)
    })
})

// The rule that stops a half-configured cell quietly sending Bangkok's work to
// Virginia.
describe("legacy vars serve the home cell only", () => {
    test("a declared but unconfigured cell reads empty, not inherited", () => {
        process.env.BOBBY_CELLS = "ashburn-0:north-america,bangkok-0:south-east-asia"
        process.env.BOBBY_ANALYSER_URL = "https://ashburn.example"
        process.env.BOBBY_ANALYSER_TOKEN = "tok"

        const bkk = registry.cell(BANGKOK_0)
        expect(bkk.analyserUrl).toBe("")
        expect(bkk.analyserToken).toBe("")
        expect(registry.isConfigured(BANGKOK_0)).toBe(false)
        expect(registry.isConfigured(ASHBURN)).toBe(true)
    })

    test("follow BOBBY_HOME_CELL when the home moves", () => {
        process.env.BOBBY_HOME_CELL = "bangkok-0"
        process.env.BOBBY_ANALYSER_URL = "https://bangkok.example"
        expect(registry.cell(BANGKOK_0).analyserUrl).toBe("https://bangkok.example")
    })

    test("a suffixed var wins over the legacy pair", () => {
        process.env.BOBBY_ANALYSER_URL = "https://legacy.example"
        process.env.BOBBY_ANALYSER_URL_ASHBURN_0 = "https://ashburn.example"
        expect(registry.cell(ASHBURN).analyserUrl).toBe("https://ashburn.example")
    })
})

describe("assignCell", () => {
    beforeEach(() => {
        process.env.BOBBY_CELLS =
            "ashburn-0:north-america,bangkok-0:south-east-asia,bangkok-1:south-east-asia"
        process.env.BOBBY_ANALYSER_URL = "https://ashburn.example"
        process.env.BOBBY_ANALYSER_URL_BANGKOK_0 = "https://bkk0.example"
        process.env.BOBBY_ANALYSER_URL_BANGKOK_1 = "https://bkk1.example"
    })

    test("places a project on a cell inside the requested region", () => {
        expect(registry.assignCell(SEA)).toBe(BANGKOK_0)
        expect(registry.assignCell(NA)).toBe(ASHBURN)
    })

    // Manifest order is the operator's preference order — placement must be
    // stable and reproducible until something deliberately makes it load-aware.
    test("is deterministic: manifest order decides", () => {
        expect(registry.assignCell(SEA)).toBe(BANGKOK_0)
        expect(registry.assignCell(SEA)).toBe(BANGKOK_0)
        process.env.BOBBY_CELLS = "bangkok-1:south-east-asia,bangkok-0:south-east-asia"
        expect(registry.assignCell(SEA)).toBe(BANGKOK_1)
    })

    test("skips a declared-but-unconfigured cell", () => {
        delete process.env.BOBBY_ANALYSER_URL_BANGKOK_0
        expect(registry.assignCell(SEA)).toBe(BANGKOK_1)
    })

    test("returns null for a region with nothing behind it", () => {
        expect(registry.assignCell("eu-central" as RegionId)).toBeNull()
    })
})

describe("labels", () => {
    test("config overrides the derived form", () => {
        process.env.BOBBY_CELLS = "bangkok-0:south-east-asia"
        process.env.BOBBY_ANALYSER_URL_BANGKOK_0 = "https://bkk.example"
        process.env.BOBBY_CELL_LABEL_BANGKOK_0 = "Bangkok (primary)"
        process.env.BOBBY_REGION_LABEL_SOUTH_EAST_ASIA = "Southeast Asia"

        expect(registry.cell(BANGKOK_0).label).toBe("Bangkok (primary)")
        expect(registry.regions().find((r) => r.id === SEA)?.label).toBe("Southeast Asia")
    })
})
