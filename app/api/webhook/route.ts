import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("signature");
    const secretKey = (process.env.CHARGILY_SECRET_KEY || "").trim();

    if (!secretKey) {
      return NextResponse.json({ error: "Secret key not configured" }, { status: 500 });
    }

    const rawBody = await request.text();

    // Verify webhook signature if provided by Chargily
    if (signature) {
      const computedSignature = crypto
        .createHmac("sha256", secretKey)
        .update(rawBody)
        .digest("hex");

      if (signature !== computedSignature) {
        console.error("Invalid Chargily webhook signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    const event = JSON.parse(rawBody);
    console.log("Chargily webhook received:", event.type, event.id);

    // Event 5b in diagram: Payment confirmed
    if (event.type === "checkout.paid") {
      const checkout = event.data;
      console.log(`Payment confirmed for checkout ${checkout.id}, amount: ${checkout.amount} DZD`);
      
      // Here you can update your relational database (Supabase) to mark the client/workspace as paid
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Webhook error";
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
