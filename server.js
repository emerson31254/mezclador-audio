const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();
var uriMP3;

const app = express();
app.use(express.json());

// Configurar Cloudinary para /unir
cloudinary.config({
  cloud_name: "dtvxttc1l",
  api_key: "984911343286864",
  api_secret: "WLG7bqJPq_BlxOWKV3j0N3R_MN8",
});

// Función para obtener duración
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

// 🔊 /mix (mantiene respuesta como archivo físico)

app.post("/mix", async (req, res) => {
  const ruta = uriMP3.match(/hipnosis\/[^.]+/)?.[0];
  console.log(ruta);
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

    // 🎧 Mezcla: solo baja volumen de música y fade-out al final
    const command = `ffmpeg -i "${meditacionPath}" -i "${fondoPath}" -filter_complex "[0:a]aecho=0.8:0.9:20:0.3[a0];[1:a]afade=t=out:st=${fadeStart}:d=4,volume=0.2[a1];[a0][a1]amix=inputs=2:duration=first[aout];[aout]volume=2.0" -y "${outputPath}"`;
    
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

    uriMP3 = upload.secure_url;
    res.json({ url: upload.secure_url });

    fs.unlinkSync(meditacionPath);
    fs.unlinkSync(fondoPath);
    fs.unlinkSync(outputPath);

    if (ruta) {
      cloudinary.uploader.destroy(ruta, { resource_type: "video" })
        .then((result) => console.log(result))
        .catch((error) => console.error(error));
    }

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error al mezclar los audios" });
  }
});

// 🎧 /unir (devuelve URL desde Cloudinary)
app.post("/unir", async (req, res) => {
  const { audios } = req.body;

  if (!Array.isArray(audios) || audios.length !== 7) {
    return res.status(400).json({
      error: "Debes enviar un arreglo con exactamente 7 URLs de audio.",
    });
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
    const listContent = audioPaths.map((p) => `file '${p}'`).join("\n");
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
    uriMP3 = upload.secure_url;
    res.json({ url: upload.secure_url });

    audioPaths.forEach((p) => fs.unlinkSync(p));
    fs.unlinkSync(listPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error("Error al unir audios:", err);
    res.status(500).json({ error: "Error al unir los audios" });
  }
});

app.post("/analizar-espectro", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Falta la URL del audio." });
  }

  const id = uuidv4();
  const tempPath = path.join("/tmp", `${id}_check.mp3`);

  try {
    // 1. Descargar el audio
    const response = await axios({ url, responseType: "stream" });
    const writer = fs.createWriteStream(tempPath);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // 2. Analizar con ffmpeg + astats (con info)
    exec(
      `ffmpeg -v info -i "${tempPath}" -af astats=metadata=1:reset=1 -f null -`,
      (err, stdout, stderr) => {
        fs.unlinkSync(tempPath); // Limpieza del archivo

        if (err) {
          console.error("FFmpeg error:", err);
          return res.status(500).json({ error: "Error al analizar el audio." });
        }

        const output = stderr; // astats logs salen en stderr

        // 3. Extraer picos por bloque (1 seg aprox)
        const peakMatches = [...output.matchAll(/Peak level dB: ([\-\d\.]+)/g)]
          .map(m => parseFloat(m[1]))
          .filter(n => !isNaN(n));

        const suspectSeconds = [];
        let glitch = false;

        for (let i = 0; i < peakMatches.length; i++) {
          const peak = peakMatches[i];

          if (peak >= -0.1) {
            glitch = true;
            suspectSeconds.push(i);
          }

          // Cambio brusco entre segundos
          if (i > 0 && Math.abs(peak - peakMatches[i - 1]) > 10) {
            glitch = true;
            suspectSeconds.push(i);
          }
        }

        res.json({
          glitch_detected: glitch,
          suspect_seconds: [...new Set(suspectSeconds)],
          peaks: peakMatches,
          max_peak: peakMatches.length ? Math.max(...peakMatches) : null
        });
      }
    );
  } catch (err) {
    console.error("Error al descargar o analizar:", err);
    res.status(500).json({ error: "Error general en el análisis." });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Servidor activo en puerto ${PORT}`);
});
