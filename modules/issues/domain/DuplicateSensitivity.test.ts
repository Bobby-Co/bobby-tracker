import { describe, expect, test } from "bun:test"
import {
    DEFAULT_DUPLICATE_SENSITIVITY,
    DUPLICATE_SENSITIVITIES,
    SENSITIVITY_COPY,
    duplicateThreshold,
    parseDuplicateSensitivity,
} from "./DuplicateSensitivity"

describe("thresholds", () => {
    test("the agreed numbers", () => {
        expect(duplicateThreshold("low")).toBe(0.9)
        expect(duplicateThreshold("medium")).toBe(0.8)
        expect(duplicateThreshold("high")).toBe(0.7)
        expect(duplicateThreshold("veryhigh")).toBe(0.65)
    })

    // The inversion is the thing most likely to be "fixed" into a bug by someone
    // skim-reading: MORE sensitivity means a LOWER bar.
    test("higher sensitivity means a strictly lower threshold", () => {
        const ordered = DUPLICATE_SENSITIVITIES.map(duplicateThreshold)
        for (let i = 1; i < ordered.length; i++) {
            expect(ordered[i]).toBeLessThan(ordered[i - 1])
        }
    })

    test("medium is the default", () => {
        expect(DEFAULT_DUPLICATE_SENSITIVITY).toBe("medium")
        expect(duplicateThreshold(undefined)).toBe(duplicateThreshold("medium"))
    })
})

describe("parseDuplicateSensitivity", () => {
    test("passes through every known level", () => {
        for (const level of DUPLICATE_SENSITIVITIES) {
            expect(parseDuplicateSensitivity(level)).toBe(level)
        }
    })

    // Degrading beats throwing: this parses a database column, and a 500 on every
    // similarity lookup is a worse outcome than the default threshold.
    test.each([null, undefined, "", "HIGH", "extreme", 0.7, {}])("%p degrades to the default", (bad) => {
        expect(parseDuplicateSensitivity(bad)).toBe(DEFAULT_DUPLICATE_SENSITIVITY)
    })
})

describe("copy", () => {
    test("every level has UI copy", () => {
        for (const level of DUPLICATE_SENSITIVITIES) {
            expect(SENSITIVITY_COPY[level]?.label).toBeTruthy()
            expect(SENSITIVITY_COPY[level]?.detail).toBeTruthy()
        }
    })

    // The user asked specifically that loose levels warn about false positives.
    test("the two loosest levels carry a caution, the strict ones do not", () => {
        expect(SENSITIVITY_COPY.veryhigh.caution).toBeTruthy()
        expect(SENSITIVITY_COPY.high.caution).toBeTruthy()
        expect(SENSITIVITY_COPY.medium.caution).toBeNull()
        expect(SENSITIVITY_COPY.low.caution).toBeNull()
    })
})
