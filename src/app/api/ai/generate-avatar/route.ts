import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "../../../../lib/ai-provider";
import { rateLimit, getClientIP } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  // Rate limit: 3 req/min per IP
  const ip = getClientIP(req);
  const { allowed } = rateLimit(`ai-generate-avatar:${ip}`, 3, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const provider = getProvider();

    const { prompt, style } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Input validation: max 200 chars for prompt
    if (prompt.length > 200) {
      return NextResponse.json({ error: "Prompt must be 200 characters or less" }, { status: 400 });
    }

    // Sanitize prompt injection attempts
    const sanitized = prompt.replace(/\b(system|assistant)\s*:/gi, '').replace(/ignore\s+(previous|above|all)\s+instructions?/gi, '');

    // The enhancedPrompt logic is now within the the AI provider image generation
    const imageUrl = await provider.generateAvatar({ name: sanitized, emoji: '', style });

    if (!imageUrl) {
      return NextResponse.json({ error: "AI provider did not return an image URL" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      image: imageUrl,
      prompt: prompt, // Original prompt, as enhancedPrompt is now internal to provider
    });
  } catch (error) {
    console.error("Avatar generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
