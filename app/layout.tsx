import type { Metadata } from "next"
import { Nunito } from "next/font/google"
import "./globals.css"

const nunito = Nunito({
    variable: "--font-nunito",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800"],
})

export const metadata: Metadata = {
    title: "Bobby Tracker",
    description: "Smart issue tracker for Bobby projects.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${nunito.variable} h-full antialiased`}>
            <body className="min-h-full font-sans">{children}</body>
        </html>
    )
}
