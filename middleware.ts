import { NextRequest, NextResponse } from 'next/server'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-ECOBE-Internal-Key, X-ECOBE-Signature, X-Request-Id, X-API-Key, Accept',
  'Access-Control-Expose-Headers': 'x-ecobe-broker, x-ecobe-upstream',
  'Access-Control-Max-Age': '86400',
} as const

function applyCors(headers: Headers) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  headers.set('Vary', 'Origin')
}

export function middleware(request: NextRequest) {
  const corsHeaders = new Headers()
  applyCors(corsHeaders)

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  const response = NextResponse.next()
  applyCors(response.headers)
  return response
}

export const config = {
  matcher: ['/api/v1/:path*'],
}
