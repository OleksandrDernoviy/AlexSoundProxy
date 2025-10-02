const express = require("express");
const axios = require("axios");

const app = express();
const port = process.env.PORT || 3000;

const clientID =
  process.env.SOUNDCLOUD_CLIENT_ID || "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  Accept: "*/*",
  "Accept-Language": "uk-UA,uk;q=0.8,en-US;q=0.5,en;q=0.3",
  Referer: "https://soundcloud.com/",
  Origin: "https://soundcloud.com",
  Connection: "keep-alive",
};

// ICY вставка
function createIcyMetadata(title) {
  const text = `StreamTitle='${title || "Unknown"}';`;
  const length = Math.ceil(text.length / 16);
  const buffer = Buffer.alloc(1 + length * 16, 0);
  buffer[0] = length;
  buffer.write(text, 1);
  return buffer;
}

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

    for (const url of playlistUrls) {
      try {
        const resolvedUrl = url.includes("on.soundcloud.com")
          ? "https://soundcloud.com/alex-derny/sets/copy-of-sea"
          : url;

        const response = await axios.get(
          "https://api-v2.soundcloud.com/resolve",
          {
            params: { url: resolvedUrl, client_id: clientID },
            headers: browserHeaders,
          }
        );

        const data = response.data;
        if (data.kind === "playlist" && data.tracks) {
          allTracks = allTracks.concat(data.tracks);
        } else if (data.kind === "track") {
          allTracks.push(data);
        }
      } catch (err) {
        console.error("Playlist fetch error:", err.message);
      }
    }

    if (allTracks.length === 0) {
      return res.status(404).json({ error: "No tracks found in playlists" });
    }

    res.set({
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
      "icy-name": "Alex Derny FM",
      "icy-description": "SoundCloud Playlist Stream",
      "icy-genre": "Various",
      "icy-br": "128",
      "icy-pub": "1",
      "icy-metaint": 16000,
    });

    let trackIndex = 0;
    const totalTracks = allTracks.length;
    const metaint = 16000;

    const streamNext = async () => {
      if (loop === "false" && trackIndex >= totalTracks) {
        res.end();
        return;
      }

      const track = allTracks[trackIndex % totalTracks];
      trackIndex++;

      try {
        const transcoding = track.media.transcodings.find(
          (t) =>
            t.format.protocol === "progressive" &&
            t.format.mime_type === "audio/mpeg"
        );
        if (!transcoding)
          throw new Error("No progressive MP3 transcoding found");

        const streamUrlResponse = await axios.get(
          `${transcoding.url}?client_id=${clientID}`,
          { headers: browserHeaders }
        );
        const streamUrl = streamUrlResponse.data.url;
        if (!streamUrl) throw new Error("No stream URL returned");

        const streamResponse = await axios.get(streamUrl, {
          headers: browserHeaders,
          responseType: "stream",
        });

        const metadata = createIcyMetadata(track.title);
        let bytesSent = 0;

        streamResponse.data.on("data", (chunk) => {
          let offset = 0;
          while (offset < chunk.length) {
            const remaining = metaint - bytesSent;
            if (chunk.length - offset >= remaining) {
              res.write(chunk.slice(offset, offset + remaining));
              res.write(metadata);
              offset += remaining;
              bytesSent = 0;
            } else {
              res.write(chunk.slice(offset));
              bytesSent += chunk.length - offset;
              offset = chunk.length;
            }
          }
        });

        streamResponse.data.on("end", () => {
          console.log(`Finished streaming: ${track.title}`);
          if (loop === "true" || trackIndex < totalTracks) {
            streamNext();
          } else {
            res.end();
          }
        });

        streamResponse.data.on("error", (err) => {
          console.error("Stream error:", err.message);
          res.end();
        });
      } catch (err) {
        console.error("Download error:", err.message);
        res.end();
      }
    };

    await streamNext();
  } catch (error) {
    console.error("Server error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "SoundCloud MP3 Proxy is running!",
    usage: "/stream?playlists=url1|url2&loop=true",
  });
});

app.listen(port, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${port}`);
});
