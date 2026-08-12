// Billing infrastructure — the service-role UsageRecorder. The metering layer runs
// inside a normal request but the ledger insert must NOT be gated by the caller's
// RLS (a member records spend for their whole team), so this uses the trusted
// service-role client — the same one that forwards jobs to the analyser.
//
// BEST-EFFORT BY CONTRACT: a metering failure must never fail the user's model
// call, so record() swallows and logs its own errors and always resolves. (We
// await it on the hot path rather than detaching — a `void promise()` dies on
// Workers before it flushes; a small awaited insert is safe and cheap.)

import { Supabase } from "@/lib/server/supabase"
import type { UsageEventInput, UsageRecorder } from "../ports/UsageRecorder"

export class ServiceUsageRecorder implements UsageRecorder {
    async record(event: UsageEventInput): Promise<void> {
        try {
            const { error } = await Supabase.service()
                .from("prowl_usage_events")
                .insert({
                    team_id: event.teamId,
                    user_id: event.userId,
                    kind: event.kind,
                    model: event.model ?? null,
                    points: Math.max(0, Math.round(event.points || 0)),
                    cost_usd: event.costUsd ?? null,
                    input_tokens: event.inputTokens ?? null,
                    output_tokens: event.outputTokens ?? null,
                    project_id: event.projectId ?? null,
                    meta: event.meta ?? {},
                })
            if (error) console.error("[prowl] usage record failed:", error.message)
        } catch (e) {
            // Never let metering break a model call.
            console.error("[prowl] usage record threw:", e instanceof Error ? e.message : e)
        }
    }
}

/** Composition seam: the app-wide usage recorder. */
export function createServiceUsageRecorder(): UsageRecorder {
    return new ServiceUsageRecorder()
}
