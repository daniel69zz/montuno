// Carga apps/api/.env si existe (nativo de Node >= 20.12). Debe importarse antes que AppModule.
import { existsSync } from 'fs';
import { resolve } from 'path';

const file = resolve(process.cwd(), '.env');
if (existsSync(file)) process.loadEnvFile(file);
