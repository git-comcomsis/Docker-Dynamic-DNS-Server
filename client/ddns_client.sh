#!/bin/bash

# --- Configuración del Cliente ---
SERVER_URL="https://ddns-mid.comsis.online/api_update/nombre_de_esta_ubicacion" # ¡CAMBIA ESTO!
SECRET_KEY="your_super_secret_key" # ¡DEBE COINCIDIR CON LA DEL SERVIDOR (DDNS_SECRET_KEY)!

# Archivo para guardar la IP previamente conocida
LAST_IP_FILE="/tmp/last_public_ip.txt"

# Función para obtener la IP pública
get_public_ip() {
    curl -sS https://ifconfig.me/ip || \
    curl -sS https://api.ipify.org || \
    curl -sS https://checkip.amazonaws.com
}

# --- Lógica del Cliente ---

CURRENT_IP=$(get_public_ip)

if [ -z "$CURRENT_IP" ]; then
    echo "$(date): Error: No se pudo obtener la IP pública. Reintentando..."
    exit 1
fi

LAST_IP=""
if [ -f "$LAST_IP_FILE" ]; then
    LAST_IP=$(cat "$LAST_IP_FILE")
fi

if [ "$CURRENT_IP" == "$LAST_IP" ]; then
    echo "$(date): La IP pública ($CURRENT_IP) no ha cambiado. No se envía actualización."
else
    echo "$(date): La IP pública ha cambiado de '$LAST_IP' a '$CURRENT_IP'. Enviando actualización..."

    # Enviar la IP al servidor DDNS personalizado
    RESPONSE=$(curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-Secret-Key: $SECRET_KEY" \
        -d "{\"ip\": \"$CURRENT_IP\"}" \
        "$SERVER_URL")

    if [ $? -eq 0 ]; then
        echo "$(date): Respuesta del servidor: $RESPONSE"
        # Analizar respuesta JSON para verificar 'status': 'ok'
        if echo "$RESPONSE" | grep -q '"status": "ok"'; then
            echo "$CURRENT_IP" > "$LAST_IP_FILE"
        else
            echo "$(date): Error: Servidor respondió con estado no OK."
        fi
    else
        echo "$(date): Error al enviar actualización al servidor DDNS."
    fi
fi