const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const cloudinary = require("cloudinary").v2;
require("dotenv").config(); // Para usar .env si es local

const app = express();
app.use(express.json());

// Configurar Cloudinary
cloudinary.config({
  cloud_name: "deyopp70c",
  api_key: "294961449435536",
  api_secret: "W1oAl9_qJXT7_LLw4K1C9UfuYUY",
});

// Obtener duración del audio
const getAudioDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (err, stdout) => {
        if (err) return reject(err);
        resolve(parseFloat(stdout.trim()));
      }
    );
  });
};

// Mezclar meditación + fondo
app.post("/mix", async (req, res) => {
  const { meditacion, fondo } = req.body;

  if (!meditacion || !fondo) {
    return res.status(400).json({ error: "Se requieren ambas URLs de audio" });
  }

  const id = uuidv4();
  const basePath = "/tmp";
  const meditacionPath = path.join(basePath, `${id}_meditacion.mp3`);
  const fondoPath = path.join(basePath, `${id}_fondo.mp3`);
  const outputPath = path.join(basePath, `${id}_final.mp3`);

  try {
    const downloadFile = async (url, filePath) => {
      const response = await axios({ url, responseType: "stream" });
      const writer = fs.createWriteStream(filePath);
      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    };

    await downloadFile(meditacion, meditacionPath);
    await downloadFile(fondo, fondoPath);

    const duration = await getAudioDuration(meditacionPath);
    const fadeStart = Math.max(0, duration - 4);

    const command = `ffmpeg -i "${meditacionPath}" -i "${fondoPath}" -filter_complex "[0:a]afade=t=out:st=${fadeStart}:d=4[a0];[1:a]volume=0.3[a1];[a0][a1]amix=inputs=2:duration=first" -y "${outputPath}"`;

    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve();
      });
    });

    const upload = await cloudinary.uploader.upload(outputPath, {
      resource_type: "video",
      folder: "hipnosis",
      public_id: `mix-${id}`,
      overwrite: true,
    });

    res.json({ url: upload.secure_url });

    fs.unlinkSync(meditacionPath);
    fs.unlinkSync(fondoPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error al mezclar los audios" });
  }
});

// Unir 7 audios
app.post("/unir", async (req, res) => {
  const { audios } = req.body;

  if (!Array.isArray(audios) || audios.length !== 7) {
    return res.status(400).json({ error: "Debes enviar un arreglo con exactamente 7 URLs de audio." });
  }

  const id = uuidv4();
  const basePath = "/tmp";
  const audioPaths = [];

  try {
    for (let i = 0; i < audios.length; i++) {
      const audioPath = path.join(basePath, `${id}_${i}.mp3`);
      const response = await axios({ url: audios[i], responseType: "stream" });
      const writer = fs.createWriteStream(audioPath);
      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      audioPaths.push(audioPath);
    }

    const listPath = path.join(basePath, `${id}_list.txt`);
    const listContent = audioPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outputPath = path.join(basePath, `${id}_completo.mp3`);
    const command = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy -y "${outputPath}"`;

    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve();
      });
    });

    const upload = await cloudinary.uploader.upload(outputPath, {
      resource_type: "video",
      folder: "hipnosis",
      public_id: `hipnosis-${id}`,
      overwrite: true,
    });

    res.json({ url: upload.secure_url });

    audioPaths.forEach(p => fs.unlinkSync(p));
    fs.unlinkSync(listPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error("Error al unir audios:", err);
    res.status(500).json({ error: "Error al unir los audios" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Servidor activo en puerto ${PORT}`);
});
