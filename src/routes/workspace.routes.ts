import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { initWorkspace } from '../services/workspace.service';
import { config } from '../config';
import { canReadWorkspace } from '../utils/access';
import { isValidWorkspaceId } from '../utils/validation';
import { rateLimit } from '../utils/rateLimit';

const router = Router();
const DATA_DIR = config.dataPath;

// Verificar contraseña de workspace
router.post('/verify', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), async (req: Request, res: Response) => {
    try {
        const { workspaceId, password } = req.body;
        const workspace = await initWorkspace(workspaceId, password);

        if ('error' in workspace) {
            return res.status(401).json({ valid: false, error: workspace.error });
        }

        const unlocked = req.session.unlockedWorkspaces || [];
        if (!unlocked.includes(workspaceId)) req.session.unlockedWorkspaces = [...unlocked, workspaceId].slice(-100);

        res.json({ valid: true });
    } catch (error) {
        console.error('Error verificando workspace:', error);
        res.status(500).json({ valid: false, error: 'Error al verificar workspace' });
    }
});

// Exportar workspace como ZIP
router.get('/export/:workspaceId', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;

    if (!isValidWorkspaceId(workspaceId)) {
        return res.status(404).json({ error: 'Workspace no encontrado' });
    }
    if (!(await canReadWorkspace(req, workspaceId))) {
        return res.status(403).json({ error: 'Este workspace está protegido con contraseña' });
    }

    try {
        const filePath = path.join(DATA_DIR, `${workspaceId}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        const workspace = JSON.parse(data);
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${workspaceId}.zip"`);
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        
        // Función recursiva para agregar archivos al ZIP
        function addFilesToArchive(structure: any, basePath = '') {
            for (const [name, item] of Object.entries(structure)) {
                const itemPath = basePath ? `${basePath}/${name}` : name;
                // @ts-ignore
                if (item.type === 'file') {
                    // @ts-ignore — los archivos protegidos no se incluyen
                    if (item.passwordHash) continue;
                    // @ts-ignore
                    archive.append(item.content || '', { name: itemPath });
                // @ts-ignore
                } else if (item.type === 'folder' && item.children) {
                    // @ts-ignore
                    addFilesToArchive(item.children, itemPath);
                }
            }
        }
        
        addFilesToArchive(workspace.structure);
        await archive.finalize();
        
        console.log(`Workspace exportado: ${workspaceId}`);
    } catch (error) {
        console.error('Error exportando workspace:', error);
        if (res.headersSent) return res.end();
        res.status((error as any)?.code === 'ENOENT' ? 404 : 500).json({ error: 'Error al exportar workspace' });
    }
});

export default router;
