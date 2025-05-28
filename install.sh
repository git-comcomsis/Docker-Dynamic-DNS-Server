#!/bin/bash
# 1. Construir la imagen
docker build -t dcss-ddns-server .

# 2. Ejecutar el contenedor
# Crea un volumen para persistir los datos de IP en tu RPi
mkdir -p $HOME/ddns_data

docker run -d \
  --name ddns-api-server \
  --restart unless-stopped \
  -p 5000:5000 \
  -e DDNS_SECRET_KEY="your_super_secret_key" \
  -e ROUTER_DDNS_USERNAME="router_user" \
  -e ROUTER_DDNS_PASSWORD="router_pass" \
  -e IP_FILE="/server/ips.json" \
  -v $HOME/ddns_data:/data \
  dcss-ddns-server