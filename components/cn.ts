// Tiny class-name joiner. Lighter than pulling in clsx for now.
export function cn(...c: (string | false | null | undefined)[]) {
    return c.filter(Boolean).join(" ")
}
