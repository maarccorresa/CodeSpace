// Validación de identificadores y nombres que llegan del cliente.
// Los workspaces se guardan como `<id>.json` junto a users.json, moderators.json…,
// así que el id no puede contener rutas ni coincidir con esos ficheros.

const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const RESERVED_WORKSPACE_IDS = new Set([
    'users', 'moderators', 'blocked-ips', 'api', 'admin', 'login', 'signin',
    'dashboard', 'js', 'css', 'img', 'socket.io', 'healthz', 'favicon.ico'
]);

// Claves que no pueden usarse como nombre de archivo o carpeta:
// apuntan al prototipo de Object y permitirían modificarlo.
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isValidWorkspaceId(id: unknown): id is string {
    return typeof id === 'string'
        && WORKSPACE_ID_RE.test(id)
        && !RESERVED_WORKSPACE_IDS.has(id.toLowerCase());
}

export function isValidItemName(name: unknown): name is string {
    return typeof name === 'string'
        && name.length > 0
        && name.length <= 255
        && name !== '.'
        && name !== '..'
        && !/[\/\\\0]/.test(name)
        && !FORBIDDEN_KEYS.has(name);
}

// Ruta relativa dentro del workspace: "carpeta/sub/archivo.js"
export function isValidItemPath(p: unknown): p is string {
    return typeof p === 'string'
        && p.length > 0
        && p.length <= 1024
        && p.split('/').every(isValidItemName);
}

export function isSafeKey(key: string): boolean {
    return !FORBIDDEN_KEYS.has(key);
}
