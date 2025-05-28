# Servidor DDNS Personalizado con Node.js y Docker

Este repositorio contiene un servidor DDNS (Dynamic DNS) personalizado, diseñado para rastrear las direcciones IP públicas de tus ubicaciones y ejecutar acciones personalizadas cuando estas IPs cambian. Está optimizado para ejecutarse en una **Raspberry Pi con Docker** y es compatible con la función "Custom DDNS" de routers como TP-Link, así como con clientes personalizados basados en scripts.

Además, aprovecha **Cloudflare Tunnels** para exponer de forma segura el servidor a Internet sin necesidad de abrir puertos en tu router ni lidiar con IPs dinámicas en el lado del servidor.

## 🌟 Características

* **Independencia:** No dependas de proveedores DDNS de terceros.
* **Control Total:** Tú decides cómo se guardan las IPs y qué acciones se toman al actualizarse.
* **Compatibilidad Dual:**
    * Soporte para la función "Custom DDNS" de routers (ej. TP-Link) mediante solicitudes `GET` con parámetros de URL.
    * Soporte para clientes personalizados (ej. scripts Bash) mediante solicitudes `POST` con cuerpo JSON y clave secreta en el header.
* **Ejecución de Script:** Lanza un script Bash personalizable (`update_script.sh`) cada vez que una IP registrada cambia.
* **Seguridad Mejorada:** Integración con Cloudflare Tunnels para HTTPS gratuito y ocultamiento de la IP de origen del servidor. Autenticación básica con claves secretas/credenciales.
* **Ligero y Eficiente:** Desarrollado en Node.js con Express, ideal para hardware de bajo consumo como la Raspberry Pi.
* **Contenerizado con Docker:** Fácil despliegue, gestión y portabilidad.
* **Persistencia de Datos:** Las IPs se guardan en un archivo JSON montado en un volumen Docker.

## 🚀 Cómo Funciona

1.  **Servidor DDNS (en tu Raspberry Pi):**
    * Una aplicación Node.js (Express) corre dentro de un contenedor Docker.
    * Expone dos endpoints: `/api_update/:location_name` (para clientes personalizados) y `/router_update` (para routers).
    * Recibe la IP de la ubicación y las credenciales/clave secreta.
    * Guarda la IP en un archivo `ips.json` persistente.
    * Si la IP ha cambiado, ejecuta el script `update_script.sh` con la ubicación, la nueva IP y la IP antigua como argumentos.
2.  **Cloudflare Tunnel:**
    * `cloudflared` (el cliente de Cloudflare Tunnel) se ejecuta en tu Raspberry Pi (o en una máquina en la misma red).
    * Crea un túnel seguro desde un subdominio de tu elección (ej. `ddns.tu-dominio.com`) hacia el puerto 5000 de tu contenedor Docker, exponiéndolo a Internet de forma segura con HTTPS y sin necesidad de abrir puertos en tu router.
3.  **Cliente DDNS (en tus ubicaciones remotas):**
    * **Router TP-Link:** Configuras la función "Custom DDNS" de tu router para enviar peticiones `GET` periódicamente al endpoint `/router_update` de tu servidor a través de Cloudflare Tunnel.
    * **Scripts Personalizados (ej. otras Raspberry Pis):** Un script Bash detecta la IP pública de su red y envía una petición `POST` con la IP y una clave secreta al endpoint `/api_update/:location_name` de tu servidor.

## 📋 Pre-requisitos

* **Raspberry Pi (o cualquier sistema Linux con ARM/AMD64) con Docker y Docker Compose instalados.**
    * Instalar Docker: `curl -sSL https://get.docker.com | sh`
    * Añadir tu usuario al grupo docker: `sudo usermod -aG docker $USER && newgrp docker`
    * Instalar Docker Compose (si no está incluido): `sudo apt install docker-compose` (o sigue la documentación oficial de Docker Compose).
* **Una cuenta de Cloudflare y un dominio registrado en Cloudflare.**
* **Cloudflare Tunnel configurado y activo en tu Raspberry Pi.** Si no lo tienes:
    1.  Instala `cloudflared`: [Documentación de Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-run/)
    2.  Autentica `cloudflared`: `cloudflared tunnel login`
    3.  Crea un túnel: `cloudflared tunnel create <nombre-de-tu-tunel>`
    4.  Crea un archivo de configuración (`~/.cloudflared/config.yml` o similar) para tu túnel, apuntando a `http://localhost:5000` para el servicio DDNS.

## 🛠️ Configuración e Instalación

### 1. Preparar el Repositorio

Clona este repositorio o crea los archivos manualmente:

```bash
git clone https://github.com/git-comcomsis/Docker-Dynamic-DNS-Server.git

cd Docker-Dynamic-DNS-Server
```

