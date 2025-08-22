const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

router.post('/generate-thumbnails', upload.single('video'), (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join(__dirname, '../public/thumbnails');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  ffmpeg(inputPath)
    .on('end', () => {
      fs.unlinkSync(inputPath); // Clean up original upload
      res.json({ message: 'Thumbnails generated.' });
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err);
      res.status(500).json({ error: 'Thumbnail generation failed' });
    })
    .screenshots({
      count: 20,
      folder: outputDir,
      filename: 'thumb_%i.jpg',
      size: '320x180',
    });
});

module.exports = router;
