import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true } as any);

const isProduction = process.env.NODE_ENV === 'production';

function bool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const DEFAULT_SECRET = 'codespace-secret-key-change-in-production';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

export const config = {
    isProduction,

    // Servidor
    port: parseInt(process.env.PORT || '3000', 10),

    // Detrás de un proxy (nginx, Traefik…) para leer la IP real de X-Forwarded-For
    trustProxy: bool(process.env.TRUST_PROXY, false),

    // Cookie de sesión solo por HTTPS
    cookieSecure: bool(process.env.COOKIE_SECURE, false),

    // Seguridad
    sessionSecret: process.env.SESSION_SECRET || DEFAULT_SECRET,

    // Admin
    adminEmail: (process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase().trim(),
    adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,

    // Base de datos
    mongoUri: process.env.MONGO_URI || '',

    // Limpieza
    cleanupIntervalDays: parseInt(process.env.CLEANUP_INTERVAL_DAYS || '1', 10),
    workspaceExpiryDays: parseInt(process.env.WORKSPACE_EXPIRY_DAYS || '30', 10),

    // Rutas
    dataDir: 'workspaces-data',
    publicDir: 'public',

    get dataPath() {
        return path.join(process.cwd(), this.dataDir);
    },

    // Constantes calculadas
    get cleanupInterval() {
        return this.cleanupIntervalDays * 24 * 60 * 60 * 1000;
    },
    get workspaceExpiry() {
        return this.workspaceExpiryDays * 24 * 60 * 60 * 1000;
    }
};

// En producción no se arranca con los valores por defecto: cualquiera los conoce.
export function assertSafeConfig(): void {
    const problems: string[] = [];
    if (config.sessionSecret === DEFAULT_SECRET || config.sessionSecret.length < 32) {
        problems.push('SESSION_SECRET debe tener al menos 32 caracteres y no ser el de ejemplo');
    }
    if (config.adminPassword === DEFAULT_ADMIN_PASSWORD || config.adminPassword.length < 8) {
        problems.push('ADMIN_PASSWORD debe tener al menos 8 caracteres y no ser "admin123"');
    }

    if (problems.length === 0) return;

    if (isProduction) {
        for (const p of problems) console.error(`❌ ${p}`);
        console.error('   Revisa el archivo .env (./codespace install lo genera solo).');
        process.exit(1);
    }
    for (const p of problems) console.warn(`⚠️  ${p} (aceptado solo en desarrollo)`);
}
