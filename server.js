
const express = require("express");
const axios = require("axios");
const { Transform } = require("stream");

const app = express();
const PORT = process.env.PORT || 8080;

// SoundCloud client id (можеш задати свій у SOUNDCLOUD_CLIENT_ID)
const clientID =
  process.env.SOUNDCLOUD_CLIENT_ID || "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

// Імітація браузерних заголовків для SoundCloud API
const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  Accept: "*/*",
  "Accept-Language": "uk-UA,uk;q=0.8,en-US;q=0.5,en;q=0.3",
  Referer: "https://soundcloud.com/",
  Origin: "https://soundcloud.com",
  Connection: "keep-alive",
};

// ICY метадані — обгортка
function createIcyMetadata(title) {
  const text = `StreamTitle='${(title || "Unknown").replace(/'/g, "\\'")}';`;
  const blocks = Math.ceil(text.length / 16);
  const buf = Buffer.alloc(1 + blocks * 16, 0);
  buf[0] = blocks;
  buf.write(text, 1);
  return buf;
}

// Transform для інжекції ICY metadata кожні metaint байт
function createIcyInjector(metaint, title) {
  let bytesSent = 0;
  const metadataBuf = createIcyMetadata(title);

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const remaining = metaint - bytesSent;
          if (chunk.length - offset >= remaining) {
            // відправляємо до межі метаінта
            this.push(chunk.slice(offset, offset + remaining));
            // вставляємо метадані
            this.push(metadataBuf);
            offset += remaining;
            bytesSent = 0;
          } else {
            // відправляємо весь шматок і збільшуємо лічильник
            this.push(chunk.slice(offset));
            bytesSent += chunk.length - offset;
            offset = chunk.length;
          }
        }
        callback();
      } catch (err) {
        callback(err);
      }
    },

    // при завершенні трансформа — нічого особливого
    flush(callback) {
      callback();
    },
  });
}

// Резолвимо playlist/track URL до об'єкта SoundCloud (playlist або track)
async function resolveSoundCloud(urlToResolve) {
  const res = await axios.get("https://api-v2.soundcloud.com/resolve", {
    params: { url: urlToResolve, client_id: clientID },
    headers: browserHeaders,
    timeout: 15000,
  });
  return res.data;
}

// Отримуємо реальний stream URL для треку (progressive mp3)
async function getProgressiveStreamUrl(track) {
  if (!track || !track.media || !Array.isArray(track.media.transcodings)) {
    throw new Error("No media/transcodings on track");
  }
  const progressive = track.media.transcodings.find(
    (t) =>
      t.format &&
      t.format.protocol === "progressive" &&
      t.format.mime_type &&
      t.format.mime_type.includes("mpeg")
  );
  if (!progressive) throw new Error("No progressive MP3 transcoding found");

  const infoRes = await axios.get(`${progressive.url}?client_id=${clientID}`, {
    headers: browserHeaders,
    timeout: 15000,
  });
  // infoRes.data.url — прямий CDN URL до mp3
  if (!infoRes.data || !infoRes.data.url)
    throw new Error("No stream URL returned");
  return infoRes.data.url;
}

// Основний ендпойнт /stream?playlists=url1|url2&loop=true
app.get("/stream", async (req, res) => {
  const { playlists, loop = "true" } = req.query;
  if (!playlists) return res.status(400).json({ error: "Missing ?playlists=" });

  // metaint для ICY
  const metaint = 16000;

  // Віддаємо ICY-заголовки (клієнт побачить і знає, що чекати metadata)
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache",
    "icy-name": "Alex Derny FM",
    "icy-description": "SoundCloud Playlist Stream",
    "icy-genre": "Various",
    "icy-br": "128",
    "icy-pub": "1",
    "icy-metaint": String(metaint),
  });

  // Якщо клієнт відключиться — припиняємо стрім
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  // Резолвимо всі плейлисти в масив треків
  const urls = playlists
    .split("|")
    .map((u) => u.trim())
    .filter(Boolean);
  let allTracks = [];

  for (const u of urls) {
    try {
      const data = await resolveSoundCloud(u);
      if (data.kind === "playlist" && Array.isArray(data.tracks)) {
        allTracks = allTracks.concat(data.tracks);
      } else if (data.kind === "track") {
        allTracks.push(data);
      }
    } catch (err) {
      // мовчки пропускаємо помилки резолву, але логнемо на сервер
      console.error("Resolve error for", u, err.message);
    }
  }

  if (allTracks.length === 0) {
    try {
      res.status(404).json({ error: "No tracks found" });
    } catch (e) {}
    return;
  }

  // Функція стрімить один трек, повертає Promise, що резолвиться коли трек завершився або відключився клієнт
  async function streamOneTrack(track) {
    if (aborted) throw new Error("Client disconnected");
    let streamUrl;
    try {
      streamUrl = await getProgressiveStreamUrl(track);
    } catch (err) {
      throw new Error("Failed to get stream URL: " + err.message);
    }

    // Запит на CDN MP3 поток
    const streamRes = await axios.get(streamUrl, {
      responseType: "stream",
      headers: browserHeaders,
      timeout: 30000,
      maxRedirects: 5,
    });

    return new Promise((resolve, reject) => {
      if (aborted) {
        // закриваємо якщо клієнт вже пішов
        try {
          streamRes.data.destroy();
        } catch (e) {}
        return reject(new Error("Client disconnected"));
      }

      const injector = createIcyInjector(metaint, track.title || "Unknown");

      // Якщо клієнт відключиться — припинити стрім
      const onClientClose = () => {
        try {
          streamRes.data.destroy();
        } catch (e) {}
        try {
          injector.destroy();
        } catch (e) {}
      };
      req.on("close", onClientClose);

      streamRes.data.on("error", (err) => {
        req.removeListener("close", onClientClose);
        try {
          injector.destroy();
        } catch (e) {}
        return reject(err);
      });

      streamRes.data.on("end", () => {
        // коли CDNs закінчився — зачекаємо поки injector завершить
        // але тут просто резолвимо, бо ми не підключаємо res.end() поки не весь плейлист / loop=false
      });

      injector.on("error", (err) => {
        req.removeListener("close", onClientClose);
        try {
          streamRes.data.destroy();
        } catch (e) {}
        return reject(err);
      });

      injector.on("end", () => {
        req.removeListener("close", onClientClose);
        return resolve();
      });

      // Pipe through injector -> response (не закриваємо res при завершенні одного треку)
      streamRes.data.pipe(injector).pipe(res, { end: false });

      // Коли оригінальний стрім завершиться, зачекаємо коротко і резолвимо
      streamRes.data.on("end", () => {
        // даємо декілька мс щоб injector її пропустив
        setTimeout(() => {
          // призупиняємо потік injector (emit 'end')
          try {
            injector.end();
          } catch (e) {}
          resolve();
        }, 50);
      });
    });
  }

  // Головний цикл — ідемо по треках, підтримуємо loop=true
  let idx = 0;
  try {
    while (!aborted) {
      const track = allTracks[idx % allTracks.length];
      try {
        await streamOneTrack(track);
      } catch (err) {
        console.error("Track stream error:", err.message);
        // при помилці зі стрімом — пропускаємо трек і йдемо далі
      }
      idx++;
      if (loop === "false" && idx >= allTracks.length) break;
    }
  } catch (err) {
    console.error("Streaming ended with error:", err.message);
  } finally {
    // закінчуємо response тільки коли закінчили весь цикл або клієнт відключився
    try {
      res.end();
    } catch (e) {}
  }
});

// Простий healthcheck
app.get("/", (req, res) => {
  res.json({
    message: "SoundCloud MP3 Proxy running",
    usage: "/stream?playlists=url1|url2&loop=true",
  });
});

app.listen(PORT, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${PORT}`);
});
