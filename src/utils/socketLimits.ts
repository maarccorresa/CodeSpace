// Límites en memoria para eventos de Socket.IO (una sola instancia).
// Frenan fuerza bruta de contraseñas, inundación de disco y spam de mensajes.

// Límites de contenido
export const MAX_FILE_BYTES = 2 * 1024 * 1024;        // 2 MB por archivo
export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;  // 25 MB por workspace
export const MAX_FILES_PER_WORKSPACE = 500;           // nº de archivos/carpetas

// Fuerza bruta: intentos de contraseña de workspace por IP
const pwAttempts = new Map<string, { count: number; reset: number }>();
const PW_WINDOW_MS = 15 * 60 * 1000;
const PW_MAX = 20;

export function passwordAttemptBlocked(ip: string): boolean {
    const now = Date.now();
    let e = pwAttempts.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + PW_WINDOW_MS }; pwAttempts.set(ip, e); }
    return e.count >= PW_MAX;
}
export function registerPasswordFailure(ip: string): void {
    const now = Date.now();
    let e = pwAttempts.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + PW_WINDOW_MS }; pwAttempts.set(ip, e); }
    e.count++;
}

// Creación de workspaces nuevos por IP (frena llenar el disco con miles)
const wsCreated = new Map<string, { count: number; reset: number }>();
const WS_WINDOW_MS = 60 * 60 * 1000;
const WS_MAX = 60;

export function workspaceCreationBlocked(ip: string): boolean {
    const now = Date.now();
    let e = wsCreated.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + WS_WINDOW_MS }; wsCreated.set(ip, e); }
    if (e.count >= WS_MAX) return true;
    e.count++;
    return false;
}

// Mensajes de chat por socket (ventana corta)
const chatRate = new Map<string, number[]>();
const CHAT_WINDOW_MS = 10 * 1000;
const CHAT_MAX = 15;

export function chatFlooded(socketId: string): boolean {
    const now = Date.now();
    const arr = (chatRate.get(socketId) || []).filter(t => now - t < CHAT_WINDOW_MS);
    arr.push(now);
    chatRate.set(socketId, arr);
    return arr.length > CHAT_MAX;
}
export function clearChatRate(socketId: string): void {
    chatRate.delete(socketId);
}

// Tamaño total de una estructura (bytes aproximados por longitud de contenido)
export function structureBytes(node: any): number {
    let size = 0;
    for (const item of Object.values<any>(node || {})) {
        if (item?.type === 'file') size += (item.content || '').length;
        else if (item?.type === 'folder' && item.children) size += structureBytes(item.children);
    }
    return size;
}
export function structureCount(node: any): number {
    let n = 0;
    for (const item of Object.values<any>(node || {})) {
        n++;
        if (item?.type === 'folder' && item.children) n += structureCount(item.children);
    }
    return n;
}
