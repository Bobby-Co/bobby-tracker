import { randomBytes } from "node:crypto"
import { jsonError, requireUser } from "@/lib/api"
import type { PublicSession } from "@/lib/supabase/types"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const token = randomBytes(24).toString("base64url")
    const { data, error: dbErr } = await supabase
        .from("public_sessions")
        .update({ token })
        .eq("id", id)
        .select("*")
        .single<PublicSession>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ session: data })
}
