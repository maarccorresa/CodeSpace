import { Router, Request, Response } from 'express';
import * as userService from '../services/user.service';
import { rateLimit } from '../utils/rateLimit';

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const str = (v: unknown) => (typeof v === 'string' ? v : '');

// Nueva sesión al identificarse (evita fijación de sesión)
function startUserSession(req: Request, res: Response, user: { id: string; email: string; username: string; nickname: string }) {
    req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'Error al iniciar sesión' });
        req.session.userEmail    = user.email;
        req.session.userId       = String(user.id);
        req.session.userUsername = user.username;
        req.session.userNickname = user.nickname;
        req.session.isLoggedIn   = true;
        res.json({ success: true, user });
    });
}

const router = Router();

// ── Registro ──────────────────────────────────────
router.post('/register', authLimiter, async (req: Request, res: Response) => {
    try {
        const email = str(req.body?.email), password = str(req.body?.password);
        const username = str(req.body?.username), nickname = str(req.body?.nickname);

        if (!email || !password || !username) {
            return res.status(400).json({ error: 'Email, contraseña y nombre de usuario son obligatorios' });
        }
        if (!nickname || nickname.trim().length < 2) {
            return res.status(400).json({ error: 'El NickName debe tener al menos 2 caracteres' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        if (username.trim().length > 40 || nickname.trim().length > 40 || email.length > 254) {
            return res.status(400).json({ error: 'Algún campo es demasiado largo' });
        }
        if (username.trim().length < 2) {
            return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 2 caracteres' });
        }

        const result = await userService.registerUser(email, password, username, nickname);
        if ('error' in result) {
            return res.status(409).json({ error: result.error });
        }

        startUserSession(req, res, result.user);
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

// ── Login ─────────────────────────────────────────
router.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
        const email = str(req.body?.email), password = str(req.body?.password);

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
        }

        const result = await userService.loginUser(email, password);
        if ('error' in result) {
            return res.status(401).json({ error: result.error });
        }

        startUserSession(req, res, result.user);
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// ── Logout ────────────────────────────────────────
router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Error al cerrar sesión' });
        res.clearCookie('codespace.sid');
        res.json({ success: true });
    });
});

// ── Perfil actual ─────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    try {
        const user = await userService.getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        res.json({
            id:       user._id || user.id,
            email:    user.email,
            username: user.username,
            nickname: user.nickname || user.username,
            createdAt: user.createdAt
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener perfil' });
    }
});

// ── Workspaces del usuario ────────────────────────
router.get('/workspaces', async (req: Request, res: Response) => {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    try {
        const data = await userService.getUserWorkspacesInfo(req.session.userId);
        res.json(data);
    } catch (error) {
        console.error('Error obteniendo workspaces:', error);
        res.status(500).json({ error: 'Error al obtener workspaces' });
    }
});

// ── Buzón de notificaciones ──────────────────────
router.get('/notifications', async (req: Request, res: Response) => {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    try {
        const ticketService = await import('../services/ticket.service');
        const inbox = await ticketService.getUserNotificationInbox(req.session.userId);
        res.json(inbox);
    } catch (error) {
        console.error('Error obteniendo notificaciones:', error);
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

export default router;
