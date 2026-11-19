import { Request, Response, NextFunction } from 'express';

// Límite simple en memoria por IP (sin dependencias). Suficiente para frenar
// fuerza bruta contra los formularios de acceso de una sola instancia.
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
    const hits = new Map<string, { count: number; reset: number }>();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
    }, options.windowMs).unref();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = req.ip || 'unknown';
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + options.windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > options.max) {
            res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000).toString());
            return res.status(429).json({ error: options.message || 'Demasiados intentos. Espera unos minutos.' });
        }
        next();
    };
}
