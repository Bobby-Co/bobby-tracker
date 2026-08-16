import { test, expect, describe } from "bun:test"
import { deriveRegionLabel, isRegionId, parseRegionId, type RegionId } from "./RegionId"
import { deriveCellLabel, isCellId, parseCellId, type CellId } from "./CellId"

describe("parseRegionId", () => {
    test("accepts hyphenated slugs", () => {
        expect(parseRegionId("north-america")).toBe("north-america" as RegionId)
        expect(parseRegionId("south-east-asia")).toBe("south-east-asia" as RegionId)
    })

    // The point of returning null instead of a default: silently substituting a
    // region would place a customer's data in a geography they never chose.
    test("rejects anything that isn't a lowercase slug", () => {
        expect(parseRegionId("North-America")).toBeNull()
        expect(parseRegionId("south east asia")).toBeNull()
        expect(parseRegionId("-leading")).toBeNull()
        expect(parseRegionId("trailing-")).toBeNull()
        expect(parseRegionId("double--hyphen")).toBeNull()
        expect(parseRegionId("0-leading-digit")).toBeNull()
        expect(parseRegionId("")).toBeNull()
    })

    test("rejects absent input", () => {
        expect(parseRegionId(null)).toBeNull()
        expect(parseRegionId(undefined)).toBeNull()
    })

    test("bounds the length", () => {
        expect(parseRegionId("a".repeat(65))).toBeNull()
    })
})

describe("parseCellId", () => {
    test("accepts place-ordinal ids", () => {
        expect(parseCellId("ashburn-0")).toBe("ashburn-0" as CellId)
        expect(parseCellId("bangkok-11")).toBe("bangkok-11" as CellId)
    })

    test("rejects malformed ids", () => {
        expect(parseCellId("Bangkok-0")).toBeNull()
        expect(parseCellId("bangkok_0")).toBeNull()
        expect(parseCellId(null)).toBeNull()
    })

    test("isCellId rejects non-strings", () => {
        expect(isCellId(1)).toBe(false)
        expect(isCellId(null)).toBe(false)
        expect(isCellId({})).toBe(false)
    })
})

// Both are open types, so ids the code has never heard of must still parse —
// that is what makes adding a cell an env change rather than a deploy.
describe("open by design", () => {
    test("an id nobody has declared still parses", () => {
        expect(parseCellId("frankfurt-2")).toBe("frankfurt-2" as CellId)
        expect(parseRegionId("eu-central")).toBe("eu-central" as RegionId)
    })

    test("isRegionId agrees with parseRegionId", () => {
        expect(isRegionId("eu-central")).toBe(true)
        expect(isRegionId("EU")).toBe(false)
    })
})

describe("derived labels", () => {
    test("title-cases each segment", () => {
        expect(deriveRegionLabel("south-east-asia" as RegionId)).toBe("South East Asia")
        expect(deriveCellLabel("bangkok-0" as CellId)).toBe("Bangkok 0")
        expect(deriveCellLabel("ashburn-0" as CellId)).toBe("Ashburn 0")
    })
})
