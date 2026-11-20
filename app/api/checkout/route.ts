import { NextResponse } from "next/server";

const priceCache: Record<string, string> = {};

const PLAN_PRICES: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 1500, yearly: 15000 },
  pro: { monthly: 3500, yearly: 35000 },
};

function getChargilyConfig() {
  const secretKey = (process.env.CHARGILY_SECRET_KEY || "").trim();
  let apiUrl = (process.env.CHARGILY_API_URL || "").trim().replace(/\/+$/, "");

  if (!apiUrl || apiUrl === "https://pay.chargily.net") {
    apiUrl = secretKey.startsWith("test_sk_")
      ? "https://pay.chargily.net/test/api/v2"
      : "https://pay.chargily.net/api/v2";
  } else if (!apiUrl.includes("/api/v2")) {
    apiUrl = secretKey.startsWith("test_sk_")
      ? `${apiUrl}/test/api/v2`
      : `${apiUrl}/api/v2`;
  }

  return { secretKey, apiUrl };
}

async function getOrCreatePrice(apiUrl: string, secretKey: string, planName: string, amount: number) {
  const cacheKey = `${planName}_${amount}`;
  if (priceCache[cacheKey]) {
    return priceCache[cacheKey];
  }

  // 1. Create a product in Chargily if not cached
  const productRes = await fetch(`${apiUrl}/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `CountaDocs - ${planName.charAt(0).toUpperCase() + planName.slice(1)} Plan`,
      description: `CountaDocs ${planName} subscription`,
    }),
  });

  const productData = await productRes.json().catch(() => ({}));
  if (!productRes.ok || !productData.id) {
    throw new Error(productData.message || "Failed to create product in Chargily");
  }

  // 2. Create a price for this product
  const priceRes = await fetch(`${apiUrl}/prices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amount,
      currency: "dzd",
      product_id: productData.id,
    }),
  });

  const priceData = await priceRes.json().catch(() => ({}));
  if (!priceRes.ok || !priceData.id) {
    throw new Error(priceData.message || "Failed to create price in Chargily");
  }

  priceCache[cacheKey] = priceData.id;
  return priceData.id;
}

export async function POST(request: Request) {
  try {
    const { secretKey, apiUrl } = getChargilyConfig();

    if (!secretKey) {
      return NextResponse.json(
        { error: "Chargily secret key is missing. Please configure CHARGILY_SECRET_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const plan = (body.plan || "starter") as "starter" | "pro";
    const billingCycle = (body.billingCycle || "monthly") as "monthly" | "yearly";
    const locale = (body.locale || "fr") as "ar" | "fr" | "en";
    const paymentMethod = body.paymentMethod === "cib" ? "cib" : "edahabia";

    const planConfig = PLAN_PRICES[plan] || PLAN_PRICES.starter;
    const amount = billingCycle === "yearly" ? planConfig.yearly : planConfig.monthly;
    const planLabel = `${plan} (${billingCycle})`;

    const host = request.headers.get("host") || "localhost:3000";
    const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `${protocol}://${host}`;

    const cleanOrigin = origin.replace(/\/+$/, "");

    // Get or create price in Chargily
    const priceId = await getOrCreatePrice(apiUrl, secretKey, planLabel, amount);

    // Create checkout in Chargily with chosen payment method (edahabia or cib)
    const checkoutRes = await fetch(`${apiUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${cleanOrigin}/success`,
        failure_url: `${cleanOrigin}/failure`,
        payment_method: paymentMethod,
        locale: locale === "ar" ? "ar" : locale === "fr" ? "fr" : "en",
        metadata: {
          plan,
          billingCycle,
          paymentMethod,
        },
      }),
    });

    const checkoutData = await checkoutRes.json().catch(() => ({}));

    if (!checkoutRes.ok || !checkoutData.checkout_url) {
      return NextResponse.json(
        { error: checkoutData.message || "Could not generate Chargily checkout link" },
        { status: checkoutRes.status || 400 }
      );
    }

    const rawUrl = String(checkoutData.checkout_url || "");
    const checkoutUrl = rawUrl
      .replace(/^http:\/\//i, "https://")
      .replace(/pay\.chargily\.dz/i, "pay.chargily.net");

    return NextResponse.json({
      checkoutUrl,
      checkout_url: checkoutUrl,
      url: checkoutUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Chargily checkout error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
