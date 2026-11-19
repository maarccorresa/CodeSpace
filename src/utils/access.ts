import { Request } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { workspaces } from '../services/workspace.service';
import { isValidWorkspaceId } from './validation';

export function isPrivilegedSession(req: Request): boolean {
    return Boolean(req.session && (req.session.isAdmin || req.session.isModerator));
}

// ¿Puede esta sesión leer el contenido del workspace (ZIP, chat)?
// Sí si no tiene contraseña, si es admin/moderador o si ya entró con la contraseña.
export async function canReadWorkspace(req: Request, workspaceId: string): Promise<boolean> {
    if (!isValidWorkspaceId(workspaceId)) return false;
    if (isPrivilegedSession(req)) return true;
    if (req.session?.unlockedWorkspaces?.includes(workspaceId)) return true;

    const live = workspaces.get(workspaceId);
    if (live) return !live.password;

    try {
        const raw = await fs.readFile(path.join(config.dataPath, `${workspaceId}.json`), 'utf-8');
        return !JSON.parse(raw).password;
    } catch {
        return false;
    }
}
