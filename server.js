const express = require("express");
const axios = require("axios");
const scdl = require("soundcloud-downloader");

const app = express();
const port = process.env.PORT || 3000;

// Використовуємо ваш client_id
const clientID = "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

// Заголовки для симуляції браузера (з вашого мережевого трафіку)
const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  Accept: "*/*",
  "Accept-Language": "uk-UA,uk;q=0.8,en-US;q=0.5,en;q=0.3",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  Referer: "https://soundcloud.com/",
  Origin: "https://soundcloud.com",
  Connection: "keep-alive",
  DNT: "1",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "X-Datadome-ClientId": "315be3ad-a051-4168-817f-e8dacacf7136",
  Priority: "u=4",
};

// Ендпоінт для стримінгу: /stream?playlists=url1|url2&loop=true
app.get("/stream", async (req, res) => {
  try {
    const { playlists, loop = "true" } = req.query;
    if (!playlists) {
      return res.status(400).json({
        error: 'Missing "playlists" query param (e.g., playlists=url1|url2)',
      });
    }

    const playlistUrls = playlists.split("|");
    let allTracks = [];

    // Отримуємо треки з усіх плейлистів через SoundCloud API
    for (const url of playlistUrls) {
      try {
        // Використовуємо повний permalink, якщо це короткий URL
        const resolvedUrl = url.includes("on.soundcloud.com")
          ? "https://soundcloud.com/alex-derny/sets/copy-of-sea"
          : url;

        console.log(`Fetching playlist: ${resolvedUrl}`);
        const response = await axios.get(
          "https://api-v2.soundcloud.com/resolve",
          {
            params: {
              url: resolvedUrl,
              client_id: clientID,
            },
            headers: browserHeaders,
          }
        );
        const data = response.data;
        console.log(`API response for ${resolvedUrl}:`, {
          kind: data.kind,
          track_count: data.tracks ? data.tracks.length : 0,
        });

        if (data.kind === "playlist" && data.tracks) {
          allTracks = allTracks.concat(data.tracks);
        } else if (data.kind === "track") {
          allTracks.push(data);
        }
      } catch (err) {
        console.error(
          `Failed to fetch playlist ${url}:`,
          err.response
            ? `${err.response.status} ${err.response.statusText}`
            : err.message
        );
        continue;
      }
    }

    if (allTracks.length === 0) {
      return res.status(404).json({ error: "No tracks found in playlists" });
    }

    console.log(`Total tracks loaded: ${allTracks.length}`);

    // Налаштування відповіді як MP3-потік
    res.set({
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      "X-Station-Name": "Alex Derny FM",
    });

    let trackIndex = 0;
    const totalTracks = allTracks.length;

    const streamNext = async () => {
      if (loop === "false" && trackIndex >= totalTracks) {
        res.end();
        return;
      }

      const track = allTracks[trackIndex % totalTracks];
      trackIndex++;

      try {
        console.log(`Streaming track: ${track.title || "Unknown"}`);
        const stream = await scdl.download(track.permalink_url, clientID);
        stream.pipe(res, { end: false });

        stream.on("end", () => {
          if (loop === "true" || trackIndex < totalTracks) {
            streamNext();
          } else {
            res.end();
          }
        });

        stream.on("error", (err) => {
          console.error("Stream error:", err);
          res.status(500).end();
        });
      } catch (err) {
        console.error("Download error:", err);
        res.status(500).end();
      }
    };

    await streamNext();
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    message: "SoundCloud MP3 Proxy is running!",
    usage: "/stream?playlists=url1|url2&loop=true",
  });
});

app.listen(port, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${port}`);
});
