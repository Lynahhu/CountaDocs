/// <reference lib="deno.ns" />

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const soundFiles: Record<string, string> = {
  bell: "bell.wav",
  soft_chime: "soft_chime.wav",
  double_bell: "double_bell.wav",
};

type ChannelResult = {
  sent: number;
  skipped: number;
  failures: string[];
};

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type Database = {
  public: {
    Tables: {
      clients: Table<
        {
          id: string;
          manager_id: string;
          name: string;
          company_name: string;
          email: string;
          phone: string;
          document_set: string;
          requests: number;
          whatsapp_opt_in: boolean;
          whatsapp_opt_in_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          manager_id: string;
          name: string;
          company_name: string;
          email: string;
          phone: string;
          document_set: string;
          requests?: number;
          whatsapp_opt_in?: boolean;
          whatsapp_opt_in_at?: string | null;
          created_at?: string;
        }
      >;
      client_members: Table<
        { client_id: string; user_id: string; created_at: string },
        { client_id: string; user_id: string; created_at?: string }
      >;
      client_notification_preferences: Table<
        { user_id: string; sound_key: string; updated_at: string },
        { user_id: string; sound_key?: string; updated_at?: string }
      >;
      client_push_tokens: Table<
        {
          id: string;
          user_id: string;
          expo_push_token: string;
          platform: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          expo_push_token: string;
          platform: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      client_notifications: Table<
        {
          id: string;
          client_id: string;
          created_by: string;
          title: string;
          body: string;
          created_at: string;
        },
        {
          id?: string;
          client_id: string;
          created_by: string;
          title: string;
          body: string;
          created_at?: string;
        }
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendPushNotifications(
  admin: SupabaseClient<Database>,
  clientId: string,
  title: string,
  body: string,
  notificationId: string,
): Promise<ChannelResult> {
  const result: ChannelResult = { sent: 0, skipped: 0, failures: [] };
  const { data: members, error: membersError } = await admin
    .from("client_members")
    .select("user_id")
    .eq("client_id", clientId);
  if (membersError) throw new Error(`Could not look up client app accounts: ${membersError.message}`);

  const memberIds = (members ?? []).map((member) => member.user_id);
  if (memberIds.length === 0) {
    result.skipped = 1;
    result.failures.push("No verified client app account is linked to this email yet.");
    return result;
  }

  const [{ data: tokens, error: tokensError }, { data: preferences, error: preferencesError }] = await Promise.all([
    admin.from("client_push_tokens").select("id, user_id, expo_push_token").in("user_id", memberIds),
    admin.from("client_notification_preferences").select("user_id, sound_key").in("user_id", memberIds),
  ]);
  if (tokensError) throw new Error(`Could not look up client devices: ${tokensError.message}`);
  if (preferencesError) throw new Error(`Could not load client sound preferences: ${preferencesError.message}`);

  if (!tokens?.length) {
    result.skipped = memberIds.length;
    result.failures.push("No client phone has enabled push notifications yet.");
    return result;
  }

  const soundByUser = new Map((preferences ?? []).map((preference) => [preference.user_id, preference.sound_key]));
  const messages = tokens.map((token) => {
    const soundKey = soundByUser.get(token.user_id) ?? "bell";
    const sound = soundFiles[soundKey] ?? soundFiles.bell;
    return {
      id: token.id,
      to: token.expo_push_token,
      title,
      body,
      sound,
      channelId: soundKey,
      priority: "high",
      data: { clientId, notificationId },
    };
  });

  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    let response: Response;
    try {
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(batch.map(({ id: _id, ...message }) => message)),
      });
    } catch (error) {
      result.failures.push(error instanceof Error ? error.message : "Could not reach the Expo push service.");
      continue;
    }

    const payload = await response.json() as {
      data?: Array<{ status?: string; message?: string; details?: { error?: string } }>;
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok) {
      result.failures.push(payload.errors?.map((item) => item.message ?? "Expo rejected the push request.").join("; ")
        ?? `Expo push request failed with HTTP ${response.status}.`);
      continue;
    }

    const invalidTokenIds: string[] = [];
    for (const [index, ticket] of (payload.data ?? []).entries()) {
      if (ticket.status === "ok") {
        result.sent += 1;
      } else {
        result.failures.push(ticket.message ?? "Expo rejected a push notification.");
        if (ticket.details?.error === "DeviceNotRegistered" && batch[index]) {
          invalidTokenIds.push(batch[index].id);
        }
      }
    }
    if (invalidTokenIds.length > 0) {
      const { error } = await admin.from("client_push_tokens").delete().in("id", invalidTokenIds);
      if (error) result.failures.push(`Could not remove expired device registrations: ${error.message}`);
    }
  }

  return result;
}

async function sendWhatsAppMessage(
  phone: string,
  companyName: string,
  documentSet: string,
): Promise<void> {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const templateLanguage = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE");
  const graphApiVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION");
  const missingSecrets = [
    ["WHATSAPP_ACCESS_TOKEN", accessToken],
    ["WHATSAPP_PHONE_NUMBER_ID", phoneNumberId],
    ["WHATSAPP_TEMPLATE_NAME", templateName],
    ["WHATSAPP_TEMPLATE_LANGUAGE", templateLanguage],
    ["WHATSAPP_GRAPH_API_VERSION", graphApiVersion],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingSecrets.length > 0) {
    throw new Error(`WhatsApp is opted in but not configured. Missing Supabase secrets: ${missingSecrets.join(", ")}.`);
  }

  if (!/^v\d+\.\d+$/.test(graphApiVersion!)) {
    throw new Error("WHATSAPP_GRAPH_API_VERSION must be a supported Meta Graph version such as v23.0.");
  }

  const internationalPhone = phone.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(internationalPhone)) {
    throw new Error("The client phone number must be in international format, for example +213555010101.");
  }

  const response = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: internationalPhone.slice(1),
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: companyName },
            { type: "text", text: documentSet },
          ],
        }],
      },
    }),
  });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `WhatsApp Cloud API rejected the message (HTTP ${response.status}).`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { success: false, message: "Use POST to send a client nudge." });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { success: false, message: "Sign in to send a client nudge." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(500, { success: false, message: "Supabase function secrets are not configured." });
  }

  const userClient = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse(401, { success: false, message: authError?.message ?? "Your session is invalid. Sign in again." });
  }

  let body: { clientId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { success: false, message: "The nudge request must contain valid JSON." });
  }
  if (typeof body.clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientId)) {
    return jsonResponse(400, { success: false, message: "Select a valid client before sending a nudge." });
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("id, name, company_name, email, phone, document_set, whatsapp_opt_in")
    .eq("id", body.clientId)
    .eq("manager_id", user.id)
    .maybeSingle();
  if (clientError) return jsonResponse(500, { success: false, message: `Could not load that client: ${clientError.message}` });
  if (!client) return jsonResponse(404, { success: false, message: "That client does not belong to your workspace." });

  const title = "A document reminder from your accountant";
  const message = `${client.company_name} is requesting ${client.document_set}.`;
  const { data: notification, error: notificationError } = await admin
    .from("client_notifications")
    .insert({
      client_id: client.id,
      created_by: user.id,
      title,
      body: message,
    })
    .select("id")
    .single();
  if (notificationError) {
    return jsonResponse(500, { success: false, message: `Could not save the in-app reminder: ${notificationError.message}` });
  }

  const push: ChannelResult = { sent: 0, skipped: 0, failures: [] };
  try {
    Object.assign(
      push,
      await sendPushNotifications(
        admin,
        client.id,
        title,
        "A new document reminder is waiting. Open L Docs to review.",
        notification.id,
      ),
    );
  } catch (error) {
    push.failures.push(error instanceof Error ? error.message : "Could not send a push notification.");
  }

  const whatsapp: ChannelResult = { sent: 0, skipped: 0, failures: [] };
  if (client.whatsapp_opt_in) {
    try {
      await sendWhatsAppMessage(client.phone, client.company_name, client.document_set);
      whatsapp.sent = 1;
    } catch (error) {
      whatsapp.failures.push(error instanceof Error ? error.message : "Could not send the WhatsApp reminder.");
    }
  } else {
    whatsapp.skipped = 1;
    whatsapp.failures.push("The client has not opted in to WhatsApp reminders.");
  }

  const sentCount = push.sent + whatsapp.sent;
  const issues = [
    ...push.failures.map((failure) => `Push: ${failure}`),
    ...whatsapp.failures.map((failure) => `WhatsApp: ${failure}`),
  ];
  const messageSummary = sentCount > 0
    ? `In-app reminder saved; ${push.sent} push notification(s) and ${whatsapp.sent} WhatsApp message(s) accepted.${issues.length ? ` Issues: ${issues.join(" ")}` : ""}`
    : `In-app reminder saved, but no external alert was sent. ${issues.join(" ")}`;

  return jsonResponse(200, {
    success: sentCount > 0,
    notificationId: notification.id,
    push: { sent: push.sent, skipped: push.skipped, failures: push.failures },
    whatsapp: { sent: whatsapp.sent, skipped: whatsapp.skipped, failures: whatsapp.failures },
    message: messageSummary,
  });
});
