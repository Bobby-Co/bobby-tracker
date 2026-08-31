// Which branches a caller may PIN an issue to.
//
// Two different questions get asked about a branch, and conflating them is how
// this goes wrong:
//
//   - At WRITE time (here): may the user choose this? Only a branch the project
//     actually tracks and has finished indexing. Anything else is refused with a
//     message, because the user is making a choice and deserves to be told the
//     choice is not available — silently storing it would file the issue against
//     a tree that cannot answer, and the failure would surface much later as a
//     mysteriously generic analysis.
//
//   - At READ time (AnalysisBranch.answerable, in the analysis services): may we
//     SEND this to the analyser? Same rule, opposite failure mode — a branch
//     that was ready when the issue was filed and has since been untracked or
//     re-indexed must not turn a stored issue into a permanent error. There it
//     falls back to the default tree.
//
// So the picker offers only ready branches, this refuses anything else that
// arrives anyway, and the read path stays forgiving about a world that moved.

import type { ProjectBranchRepository } from "../ports/ProjectBranchRepository"
import { AnalysisBranch } from "../domain/AnalysisBranch"

/** Accepted, with the branch to store — null meaning the project's default
 *  tree. Or refused, with the code + message the route should return. */
export type BranchSelection =
    | { ok: true; branch: string | null }
    | { ok: false; code: "branch_not_indexed"; message: string }

/** Validate a caller-supplied branch for a project.
 *
 *  An absent, blank or malformed name is the DEFAULT TREE, not an error: that
 *  is what an untagged issue means, and it is what every issue meant before
 *  branches existed. Only a name that was actually given and cannot answer is
 *  refused. */
export async function selectIssueBranch(
    branches: ProjectBranchRepository,
    projectId: string,
    input: unknown,
): Promise<BranchSelection> {
    const branch = AnalysisBranch.normalise(input)
    if (!branch) return { ok: true, branch: null }

    const tracked = await branches.find(projectId, branch)
    if (!tracked) {
        return {
            ok: false,
            code: "branch_not_indexed",
            message: `This project doesn't index the branch "${branch}". Track it on the project's Knowledge tab first, or leave the issue on the default branch.`,
        }
    }
    if (!AnalysisBranch.answerable(tracked)) {
        // Tracked but not ready — pending, indexing, or failed. A different
        // message from "not tracked", because it asks for a different action:
        // wait (or look at the error), rather than go and track it.
        return {
            ok: false,
            code: "branch_not_indexed",
            message: `The branch "${branch}" isn't finished indexing (${tracked.status}). It can't be analysed until it is.`,
        }
    }
    return { ok: true, branch }
}
