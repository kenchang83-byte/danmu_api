import { handleRequest } from './worker.js';

// Keep all application routes private, including upstream public metadata.
export default {
  async fetch(request) {
    const token = new URL(request.url).pathname.split('/').filter(Boolean)[0];
    const allowed = [process.env.TOKEN, process.env.ADMIN_TOKEN].filter(Boolean);
    if (!allowed.length || process.env.TOKEN === '87654321') {
      return Response.json({ error: 'Private API credentials are not configured' }, { status: 503 });
    }
    if (request.method !== 'OPTIONS' && !allowed.includes(token)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const response = await handleRequest(request, process.env, 'vercel', clientIp);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  },
};
