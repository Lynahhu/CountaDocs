import { createClient } from "@supabase/supabase-js";

type MessageError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorResponse(message: string, status: number, error?: MessageError) {
  return Response.json(
    { data: null, error: error ?? { message } },
    { status },
  );
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return errorResponse("Authentication is required.", 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return errorResponse("Supabase is not configured on the server.", 500);
  }

  let payload: unknown;
  try {
    const requestText = await request.text();
    payload = JSON.parse(requestText) as unknown;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!payload || typeof payload !== "object") {
    return errorResponse("Request body must be a JSON object containing client_id and body.", 400);
  }

  const requestData = payload as Record<string, unknown>;
  const nestedData = requestData.data && typeof requestData.data === "object"
    ? requestData.data as Record<string, unknown>
    : {};
  const client_id = requestData.client_id
    ?? requestData.clientId
    ?? nestedData.client_id
    ?? nestedData.clientId;
  const body = requestData.body
    ?? requestData.message
    ?? requestData.messageText
    ?? requestData.content
    ?? nestedData.body
    ?? nestedData.message
    ?? nestedData.messageText
    ?? nestedData.content;
  const clientIdText = typeof client_id === "string"
    ? client_id.trim()
    : typeof client_id === "number"
      ? String(client_id)
      : "";
  const validClientId = Boolean(clientIdText)
    && (typeof client_id !== "number" || Number.isSafeInteger(client_id));
  if (!validClientId || typeof body !== "string") {
    const clientIdStatus = typeof client_id === "string"
      ? client_id.trim() ? "non-empty string" : "empty string"
      : client_id === null ? "null" : typeof client_id;
    const bodyStatus = typeof body === "string"
      ? body.trim() ? "non-empty string" : "empty string"
      : body === null ? "null" : typeof body;
    return errorResponse(
      `Invalid message payload: client_id must be a non-empty string (received ${clientIdStatus}); body must be a string (received ${bodyStatus}).`,
      400,
    );
  }

  const messageBody = body.trim();
  const clientId = /^\d+$/.test(clientIdText) ? Number(clientIdText) : clientIdText;
  if (!messageBody || messageBody.length > 4000) {
    return errorResponse("Message body must contain between 1 and 4,000 characters.", 400);
  }
  if (typeof clientId === "number" && !Number.isSafeInteger(clientId)) {
    return errorResponse("Client ID is outside the supported numeric range.", 400);
  }

  const supabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return errorResponse(authError?.message ?? "The session is invalid.", 401, authError
      ? { message: authError.message, code: authError.code ?? undefined }
      : undefined);
  }

  const { data, error } = await supabase
    .from("client_messages")
    .insert({
      client_id: clientId,
      sender_id: authData.user.id,
      sender_role: "manager",
      body: messageBody,
    })
    .select("id, client_id, sender_id, sender_role, body, created_at, manager_read_at, client_read_at")
    .single();

  if (error) {
    const status = error.code === "42501"
      ? 403
      : error.code === "23505"
        ? 409
        : error.code?.startsWith("22") || error.code?.startsWith("23")
          ? 400
          : 500;
    return errorResponse(error.message, status, {
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
      ...(error.hint ? { hint: error.hint } : {}),
    });
  }

  if (!data) return errorResponse("The database returned no message row after insertion.", 502);
  return Response.json({ data, error: null }, { status: 201 });
}
