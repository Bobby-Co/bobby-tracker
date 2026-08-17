"use client"

import { useEffect } from "react"
import { registerHyperellipse } from "hyperellipse"

export function HyperellipseSetup() {
    useEffect(() => {
        registerHyperellipse();
    }, []);

    return null
}
