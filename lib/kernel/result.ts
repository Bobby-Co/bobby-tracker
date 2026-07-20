// Typed outcomes — errors are values, not thrown control-flow. Application
// use-cases return Result<T> instead of throwing; the interface layer maps a
// DomainError.code to an HTTP status (never the reverse), keeping the core
// transport-agnostic.
//
// Part of the shared kernel (see modules/README.md). Pure: this file must not
// import Next, Workers, or any SDK — the eslint boundary rule enforces it.

export type Result<T, E = DomainError> =
    | { ok: true; value: T }
    | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value }
}

export function err<E = DomainError>(error: E): Result<never, E> {
    return { ok: false, error }
}

/** A domain-level failure with a stable, machine-readable code. Transport-
 *  agnostic on purpose: HTTP/status mapping happens at the interface edge. The
 *  underlying cause (if any) is carried on the standard Error `cause` field. */
export class DomainError extends Error {
    readonly code: string

    constructor(code: string, message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = "DomainError"
        this.code = code
    }
}
