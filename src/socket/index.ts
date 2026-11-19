import { Server as SocketIOServer, Socket } from 'socket.io';
import bcrypt from 'bcrypt';
import { workspaces, saveWorkspace, scheduleSave, getFileByPath, initWorkspace, onlineUserSockets } from '../services/workspace.service';
import { chatService } from '../services/chat.service';
import * as logService from '../services/log.service';
import * as userService from '../services/user.service';
import { isValidItemName, isValidItemPath, isValidWorkspaceId } from '../utils/validation';
import { config } from '../config';

const MAX_CHAT_LENGTH = 2000;
const MAX_USERNAME_LENGTH = 40;

function clientIP(socket: Socket): string {
    if (config.trustProxy) {
        const fwd = socket.handshake.headers['x-forwarded-for'];
        const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
        if (first) return first;
    }
    return socket.handshake.address;
}

// Estructura que se envía a los clientes: sin hashes y sin el contenido de los archivos protegidos
function publicStructure(node: any): any {
    const out: any = {};
    for (const [name, item] of Object.entries<any>(node || {})) {
        if (item?.type === 'folder') {
            out[name] = { type: 'folder', children: publicStructure(item.children) };
        } else if (item?.type === 'file') {
            out[name] = item.passwordHash
                ? { type: 'file', hasPassword: true }
                : { type: 'file', content: item.content || '' };
        }
    }
    return out;
}

function cleanName(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, MAX_USERNAME_LENGTH) : '';
}

export function setupSocketHandlers(io: SocketIOServer, sessionMiddleware: any): void {
    // Usar sesión en WebSocket
    io.use((socket: any, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    io.on('connection', (socket: Socket) => {
        let currentWorkspace: string | null = null;
        
        // Obtener ID de sesión único del usuario
        const sessionId = (socket.request as any).session.id;

        // Rastrear usuario online
        const connectedUserId: string | undefined = (socket.request as any).session?.userId;
        if (connectedUserId) {
            if (!onlineUserSockets.has(connectedUserId)) {
                onlineUserSockets.set(connectedUserId, new Set());
            }
            onlineUserSockets.get(connectedUserId)!.add(socket.id);
        }
        const userIP = clientIP(socket);
        const session = (socket.request as any).session;
        const isPrivileged = () => session?.isAdmin === true || session?.isModerator === true;

        // Solo se puede actuar sobre el workspace al que se ha entrado
        // (join-workspace comprueba IP bloqueada y contraseña).
        const joined = (workspaceId: unknown): workspaceId is string =>
            typeof workspaceId === 'string' && currentWorkspace === workspaceId && socket.rooms.has(workspaceId);

        // Archivos con contraseña que este socket ha desbloqueado
        const unlockedFiles = new Set<string>();
        socket.data.unlockedFiles = unlockedFiles;

        const isOwner = (workspaceId: string) => {
            const ws = workspaces.get(workspaceId);
            return !!(ws?.ownerId && session?.userId && ws.ownerId === session.userId);
        };

        // Recuerda en la sesión los workspaces desbloqueados (para exportar ZIP y leer el chat por HTTP)
        const rememberUnlocked = (workspaceId: string) => {
            if (!session) return;
            const list: string[] = Array.isArray(session.unlockedWorkspaces) ? session.unlockedWorkspaces : [];
            if (!list.includes(workspaceId)) {
                list.push(workspaceId);
                session.unlockedWorkspaces = list.slice(-100);
                session.save?.(() => {});
            }
        };
        const userAgent = socket.handshake.headers['user-agent'];

        // Unirse a un workspace
        socket.on('join-workspace', async ({ workspaceId, password } = {} as any) => {
            if (!isValidWorkspaceId(workspaceId)) {
                socket.emit('workspace-error', { error: 'invalid_workspace' });
                return;
            }
            if (currentWorkspace && currentWorkspace !== workspaceId) {
                socket.leave(currentWorkspace);
            }
            currentWorkspace = workspaceId;

            // Verificar si la IP está bloqueada
            const isBlocked = await logService.isIPBlocked(userIP);
            if (isBlocked) {
                socket.emit('workspace-error', { error: 'blocked' });
                await logService.logAccess({
                    ip: userIP,
                    workspaceId,
                    userId: session?.userId || socket.id,
                    sessionId,
                    action: 'join',
                    userAgent
                });
                return;
            }

            // Los admins y moderadores pasan sin contraseña
            const workspace = await initWorkspace(workspaceId, password, isPrivileged());
            
            // Verificar si hay error de contraseña
            if ('error' in workspace) {
                // Registrar intento fallido de contraseña
                if (workspace.error === 'invalid_password') {
                    await logService.logAccess({
                        ip: userIP,
                        workspaceId,
                        userId: session?.userId || socket.id,
                        sessionId,
                        action: 'password_attempt',
                        userAgent
                    });
                }
                socket.emit('workspace-error', { error: workspace.error });
                return;
            }
            
            // Registrar acceso exitoso
            await logService.logAccess({
                ip: userIP,
                workspaceId,
                userId: session?.userId || socket.id,
                sessionId,
                action: 'join',
                userAgent
            });
            
            socket.join(workspaceId);
            rememberUnlocked(workspaceId);

            // Rastrear usuarios únicos por sesión
            if (!workspace.uniqueUsers) {
                workspace.uniqueUsers = new Set();
            }
            
            if (!workspace.sessionSockets) {
                workspace.sessionSockets = new Map();
            }
            
            if (!workspace.sessionSockets.has(sessionId)) {
                workspace.sessionSockets.set(sessionId, new Set());
            }
            workspace.sessionSockets.get(sessionId)!.add(socket.id);
            
            const isNewUser = !workspace.uniqueUsers.has(sessionId);
            if (isNewUser) {
                workspace.uniqueUsers.add(sessionId);
            }
            workspace.users = workspace.uniqueUsers.size;
            
            if (!workspace.connectedUsers) {
                workspace.connectedUsers = new Map();
            }

            socket.emit('load-structure', publicStructure(workspace.structure));

            // Seguimiento de propiedad / participación para usuarios autenticados
            const userSession = (socket.request as any).session;
            if (userSession?.userId) {
                const ws = workspaces.get(workspaceId)!;
                if (!ws.ownerId) {
                    ws.ownerId = userSession.userId;
                    await saveWorkspace(workspaceId, ws);
                    await userService.addOwnedWorkspace(userSession.userId, workspaceId);
                } else if (ws.ownerId !== userSession.userId) {
                    if (!ws.participants) ws.participants = [];
                    if (!ws.participants.includes(userSession.userId)) {
                        ws.participants.push(userSession.userId);
                        await saveWorkspace(workspaceId, ws);
                        await userService.addParticipatedWorkspace(userSession.userId, workspaceId);
                    }
                }
            }

            if (isNewUser) {
                socket.to(workspaceId).emit('user-connected', { userId: socket.id });
            }
            io.to(workspaceId).emit('users-count', workspace.users);
            
            // Enviar información sobre si el workspace tiene contraseña
            socket.emit('workspace-info', { hasPassword: !!workspace.password });
        });

        // Establecer nombre de usuario
        socket.on('set-username', ({ workspaceId, username }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            const workspace = workspaces.get(workspaceId)!;
            if (!workspace.connectedUsers) {
                workspace.connectedUsers = new Map();
            }
            
            // Sin nombre elegido: nombre de invitado para que aparezca en la lista
            username = cleanName(username) || `Invitado-${socket.id.slice(0, 4)}`;
            workspace.connectedUsers.set(socket.id, username);

            // Filtrar usuarios en modo vanish
            const usersList = Array.from(workspace.connectedUsers.entries())
                .filter(([id]) => !workspace.vanishedUsers || !workspace.vanishedUsers.has(id))
                .map(([id, name]) => ({
                    id,
                    username: name
                }));
            
            io.to(workspaceId).emit('users-list', usersList);
            
            socket.to(workspaceId).emit('user-joined', {
                id: socket.id,
                username
            });
        });

        // Cambiar nombre de usuario
        socket.on('username-change', ({ workspaceId, oldUsername, newUsername }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            const workspace = workspaces.get(workspaceId)!;
            if (!workspace.connectedUsers) return;
            
            newUsername = cleanName(newUsername);
            if (!newUsername) return;
            workspace.connectedUsers.set(socket.id, newUsername);
            
            // Actualizar lista de usuarios solo (sin notificar el cambio de nombre) y filtrar vanished
            const usersList = Array.from(workspace.connectedUsers.entries())
                .filter(([id]) => !workspace.vanishedUsers || !workspace.vanishedUsers.has(id))
                .map(([id, name]) => ({
                    id,
                    username: name
                }));
            
            io.to(workspaceId).emit('users-list', usersList);
        });

        // Ping-pong para medir latencia
        socket.on('ping', ({ workspaceId, timestamp }) => {
            socket.emit('pong', { timestamp });
        });

        // Kick user
        socket.on('kick-user', ({ workspaceId, kickedBy, targetUser, message }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            if (!isPrivileged() && !isOwner(workspaceId)) {
                socket.emit('chat-system', { message: 'Solo el propietario del workspace, administradores y moderadores pueden expulsar' });
                return;
            }

            const workspace = workspaces.get(workspaceId)!;
            if (!workspace.connectedUsers) return;
            kickedBy = workspace.connectedUsers.get(socket.id) || 'Moderación';
            message = typeof message === 'string' ? message.slice(0, 200) : '';

            // Buscar el socketId del usuario a expulsar
            let targetSocketId: string | null = null;
            for (const [socketId, username] of workspace.connectedUsers.entries()) {
                if (username === targetUser) {
                    targetSocketId = socketId;
                    break;
                }
            }
            
            if (!targetSocketId) return;
            
            // Notificar al usuario expulsado
            io.to(targetSocketId).emit('kicked', {
                message: `${message}`
            });
            
            // Notificar a todos los demás usuarios
            socket.to(workspaceId).emit('user-kicked', {
                kickedBy,
                targetUser,
                message
            });
            
            // Desconectar al usuario después de 2 segundos
            setTimeout(() => {
                const targetSocket = io.sockets.sockets.get(targetSocketId!);
                if (targetSocket) {
                    targetSocket.disconnect(true);
                }
            }, 2000);
        });

        // Ban user (solo admin/moderador)
        socket.on('ban-user', async ({ workspaceId, bannedBy, targetUser, reason }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            if (!isPrivileged()) {
                socket.emit('chat-system', { message: 'Solo administradores y moderadores pueden banear' });
                return;
            }

            const workspace = workspaces.get(workspaceId)!;
            if (!workspace.connectedUsers) return;
            bannedBy = session?.userEmail || workspace.connectedUsers.get(socket.id) || 'Moderación';
            reason = typeof reason === 'string' && reason.trim() ? reason.slice(0, 200) : 'Sin especificar';

            // Buscar el socketId del usuario a banear
            let targetSocketId: string | null = null;
            for (const [socketId, username] of workspace.connectedUsers.entries()) {
                if (username === targetUser) {
                    targetSocketId = socketId;
                    break;
                }
            }
            
            if (!targetSocketId) return;
            
            // Obtener la IP del usuario
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (!targetSocket) return;
            
            const targetIP = clientIP(targetSocket);
            if (targetIP === userIP) {
                socket.emit('chat-system', { message: 'No puedes banear tu propia IP' });
                return;
            }
            
            // Bloquear la IP
            await logService.blockIP(targetIP, reason, bannedBy);
            
            // Notificar al usuario baneado
            io.to(targetSocketId).emit('kicked', {
                message: `Has sido baneado. Razón: ${reason}`
            });
            
            // Notificar a todos los demás usuarios
            io.to(workspaceId).emit('chat-system', {
                message: `🔨 ${bannedBy} baneó a ${targetUser}. Razón: ${reason}`
            });
            
            // Desconectar al usuario después de 2 segundos
            setTimeout(() => {
                if (targetSocket) {
                    targetSocket.disconnect(true);
                }
            }, 2000);
        });

        // Toggle modo vanish (solo admin/moderador)
        socket.on('toggle-vanish', ({ workspaceId, username }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            // Verificar permisos de admin/moderador
            const session = (socket.request as any).session;
            if (!session?.isAdmin && !session?.isModerator) {
                socket.emit('vanish-error', { message: 'Solo administradores y moderadores pueden usar este comando' });
                return;
            }
            
            const workspace = workspaces.get(workspaceId)!;
            
            // Inicializar el Set de usuarios en vanish si no existe
            if (!workspace.vanishedUsers) {
                workspace.vanishedUsers = new Set<string>();
            }
            
            const isVanished = workspace.vanishedUsers.has(socket.id);
            
            if (isVanished) {
                // Desactivar vanish
                workspace.vanishedUsers.delete(socket.id);
                socket.emit('vanish-toggled', { enabled: false });
            } else {
                // Activar vanish
                workspace.vanishedUsers.add(socket.id);
                socket.emit('vanish-toggled', { enabled: true });
            }
            
            // Emitir lista actualizada de usuarios a todos (excluyendo vanished)
            const usersList = Array.from(workspace.connectedUsers?.entries() || [])
                .filter(([id]) => !workspace.vanishedUsers || !workspace.vanishedUsers.has(id))
                .map(([id, name]) => ({
                    id,
                    username: name
                }));
            
            io.to(workspaceId).emit('users-list', usersList);
        });

        // Desbanear IP (solo admin/moderador)
        socket.on('unban-ip', async ({ workspaceId, unbannedBy, ipAddress }) => {
            if (!joined(workspaceId) || !workspaces.has(workspaceId)) return;
            
            // Verificar permisos de admin/moderador
            const session = (socket.request as any).session;
            if (!session?.isAdmin && !session?.isModerator) {
                socket.emit('unban-error', { message: 'Solo administradores y moderadores pueden desbanear IPs' });
                return;
            }
            
            if (typeof ipAddress !== 'string' || !ipAddress) return;
            unbannedBy = session?.userEmail || 'Moderación';
            try {
                // Desbloquear la IP
                await logService.unblockIP(ipAddress);
                
                // Notificar éxito al usuario que ejecutó el comando
                socket.emit('unban-success', { 
                    message: `IP ${ipAddress} desbaneada correctamente`,
                    ipAddress,
                    unbannedBy
                });
                
                // Notificar a todos en el workspace
                io.to(workspaceId).emit('chat-system', {
                    message: `🔓 ${unbannedBy} desbaneó la IP: ${ipAddress}`
                });
                
                console.log(`🔓 IP desbaneada: ${ipAddress} por ${unbannedBy}`);
            } catch (error) {
                console.error('Error al desbanear IP:', error);
                socket.emit('unban-error', { message: 'Error al desbanear la IP' });
            }
        });

        // Mensaje de chat
        socket.on('chat-message', async ({ workspaceId, username, message, timestamp }) => {
            if (!joined(workspaceId)) return;
            if (typeof message !== 'string' || !message.trim()) return;
            message = message.slice(0, MAX_CHAT_LENGTH);
            username = workspaces.get(workspaceId)?.connectedUsers?.get(socket.id) || cleanName(username) || 'Anónimo';
            const data = { username, message, timestamp: Date.now() };
            
            // Guardar en base de datos si está disponible
            await chatService.saveMessage(workspaceId, username, message, socket.id);
            
            // Enviar a todos los demás usuarios
            socket.to(workspaceId).emit('chat-message', data);
            
            // Confirmar al emisor
            socket.emit('chat-message-own', data);
        });

        // Indicador de escritura
        socket.on('typing', ({ workspaceId, username, isTyping }) => {
            if (!joined(workspaceId)) return;
            username = workspaces.get(workspaceId)?.connectedUsers?.get(socket.id) || cleanName(username);
            isTyping = !!isTyping;
            socket.to(workspaceId).emit('typing', { username, isTyping });
        });

        // Obtener historial de chat al unirse
        socket.on('get-chat-history', async ({ workspaceId }) => {
            if (!joined(workspaceId)) return;
            const messages = await chatService.getWorkspaceMessages(workspaceId);
            socket.emit('chat-history', messages);
        });

        // Abrir archivo
        socket.on('open-file', ({ workspaceId, path }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            const file = getFileByPath(workspace.structure, path);
            if (file && file.type === 'file') {
                if (file.passwordHash) {
                    socket.emit('file-password-required', { path });
                } else {
                    socket.emit('load-file', {
                        path: path,
                        content: file.content || ''
                    });
                }
            }
        });

        // Establecer contraseña en archivo
        socket.on('set-file-password', async ({ workspaceId, path, password }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            const file = getFileByPath(workspace.structure, path);
            if (file && file.type === 'file') {
                if (file.passwordHash) {
                    socket.emit('file-password-set', { 
                        path, 
                        success: false, 
                        error: 'Este archivo ya tiene una contraseña establecida' 
                    });
                    return;
                }

                if (typeof password !== 'string' || password.length < 4) {
                    socket.emit('file-password-set', { path, success: false, error: 'La contraseña debe tener al menos 4 caracteres' });
                    return;
                }
                const hash = await bcrypt.hash(password, 10);
                file.passwordHash = hash;
                unlockedFiles.add(path);
                file.hasPassword = true;

                await saveWorkspace(workspaceId, workspace);
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                
                socket.emit('file-password-set', { path, success: true });
            }
        });

        // Quitar contraseña de archivo
        socket.on('remove-file-password', async ({ workspaceId, path, password }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            const file = getFileByPath(workspace.structure, path);
            if (file && file.type === 'file') {
                if (!file.passwordHash) {
                    socket.emit('file-password-removed', { 
                        path, 
                        success: false, 
                        error: 'Este archivo no tiene contraseña' 
                    });
                    return;
                }

                const match = typeof password === 'string' && await bcrypt.compare(password, file.passwordHash);
                if (!match) {
                    socket.emit('file-password-removed', { 
                        path, 
                        success: false, 
                        error: 'Contraseña incorrecta' 
                    });
                    return;
                }

                delete file.passwordHash;
                delete file.hasPassword;

                await saveWorkspace(workspaceId, workspace);
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                
                socket.emit('file-password-removed', { path, success: true });
            }
        });

        // Desbloquear archivo con contraseña
        socket.on('unlock-file', async ({ workspaceId, path, password }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            const file = getFileByPath(workspace.structure, path);
            if (file && file.type === 'file') {
                if (!file.passwordHash) {
                    socket.emit('file-unlocked', { 
                        path, 
                        content: file.content || '',
                        success: true 
                    });
                    return;
                }

                const match = typeof password === 'string' && await bcrypt.compare(password, file.passwordHash);
                if (!match) {
                    socket.emit('file-unlocked', { 
                        path, 
                        success: false, 
                        error: 'Contraseña incorrecta' 
                    });
                    return;
                }

                unlockedFiles.add(path);
                socket.emit('file-unlocked', {
                    path,
                    content: file.content || '',
                    success: true
                });
            }
        });

        // Establecer contraseña del workspace
        socket.on('set-workspace-password', async ({ workspaceId, password }) => {
            const workspace = joined(workspaceId) ? workspaces.get(workspaceId) : undefined;
            if (!workspace) {
                socket.emit('workspace-password-error', { message: 'Workspace no encontrado' });
                return;
            }

            if (workspace.ownerId && !isOwner(workspaceId) && !isPrivileged()) {
                socket.emit('workspace-password-error', { message: 'Solo el propietario del workspace puede ponerle contraseña' });
                return;
            }

            if (workspace.password) {
                socket.emit('workspace-password-error', { message: 'El workspace ya tiene contraseña. Quítala primero.' });
                return;
            }

            if (typeof password !== 'string' || password.length < 4) {
                socket.emit('workspace-password-error', { message: 'La contraseña debe tener al menos 4 caracteres' });
                return;
            }

            try {
                const hashedPassword = await bcrypt.hash(password, 10);
                workspace.password = hashedPassword;
                await saveWorkspace(workspaceId, workspace);
                
                socket.emit('workspace-password-set');
                io.to(workspaceId).emit('workspace-info', { hasPassword: true });
                
                console.log(`🔒 Contraseña establecida: ${workspaceId}`);
            } catch (error) {
                socket.emit('workspace-password-error', { message: 'Error al establecer contraseña' });
            }
        });

        // Quitar contraseña del workspace
        socket.on('remove-workspace-password', async ({ workspaceId, password }) => {
            const workspace = joined(workspaceId) ? workspaces.get(workspaceId) : undefined;
            if (!workspace) {
                socket.emit('workspace-password-error', { message: 'Workspace no encontrado' });
                return;
            }

            if (!workspace.password) {
                socket.emit('workspace-password-error', { message: 'El workspace no tiene contraseña' });
                return;
            }

            try {
                const match = typeof password === 'string' && await bcrypt.compare(password, workspace.password);
                if (!match) {
                    socket.emit('workspace-password-error', { message: 'Contraseña incorrecta' });
                    return;
                }

                delete workspace.password;
                await saveWorkspace(workspaceId, workspace);
                
                socket.emit('workspace-password-removed');
                io.to(workspaceId).emit('workspace-info', { hasPassword: false });
                
                console.log(`🔓 Contraseña eliminada: ${workspaceId}`);
            } catch (error) {
                socket.emit('workspace-password-error', { message: 'Error al quitar contraseña' });
            }
        });

        // Cambiar contraseña del workspace
        socket.on('change-workspace-password', async ({ workspaceId, currentPassword, newPassword }) => {
            const workspace = joined(workspaceId) ? workspaces.get(workspaceId) : undefined;
            if (!workspace) {
                socket.emit('workspace-password-error', { message: 'Workspace no encontrado' });
                return;
            }

            if (!workspace.password) {
                socket.emit('workspace-password-error', { message: 'El workspace no tiene contraseña establecida' });
                return;
            }

            if (!currentPassword || !newPassword) {
                socket.emit('workspace-password-error', { message: 'Debes proporcionar la contraseña actual y la nueva' });
                return;
            }

            if (typeof newPassword !== 'string' || newPassword.length < 4) {
                socket.emit('workspace-password-error', { message: 'La nueva contraseña debe tener al menos 4 caracteres' });
                return;
            }

            try {
                // Verificar contraseña actual
                const match = typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, workspace.password);
                if (!match) {
                    socket.emit('workspace-password-error', { message: 'La contraseña actual es incorrecta' });
                    return;
                }

                // Establecer nueva contraseña
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                workspace.password = hashedPassword;
                await saveWorkspace(workspaceId, workspace);
                
                socket.emit('workspace-password-changed');
                io.to(workspaceId).emit('workspace-info', { hasPassword: true });
                
                console.log(`🔑 Contraseña cambiada: ${workspaceId}`);
            } catch (error) {
                console.error('Error al cambiar contraseña:', error);
                socket.emit('workspace-password-error', { message: 'Error al cambiar contraseña' });
            }
        });


        // Crear archivo
        socket.on('create-file', async ({ workspaceId, name, parentPath }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;
            if (!isValidItemName(name) || (parentPath && !isValidItemPath(parentPath))) return;

            const parent = parentPath ? getFileByPath(workspace.structure, parentPath) : workspace.structure;
            // getFileByPath devuelve los hijos de una carpeta; un archivo no tiene .type 'file' aquí
            if (!parent || parent.type === 'file') return;

            if (!Object.prototype.hasOwnProperty.call(parent, name)) {
                parent[name] = { type: 'file', content: '' };
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                await saveWorkspace(workspaceId, workspace);
                
                // Log de creación de archivo
                await logService.logAccess({
                    ip: userIP,
                    workspaceId,
                    userId: session?.userId || socket.id,
                    sessionId,
                    action: 'create_file',
                    userAgent
                });
            }
        });

        // Crear carpeta
        socket.on('create-folder', async ({ workspaceId, name, parentPath }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;
            if (!isValidItemName(name) || (parentPath && !isValidItemPath(parentPath))) return;

            const parent = parentPath ? getFileByPath(workspace.structure, parentPath) : workspace.structure;
            // getFileByPath devuelve los hijos de una carpeta; un archivo no tiene .type 'file' aquí
            if (!parent || parent.type === 'file') return;

            if (!Object.prototype.hasOwnProperty.call(parent, name)) {
                parent[name] = { type: 'folder', children: {} };
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                await saveWorkspace(workspaceId, workspace);
            }
        });

        // Eliminar archivo o carpeta
        socket.on('delete-item', async ({ workspaceId, path }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            if (!isValidItemPath(path)) return;
            const parts = path.split('/');
            const itemName = parts.pop()!;
            const parentPath = parts.join('/');
            
            const parent = parentPath ? getFileByPath(workspace.structure, parentPath) : workspace.structure;
            
            // Log de eliminación
            await logService.logAccess({
                ip: userIP,
                workspaceId,
                userId: session?.userId || socket.id,
                sessionId,
                action: 'delete_file',
                userAgent
            });
            
            if (parent && Object.prototype.hasOwnProperty.call(parent, itemName)) {
                if (parent[itemName]?.passwordHash && !unlockedFiles.has(path) && !isPrivileged()) {
                    socket.emit('chat-system', { message: 'Desbloquea el archivo antes de eliminarlo' });
                    return;
                }
                delete parent[itemName];
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                io.to(workspaceId).emit('item-deleted', { path });
                await saveWorkspace(workspaceId, workspace);
            }
        });

        // Renombrar archivo o carpeta
        socket.on('rename-item', async ({ workspaceId, path, newName }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            if (!isValidItemPath(path) || !isValidItemName(newName)) return;
            const parts = path.split('/');
            const oldName = parts.pop()!;
            const parentPath = parts.join('/');
            const parent = parentPath ? getFileByPath(workspace.structure, parentPath) : workspace.structure;
            
            const has = (k: string) => !!parent && Object.prototype.hasOwnProperty.call(parent, k);
            if (has(oldName) && !has(newName)) {
                parent[newName] = parent[oldName];
                delete parent[oldName];
                io.to(workspaceId).emit('structure-updated', publicStructure(workspace.structure));
                await saveWorkspace(workspaceId, workspace);
            }
        });

        // Recibir cambios de texto
        socket.on('send-changes', async ({ workspaceId, path, content, change }) => {
            if (!joined(workspaceId)) return;
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return;

            if (typeof content !== 'string') return;
            const file = getFileByPath(workspace.structure, path);
            if (file && file.type === 'file') {
                if (file.passwordHash && !unlockedFiles.has(path)) return;
                file.content = content;
                const payload = { path, content, change };
                if (file.passwordHash) {
                    // Archivo protegido: solo a quien lo tenga desbloqueado
                    for (const id of io.sockets.adapter.rooms.get(workspaceId) || []) {
                        const other = io.sockets.sockets.get(id);
                        if (id !== socket.id && other?.data?.unlockedFiles?.has(path)) {
                            other.emit('receive-changes', payload);
                        }
                    }
                } else {
                    socket.to(workspaceId).emit('receive-changes', payload);
                }
                scheduleSave(workspaceId);
            }
        });

        // Desconexión
        socket.on('disconnect', async () => {
            // Limpiar registro de usuario online
            if (connectedUserId) {
                const sockets = onlineUserSockets.get(connectedUserId);
                if (sockets) {
                    sockets.delete(socket.id);
                    if (sockets.size === 0) onlineUserSockets.delete(connectedUserId);
                }
            }

            // Registrar desconexión
            if (currentWorkspace) {
                await logService.logAccess({
                    ip: userIP,
                    workspaceId: currentWorkspace,
                    userId: session?.userId || socket.id,
                    sessionId,
                    action: 'disconnect',
                    userAgent
                });
            }
            
            if (currentWorkspace && workspaces.has(currentWorkspace)) {
                const workspace = workspaces.get(currentWorkspace)!;
                
                if (workspace.sessionSockets && workspace.sessionSockets.has(sessionId)) {
                    workspace.sessionSockets.get(sessionId)!.delete(socket.id);
                    
                    if (workspace.sessionSockets.get(sessionId)!.size === 0) {
                        workspace.sessionSockets.delete(sessionId);
                        workspace.uniqueUsers.delete(sessionId);
                        workspace.users = workspace.uniqueUsers.size;
                        
                        io.to(currentWorkspace).emit('users-count', workspace.users);
                    }
                }
                
                if (workspace.connectedUsers) {
                    const username = workspace.connectedUsers.get(socket.id);
                    workspace.connectedUsers.delete(socket.id);
                    
                    // Limpiar de vanished users si estaba ahí
                    if (workspace.vanishedUsers) {
                        workspace.vanishedUsers.delete(socket.id);
                    }
                    
                    socket.to(currentWorkspace).emit('user-left', {
                        id: socket.id,
                        username
                    });
                    
                    const usersList = Array.from(workspace.connectedUsers.entries())
                        .filter(([id]) => !workspace.vanishedUsers || !workspace.vanishedUsers.has(id))
                        .map(([id, name]) => ({
                            id,
                            username: name
                        }));
                    
                    io.to(currentWorkspace).emit('users-list', usersList);
                }
            }
        });

        // Tickets en tiempo real
        socket.on('ticket-updated', ({ workspaceId, ticketId }) => {
            if (!joined(workspaceId)) return;
            socket.to(workspaceId).emit('ticket-refresh', { ticketId });
        });
    });
}
