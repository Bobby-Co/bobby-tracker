// Projects module — deleting a project completely, across both planes.
//
// Before the split this was `delete from projects where id = ?` and the database
// did the rest. Three groups of rows hang off a project, and only one of them
// still cascades:
//
//   CENTRAL, still cascades — project_analyser, notifications,
//     access_group_projects, the per-project config tables, project_insight.
//     Their FKs to `projects` are intact because both sides are control-plane.
//
//   REGIONAL, no longer cascades — issues and their comments, embeddings, the PR
//     mirror, chat context. Those FKs were dropped because they cannot span two
//     databases (see regional-node-setup.sql).
//
//   CENTRAL but pointing at REGIONAL — issue_suggestions.issue_id. 0068 dropped
//     that key for the same reason, in the other direction.
//
// So the order below is not arbitrary: regional content first (which yields the
// issue ids), then the central rows that referenced those ids, then the project
// row whose deletion still cascades everything else. Doing it the other way
// round destroys the only handle on what needs cleaning.

import type { IssueSuggestionsRepository } from "@/modules/issues"
import type { ProjectContentPurge } from "../ports/ProjectContentPurge"
import type { ProjectsRepository } from "../ports/ProjectsRepository"

export class ProjectDeletionService {
    constructor(
        private readonly projects: ProjectsRepository,
        private readonly purge: ProjectContentPurge,
        private readonly suggestions: IssueSuggestionsRepository,
    ) {}

    /** Delete a project and everything belonging to it, in both planes.
     *
     *  THROWS if the regional purge fails, deliberately leaving the project row
     *  in place. A surviving project with some content missing is recoverable —
     *  you can see it and retry. A deleted project with content left behind is
     *  not: nothing remains to identify the orphans by. */
    async delete(projectId: string): Promise<void> {
        const { issueIds } = await this.purge.purgeProject(projectId)

        // Central suggestions keyed by the issues just removed. Best-effort by
        // deliberate choice: these are a cache of analyser output, so a failure
        // here should not strand the delete when the expensive part has already
        // succeeded. The rows are invisible without their issue and get collected
        // by any later sweep.
        if (issueIds.length > 0) {
            try {
                await this.suggestions.deleteForIssues(issueIds)
            } catch (err) {
                console.error("[project delete] suggestion cleanup failed", projectId, err)
            }
        }

        // Last. Its own cascade still clears every central child.
        await this.projects.delete(projectId)
    }
}
