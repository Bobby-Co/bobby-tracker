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
    const db = Supabase.service()
    return new KnowledgeBaseService(
        getAccessService(db),
        createSupabaseProjectsRepository(db),
        createSupabaseProjectMcpIntegrationRepository(db),
        createSupabaseProjectAnalyserRepository(db),
        getAnalyser(),
        userId,
    )
}
