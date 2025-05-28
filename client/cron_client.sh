# Hacer el script ejecutable
chmod +x ddns_client.sh

# Moverlo a una ubicación común (ej. /usr/local/bin)
sudo mv ddns_client.sh /usr/local/bin/ddns_client.sh

# Programarlo para que se ejecute cada 5 minutos
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/ddns_client.sh >> /var/log/ddns_client.log 2>&1") | crontab -