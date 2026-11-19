import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import path from 'path';
import { config, assertSafeConfig } from './config';
import { connectDatabase, isDatabaseConnected, disconnectDatabase } from './database/connection';
import { ensureDataDir, cleanupExpiredWorkspaces, flushPendingSaves } from './services/workspace.service';
import { setupSocketHandlers } from './socket';
import { isValidWorkspaceId } from './utils/validation';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import workspaceRoutes from './routes/workspace.routes';
import chatRoutes from './routes/chat.routes';
import ticketRoutes from './routes/ticket.routes';
import userRoutes from './routes/user.routes';

const PUBLIC_DIR = path.join(__dirname, '../public');
const page = (name: string) => path.join(PUBLIC_DIR, name);

async function startServer() {
    assertSafeConfig();
    await ensureDataDir();
    await connectDatabase();

    const app = express();
    const server = createServer(app);
    const io = new SocketIOServer(server, {
        maxHttpBufferSize: 2 * 1024 * 1024 // 2 MB por mensaje (archivos grandes)
    });

    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', 1);

    // Cabeceras de seguridad básicas
    app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        next();
    });

    app.use(express.json({ limit: '1mb' }));

    // Sesiones: en MongoDB si está disponible (sobreviven a reinicios del contenedor)
    const sessionMiddleware = session({
        name: 'codespace.sid',
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: true,
        rolling: true,
        store: isDatabaseConnected()
            ? MongoStore.create({
                mongoUrl: config.mongoUri,
                collectionName: 'sessions',
                ttl: 7 * 24 * 60 * 60,
                touchAfter: 60
            })
            : undefined,
        cookie: {
            secure: config.cookieSecure,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
            httpOnly: true,
            sameSite: 'lax',
            path: '/'
        }
    });
    app.use(sessionMiddleware);

    // Estado para Docker / balanceadores
    app.get('/healthz', (req, res) => {
        res.json({ status: 'ok', database: isDatabaseConnected() ? 'up' : 'down' });
    });

    // Archivos estáticos (sin servir *.bak ni listados)
    app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'ignore' }));

    // Páginas
    app.get('/', (req, res) => res.sendFile(page('index.html')));
    app.get('/login', (req, res) => res.sendFile(page('login.html')));
    app.get('/signin', (req, res) => res.sendFile(page('signin.html')));

    app.get('/dashboard', (req, res) => {
        if (req.session?.isLoggedIn && req.session?.userId) {
            res.sendFile(page('dashboard.html'));
        } else {
            res.redirect('/signin');
        }
    });

    app.get('/admin', (req, res) => {
        if (req.session && (req.session.isAdmin || req.session.isModerator)) {
            res.sendFile(page('admin.html'));
        } else {
            res.redirect('/login');
        }
    });

    // Rutas de API
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/workspace', workspaceRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/user', userRoutes);
    app.use('/api/tickets', (req, res, next) => {
        (req as any).io = io;
        next();
    }, ticketRoutes);

    app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

    // Workspace: /<nombre>
    app.get('/:workspaceId', (req, res) => {
        if (!isValidWorkspaceId(req.params.workspaceId)) {
            return res.status(404).sendFile(page('index.html'));
        }
        res.sendFile(page('workspace.html'));
    });

    // Errores no capturados en rutas
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
        if (err?.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'JSON inválido' });
        }
        if (err?.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Petición demasiado grande' });
        }
        console.error('Error no controlado:', err);
        res.status(500).json({ error: 'Error interno' });
    });

    setupSocketHandlers(io, sessionMiddleware);

    await cleanupExpiredWorkspaces();
    setInterval(cleanupExpiredWorkspaces, config.cleanupInterval);

    server.listen(config.port, () => {
        console.log(`\n🚀 CodeSpace escuchando en el puerto ${config.port}`);
        console.log(`🔐 Administración: /login (${config.adminEmail})`);
        console.log(`🗄️  MongoDB: ${isDatabaseConnected() ? 'conectado' : 'no configurado (modo archivos)'}`);
        console.log(`⏳ Expiración de workspaces: ${config.workspaceExpiryDays} días\n`);
    });

    // Parada limpia (docker stop envía SIGTERM)
    const shutdown = (signal: string) => {
        console.log(`${signal} recibido, cerrando…`);
        io.close();
        server.close(async () => {
            await flushPendingSaves();
            await disconnectDatabase();
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 8000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
    console.error('No se pudo arrancar el servidor:', error);
    process.exit(1);
});
