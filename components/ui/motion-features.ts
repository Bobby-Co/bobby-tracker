// The framer-motion feature bundle, isolated in its own module so the bundler
// can split it into a chunk of its own. The shell imports only `LazyMotion` +
// `m` (the small core); these features arrive afterwards, off the hydration
// path — see components/ui/lazy-motion.tsx for why that matters.
//
// domMax rather than domAnimation: the sidebar's collapsible sections use
// `layout="position"`, and layout animations only ship in the max bundle.
export { domMax as default } from "framer-motion"
