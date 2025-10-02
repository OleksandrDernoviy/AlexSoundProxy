const express = require("express");
const axios = require("axios");
const stream = require("stream");
const { AbortController } = require("node-abort-controller"); // Added for compatibility

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

// ICY metadata creation
function createIcyMetadata(title) {
  const text = `StreamTitle='${title || "Unknown"}';`;
  const length = Math.ceil(text.length / 16);
  const buffer = Buffer.alloc(1 + length * 16, 0);
  buffer[0] = length;
  buffer.write(text, 1);
  return buffer;
}

// Metadata inserter transform stream
class MetadataInserter extends stream.Transform {
  constructor(metadata, metaint) {
    super();
    this.metadata = metadata;
    this.metaint = metaint;
    this.bytesSent = 0;
  }

  _transform(chunk, encoding, callback) {
    let offset = 0;
    while (offset < chunk.length) {
      const remaining = this.metaint - this.bytesSent;
      if (chunk.length - offset >= remaining) {
        this.push(chunk.slice(offset, offset + remaining));
        this.push(this.metadata);
        offset += remaining;
        this.bytesSent = 0;
      } else {
        this.push(chunk.slice(offset));
        this.bytesSent += chunk.length - offset;
        offset = chunk.length;
      }
    }
    callback();
  }
}

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
          allTracks = allTracks.concat(
            data.tracks
              .map((track) => {
                const transcoding = track.media.transcodings.find(
                  (t) =>
                    t.format.protocol === "progressive" &&
                    t.format.mime_type === "audio/mpeg"
                );
                if (!transcoding) return null;
                return { title: track.title, transcoding };
              })
              .filter(Boolean)
          );
        } else if (data.kind === "track") {
          const transcoding = data.media.transcodings.find(
            (t) =>
              t.format.protocol === "progressive" &&
              t.format.mime_type === "audio/mpeg"
          );
          if (transcoding) {
            allTracks.push({ title: data.title, transcoding });
          }
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
    let isClosed = false;
    let abortController = null;

    res.on("close", () => {
      isClosed = true;
      if (abortController) {
        abortController.abort();
      }
    });

    const streamNext = async () => {
      if (isClosed || (loop === "false" && trackIndex >= totalTracks)) {
        res.end();
        return;
      }

      const track = allTracks[trackIndex % totalTracks];
      trackIndex++;

      abortController = new AbortController();

      try {
        const streamUrlResponse = await axios.get(
          `${track.transcoding.url}?client_id=${clientID}`,
          { headers: browserHeaders, signal: abortController.signal }
        );
        const streamUrl = streamUrlResponse.data.url;
        if (!streamUrl) throw new Error("No stream URL returned");

        const streamResponse = await axios.get(streamUrl, {
          headers: browserHeaders,
          responseType: "stream",
          signal: abortController.signal,
        });

        const metadata = createIcyMetadata(track.title);
        const inserter = new MetadataInserter(metadata, metaint);

        streamResponse.data.pipe(inserter).pipe(res, { end: false });

        inserter.on("end", () => {
          console.log(`Finished streaming: ${track.title}`);
          if (!isClosed && (loop === "true" || trackIndex < totalTracks)) {
            streamNext();
          } else {
            res.end();
          }
        });

        inserter.on("error", (err) => {
          console.error("Stream error:", err.message);
          res.end();
        });
      } catch (err) {
        if (axios.isCancel(err)) {
          console.log("Stream aborted by client disconnect");
        } else {
          console.error("Download error:", err.message);
        }
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
