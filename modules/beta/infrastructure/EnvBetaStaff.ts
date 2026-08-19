// EnvBetaStaff — who may edit the beta list.
//
// This app has no site-wide admin concept; every role it knows about
// (owner/admin/member) is scoped to a TEAM, and "may invite people to the beta"
// is not a property of any team. Rather than invent a role for a temporary
// product phase, staff are named in the environment — the ONE thing the env var
// was always genuinely good at, and a list that changes when we hire, not when
// we enrol.
//
//   BETA_ADMIN_EMAILS            server-only, comma separated. Preferred.
//   NEXT_PUBLIC_BETA_ALLOWED_EMAILS   the legacy staff bypass, used as the
//                                     fallback so the enrolment routes work
//                                     before anything new is configured.
//
// Note the asymmetry with the beta list itself: this one is short, changes
// rarely, and is only ever read on the server, which is why it stays in config.
export class EnvBetaStaff {
    private readonly emails: string[]

    constructor(raw = process.env.BETA_ADMIN_EMAILS ?? process.env.NEXT_PUBLIC_BETA_ALLOWED_EMAILS ?? "") {
        this.emails = raw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
    }

    /** Whether this address may read and edit the beta list. An empty
     *  configuration admits NOBODY — the enrolment routes 403 rather than
     *  standing open while someone works out why the env var is missing. */
    includes(email: string | null | undefined): boolean {
        const value = (email ?? "").trim().toLowerCase()
        return value.length > 0 && this.emails.includes(value)
    }
}
