import { NextResponse } from 'next/server';
import { query } from '@/server/db';

export async function GET() {
  try {
    const result = await query('SELECT 1 as status');
    return NextResponse.json({ status: 'ok', db: result });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: (error as Error).message }, { status: 500 });
  }
}
