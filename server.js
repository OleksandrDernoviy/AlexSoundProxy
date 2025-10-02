const express = require("express");
const axios = require("axios");

const app = express();
const port = process.env.PORT || 8080;

const clientID =
  process.env.SOUNDCLOUD_CLIENT_ID || "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

const browserHeaders = {
  "User-Agent": "Mozilla/5.0",
  Accept: "*/*",
  "Accept-Language": "en-US;q=0.9",
  Referer: "https://soundcloud.com/",
  Origin: "https://soundcloud.com",
};

// ICY метадані
function createIcyMetadata(title) {
  const text = `StreamTitle='${title || "Unknown"}';`;
  const length = Math.ceil(text.length / 16);
  const buffer = Buffer.alloc(1 + length * 16, 0);
  buffer[0] = length;
  buffer.write(text, 1);
  return buffer;
}

app.get("/stream", async (req, res) => {
  const { playlists, loop = "true" } = req.query;
  if (!playlists) {
    return res
      .status(400)
      .json({
        error: 'Missing "playlists" query param (e.g. playlists=url1|url2)',
      });
  }

  const playlistUrls = playlists.split("|");
  let allTracks = [];

  // резолвимо плейлисти/треки
  for (const url of playlistUrls) {
    try {
      const resolvedUrl = url.includes("on.soundcloud.com")
        ? url // тут можна одразу редіректнути
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
    "icy-description": "SoundCloud Proxy",
    "icy-metaint": 16000,
  });

  let trackIndex = 0;
  const metaint = 16000;

  const streamNext = async () => {
    if (loop === "false" && trackIndex >= allTracks.length) {
      res.end();
      return;
    }

    const track = allTracks[trackIndex % allTracks.length];
    trackIndex++;

    try {
      const transcoding = track.media.transcodings.find(
        (t) =>
          t.format.protocol === "progressive" &&
          t.format.mime_type === "audio/mpeg"
      );
      if (!transcoding) throw new Error("No progressive MP3 found");

      const streamUrlResponse = await axios.get(
        `${transcoding.url}?client_id=${clientID}`,
        {
          headers: browserHeaders,
        }
      );

      const streamUrl = streamUrlResponse.data.url;
      if (!streamUrl) throw new Error("No stream URL");

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
        console.log(`Finished: ${track.title}`);
        if (loop === "true" || trackIndex < allTracks.length) {
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
      console.error("Track error:", err.message);
      res.end();
    }
  };

  streamNext();
});

app.get("/", (req, res) => {
  res.json({ usage: "/stream?playlists=url1|url2&loop=true" });
});

app.listen(port, () => {
  console.log(`SoundCloud MP3 Proxy running on port ${port}`);
});
