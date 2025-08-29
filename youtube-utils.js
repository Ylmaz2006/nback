const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
// Add this to your youtube-utils.js file:

const ytdl = require('ytdl-core'); // npm install ytdl-core
const fs = require('fs').promises;
const path = require('path');

async function downloadYouTubeAudio(youtubeUrl) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🎵 Starting YouTube audio download:', youtubeUrl);
      
      const tempAudioPath = path.join(__dirname, 'temp_videos', `youtube_audio_${Date.now()}.mp3`);
      const audioStream = ytdl(youtubeUrl, {
        filter: 'audioonly',
        quality: 'highestaudio',
        format: 'mp3'
      });
      
      const writeStream = require('fs').createWriteStream(tempAudioPath);
      
      audioStream.pipe(writeStream);
      
      audioStream.on('error', (error) => {
        console.error('❌ YouTube download error:', error.message);
        reject(error);
      });
      
      writeStream.on('finish', async () => {
        try {
          // Read the file as buffer
          const audioBuffer = await fs.readFile(tempAudioPath);
          
          console.log('✅ YouTube audio download completed');
          console.log('📊 File size:', (audioBuffer.length / 1024 / 1024).toFixed(2), 'MB');
          
          resolve({
            buffer: audioBuffer,
            filePath: tempAudioPath
          });
          
        } catch (readError) {
          reject(readError);
        }
      });
      
      writeStream.on('error', (error) => {
        console.error('❌ Write stream error:', error.message);
        reject(error);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

async function searchYouTubeVideos(query, maxResults = 7) {
  const url = `https://www.googleapis.com/youtube/v3/search`;
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults,
    order: 'relevance',         // Most relevant videos
    videoDuration: 'medium',    // Only videos between 4 and 20 mins
    key: YOUTUBE_API_KEY
  };

  try {
    const response = await axios.get(url, { params });
    return response.data.items.map(item => ({
      title: item.snippet.title,
      videoId: item.id.videoId,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails.default.url,
      description: item.snippet.description
    }));
  } catch (error) {
    console.error('YouTube Search Error:', error.message);
    return [];
  }
}

module.exports = { searchYouTubeVideos, downloadYouTubeAudio};