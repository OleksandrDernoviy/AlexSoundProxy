const express = require("express");
const { default: scdlCreate } = require("soundcloud-downloader");

const app = express();
const port = process.env.PORT || 3000;

// Використовуємо ваш client_id
const scdl = scdlCreate({
  clientID: "0wlyyut4CpbvbdpJVkjVQExyIYX27qGO",
  saveClientID: false,
});

// Ендпоінт для стримінгу: /stream?playlists=url1|url2&loop=true
app.get("/stream", async (req, res) => {
  try {
    const { playlists, loop = "true" } = req.query;
    if (!playlists) {
      return res
        .status(400)
        .json({
          error: 'Missing "playlists" query param (e.g., playlists=url1|url2)',
        });
    }

    const playlistUrls = playlists.split("|");
    let allTracks = [];

    // Отримуємо треки з усіх плейлистів
    for (const url of playlistUrls) {
      const setInfo = await scdl.getSetInfo(url);
      if (setInfo && setInfo.tracks) {
        allTracks = allTracks.concat(setInfo.tracks);
      }
    }

    if (allTracks.length === 0) {
      return res.status(404).json({ error: "No tracks found in playlists" });
    }

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
      // Loop логіка
      if (loop === "false" && trackIndex >= totalTracks) {
        res.end();
        return;
      }

      const track = allTracks[trackIndex % totalTracks];
      trackIndex++;

      try {
        const stream = await scdl.download(track.permalink_url);
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
