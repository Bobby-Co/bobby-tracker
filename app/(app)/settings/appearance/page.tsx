import { ThemePanel } from "@/components/settings/theme-panel"

// Settings → Appearance. Device-level, not account-level: the choice lives in
// localStorage because the boot script in app/layout.tsx has to read it
// synchronously before first paint, and a value that needs a round trip can't
// be read then — it would paint the wrong theme and flash on every load.
export default function AppearancePage() {
    return (
        <section className="max-w-xl">
            <h2 className="text-[15px] font-bold tracking-[-0.006em]">Appearance</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Choose how Ucelot looks. This is saved on this device, so each browser you
                sign in from can differ.
            </p>
            <div className="mt-4">
                <ThemePanel />
            </div>
        </section>
    )
}
