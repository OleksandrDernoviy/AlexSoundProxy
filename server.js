const express = require("express");
const https = require("https");
const http = require("http");
const url = require("url");

const app = express();
const PORT = process.env.PORT || 8080;

// Проксі endpoint
app.get("/stream", (req, res) => {
  const playlistUrl = req.query.playlists;
  if (!playlistUrl) {
    return res.status(400).send("Missing ?playlists= URL");
  }

  try {
    const parsed = url.parse(playlistUrl);

    const client = parsed.protocol === "https:" ? https : http;

    const proxyReq = client.get(playlistUrl, (proxyRes) => {
      // Передаємо заголовки назад на ESP32
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "icy-metadata": "1",
      });

      // 🚀 Головне місце: напряму pipe у відповідь
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err.message);
      res.status(500).send("Stream error");
    });
  } catch (err) {
    console.error("Invalid URL:", err.message);
    res.status(400).send("Invalid playlist URL");
  }
});

app.listen(PORT, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${PORT}`);
});
