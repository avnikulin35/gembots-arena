import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "../../../../lib/ai-provider";
import { rateLimit, getClientIP } from '@/lib/rate-limit';

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Rate limit: 3 req/min per IP
  const ip = getClientIP(req);
  const { allowed } = rateLimit(`ai-generate-strategy:${ip}`, 3, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const provider = getProvider();

    const { description } = await req.json();

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "Strategy description is required" },
        { status: 400 }
      );
    }

    // Input validation: max 200 chars for description
    if (description.length > 200) {
      return NextResponse.json(
        { error: "Description must be 200 characters or less" },
        { status: 400 }
      );
    }

    // Sanitize prompt injection attempts
    const sanitized = description.replace(/\b(system|assistant)\s*:/gi, '').replace(/ignore\s+(previous|above|all)\s+instructions?/gi, '');

    const strategy = await provider.generateStrategy(sanitized);

    if (!strategy) {
      return NextResponse.json(
        { error: "AI provider did not return a strategy" },
        { status: 500 }
      );
    }

    // The original API returned an object with 'success', 'contract', 'audit'.
    // Our new interface returns a string (the strategy itself).
    // Adapt the response to match expectations if needed, or simply return the strategy.
    return NextResponse.json({ success: true, contract: strategy, audit: null });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Strategy] Error:", msg);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return NextResponse.json(
        { error: "AI provider is taking too long. Please try again." },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
