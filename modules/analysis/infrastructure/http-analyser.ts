// Analysis module — the HTTP/WS analyser ADAPTER. Implements AnalyserPort by
// delegating, one-to-one, to the existing bobby-analyser client in
// @/lib/analyser. This is a THIN wrapper (point-free delegation): the wire
// protocol, env config, and AnalyserError semantics stay in lib/analyser for now
// — the port just gives callers a runtime-agnostic seam to depend on. A later
// step can inline the transport here and retire lib/analyser (see modules/README.md).
//
// Infrastructure is the ONLY layer allowed to import the concrete client.

import {
    ask,
    chatStream,
    analyseIssue,
    runIssueAnalysis,
    cancelIssueAnalysis,
    runPRAnalysis,
    cancelPRAnalysis,
    deepDivePRInsight,
    getIssuePreferences,
    setIssuePreferences,
    composeIssue,
    embedText,
    verifyGraph,
    kickoffJob,
    deleteGraph,
} from "@/lib/analyser"

import type { AnalyserPort } from "../ports/analyser-port"

/** Construct the HTTP-backed AnalyserPort. Stateless (the underlying client reads
 *  its config from env at import), so it's cheap to build per call. */
export function createHttpAnalyser(): AnalyserPort {
    return {
        query:               ask,
        streamChat:          chatStream,
        analyseIssue:        analyseIssue,
        startIssueAnalysis:  runIssueAnalysis,
        cancelIssueAnalysis: cancelIssueAnalysis,
        startPRAnalysis:     runPRAnalysis,
        cancelPRAnalysis:    cancelPRAnalysis,
        deepDivePRInsight:   deepDivePRInsight,
        getIssuePreferences: getIssuePreferences,
        setIssuePreferences: setIssuePreferences,
        compose:             composeIssue,
        embed:               embedText,
        verify:              verifyGraph,
        startIndex:          kickoffJob,
        deleteGraph:         deleteGraph,
    }
}
