// The handshake between "yes, delete my account" and the page that carries it
// out (/goodbye).
//
// It lives in its own module so the two sides don't have to import each other:
// a page importing another PAGE drags that route's whole component tree into its
// bundle, for the sake of one string.
//
// sessionStorage rather than a query param, deliberately. A param survives
// copy-paste, sharing and browser history, and this marker authorises deleting
// an account — it must not be able to travel anywhere the person who set it
// didn't go. Set immediately before navigating, read once, cleared before the
// request goes out.
export const DELETE_ACCOUNT_FLAG = "ucelot:delete-account"
