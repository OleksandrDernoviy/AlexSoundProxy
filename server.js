const express = require("express");
const axios = require("axios");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// ⚡ Використовуємо client_id (твій ключ)
const CLIENT_ID =
  process.env.SOUNDCLOUD_CLIENT_ID || "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

// Плейліст із SoundCloud (повне посилання!)
const PLAYLIST_URL = "https://soundcloud.com/alex-derny/sets/copy-of-sea";

// HTTPS агент щоб уникнути зависань
const agent = new https.Agent({ rejectUnauthorized: false });

// Функція resolve: бере коротке on.soundcloud.com або звичайне посилання
async function resolveUrl(url) {
  try {
    if (url.includes("on.soundcloud.com")) {
      // робимо HEAD щоб дістати справжнє посилання
      const headResp = await axios.head(url, {
        maxRedirects: 0,
        validateStatus: null,
      });
      if (headResp.headers.location) return headResp.headers.location;
    }
    return url;
  } catch (err) {
    console.error("Resolve error:", err.message);
    return url;
  }
}

// Завантажити плейліст і повернути масив треків
async function getPlaylistTracks(playlistUrl) {
  const resolved = await resolveUrl(playlistUrl);
  console.log("Resolved URL:", resolved);

  const apiUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
    resolved
  )}&client_id=${CLIENT_ID}`;

  const res = await axios.get(apiUrl);
  const playlist = res.data;

  if (playlist.kind === "playlist" && playlist.tracks) return playlist.tracks;
  if (playlist.kind === "track") return [playlist];

  throw new Error("No tracks found in playlist");
}

// Отримати стрім URL для треку
async function getStreamUrl(track) {
  const transcodings = track.media?.transcodings;
  const mp3 = transcodings?.find((t) => t.format.protocol === "progressive");
  if (!mp3) throw new Error("No MP3 stream found");

  const streamRes = await axios.get(`${mp3.url}?client_id=${CLIENT_ID}`);
  return streamRes.data.url;
}

// Функція перемішування (Fisher–Yates shuffle)
function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;

  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

// Основний маршрут
app.get("/stream", async (req, res) => {
  try {
    let tracks = await getPlaylistTracks(PLAYLIST_URL);

    // Перемішуємо треки
    tracks = shuffle(tracks);

    console.log("Streaming playlist with", tracks.length, "tracks");

    // Встановлюємо заголовки
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("icy-name", "Alex Derny FM");
    res.setHeader("icy-description", "SoundCloud Playlist Stream");
    res.setHeader("icy-genre", "Various");
    res.setHeader("icy-br", "128");

    let index = 0;

    const playNext = async () => {
      if (index >= tracks.length) {
        // Якщо всі треки зіграли – перемішуємо знову
        tracks = shuffle(tracks);
        index = 0;
      }

      const track = tracks[index++];
      try {
        const streamUrl = await getStreamUrl(track);

        console.log("Now streaming:", track.title);

        const response = await axios.get(streamUrl, {
          responseType: "stream",
          httpsAgent: agent,
        });

        response.data.pipe(res, { end: false });
        response.data.on("end", () => {
          console.log("Finished streaming:", track.title);
          playNext();
        });
      } catch (err) {
        console.error("Track error:", err.message);
        playNext(); // Пропускаємо проблемний трек
      }
    };

    playNext();
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Error streaming playlist");
  }
});

app.listen(PORT, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${PORT}`);
});
