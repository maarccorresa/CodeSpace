# 🚀 CodeSpace - Editor Colaborativo en Tiempo Real

<div align="center">

![CodeSpace](https://img.shields.io/badge/CodeSpace-Collaborative%20Editor-4ec9b0?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=for-the-badge&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js)
![Socket.io](https://img.shields.io/badge/Socket.io-Real--time-010101?style=for-the-badge&logo=socket.io)
![MongoDB](https://img.shields.io/badge/MongoDB-Docker-47A248?style=for-the-badge&logo=mongodb)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker)

**Editor colaborativo en tiempo real con explorador de archivos, chat persistente y sistema de workspaces**

[Características](#-características) • [Instalación](#-instalación-docker) • [Uso](#-uso) • [Tecnologías](#️-tecnologías)

</div>

---

## ✨ Características

### 🎯 Funcionalidades Principales

- **📁 Explorador de Archivos**: Organiza tu código en carpetas y archivos jerárquicos
- **👥 Edición Colaborativa**: Múltiples usuarios editando en tiempo real con Socket.IO
- **💬 Chat Personalizable**: Chat en vivo con nombre editable y historial guardado
- **🔒 Protección de Archivos y Workspaces**: Protege archivos individuales y workspaces completos con contraseña
- **🎨 Resaltado de Sintaxis**: Soporte para múltiples lenguajes con CodeMirror
- **📦 Exportación ZIP**: Descarga tus proyectos completos
- **🐙 Integración GitHub**: Exporta directamente a repositorios GitHub
- **👀 Usuarios en Línea**: Ve quién está conectado en tiempo real
- **🎫 Sistema de Tickets**: Soporte integrado para reportar problemas o solicitar ayuda
- **👮 Panel de Administración Avanzado**: 
  - Gestión completa de workspaces
  - Sistema de moderadores con roles
  - Visualización de tickets y soporte
  - Estadísticas de accesos y uso
  - Bloqueo de IPs
  - Logs de acceso por hora
- **⚡ Sesiones Únicas**: Sistema de sesiones para identificar usuarios únicos
- **🧹 Limpieza Automática**: Workspaces inactivos se eliminan automáticamente (configurable)
- **🌓 Tema Claro/Oscuro**: Cambia entre temas con persistencia
- **🏢 Diseño corporativo**: Paleta gris pizarra con azul corporativo, sin degradados, tipografía Inter / JetBrains Mono
- **👤 Avatar por defecto**: Silueta genérica de persona para todos los usuarios
- **🙋 Invitados**: Quien entra sin nombre aparece como `Invitado-xxxx` en la lista de conectados

---

## 🚀 Instalación (Docker)

La aplicación y la base de datos (MongoDB) se ejecutan en contenedores. No hace falta instalar Node.js ni MongoDB en el servidor.

### Requisitos

- Linux con **Docker** y el plugin **docker compose** (v2). En Ubuntu/Debian: `curl -fsSL https://get.docker.com | sh`
- 1 GB de RAM libre como mínimo.

### Pasos

```bash
git clone https://github.com/maarccorresa/CodeSpace.git
cd CodeSpace
./codespace install
```

`./codespace install`:
1. Pregunta el email del administrador y el puerto (por defecto `3000`).
2. Crea `.env` con claves aleatorias: secreto de sesión, contraseña de MongoDB y contraseña del administrador.
3. Construye la imagen y arranca dos contenedores: `app` y `mongo`.
4. Espera a que la aplicación responda y muestra la URL y los datos de acceso a `/login`.

MongoDB no publica ningún puerto: solo la aplicación llega a él. Los datos se guardan en volúmenes de Docker (`mongo-data`, `workspaces`, `tickets`), así que sobreviven a reinicios y actualizaciones.

### Órdenes de gestión

| Orden | Qué hace |
|---|---|
| `./codespace install` | Primera instalación |
| `./codespace update` | `git pull` y reconstruye la imagen |
| `./codespace up` / `down` | Arranca / para los contenedores |
| `./codespace restart` | Reinicia la aplicación (aplica cambios de `.env`) |
| `./codespace logs [app\|mongo]` | Registros en directo |
| `./codespace status` | Estado de los contenedores |
| `./codespace backup` | Copia de MongoDB y de los workspaces en `./backups` |
| `./codespace restore <archivo>` | Restaura una copia |

### Configuración (`.env`)

| Variable | Para qué sirve |
|---|---|
| `APP_PORT` | Puerto publicado en el equipo (por defecto `3000`) |
| `APP_BIND` | `0.0.0.0` (todas las interfaces) o `127.0.0.1` si hay un proxy delante |
| `SESSION_SECRET` | Secreto de las cookies de sesión (32 caracteres o más) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Administrador principal (contraseña de 8 caracteres o más) |
| `MONGO_USER` / `MONGO_PASSWORD` / `MONGO_DB` | Credenciales de MongoDB en Docker |
| `COOKIE_SECURE` | `true` si se sirve por HTTPS |
| `TRUST_PROXY` | `true` si hay un proxy (nginx, Traefik…) que envía `X-Forwarded-For` |
| `WORKSPACE_EXPIRY_DAYS` | Días sin uso tras los que se borra un workspace (por defecto 30) |

En producción la aplicación **no arranca** con el secreto o la contraseña de ejemplo.

### HTTPS

La aplicación sirve HTTP en el puerto 3000. Para HTTPS, pon delante un proxy (nginx, Caddy, Traefik) con `APP_BIND=127.0.0.1`, `TRUST_PROXY=true` y `COOKIE_SECURE=true`. El proxy debe reenviar WebSocket (`Upgrade`/`Connection`) para Socket.IO.

### Desarrollo sin Docker

```bash
npm install
cp .env.example .env     # y ajusta MONGO_URI si tienes un MongoDB local
npm run dev
```

Sin `MONGO_URI`, la aplicación funciona en modo archivos (JSON en `workspaces-data/`). Este modo solo se acepta fuera de producción.

---

## 📖 Uso

### 1️⃣ Crear un Workspace

1. Ve a `http://localhost:3000`
2. Escribe un nombre para tu workspace (ej: `mi-proyecto`)
3. Haz clic en "Abrir Workspace"
4. O accede directamente desde la URL: `http://localhost:3000/mi-proyecto`

### 2️⃣ Gestión de Archivos

- **Crear carpeta**: Click derecho en el explorador → Nueva carpeta
- **Crear archivo**: Click derecho → Nuevo archivo
- **Proteger archivo**: Click derecho en archivo → Establecer contraseña
- **Renombrar**: Click derecho → Renombrar
- **Eliminar**: Click derecho → Eliminar
- **Abrir archivo**: Click en el nombre del archivo

### 3️⃣ Colaboración en Tiempo Real

- **Compartir**: Copia la URL y compártela (ej: `localhost:3000/mi-proyecto`)
- **Proteger workspace**: Establece contraseña desde el menú superior (icono de candado)
- **Chat personalizable**: 
  - Establece tu nombre de usuario
  - El título del chat se actualiza con tu nombre: "Chat - [tu nombre]"
  - Puedes cambiar el nombre del chat haciendo clic en el icono de lápiz
  - Los nombres se guardan automáticamente
- **Historial**: Los mensajes se guardan automáticamente
- **Usuarios online**: Ve quiénes están conectados en tiempo real
- **Tickets**: Reporta problemas usando el sistema de tickets integrado

### 4️⃣ Sistema de Tickets

1. Click en el icono de tickets (🎫)
2. Rellena el formulario con:
   - Título del problema
   - Descripción detallada
   - Prioridad (baja, media, alta)
3. Los tickets se envían al panel de administración
4. Los administradores y moderadores pueden responder y gestionar tickets

### 5️⃣ Exportación

**Descargar como ZIP:**
- Click en el botón de descarga
- Se descargará un archivo `workspace-[nombre].zip`

**Exportar a GitHub:**
1. Click en el icono de GitHub
2. Introduce:
   - URL del repositorio (ej: `c0rresita/mi-repo`)
   - Token de acceso personal ([crear token](https://github.com/settings/tokens))
   - Mensaje del commit
3. Click en "Exportar"

### 6️⃣ Panel de Administración

Accede a `http://<servidor>:3000/login` con `ADMIN_EMAIL` y `ADMIN_PASSWORD` del archivo `.env` (`./codespace install` los muestra al terminar).

**Funcionalidades del Administrador:**
- **Workspaces**: Ver, editar contraseñas, eliminar workspaces
- **Usuarios Activos**: Monitoreo en tiempo real de usuarios conectados
- **Logs**: 
  - Estadísticas por hora
  - Top workspaces más visitados
  - Bloqueo de IPs sospechosas
- **Tickets**: Ver y gestionar tickets de soporte
- **Moderadores**: Crear y gestionar cuentas de moderadores (solo admin principal)

**Sistema de Moderadores:**
- Los moderadores pueden acceder al panel de administración
- Pueden gestionar tickets y ver estadísticas
- No pueden crear otros moderadores (solo el admin principal)
- Inicio de sesión con email y contraseña cifrada
- Seguimiento de último acceso y estado activo/inactivo

---

## 🛠️ Tecnologías

### Backend
- **TypeScript** - Tipado estático
- **Node.js** (v18+) - Entorno de ejecución
- **Express** - Framework web
- **Socket.io** - WebSockets en tiempo real
- **Mongoose** - ODM para MongoDB (opcional)
- **bcrypt** - Cifrado de contraseñas
- **express-session** - Manejo de sesiones
- **dotenv** - Variables de entorno

### Frontend
- **Vanilla JavaScript** - Sin frameworks pesados
- **CodeMirror 5** - Editor de código profesional
- **Feather Icons** - Iconografía
- **Tema común** (`public/css/theme.css`) - Paleta corporativa (gris pizarra y azul `#2563eb`), tipografía Inter / JetBrains Mono y tema claro en el editor

### Persistencia
- **Archivos JSON** - Sistema de archivos para workspaces
- **MongoDB** (opcional) - Base de datos para chat persistente
- **Dual Storage** - Chat en archivos JSON si no hay MongoDB
- **Limpieza automática** - TTL de 30 días en MongoDB

### Arquitectura
- **Modular TypeScript** - Código organizado en módulos
- **Socket.IO Rooms** - Salas por workspace
- **Sesiones únicas** - Un usuario = múltiples pestañas/sockets
- **Compilación** - TypeScript → JavaScript (dist/)

---

## 📁 Estructura del Proyecto

```
CodeSpace/
├── codespace                # Script de gestión (install, update, backup…)
├── Dockerfile               # Imagen de la aplicación (Node 20, usuario sin privilegios)
├── compose.yaml             # Servicios: app + mongo
├── .env.example             # Plantilla de configuración
├── src/                     # Código fuente TypeScript
│   ├── config/              # Configuración y comprobaciones de arranque
│   ├── database/            # Conexión a MongoDB (con reintentos)
│   ├── middleware/          # Permisos de administración
│   ├── models/              # Modelos Mongoose
│   ├── routes/              # API REST
│   ├── services/            # Lógica de negocio
│   ├── socket/              # Eventos en tiempo real (Socket.IO)
│   ├── utils/               # Validación, control de acceso y límite de intentos
│   └── server.ts            # Punto de entrada
└── public/                  # Frontend
    ├── index.html           # Portada
    ├── workspace.html       # Editor
    ├── dashboard.html       # Área de usuario
    ├── signin.html          # Acceso y registro de usuarios
    ├── login.html           # Acceso de administración
    ├── admin.html           # Panel de administración
    ├── css/theme.css        # Tema común de todas las pantallas
    ├── img/                 # Logo y avatar por defecto
    └── js/workspace.js      # Lógica del editor
```

Datos en Docker (volúmenes): `mongo-data` (MongoDB), `workspaces` (`/app/workspaces-data`, un JSON por workspace) y `tickets` (`/app/tickets-data`).

---

## 🔐 Seguridad

- Contraseñas con **bcrypt** (workspaces, archivos, usuarios y moderadores).
- **Sesiones en MongoDB**, cookie `httpOnly` y `SameSite=Lax`; la sesión se renueva al identificarse.
- **Límite de intentos** en los inicios de sesión y en la verificación de contraseñas de workspace (respuesta `429`).
- **Validación del nombre del workspace** (`A-Z a-z 0-9 - _`, máx. 64): no se pueden usar rutas (`../`) ni nombres internos (`users`, `moderators`…).
- **Nombres de archivo validados**: se rechazan `__proto__`, `constructor`, `/` y similares.
- **Eventos en tiempo real autorizados**: solo actúa sobre un workspace quien ha entrado en él (con su contraseña, si la tiene).
- **Archivos protegidos**: su contenido y su hash no se envían a nadie que no los haya desbloqueado, ni se incluyen en el ZIP.
- **Expulsar** solo lo pueden hacer el propietario del workspace, administradores y moderadores; **banear**, solo administradores y moderadores.
- El ZIP y el historial de chat de un workspace protegido solo se sirven a quien lo ha desbloqueado.
- Textos de usuarios (tickets, nombres, archivos, motivos de bloqueo) escapados antes de mostrarse en el panel y en el editor.
- Cabeceras `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`.
- El contenedor de la aplicación se ejecuta sin privilegios (usuario `node`).

---

## 💾 Sistema de Chat

### Persistencia Dual

El chat funciona con dos modos de almacenamiento:

**Con MongoDB:**
- Mensajes guardados en base de datos
- TTL automático de 30 días
- Consultas optimizadas con índices
- Estadísticas en tiempo real

**Sin MongoDB (Fallback):**
- Mensajes guardados en `workspaces-data/[id]/chat.json`
- Límite de 500 mensajes por workspace
- Historial completo recuperable
- Sin dependencias externas

### Características del Chat

- ✅ Mensajes en tiempo real con Socket.IO
- ✅ Historial persistente automático
- ✅ Nombre de chat personalizable y editable
- ✅ Título dinámico basado en el usuario
- ✅ Límite de 500 mensajes (archivos) o 30 días (MongoDB)
- ✅ Recuperación al recargar página
- ✅ Estadísticas de mensajes y usuarios únicos
- ✅ Identificación de usuarios por nombre personalizado

---

## 🧹 Limpieza Automática

Los workspaces inactivos se eliminan automáticamente:

- **Intervalo**: Configurable en `.env` (default: 1 día)
- **Expiración**: 30 días sin actividad (configurable)
- **Limpieza manual**: Disponible en panel de administración
- **Logs**: Información en consola sobre workspaces eliminados

---

## 🚀 Comandos útiles (sin Docker)

```bash
npm run dev      # Desarrollo con ts-node
npm run build    # Compilar TypeScript a dist/
npm start        # Ejecutar dist/server.js
```

Para producción, usa Docker (ver [Instalación](#-instalación-docker)).

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-caracteristica`)
3. Commit tus cambios (`git commit -m 'Agregar nueva característica'`)
4. Push a la rama (`git push origin feature/nueva-caracteristica`)
5. Abre un Pull Request

---

## 📝 Licencia

Este proyecto está bajo la Licencia MIT.

---

## 👨‍💻 Autor

**c0rresita**

- GitHub: [@c0rresita](https://github.com/c0rresita)
- Repositorio: [CodeSpace](https://github.com/maarccorresa/CodeSpace)

<div align="center">

---

**⭐ Si te gusta este proyecto, dale una estrella en GitHub ⭐**


by c0rresita

</div>
