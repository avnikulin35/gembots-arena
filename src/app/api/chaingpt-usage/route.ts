import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const reportPath = path.join(process.cwd(), 'data', 'chaingpt-report.json');

  if (!fs.existsSync(reportPath)) {
    return NextResponse.json(
      { error: 'Report not generated yet' },
      { status: 404 }
    );
  }

  const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
