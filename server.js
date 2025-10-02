const express = require("express");
const https = require("https");

const app = express();
const port = process.env.PORT || 3000;

const clientID =
  process.env.SOUNDCLOUD_CLIENT_ID || "emtYgYTYncaCH7HKEAQUQ5SDWmSeQhRT";

// мінімальний набір заголовків
const headers = {
  "User-Agent": "Mozilla/5.0",
  Accept: "*/*",
};

// ICY метадані (можеш взагалі вирізати, якщо не треба)
function createIcyMetadata(title) {
  const text = `StreamTitle='${title || "Unknown"}';`;
  const length = Math.ceil(text.length / 16);
  const buffer = Buffer.alloc(1 + length * 16, 0);
  buffer[0] = length;
  buffer.write(text, 1);
  return buffer;
}

app.get("/stream", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res
      .status(400)
      .json({ error: "Missing ?url=<soundcloud_track_url>" });
  }

  // ставимо заголовки для стріму
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache",
    "icy-name": "Alex Derny FM",
    "icy-metaint": 16000,
  });

  try {
    // 1. resolve API -> отримати дані про трек
    const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
      url
    )}&client_id=${clientID}`;

    https.get(resolveUrl, { headers }, (resolveRes) => {
      let body = "";
      resolveRes.on("data", (chunk) => (body += chunk));
      resolveRes.on("end", () => {
        const data = JSON.parse(body);
        if (!data.media || !data.media.transcodings) {
          res.end();
          return;
        }

        // 2. беремо progressive mp3
        const transcoding = data.media.transcodings.find(
          (t) =>
            t.format.protocol === "progressive" &&
            t.format.mime_type.includes("audio/mpeg")
        );

        if (!transcoding) {
          res.end();
          return;
        }

        const streamApiUrl = `${transcoding.url}?client_id=${clientID}`;

        // 3. запитати справжній stream URL
        https.get(streamApiUrl, { headers }, (streamApiRes) => {
          let sbody = "";
          streamApiRes.on("data", (c) => (sbody += c));
          streamApiRes.on("end", () => {
            const { url: realStreamUrl } = JSON.parse(sbody);
            if (!realStreamUrl) {
              res.end();
              return;
            }

            // 4. підключаємося до реального mp3-потоку і пайпимо напряму в клієнта
            https.get(realStreamUrl, { headers }, (audioRes) => {
              let bytesSent = 0;
              const metaint = 16000;
              const metadata = createIcyMetadata(data.title);

              audioRes.on("data", (chunk) => {
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

              audioRes.on("end", () => res.end());
              audioRes.on("error", () => res.end());
            });
          });
        });
      });
    });
  } catch (err) {
    console.error("Stream error:", err.message);
    res.end();
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "SoundCloud proxy running!",
    usage: "/stream?url=<track_url>",
  });
});

app.listen(port, () => {
  console.log(`Proxy on port ${port}`);
});
