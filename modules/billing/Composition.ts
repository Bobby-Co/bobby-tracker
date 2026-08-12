// Billing module — composition root. Wires the metering decorator to the Analyser
// port + the service-role usage recorder. A route that wants its model calls
// billed obtains its analyser here instead of from @/modules/analysis:
//
//     const analyser = getMeteredAnalyser({ teamId, userId }, { projectId })
//     await analyser.analyseIssue(...)   // ← recorded to the Prowl ledger
//
// Nothing else changes at the call site; swapping the recorder or the transport is
// a change to this file alone.

import { getAnalyser, type Analyser } from "@/modules/analysis"
import { MeteringAnalyser } from "./infrastructure/MeteringAnalyser"
import { createServiceUsageRecorder } from "./infrastructure/ServiceUsageRecorder"
import type { BillingSubject } from "./ports/UsageRecorder"

/** An Analyser whose billable calls are recorded to the Prowl usage ledger for
 *  `subject`'s team. Drop-in for getAnalyser() at any call site. */
export function getMeteredAnalyser(subject: BillingSubject, opts?: { projectId?: string }): Analyser {
    return new MeteringAnalyser(getAnalyser(), subject, createServiceUsageRecorder(), opts?.projectId)
}
