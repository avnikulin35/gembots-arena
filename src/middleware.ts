import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://gembots.space',
  'https://www.gembots.space',
  'https://gembots.ainmid.com',
];

function getCorsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return null;
}

// Simple edge-compatible rate limiter for AI endpoints
const aiRateMap = new Map<string, { count: number; resetAt: number }>();
const AI_RATE_LIMIT = 20; // max 20 AI requests per minute per IP
const AI_RATE_WINDOW = 60_000;

function checkAIRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = aiRateMap.get(ip);
  if (!entry || entry.resetAt < now) {
    aiRateMap.set(ip, { count: 1, resetAt: now + AI_RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= AI_RATE_LIMIT;
}

// Cleanup every 2 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of aiRateMap) {
      if (entry.resetAt < now) aiRateMap.delete(key);
    }
  }, 120_000);
}

export function middleware(request: NextRequest) {
  // Block invalid Server Action requests (bot scanners sending Next-Action: "x")
  const nextAction = request.headers.get('next-action');
  if (nextAction && !/^[a-f0-9]{40}$/.test(nextAction)) {
    return new NextResponse(null, { status: 403 });
  }

  // Global rate limit for AI endpoints
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/ai/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (!checkAIRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many AI requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
  }

  const corsOrigin = getCorsOrigin(request);

  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
    }
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');

  // CORS
  if (corsOrigin) {
    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
  }

  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
