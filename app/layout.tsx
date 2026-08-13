import type { Metadata } from "next"
import { Nunito } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/lib/client/auth/auth-context"
import {HyperellipseSetup} from "@/components/layout/hyperellipse-setup";

const nunito = Nunito({
    variable: "--font-nunito",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800"],
})

export const metadata: Metadata = {
    title: "Ucelot by Bobby",
    description: "Smart issue tracker for your projects.",
}

// Resolves the theme BEFORE first paint and stamps it on <html>. It has to be
// an inline blocking script: run it in an effect and the browser paints the
// light palette first, so every dark-mode visitor gets a white flash on every
// navigation that reloads the document.
//
// Stored choice wins; otherwise the OS preference. The listener keeps a visitor
// who has never chosen in sync when they change the OS setting mid-session —
// once they choose, `ucelot-theme` exists and the listener stops applying.
const THEME_BOOT = `(function(){try{
  var stored=localStorage.getItem("ucelot-theme");
  var mq=window.matchMedia("(prefers-color-scheme: dark)");
  var apply=function(t){document.documentElement.setAttribute("data-theme",t)};
  apply(stored||(mq.matches?"dark":"light"));
  if(!stored)mq.addEventListener("change",function(e){
    if(!localStorage.getItem("ucelot-theme"))apply(e.matches?"dark":"light")
  });
}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        // suppressHydrationWarning: the boot script mutates this element's
        // data-theme before React hydrates, so server and client markup differ
        // here by design.
        <html lang="en" className={`${nunito.variable} h-full antialiased`} suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
            </head>
            <body className="min-h-full font-sans">
            <HyperellipseSetup/>
            <AuthProvider>{children}</AuthProvider>
            </body>
        </html>
    )
}
