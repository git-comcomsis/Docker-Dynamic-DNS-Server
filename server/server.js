const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('pg'); // Cliente de PostgreSQL
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises; // Usamos la versión de promesas de fs


const app = express();
const PORT = process.env.PORT || 5000;

// Configuración de la base de datos desde variables de entorno
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'ddnsuser';
const DB_PASS = process.env.DB_PASS || 'ddnspass';
const DB_NAME = process.env.DB_NAME || 'ddnsdb';

const dbConfig = {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    port: 5432, // Puerto por defecto de PostgreSQL
    ssl: {
        rejectUnauthorized: false // Puedes cambiar a true en producción si usas SSL con un certificado válido
    }
};

let pgClient;

async function connectDb() {
    if (pgClient && !pgClient._ending) { // Check if client exists and is not ending
        return pgClient;
    }
    pgClient = new Client(dbConfig);
    try {
        await pgClient.connect();
        console.log(`[${new Date().toISOString()}] Connected to PostgreSQL database: ${DB_NAME}`);
        return pgClient;
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error connecting to PostgreSQL:`, err.message);
        throw err;
    }
}

// Ruta al script a ejecutar (dentro del contenedor)
//const UPDATE_SCRIPT_PATH = "/app/update_script.sh";
const UPDATE_SCRIPT_PATH = "/server/update_script.sh";

// Claves secretas de entorno
const DDNS_SECRET_KEY = process.env.DDNS_SECRET_KEY || 'your_super_secret_key'; // Para clientes personalizados (POST)
const ROUTER_DDNS_USERNAME = process.env.ROUTER_DDNS_USERNAME || 'router_user'; // Para routers (GET)
const ROUTER_DDNS_PASSWORD = process.env.ROUTER_DDNS_PASSWORD || 'router_pass'; // Para routers (GET)

// Middleware para parsear JSON y URL-encoded bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- DB Migration / Initialization Functions ---

// Migración inicial para crear la tabla de IPs
async function runMigrations() {
    const client = await connectDb();
    const createTableSql = `
        CREATE TABLE IF NOT EXISTS ip_records (
            id SERIAL PRIMARY KEY,
            location_name VARCHAR(255) UNIQUE NOT NULL,
            ip_address VARCHAR(45) NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            reported_from_tunnel_ip VARCHAR(45),
            source VARCHAR(50)
        );
    `;
    try {
        await client.query(createTableSql);
        console.log(`[${new Date().toISOString()}] Migration successful: ip_records table ensured.`);
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Migration failed:`, err.message);
        throw err;
    } finally {
        client.end(); // Cerrar la conexión después de la migración
    }
}

// Función para inicializar la DB (en este caso es lo mismo que la migración inicial)
async function initDb() {
    console.log(`[${new Date().toISOString()}] Initializing database...`);
    await runMigrations();
    console.log(`[${new Date().toISOString()}] Database initialization complete.`);
}


// --- Helper function to execute shell script ---
async function executeUpdateScript(locationName, newIp, oldIp) {
    try {
        await fs.promises.access(UPDATE_SCRIPT_PATH, fs.constants.X_OK); // Check if script exists and is executable
        const command = `${UPDATE_SCRIPT_PATH} "${locationName}" "${newIp}" "${oldIp || ''}"`;
        console.log(`[${new Date().toISOString()}] Executing script for ${locationName}: ${command}`);
        const { stdout, stderr } = await exec(command);
        if (stdout) console.log(`Script output for ${locationName}:\n${stdout}`);
        if (stderr) console.error(`Script error for ${locationName}:\n${stderr}`);
        return { success: true, output: stdout, error: stderr };
    } catch (error) {
        console.error(`Error executing script for ${locationName}:`, error, command);
        return { success: false, error: error.message };
    }
}

// --- Common IP Update Logic ---
async function processUpdate(locationName, newIp, reporterIp, sourceType, res, responseFormat) {
    const client = await connectDb();
    let oldIp = null;
    let queryResult;

    try {
        // Buscar el registro existente
        queryResult = await client.query('SELECT ip_address FROM ip_records WHERE location_name = $1', [locationName]);
        if (queryResult.rows.length > 0) {
            oldIp = queryResult.rows[0].ip_address;
        }

        if (oldIp === newIp) {
            console.log(`[${new Date().toISOString()}] ${locationName} (${sourceType}): IP ${newIp} has not changed. No script execution.`);
            if (responseFormat === 'router') {
                return res.send(`nochg ${newIp}`);
            } else {
                return res.json({ status: "ok", message: "IP has not changed" });
            }
        }

        // Insertar o actualizar la IP
        const upsertSql = `
            INSERT INTO ip_records (location_name, ip_address, reported_from_tunnel_ip, source)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (location_name) DO UPDATE
            SET ip_address = $2, last_updated = CURRENT_TIMESTAMP, reported_from_tunnel_ip = $3, source = $4;
        `;
        await client.query(upsertSql, [locationName, newIp, reporterIp, sourceType]);

        console.log(`[${new Date().toISOString()}] ${locationName} (${sourceType}): IP updated from ${oldIp || 'N/A'} to ${newIp}`);

        const scriptResult = await executeUpdateScript(locationName, newIp, oldIp);

        if (responseFormat === 'router') {
            if (scriptResult.success) {
                return res.send(`good ${newIp}`);
            } else {
                return res.status(500).send(`911 Error executing script: ${scriptResult.error}`);
            }
        } else {
            if (scriptResult.success) {
                return res.json({ status: "ok", message: "IP updated and script executed", script_output: scriptResult.output });
            } else {
                return res.status(500).json({ status: "ok", message: "IP updated, but script failed", script_error: scriptResult.error });
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Database or script error for ${locationName}:`, error);
        if (responseFormat === 'router') {
            return res.status(500).send(`911 Internal Server Error`);
        } else {
            return res.status(500).json({ status: "error", message: "Internal Server Error", details: error.message });
        }
    } finally {
        //if (client) client.release(); // Liberar el cliente de vuelta al pool
    }
}

// --- Endpoint for Custom Clients (POST with JSON) ---
app.post('/api_update/:location_name', async(req, res) => {
    const locationName = req.params.location_name;
    const newIp = req.body.ip;
    const secretKey = req.headers['x-secret-key'];

    if (!newIp) {
        return res.status(400).json({ status: "error", message: "Missing 'ip' in JSON body" });
    }

    if (secretKey !== DDNS_SECRET_KEY) {
        console.log(`[${new Date().toISOString()}] Unauthorized access for ${locationName} (API POST) from IP: ${req.ip}`);
        return res.status(401).json({ status: "error", message: "Invalid secret key" });
    }

    await processUpdate(locationName, newIp, req.ip, "API_POST", res, 'json');
});

// --- Endpoint for TP-Link Router (GET with Query Params) ---
app.get('/router_update', async(req, res) => {
    const hostname = req.query.hostname;
    let newIp = req.query.myip || req.query.ip || req.query.addr; // Router might send 'ip' or 'addr'
    const username = req.query.username;
    const password = req.query.password;

    if (!hostname || !newIp) {
        console.log(`[${new Date().toISOString()}] Router GET request missing hostname or IP. Query:`, req.query);
        return res.status(400).send("nohost - hostname or myip (ip/addr) missing");
    }

    if (username !== ROUTER_DDNS_USERNAME || password !== ROUTER_DDNS_PASSWORD) {
        console.log(`[${new Date().toISOString()}] Unauthorized access for ${hostname} (Router GET). User: ${username}, Pass: ${password}`);
        return res.status(401).send("badauth");
    }

    const locationName = hostname; // Router's hostname acts as our location name

    await processUpdate(locationName, newIp, req.ip, "ROUTER_GET", res, 'router');
});

// --- Status Endpoint ---
app.get('/status', async(req, res) => {
    let client;
    try {
        client = await connectDb();
        const result = await client.query('SELECT location_name, ip_address, last_updated, reported_from_tunnel_ip, source FROM ip_records ORDER BY location_name');
        res.json({ status: "ok", locations: result.rows });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching status from DB:`, error);
        res.status(500).json({ status: "error", message: "Error fetching status", details: error.message });
    } finally {
        //if (client) client.release();
    }
});

// --- API Endpoint para Migraciones (GET) ---
app.get('/api/migrate', async(req, res) => {
    const secret = req.query.secret; // Se espera una clave secreta para ejecutar migraciones
    const MIGRATION_SECRET = process.env.MIGRATION_SECRET || 'migration_admin_secret'; // Nueva variable de entorno

    if (secret !== MIGRATION_SECRET) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized for migration.' });
    }

    try {
        await runMigrations();
        res.json({ status: 'ok', message: 'Migrations executed successfully.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Migration failed.', details: error.message });
    }
});

// --- API Endpoint para Inicializar DB (GET) ---
app.get('/api/initdb', async(req, res) => {
    const secret = req.query.secret;
    const MIGRATION_SECRET = process.env.MIGRATION_SECRET || 'migration_admin_secret';

    if (secret !== MIGRATION_SECRET) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized for DB initialization.' });
    }

    try {
        await initDb();
        res.json({ status: 'ok', message: 'Database initialized successfully.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Database initialization failed.', details: error.message });
    }
});


// Main application start logic
if (process.argv[2] === 'migrate') {
    // Si se ejecuta con 'node server.js migrate'
    runMigrations().catch(err => {
        console.error("Migration failed:", err);
        process.exit(1);
    });
} else if (process.argv[2] === 'initdb') {
    // Si se ejecuta con 'node server.js initdb'
    initDb().catch(err => {
        console.error("DB initialization failed:", err);
        process.exit(1);
    });
} else {
    // Ejecutar el servidor web por defecto
    app.listen(PORT, async() => {
        console.log(`[${new Date().toISOString()}] Server listening on port ${PORT}`);
        console.log(`[${new Date().toISOString()}] Database connection details: Host=${DB_HOST}, User=${DB_USER}, DB=${DB_NAME}`);
        // Intenta conectar a la DB al iniciar el servidor (opcional, ya se conecta en cada operación)
        try {
            await connectDb();
            // Esto es importante para que el contenedor tenga la tabla lista al iniciar
            await runMigrations(); // Asegura que la tabla exista al iniciar el servidor
        } catch (err) {
            console.error(`[${new Date().toISOString()}] Initial DB connection/migration failed. Server might not function correctly.`, err.message);
        }
    });
}