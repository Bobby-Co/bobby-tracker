// An email address value object — normalises on construction (trim + lowercase,
// matching the DB's lower(email) index) and validates its own shape.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class Email {
    private constructor(private readonly normalized: string) {}

    static of(raw: string): Email {
        return new Email(raw.trim().toLowerCase())
    }

    /** The normalised address (safe to store / compare). */
    get value(): string {
        return this.normalized
    }

    isValid(): boolean {
        return EMAIL_RE.test(this.normalized)
    }
}
