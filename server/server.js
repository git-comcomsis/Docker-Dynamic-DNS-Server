const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises; // Usamos la versión de promesas de fs
const path = require('path');
const { exec } = require('child_process'); // Para ejecutar el script shell

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware para parsear JSON y URL-encoded bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Para manejar query parameters en GET

// Archivo donde se guardarán las IPs
const IP_FILE = process.env.IP_FILE || '/server/ips.json';
// Ruta al script a ejecutar (dentro del contenedor)
const UPDATE_SCRIPT_PATH = "/server/update_script.sh";

// Claves secretas de entorno
const DDNS_SECRET_KEY = process.env.DDNS_SECRET_KEY || 'your_super_secret_key'; // Para clientes personalizados (POST)
const ROUTER_DDNS_USERNAME = process.env.ROUTER_DDNS_USERNAME || 'router_user'; // Para routers (GET)
const ROUTER_DDNS_PASSWORD = process.env.ROUTER_DDNS_PASSWORD || 'router_pass'; // Para routers (GET)

// --- Helper functions ---
async function loadIps() {
    try {
        await fs.access(IP_FILE); // Check if file exists
        const data = await fs.readFile(IP_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') { // File not found
            return {};
        }
        console.error(`Error loading IPs from ${IP_FILE}:`, error);
        return {}; // Return empty on other errors
    }
}

async function saveIps(data) {
    try {
        await fs.mkdir(path.dirname(IP_FILE), { recursive: true });
        await fs.writeFile(IP_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error(`Error saving IPs to ${IP_FILE}:`, error);
    }
}

async function executeUpdateScript(locationName, newIp, oldIp) {
    try {
        await fs.access(UPDATE_SCRIPT_PATH, fs.constants.X_OK); // Check if script exists and is executable
        const command = `${UPDATE_SCRIPT_PATH} "${locationName}" "${newIp}" "${oldIp || ''}"`;
        console.log(`[${new Date().toISOString()}] Executing script for ${locationName}: ${command}`);
        const { stdout, stderr } = await exec(command);
        if (stdout) console.log(`Script output for ${locationName}:\n${stdout}`);
        if (stderr) console.error(`Script error for ${locationName}:\n${stderr}`);
        return { success: true, output: stdout, error: stderr };
    } catch (error) {
        console.error(`Error executing script for ${locationName}:`, error);
        return { success: false, error: error.message };
    }
}

// --- Common IP Update Logic ---
async function processUpdate(locationName, newIp, reporterIp, sourceType, res, responseFormat) {
    const ipsData = await loadIps();
    const currentIpInfo = ipsData[locationName] || {};
    const oldIp = currentIpInfo.ip;

    if (oldIp === newIp) {
        console.log(`[${new Date().toISOString()}] ${locationName} (${sourceType}): IP ${newIp} has not changed. No script execution.`);
        if (responseFormat === 'router') {
            return res.send(`nochg ${newIp}`);
        } else {
            return res.json({ status: "ok", message: "IP has not changed" });
        }
    }

    ipsData[locationName] = {
        ip: newIp,
        last_updated: new Date().toISOString(),
        reported_from_tunnel_ip: reporterIp,
        source: sourceType
    };
    await saveIps(ipsData);
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
    const ipsData = await loadIps();
    res.json({ status: "ok", locations: ipsData });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`IP_FILE: ${IP_FILE}`);
    console.log(`UPDATE_SCRIPT_PATH: ${UPDATE_SCRIPT_PATH}`);
});