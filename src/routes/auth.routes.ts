import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { config } from '../config';
import { rateLimit } from '../utils/rateLimit';

function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

const router = Router();
const DATA_DIR = path.join(process.cwd(), config.dataDir);

// Login de admin o moderador
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req: Request, res: Response) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
        }
        
        // Verificar si es el admin principal
        if (safeEqual(email, config.adminEmail) && safeEqual(password, config.adminPassword)) {
            return req.session.regenerate((err) => {
                if (err) return res.status(500).json({ error: 'Error al iniciar sesión' });
                req.session.isAdmin = true;
                req.session.isModerator = false;
                req.session.userEmail = email;
                res.json({ success: true, redirect: '/admin' });
            });
        }
        
        // Verificar si es un moderador
        try {
            const moderatorsPath = path.join(DATA_DIR, 'moderators.json');
            const data = await fs.readFile(moderatorsPath, 'utf-8');
            const moderators = JSON.parse(data);
            
            const moderator = moderators.find((mod: any) => String(mod.email).toLowerCase() === email);
            
            if (moderator) {
                // Verificar si está activo
                if (moderator.active === false) {
                    return res.status(401).json({ error: 'Cuenta de moderador desactivada' });
                }
                
                // Verificar contraseña
                const passwordMatch = await bcrypt.compare(password, moderator.password);
                
                if (passwordMatch) {
                    // Actualizar último login
                    moderator.lastLogin = new Date().toISOString();
                    await fs.writeFile(moderatorsPath, JSON.stringify(moderators, null, 2));

                    console.log(`👮 Moderador autenticado: ${email}`);

                    return req.session.regenerate((err) => {
                        if (err) return res.status(500).json({ error: 'Error al iniciar sesión' });
                        req.session.isAdmin = false;
                        req.session.isModerator = true;
                        req.session.userEmail = email;
                        res.json({ success: true, redirect: '/admin' });
                    });
                }
            }
        } catch (error) {
            // Sin archivo de moderadores: solo existe el admin principal
            if ((error as any)?.code !== 'ENOENT') console.error('Error leyendo moderadores:', error);
        }
        
        return res.status(401).json({ error: 'Credenciales inválidas' });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        res.clearCookie('codespace.sid');
        res.json({ success: true });
    });
});

export default router;
