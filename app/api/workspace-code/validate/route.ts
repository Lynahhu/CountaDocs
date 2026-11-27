import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/workspace-code/validate
 * Validates a workspace code entered/scanned by a client in the mobile app.
 *
 * Body: { code: "CTD-7X9K2M" }
 * Returns: { valid: true, managerId: "uuid", managerName: "...", managerEmail: "..." }
 *      or: { valid: false, error: "..." }
 */

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Use service role key if available (server-side), otherwise anon key
    const keyToUse = supabaseServiceKey || supabaseAnonKey;

    if (!supabaseUrl || !keyToUse) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const rawCode = (body.code || "").toString().trim().toUpperCase();

    if (!rawCode) {
      return NextResponse.json({ valid: false, error: "No code provided" }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, keyToUse);

    // Look up the code in workspace_codes table
    let codeRecord: { manager_id: string; is_active: boolean } | null = null;
    try {
      const { data } = await supabase
        .from("workspace_codes")
        .select("manager_id, is_active")
        .eq("code", rawCode)
        .single();
      if (data) codeRecord = data;
    } catch {
      // Table may not exist yet
    }

    let managerId: string | null = codeRecord ? codeRecord.manager_id : null;

    // Fallback: look up in auth.users by metadata if table not found
    if (!managerId) {
      try {
        const { data: usersData } = await supabase.auth.admin.listUsers();
        const found = usersData?.users?.find(
          (u) => (u.user_metadata?.workspace_code || "").toString().toUpperCase() === rawCode
        );
        if (found) {
          managerId = found.id;
        }
      } catch {
        // ignore
      }
    }

    if (!managerId) {
      return NextResponse.json({
        valid: false,
        error: "Invalid code. Please check and try again.",
      });
    }

    if (codeRecord && !codeRecord.is_active) {
      return NextResponse.json({
        valid: false,
        error: "This code is no longer active. Ask your accountant for a new code.",
      });
    }

    // Get manager's basic info
    const { data: userData } = await supabase.auth.admin.getUserById(managerId);
    const managerUser = userData?.user;

    const managerName =
      managerUser?.user_metadata?.full_name ||
      managerUser?.user_metadata?.name ||
      managerUser?.user_metadata?.display_name ||
      managerUser?.email?.split("@")[0] ||
      "Your accountant";

    return NextResponse.json({
      valid: true,
      managerId,
      workspaceId: (managerUser?.user_metadata?.workspace_id as string) || "WS-00001",
      managerName,
      managerEmail: managerUser?.email || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Workspace code validation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
