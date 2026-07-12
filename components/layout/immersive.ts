// The Mind tab takes over the whole window: the sidebar, top bar and project
// header/tabs collapse away and the chat fills the screen. Several layout
// components (app-shell, the project layout) key their "immersive" morph off
// this one matcher so they stay in sync. Layouts persist across tab navigation,
// so flipping this on/off animates via CSS transitions.
export function isImmersiveMind(pathname: string | null | undefined): boolean {
    return !!pathname && /^\/projects\/[^/]+\/mind\/?$/.test(pathname)
}
