import { NextResponse } from "next/server";

/**
 * Gammal Tech International Payment – Payment Link redirect
 *
 * Uses the hosted payment-link URL so no server-side secret key is needed.
 * Security is enforced by Gammal Tech through domain whitelisting on the project.
 *
 * Required env var:
 *   NEXT_PUBLIC_GAMMALTECH_PROJECT_ID  – your Gammal Tech project ID
 *
 * Flow:
 *   1. Frontend POSTs { plan, billingCycle, currency, card }
 *   2. We build the Gammal Tech payment-link URL with amount + currency
 *   3. Return the URL to the frontend which does window.location.href = url
 */

const PLAN_PRICES_DZD: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 1500, yearly: 15000 },
  pro: { monthly: 3500, yearly: 35000 },
};

// Official bank rates: 1 USD = 137.17 DZD, 1 EUR = 150.79 DZD
const DZD_TO_USD = 137.17;
const DZD_TO_EUR = 150.79;

export async function POST(request: Request) {
  try {
    const projectId = (process.env.NEXT_PUBLIC_GAMMALTECH_PROJECT_ID || "").trim();

    if (!projectId) {
      return NextResponse.json(
        { error: "Gammal Tech project ID is not configured. Please set NEXT_PUBLIC_GAMMALTECH_PROJECT_ID in .env.local" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const plan = (body.plan || "starter") as "starter" | "pro";
    const billingCycle = (body.billingCycle || "monthly") as "monthly" | "yearly";
    const currency = (body.currency || "USD").toUpperCase() as "USD" | "EUR";
    const card = body.card || "visa"; // visa, mastercard, applepay

    const planConfig = PLAN_PRICES_DZD[plan] || PLAN_PRICES_DZD.starter;
    const amountDZD = billingCycle === "yearly" ? planConfig.yearly : planConfig.monthly;

    // Convert DZD to international currency
    const rate = currency === "EUR" ? DZD_TO_EUR : DZD_TO_USD;
    const amountConverted = Math.round((amountDZD / rate) * 100) / 100; // 2 decimal places

    const planLabel = `CountaDocs ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${billingCycle})`;

    // Build callback URL
    const host = request.headers.get("host") || "localhost:3000";
    const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `${protocol}://${host}`;
    const cleanOrigin = origin.replace(/\/+$/, "");

    // Build Gammal Tech payment link
    const params = new URLSearchParams({
      pid: projectId,
      amount: amountConverted.toString(),
      desc: planLabel,
      currency: currency,
      callback: `${cleanOrigin}/success`,
    });

    const checkoutUrl = `https://api.gammal.tech/sdk/pay/link/?${params.toString()}`;

    return NextResponse.json({
      checkoutUrl,
      checkout_url: checkoutUrl,
      url: checkoutUrl,
      amount: amountConverted,
      currency,
      card,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Gammal Tech checkout error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
