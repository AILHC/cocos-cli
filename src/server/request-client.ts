import type { Request } from 'express';

export function isBrowserRequest(request: Request): boolean {
    if (request.query.isBrowser === 'true') {
        return true;
    }

    const userAgent = request.headers['user-agent'];
    return !!request.headers['sec-ch-ua']
        || request.headers['accept']?.includes('text/html') === true
        || (typeof userAgent === 'string' && userAgent.includes('Mozilla/') && !userAgent.includes('node.js/'));
}
