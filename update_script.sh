#!/bin/bash

LOCATION_NAME="$1"
NEW_IP="$2"
OLD_IP="$3"

echo "------------------------------------------------------"
echo "Script de actualización ejecutado para: $LOCATION_NAME"
echo "Nueva IP: $NEW_IP"
echo "IP Antigua: $OLD_IP"
echo "Fecha y Hora: $(date)"
echo "------------------------------------------------------"

# Aquí puedes añadir cualquier comando que necesites.
# Ejemplos:
# - Enviar una notificación por Telegram:
#   curl -s -X POST https://api.telegram.org/botTU_TOKEN_BOT/sendMessage -d chat_id=TU_CHAT_ID -d text="IP de $LOCATION_NAME ha cambiado a $NEW_IP"
# - Actualizar un archivo de configuración en algún lugar:
#   echo "La IP de $LOCATION_NAME ahora es $NEW_IP" > /path/a/otro/archivo_de_status.txt
# - Reiniciar otro servicio (si lo tienes mapeado en docker-compose o si este script accede a otros contenedores)
#   docker restart mi_otro_servicio_en_el_mismo_host
# - Lo que sea que necesites automatizar al cambiar la IP

exit 0 # Asegúrate de salir con 0 para indicar éxito