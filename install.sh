#!/bin/bash

# --- Colores para la salida en terminal ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# --- Función para generar una cadena alfanumérica aleatoria ---
generate_random_string() {
  head /dev/urandom | tr -dc A-Za-z0-9_ | head -c "${1:-32}" ; echo ''
}

echo -e "${GREEN}==========================================="
echo -e " Instalador de Servidor DDNS Personalizado "
echo -e "===========================================${NC}"
echo ""

# --- 1. Verificar y preguntar sobre instancia anterior ---
echo -e "${YELLOW}Paso 1: Verificando instancias Docker existentes...${NC}"
EXISTING_CONTAINER=$(docker ps -a --filter "name=ddns-api-server" --format "{{.ID}}")
EXISTING_IMAGE=$(docker images --filter "reference=my-ddns-server" --format "{{.ID}}")

if [ -n "$EXISTING_CONTAINER" ] || [ -n "$EXISTING_IMAGE" ]; then
    echo -e "${YELLOW}Se ha detectado una instalación anterior del contenedor o imagen 'ddns-api-server'.${NC}"
    read -p "¿Deseas sobrescribir la instalación existente (detener, eliminar contenedor e imagen)? (s/N): " OVERWRITE_CHOICE
    if [[ "$OVERWRITE_CHOICE" =~ ^[Ss]$ ]]; then
        echo -e "${RED}Sobrescribiendo instalación anterior...${NC}"
        if [ -n "$EXISTING_CONTAINER" ]; then
            echo "Deteniendo y eliminando contenedor existente..."
            docker stop ddns-api-server
            docker rm ddns-api-server
        fi
        if [ -n "$EXISTING_IMAGE" ]; then
            echo "Eliminando imagen Docker existente..."
            docker rmi my-ddns-server
        fi
        echo -e "${GREEN}Instancia anterior eliminada.${NC}"
    else
        echo -e "${YELLOW}Se canceló la sobrescritura. Saliendo del instalador.${NC}"
        exit 0
    fi
else
    echo -e "${GREEN}No se detectaron instancias anteriores. Continuando con la instalación limpia.${NC}"
fi

echo ""

# --- 2. Preguntar variables de entorno ---
echo -e "${YELLOW}Paso 2: Configuración de Variables de Entorno:${NC}"
echo "Deja en blanco para generar un valor aleatorio (para claves/contraseñas) o usar el valor por defecto."

# Puerto
read -p "Puerto de escucha del servidor (ej. 5000:5000, dejar vacío para 5000:5000 por defecto): " USER_PORT
PORT="${USER_PORT:-5000:5000}"

# DDNS_SECRET_KEY
read -p "Clave secreta para clientes personalizados (DDNS_SECRET_KEY, dejar vacío para generar): " USER_DDNS_SECRET_KEY
DDNS_SECRET_KEY="${USER_DDNS_SECRET_KEY:-$(generate_random_string 40)}"

# ROUTER_DDNS_USERNAME
read -p "Nombre de usuario para el router (ROUTER_DDNS_USERNAME, dejar vacío para generar): " USER_ROUTER_USERNAME
ROUTER_DDNS_USERNAME="${USER_ROUTER_USERNAME:-$(generate_random_string 10)}"

# ROUTER_DDNS_PASSWORD
read -p "Contraseña para el router (ROUTER_DDNS_PASSWORD, dejar vacío para generar): " USER_ROUTER_PASSWORD
ROUTER_DDNS_PASSWORD="${USER_ROUTER_PASSWORD:-$(generate_random_string 20)}"

# MIGRATION_SECRET (Nueva clave para APIs de DB)
read -p "Clave secreta para APIs de migración/inicialización (MIGRATION_SECRET, dejar vacío para generar): " USER_MIGRATION_SECRET
MIGRATION_SECRET="${USER_MIGRATION_SECRET:-$(generate_random_string 30)}"

echo ""
echo -e "${YELLOW}Configuración de Base de Datos PostgreSQL:${NC}"
read -p "Host de la DB PostgreSQL (DB_HOST, ej. 'localhost' o IP de otro contenedor/servidor): " DB_HOST
DB_HOST="${DB_HOST:-localhost}"

read -p "Usuario de la DB PostgreSQL (DB_USER, ej. 'ddnsuser'): " DB_USER
DB_USER="${DB_USER:-ddnsuser}"

read -p "Contraseña de la DB PostgreSQL (DB_PASS, ej. 'ddnspass'): " DB_PASS
DB_PASS="${DB_PASS:-ddnspass}"

read -p "Nombre de la DB PostgreSQL (DB_NAME, ej. 'ddnsdb'): " DB_NAME
DB_NAME="${DB_NAME:-ddnsdb}"

echo ""

# --- 3. Crear directorio para datos persistentes ---
echo -e "${YELLOW}Paso 3: Creando directorio de datos persistentes...${NC}"
mkdir -p data
echo -e "${GREEN}Directorio './data' creado/verificado.${NC}"

echo ""

# --- 4. Construir la imagen Docker ---
echo -e "${YELLOW}Paso 4: Construyendo la imagen Docker 'my-ddns-server-node'...${NC}"
docker build -t my-ddns-server-node .
if [ $? -ne 0 ]; then
    echo -e "${RED}Error al construir la imagen Docker. Saliendo.${NC}"
    exit 1
fi
echo -e "${GREEN}Imagen Docker construida exitosamente.${NC}"

echo ""

# --- 5. Ejecutar el Contenedor Docker ---
echo -e "${YELLOW}Paso 5: Ejecutando el contenedor Docker 'ddns-api-server'...${NC}"
docker run -d \
  --name ddns-api-server \
  --restart unless-stopped \
  -p "$PORT" \
  -e DDNS_SECRET_KEY="$DDNS_SECRET_KEY" \
  -e ROUTER_DDNS_USERNAME="$ROUTER_DDNS_USERNAME" \
  -e ROUTER_DDNS_PASSWORD="$ROUTER_DDNS_PASSWORD" \
  -e MIGRATION_SECRET="$MIGRATION_SECRET" \
  -e DB_HOST="$DB_HOST" \
  -e DB_USER="$DB_USER" \
  -e DB_PASS="$DB_PASS" \
  -e DB_NAME="$DB_NAME" \
  -v "$(pwd)/data:/data" \
  my-ddns-server-node
if [ $? -ne 0 ]; then
    echo -e "${RED}Error al ejecutar el contenedor Docker. Saliendo.${NC}"
    exit 1
fi
echo -e "${GREEN}Contenedor 'ddns-api-server' ejecutándose en segundo plano.${NC}"

echo ""

# --- 6. Ejecutar migraciones iniciales de la DB ---
echo -e "${YELLOW}Paso 6: Ejecutando migraciones iniciales de la base de datos...${NC}"
echo -e "${YELLOW}Asegúrate de que tu servidor PostgreSQL esté accesible desde el host de Docker.${NC}"
echo -e "${YELLOW}Si el host de DB es 'localhost' y PostgreSQL está en otro contenedor, podrías necesitar 'host.docker.internal' (solo en Docker Desktop) o la IP de la red Docker bridge.${NC}"

# Esperar un poco para que el contenedor se inicie
sleep 5

# Puedes usar el endpoint API o ejecutar directamente desde el contenedor si la DB es local al contenedor
# Opción 1: Usar la API (si el Cloudflare Tunnel ya está activo y puedes acceder a /api/migrate)
# curl -sS "https://ddns.tu-dominio.com/api/migrate?secret=$MIGRATION_SECRET" # Requiere Cloudflare Tunnel configurado

# Opción 2: Ejecutar la migración directamente en el contenedor (más fiable al inicio)
docker exec ddns-api-server npm run db:migrate
if [ $? -ne 0 ]; then
    echo -e "${RED}¡ADVERTENCIA! Falló la migración inicial de la base de datos.${NC}"
    echo -e "${RED}Por favor, verifica la conexión a la base de datos y ejecuta las migraciones manualmente."
    echo -e "${RED}Puedes intentar ejecutar: docker exec ddns-api-server npm run db:migrate${NC}"
else
    echo -e "${GREEN}Migración inicial de la base de datos ejecutada exitosamente.${NC}"
fi

echo ""

# --- Resumen de la Instalación ---
echo -e "${GREEN}==========================================="
echo -e "      ¡Instalación Completada! Resumen     "
echo -e "===========================================${NC}"
echo ""
echo -e "${YELLOW}Configuración del Servidor Docker:${NC}"
echo "  - Nombre del Contenedor: ddns-api-server"
echo "  - Imagen Docker: my-ddns-server-node"
echo "  - Puerto Mapeado: $PORT"
echo "  - Clave DDNS (Clientes Custom): ${DDNS_SECRET_KEY}"
echo "  - Usuario Router (TP-Link): ${ROUTER_DDNS_USERNAME}"
echo "  - Contraseña Router (TP-Link): ${ROUTER_DDNS_PASSWORD}"
echo "  - Clave Migración DB: ${MIGRATION_SECRET}"
echo "  - Host DB: ${DB_HOST}"
echo "  - Usuario DB: ${DB_USER}"
echo "  - Nombre DB: ${DB_NAME}"
echo ""
echo -e "${YELLOW}Próximos Pasos Importantes:${NC}"
echo "1. Asegúrate de que tu base de datos PostgreSQL (${DB_HOST}:${DB_USER}/${DB_NAME}) esté corriendo y sea accesible desde tu Raspberry Pi."
echo "2. Configura tu Cloudflare Tunnel para apuntar a: http://localhost:${PORT##*:}/ (o http://IP_DE_TU_PI:${PORT##*:}/)"
echo "3. En tu router TP-Link, configura 'Custom DDNS' con:"
echo "   - Update URL: https://ddns.tu-dominio.com/router_update"
echo "   - Account Name: ${ROUTER_DDNS_USERNAME}"
echo "   - Password: ${ROUTER_DDNS_PASSWORD}"
echo "   - Domain Name: <Un identificador para esta ubicación, ej. 'casa_router'>"
echo "4. Para clientes personalizados (otras Raspberry Pis), usa el script 'ddns_client.sh' con:"
echo "   - SERVER_URL: https://ddns.tu-dominio.com/api_update/<nombre_de_esta_ubicacion_remota>"
echo "   - SECRET_KEY: ${DDNS_SECRET_KEY}"
echo ""
echo -e "${GREEN}¡Disfruta de tu servidor DDNS personalizado!${NC}"
echo "Para ver los logs del servidor: docker logs ddns-api-server -f"
echo "Para verificar las IPs registradas: https://ddns.tu-dominio.com/status?secret=${MIGRATION_SECRET}"
echo "Puedes ejecutar migraciones manualmente si es necesario: docker exec ddns-api-server npm run db:migrate"
echo ""