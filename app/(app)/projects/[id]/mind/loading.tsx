// Route-level loading. Fires on hard navigations (initial visit, reload). The
// Mind view is a static chat shell that renders immediately once mounted, so we
// deliberately show nothing here rather than flashing a skeleton that doesn't
// match the final UI (it also collides with the immersive morph).
export default function MindLoading() {
    return null
}
