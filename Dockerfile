FROM node:18

# Instala FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Prepara app
WORKDIR /app
COPY . .

RUN npm install

EXPOSE 3000
CMD ["npm", "start"]
