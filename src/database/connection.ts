import mongoose from 'mongoose';
import { config } from '../config';

// Deshabilitar buffering de Mongoose para evitar timeouts cuando no hay conexión
mongoose.set('bufferCommands', false);

export async function connectDatabase(): Promise<void> {
    try {
        if (!config.mongoUri) {
            console.warn('⚠️  MongoDB URI no configurada. El chat no se persistirá.');
            console.warn('   Configura MONGO_URI en el archivo .env para habilitar persistencia.');
            return;
        }

        // En Docker, MongoDB puede tardar unos segundos en aceptar conexiones
        const attempts = 15;
        for (let i = 1; ; i++) {
            try {
                await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
                break;
            } catch (err) {
                if (i >= attempts) throw err;
                console.warn(`   MongoDB aún no responde (intento ${i}/${attempts}), reintentando…`);
                await new Promise((r) => setTimeout(r, 2000));
            }
        }

        console.log('✅ Conectado a MongoDB');
        console.log(`   Base de datos: ${mongoose.connection.name}`);
        
        // Eventos de conexión
        mongoose.connection.on('error', (error) => {
            console.error('❌ Error de MongoDB:', error);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB desconectado');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('✅ MongoDB reconectado');
        });

    } catch (error) {
        console.error('❌ Error al conectar a MongoDB:', (error as Error).message);
        if (config.isProduction) {
            // En producción la base de datos es obligatoria: Docker reinicia el contenedor
            process.exit(1);
        }
        console.warn('   El servidor continuará en modo archivos.');
    }
}

export async function disconnectDatabase(): Promise<void> {
    try {
        await mongoose.disconnect();
        console.log('MongoDB desconectado');
    } catch (error) {
        console.error('Error al desconectar MongoDB:', error);
    }
}

export function isDatabaseConnected(): boolean {
    return mongoose.connection.readyState === 1;
}
