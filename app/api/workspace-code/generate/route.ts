import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/workspace-code/generate
 * Generates a unique workspace invite code for the authenticated manager.
 * If the manager already has an active code, returns that one instead.
 *
 * Requires: Authorization header with Supabase access token
 * Returns: { code: "CTD-7X9K2M", isNew: true/false }
 */

function generateCode(): string {
  // Format: XXXX-XXXX (e.g. K7PX-92QM, 8 uppercase alphanumeric chars cleanly grouped)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0,O,1,I,L to avoid confusion
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${part1}-${part2}`;
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Get the user's auth token from the request
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    // Create a Supabase client with the user's token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const publicWorkspaceId = (user.user_metadata?.workspace_id as string) || "WS-00001";

    // Check if manager already has an active code
    let existingCode: { code: string; created_at: string } | null = null;
    try {
      const { data } = await supabase
        .from("workspace_codes")
        .select("code, created_at")
        .eq("manager_id", user.id)
        .eq("is_active", true)
        .single();
      if (data) existingCode = data;
    } catch {
      // Table may not exist yet
    }

    // Check user_metadata fallback
    if (!existingCode && user.user_metadata?.workspace_code) {
      existingCode = {
        code: user.user_metadata.workspace_code as string,
        created_at: new Date().toISOString(),
      };
    }

    // If the manager has a valid non-legacy code (not starting with old CTD-), return it
    if (existingCode && !existingCode.code.startsWith("CTD-")) {
      if (!user.user_metadata?.workspace_id) {
        try {
          await supabase.auth.updateUser({
            data: { workspace_id: publicWorkspaceId },
          });
        } catch {
          // ignore
        }
      }
      return NextResponse.json({
        code: existingCode.code,
        workspaceId: publicWorkspaceId,
        createdAt: existingCode.created_at,
        isNew: false,
      });
    }

    // Generate a fresh XXXX-XXXX code
    let code = "";
    let inserted = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode();
      try {
        if (existingCode && existingCode.code.startsWith("CTD-")) {
          // Upgrade existing record
          const { error: updateError } = await supabase
            .from("workspace_codes")
            .update({ code })
            .eq("manager_id", user.id)
            .eq("is_active", true);
          if (!updateError) {
            inserted = true;
            break;
          }
        } else {
          const { error: insertError } = await supabase
            .from("workspace_codes")
            .insert({ manager_id: user.id, code });

          if (!insertError) {
            inserted = true;
            break;
          }

          if (insertError.code === "23505") continue; // duplicate code, try again
        }
      } catch {
        // Table doesn't exist
      }
    }

    // Save to user_metadata
    try {
      await supabase.auth.updateUser({
        data: { workspace_code: code, workspace_id: publicWorkspaceId },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({
      code,
      workspaceId: publicWorkspaceId,
      createdAt: new Date().toISOString(),
      isNew: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Workspace code generation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
