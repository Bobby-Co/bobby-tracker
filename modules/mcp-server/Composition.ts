// MCP server — composition. Wires the application service to concrete adapters,
// so the route handler stays a transport and the service stays testable with
// plain mocks (it takes ports, never a DB client).
//
// The client here is the SERVICE-ROLE one, because an MCP request has no Supabase
// session cookie to scope RLS with — see the security note in
// application/KnowledgeBaseService.ts for why that is safe, and what it obliges
// anyone extending this to do.

import { Supabase } from "@/lib/server/supabase"
import { getAccessService } from "@/modules/access"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createSupabaseProjectMcpIntegrationRepository } from "@/modules/mcp"
import { createSupabaseProjectAnalyserRepository, getAnalyser } from "@/modules/analysis"
import { KnowledgeBaseService } from "./application/KnowledgeBaseService"

/** Build the knowledge-base service for an already-authenticated MCP caller. The
 *  userId MUST come from a resolved OAuth token, never from the request body. */
export function createKnowledgeBaseService(userId: string): KnowledgeBaseService {
    // One service-role client, named per plane. `project_analyser` is
    // control-plane (realtime publication); projects and the MCP exposure flag are
    // data-plane. Splitting them later is a change here and nowhere else.
    const dataDb = Supabase.service()
    const controlDb = dataDb
    return new KnowledgeBaseService(
        getAccessService(controlDb, dataDb),
        createSupabaseProjectsRepository(dataDb),
        createSupabaseProjectMcpIntegrationRepository(dataDb),
        createSupabaseProjectAnalyserRepository(controlDb),
        getAnalyser,
        userId,
    )
}
