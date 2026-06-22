import type { Metadata } from "next"
import { Nunito } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/lib/auth/auth-context"
import {HyperellipseSetup} from "@/components/hyperellipse-setup";

const nunito = Nunito({
    variable: "--font-nunito",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800"],
})

export const metadata: Metadata = {
    title: "Ucelot by Bobby",
    description: "Smart issue tracker for your projects.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${nunito.variable} h-full antialiased`}>
            <body className="min-h-full font-sans">
            <HyperellipseSetup/>
            <AuthProvider>{children}</AuthProvider>
            </body>
        </html>
    )
}
