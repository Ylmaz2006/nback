const axios = require('axios');
const ytdl = require('ytdl-core');
const fs = require('fs').promises;
const path = require('path');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

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
// 🆕 NEW: Search with pagination support
async function searchYouTubeVideos(query, maxResults = 5, pageToken = null) {
  const url = `https://www.googleapis.com/youtube/v3/search`;
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults,
    order: 'relevance',
    videoDuration: 'medium',
    key: YOUTUBE_API_KEY
  };

  // Add pagination token if provided
  if (pageToken) {
    params.pageToken = pageToken;
  }

  try {
    console.log(`🔍 Searching YouTube: "${query}" (Page: ${pageToken || 'first'})`);
    
    if (!YOUTUBE_API_KEY) {
      console.warn('⚠️ YouTube API key not configured');
      return []; // Return empty array instead of object
    }
    
    const response = await axios.get(url, { params });
    
    if (!response.data || !response.data.items) {
      console.warn('⚠️ YouTube API returned no items');
      return []; // Return empty array
    }
    
    const videos = response.data.items.map(item => ({
      title: item.snippet.title,
      videoId: item.id.videoId,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails.default.url,
      description: item.snippet.description
    }));

    console.log(`✅ YouTube search found ${videos.length} videos`);
    return videos; // Return array directly (not object)
    
  } catch (error) {
    console.error('❌ YouTube Search Error:', error.message);
    if (error.response?.status === 403) {
      console.error('❌ YouTube API quota exceeded or invalid key');
    }
    return []; // Always return empty array on error
  }
}

// 🆕 NEW: Advanced search with fallback system

// 🆕 NEW: Helper function to extract video info
async function getVideoInfo(videoUrl) {
  try {
    const videoId = ytdl.getVideoID(videoUrl);
    const info = await ytdl.getInfo(videoId);
    
    return {
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds),
      description: info.videoDetails.description,
      author: info.videoDetails.author.name,
      viewCount: parseInt(info.videoDetails.viewCount)
    };
  } catch (error) {
    console.error('Error getting video info:', error.message);
    return null;
  }
}
module.exports = { 
  searchYouTubeVideos, 
  downloadYouTubeAudio, getVideoInfo
};