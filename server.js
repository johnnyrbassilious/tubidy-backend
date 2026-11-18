const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

// 1. Health & Connection Check
app.get('/api/ping', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now() });
});

// 2. Search YouTube / Music
app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  const proc = spawn('yt-dlp', [
    `ytsearch15:${query}`,
    '--dump-json',
    '--flat-playlist',
    '--no-warnings'
  ]);

  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
  proc.on('close', () => {
    const results = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const d = JSON.parse(line);
          return {
            id: d.id,
            title: d.title || 'Untitled',
            uploader: d.uploader || d.channel || 'Unknown',
            duration: d.duration || 0,
            thumbnail: (d.thumbnails && d.thumbnails.length) ? d.thumbnails[d.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
            url: d.url || `https://www.youtube.com/watch?v=${d.id}`
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json(results);
  });
});

// 3. Resolve Any Direct Link (YouTube, TikTok, Instagram, SoundCloud, X)
app.get('/api/info', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const proc = spawn('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]);
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
  proc.on('close', (code) => {
    if (code !== 0 || !output) return res.status(500).json({ error: 'Failed to resolve URL' });
    try {
      const d = JSON.parse(output);
      res.json({
        id: d.id || String(Date.now()),
        title: d.title || 'Media Stream',
        uploader: d.uploader || d.extractor_key || 'Web Media',
        duration: d.duration || 0,
        thumbnail: d.thumbnail || '',
        url: d.webpage_url || url
      });
    } catch {
      res.status(500).json({ error: 'Parse error' });
    }
  });
});

// 4. Stream or Download Video (1080p/720p/480p/360p) or Extract Audio (MP3/M4A)
app.get('/api/stream', (req, res) => {
  const { url, mode = 'video', quality = '720' } = req.query;
  if (!url) return res.status(400).send('Missing url');

  if (mode === 'audio') {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');

    const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio/best', '-o', '-', '--no-playlist', url]);
    const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1']);

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    req.on('close', () => {
      ytdlp.kill('SIGKILL');
      ffmpeg.kill('SIGKILL');
    });
  } else {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

    const formatSelector = `best[height<=${quality}][ext=mp4]/best[ext=mp4]/best`;
    const ytdlp = spawn('yt-dlp', ['-f', formatSelector, '-o', '-', '--no-playlist', url]);

    ytdlp.stdout.pipe(res);
    req.on('close', () => ytdlp.kill('SIGKILL'));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
