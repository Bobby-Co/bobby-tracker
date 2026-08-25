import { test, expect, describe } from "bun:test"

import { renderFarewellEmail, renderWelcomeEmail } from "./JmapAccountMailer"

const farewell = (to: string) =>
    renderFarewellEmail({ to, name: "Ada Lovelace", teamsDeleted: ["Bobby Products"], teamsLeft: ["Analytical Engines"] })

describe("the welcome", () => {
    test("greets by first name and points at the one thing that matters", () => {
        const mail = renderWelcomeEmail({ to: "ada@example.com", name: "Ada Lovelace", teamName: "Bobby Products" })
        expect(mail.subject).toBe("Welcome aboard, Ada")
        expect(mail.html).toContain("Bobby Products")
        expect(mail.html).toContain("Add your first project")
    })

    test("works with no name and no team", () => {
        const mail = renderWelcomeEmail({ to: "ada@example.com", name: null, teamName: null })
        expect(mail.subject).toBe("Welcome aboard")
        expect(mail.text).not.toContain("null")
        expect(mail.text).not.toContain("undefined")
    })
})

describe("the farewell", () => {
    // The heading is warm, but this mail is also the only record of an
    // irreversible action — and months later someone searches for the fact, not
    // the sentiment.
    test("keeps a factual subject under a warm heading", () => {
        const mail = farewell("ada@example.com")
        expect(mail.subject).toBe("Your Ucelot account has been deleted")
        expect(mail.html).toContain("Until next time, Ada")
    })

    test("names every team on both sides of the receipt", () => {
        const mail = farewell("ada@example.com")
        for (const surface of [mail.html, mail.text]) {
            expect(surface).toContain("Bobby Products")
            expect(surface).toContain("Analytical Engines")
        }
    })
})

// The playful last line of "what we kept" is picked from the address, not at
// random — random would make the template impure and every re-render disagree.
describe("the keepsake line", () => {
    // Rendered with NO teams, so the only bullets are the three "what we kept"
    // ones and the keepsake is the last — the team lists share the "- " prefix,
    // so taking the first match would return a team name every time.
    const line = (to: string) => {
        const bullets = renderFarewellEmail({ to, name: null, teamsDeleted: [], teamsLeft: [] })
            .text.split("\n")
            .filter((l) => l.startsWith("- "))
        return bullets[bullets.length - 1] ?? ""
    }

    test("is stable for one address", () => {
        expect(farewell("ada@example.com").html).toBe(farewell("ada@example.com").html)
    })

    test("varies across addresses", () => {
        const addresses = ["ada", "grace", "alan", "katherine", "edsger", "barbara", "linus", "margaret"].map((n) => `${n}@example.com`)
        const distinct = new Set(addresses.map(line))
        expect(distinct.size).toBeGreaterThan(2)
    })

    // Load-bearing: this sits directly under a deletion receipt, so a line that
    // could be read as "…and we also kept some of your data" would undo the
    // trust the receipt exists to build.
    // It sits in the list like the others — colour is the only separation, and
    // it has to be the DIM token, not the body one the disclosures use.
    test("is a bullet like the rest, greyed", () => {
        const mail = farewell("ada@example.com")
        const dim = mail.html.match(/class="dim" style="padding:0 0 9px 0;[^"]*color:#a3a8b0/g) ?? []
        expect(dim.length).toBe(1)
        // Same size as its neighbours — nothing but the colour changes.
        expect(mail.html).toMatch(/class="dim" style="padding:0 0 9px 0;[^"]*font-size:14px/)
        // And still a bullet in the text alternative.
        expect(mail.text).toMatch(/^- .*(memories|fondness|soft spot|Quiet respect|good bits)/m)
    })

    test("every line disclaims being stored anywhere", () => {
        const seen = new Set<string>()
        for (let i = 0; i < 200; i++) seen.add(line(`user${i}@example.com`))
        expect(seen.size).toBe(6)
        for (const l of seen) {
            expect(l.toLowerCase()).toMatch(/nowhere|not stored|no table|no row|not a row|never got round|no database/)
        }
    })
})
