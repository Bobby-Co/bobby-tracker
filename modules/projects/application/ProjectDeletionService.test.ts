import { test, expect, describe, mock, beforeEach } from "bun:test"
import { ProjectDeletionService } from "./ProjectDeletionService"

// The ordering here is the whole point, and it is not interchangeable.
//
// A project's regional content (issues, comments, PRs, embeddings) lost its
// foreign key to `projects` when the planes split, and the central
// issue_suggestions rows lost theirs to `issues` in 0068. So deletion has to
// collect the issue ids, clear the regional side, clear the central rows that
// referenced those ids, and only then remove the project row. Delete the project
// first and there is nothing left to find any of it by.

const projects = { delete: mock() }
const purge = { purgeProject: mock() }
const suggestions = { deleteForIssues: mock() }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new ProjectDeletionService(projects as any, purge as any, suggestions as any)

beforeEach(() => {
    projects.delete.mockReset().mockResolvedValue(undefined)
    purge.purgeProject.mockReset().mockResolvedValue({ issueIds: ["i1", "i2"] })
    suggestions.deleteForIssues.mockReset().mockResolvedValue(undefined)
})

describe("order of operations", () => {
    test("regional content is purged before the project row is removed", async () => {
        const seen: string[] = []
        purge.purgeProject.mockImplementation(async () => {
            seen.push("purge")
            return { issueIds: ["i1"] }
        })
        suggestions.deleteForIssues.mockImplementation(async () => void seen.push("suggestions"))
        projects.delete.mockImplementation(async () => void seen.push("project"))

        await svc().delete("p1")
        expect(seen).toEqual(["purge", "suggestions", "project"])
    })

    test("central suggestions are cleared using the ids the purge reported", async () => {
        await svc().delete("p1")
        expect(suggestions.deleteForIssues).toHaveBeenCalledWith(["i1", "i2"])
    })

    test("no suggestion call when the project had no issues", async () => {
        purge.purgeProject.mockResolvedValue({ issueIds: [] })
        await svc().delete("p1")
        expect(suggestions.deleteForIssues).not.toHaveBeenCalled()
        expect(projects.delete).toHaveBeenCalledWith("p1")
    })
})

describe("failure handling", () => {
    // Leaving the project row in place is the recoverable outcome: you can see it
    // and retry. Removing it while content survives is not — nothing remains to
    // identify the orphans by, and they sit in a database this service cannot
    // even reach once the planes are split.
    test("a failed purge aborts and leaves the project row alone", async () => {
        purge.purgeProject.mockRejectedValue(new Error("regional database unreachable"))
        await expect(svc().delete("p1")).rejects.toThrow("regional database unreachable")
        expect(projects.delete).not.toHaveBeenCalled()
    })

    // Suggestions are a cache of analyser output. Once the expensive part has
    // succeeded, a failure here must not strand the delete — the rows are
    // unreachable without their issue anyway.
    test("a failed suggestion cleanup does not block the delete", async () => {
        suggestions.deleteForIssues.mockRejectedValue(new Error("nope"))
        await svc().delete("p1")
        expect(projects.delete).toHaveBeenCalledWith("p1")
    })
})
