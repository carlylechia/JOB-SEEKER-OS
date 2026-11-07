const allowedOrigin = process.env.CORS_ORIGIN;

export function withCors(response: Response, request?: Request) {
  const origin = request?.headers.get('origin') || '';
  const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
  const allowOrigin = isExtension
    ? origin
    : (allowedOrigin && origin === allowedOrigin ? allowedOrigin : 'same-origin');
  response.headers.set('Vary', 'Origin');
  if (allowOrigin !== 'same-origin') {
    response.headers.set('Access-Control-Allow-Origin', allowOrigin);
    if (isExtension) {
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

export function handleOptions(request: Request) {
  return withCors(new Response(null, { status: 204 }), request);
}
