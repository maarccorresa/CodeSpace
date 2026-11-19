import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { Workspace, WorkspaceData, WorkspaceStructure } from '../types';
import { config } from '../config';
import { isValidWorkspaceId, isSafeKey } from '../utils/validation';

// Almacenamiento en memoria
export const workspaces = new Map<string, Workspace>();

// userId → set of socket IDs currently connected (tracks who is online)
export const onlineUserSockets = new Map<string, Set<string>>();

const DATA_DIR = config.dataPath;

// Asegurar que existe el directorio de datos
export async function ensureDataDir(): Promise<void> {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('Directorio de datos creado:', DATA_DIR);
    }
}

// Guardar workspace en disco
export async function saveWorkspace(workspaceId: string, workspace: Workspace): Promise<void> {
    if (!isValidWorkspaceId(workspaceId)) return;
    try {
        const filePath = path.join(DATA_DIR, `${workspaceId}.json`);
        const data: WorkspaceData = {
            structure: workspace.structure,
            password: workspace.password,
            lastAccess: Date.now(),
            created: workspace.created || Date.now(),
            ownerId: workspace.ownerId,
            participants: workspace.participants
        };
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error guardando workspace ${workspaceId}:`, error);
    }
}

// Guardado diferido: al escribir en el editor llegan cambios por cada tecla;
// se agrupan y el JSON se escribe como mucho una vez por segundo y workspace.
const pendingSaves = new Map<string, NodeJS.Timeout>();

export function scheduleSave(workspaceId: string, delayMs = 1000): void {
    if (pendingSaves.has(workspaceId)) return;
    pendingSaves.set(workspaceId, setTimeout(async () => {
        pendingSaves.delete(workspaceId);
        const ws = workspaces.get(workspaceId);
        if (ws) await saveWorkspace(workspaceId, ws);
    }, delayMs));
}

export async function flushPendingSaves(): Promise<void> {
    const ids = Array.from(pendingSaves.keys());
    for (const id of ids) {
        clearTimeout(pendingSaves.get(id)!);
        pendingSaves.delete(id);
        const ws = workspaces.get(id);
        if (ws) await saveWorkspace(id, ws);
    }
}

// Cargar workspace desde disco
export async function loadWorkspace(workspaceId: string): Promise<Workspace | null> {
    if (!isValidWorkspaceId(workspaceId)) return null;
    try {
        const filePath = path.join(DATA_DIR, `${workspaceId}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed: WorkspaceData = JSON.parse(data);
        if (!parsed || typeof parsed.structure !== 'object') return null;

        // Actualizar último acceso
        parsed.lastAccess = Date.now();
        await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));
        
        return {
            structure: parsed.structure,
            password: parsed.password,
            users: 0,
            created: parsed.created,
            lastAccess: parsed.lastAccess,
            uniqueUsers: new Set<string>(),
            sessionSockets: new Map<string, Set<string>>(),
            ownerId: parsed.ownerId,
            participants: parsed.participants || []
        };
    } catch (error) {
        return null;
    }
}

// Limpiar workspaces expirados
export async function cleanupExpiredWorkspaces(): Promise<void> {
    try {
        const files = await fs.readdir(DATA_DIR);
        const now = Date.now();
        let cleaned = 0;

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const workspaceId = file.replace(/\.json$/, '');
            if (!isValidWorkspaceId(workspaceId)) continue; // users.json, moderators.json…

            const filePath = path.join(DATA_DIR, file);
            let parsed: WorkspaceData;
            try {
                parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            } catch {
                continue;
            }

            // No borrar un workspace con gente conectada
            const live = workspaces.get(workspaceId);
            if (live && live.users > 0) continue;

            if (now - (parsed.lastAccess || 0) > config.workspaceExpiry) {
                await fs.unlink(filePath);
                await fs.rm(path.join(DATA_DIR, workspaceId), { recursive: true, force: true });
                workspaces.delete(workspaceId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Limpieza: ${cleaned} workspace(s) expirado(s) eliminado(s)`);
        }
    } catch (error) {
        console.error('Error en limpieza de workspaces:', error);
    }
}

// Inicializar workspace
export async function initWorkspace(workspaceId: string, password: string | null = null, bypassPassword = false): Promise<Workspace | { error: string }> {
    if (!isValidWorkspaceId(workspaceId)) {
        return { error: 'invalid_workspace' };
    }
    if (password !== null && password !== undefined && typeof password !== 'string') {
        return { error: 'invalid_password' };
    }

    if (workspaces.has(workspaceId)) {
        const workspace = workspaces.get(workspaceId)!;
        
        // Verificar contraseña si el workspace está protegido
        if (workspace.password && !bypassPassword) {
            if (!password) {
                return { error: 'password_required' };
            }
            const match = await bcrypt.compare(password, workspace.password);
            if (!match) {
                return { error: 'invalid_password' };
            }
        }
        
        return workspace;
    }

    // Intentar cargar desde disco
    let workspace = await loadWorkspace(workspaceId);

    // Si no existe, crear uno nuevo
    if (!workspace) {
        workspace = {
            structure: {
                'README.md': { 
                    type: 'file', 
                    content: '# Bienvenido a CodeSpace\n\nEste es tu workspace colaborativo.\n\nPuedes crear archivos y carpetas desde la barra lateral.' 
                }
            },
            users: 0,
            created: Date.now(),
            uniqueUsers: new Set<string>(),
            sessionSockets: new Map<string, Set<string>>()
        };
        
        // NO establecer contraseña al crear workspace
        // Las contraseñas solo se establecen desde el menú contextual
        
        await saveWorkspace(workspaceId, workspace);
    } else if (workspace.password && !bypassPassword) {
        // Workspace existente con contraseña
        if (!password) {
            return { error: 'password_required' };
        }
        const match = await bcrypt.compare(password, workspace.password);
        if (!match) {
            return { error: 'invalid_password' };
        }
    }

    workspaces.set(workspaceId, workspace);
    return workspace;
}

// Obtener archivo por ruta
export function getFileByPath(structure: WorkspaceStructure, filePath: string): any {
    if (typeof filePath !== 'string' || filePath === '') return null;
    const parts = filePath.split('/');
    let current: any = structure;

    for (const part of parts) {
        // Solo propiedades propias: "__proto__" o "constructor" no deben resolver
        if (!isSafeKey(part) || !current || !Object.prototype.hasOwnProperty.call(current, part)) return null;
        current = current[part];
        if (current.type === 'folder' && current.children) {
            current = current.children;
        }
    }

    return current;
}

// Calcular tamaño del workspace
export function calculateWorkspaceSize(structure: WorkspaceStructure): number {
    let size = 0;
    
    function traverse(node: any) {
        if (node.type === 'file') {
            size += (node.content || '').length;
        } else if (node.type === 'folder' && node.children) {
            for (const child of Object.values(node.children)) {
                traverse(child);
            }
        }
    }
    
    for (const item of Object.values(structure)) {
        traverse(item);
    }
    
    return size;
}

// Contar archivos
export function countFiles(structure: WorkspaceStructure): number {
    let count = 0;
    
    function traverse(node: any) {
        if (node.type === 'file') {
            count++;
        } else if (node.type === 'folder' && node.children) {
            for (const child of Object.values(node.children)) {
                traverse(child);
            }
        }
    }
    
    for (const item of Object.values(structure)) {
        traverse(item);
    }
    
    return count;
}

// Metadatos de todos los workspaces guardados en disco (los que están en
// memoria tienen prioridad porque llevan los usuarios conectados).
export async function listAllWorkspaces(): Promise<Array<{
    id: string; size: number; files: number; users: number;
    created: number; lastAccess: number; hasPassword: boolean;
}>> {
    const result = new Map<string, any>();
    let files: string[] = [];
    try {
        files = await fs.readdir(DATA_DIR);
    } catch {
        files = [];
    }

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = file.replace(/\.json$/, '');
        if (!isValidWorkspaceId(id) || workspaces.has(id)) continue;
        try {
            const data: WorkspaceData = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8'));
            if (!data || typeof data.structure !== 'object') continue;
            result.set(id, {
                id,
                size: calculateWorkspaceSize(data.structure),
                files: countFiles(data.structure),
                users: 0,
                created: data.created,
                lastAccess: data.lastAccess,
                hasPassword: !!data.password
            });
        } catch {
            // fichero corrupto: se ignora
        }
    }

    for (const [id, ws] of workspaces.entries()) {
        result.set(id, {
            id,
            size: calculateWorkspaceSize(ws.structure),
            files: countFiles(ws.structure),
            users: ws.users || 0,
            created: ws.created,
            lastAccess: ws.lastAccess || Date.now(),
            hasPassword: !!ws.password
        });
    }

    return Array.from(result.values()).sort((a, b) => (b.lastAccess || 0) - (a.lastAccess || 0));
}
