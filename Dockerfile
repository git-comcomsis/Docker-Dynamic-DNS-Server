# Usa una imagen base Node.js para Raspberry Pi (armv7/arm64)
FROM node:18-alpine

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /server

# Copia los archivos de package.json y package-lock.json (si existe)
COPY package*.json ./
# Copia el resto de tu aplicación
COPY server.js ./
COPY update_script.sh ./

# Asegura que el script de actualización sea ejecutable
RUN chmod +x update_script.sh

# Instala las dependencias
RUN npm install 

# Crea un directorio para los datos y asegúrate de que el usuario 'node' pueda escribir en él
# La imagen 'alpine' usa un usuario 'node' por defecto, lo cual es más seguro que 'root'
RUN mkdir -p /data && chown node:node /data

# Cambia al usuario 'node'
USER node

# Expone el puerto en el que Express escuchará (Cloudflare Tunnel lo usará)
EXPOSE 5000

# Comando para ejecutar la aplicación
CMD ["npm", "start"]