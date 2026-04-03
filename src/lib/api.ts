import { NextResponse } from 'next/server';
import { withCors } from './cors';

export function jsonOk<T>(data: T, request?: Request, init?: ResponseInit) {
  return withCors(NextResponse.json(data, init), request);
}

export function jsonError(message: string, status = 400, details?: string[], request?: Request) {
  return withCors(NextResponse.json({ error: message, details }, { status }), request);
}
