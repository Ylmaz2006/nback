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
    const response = await axios.get(url, { params });
    
    const videos = response.data.items.map(item => ({
      title: item.snippet.title,
      videoId: item.id.videoId,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails.default.url,
      description: item.snippet.description
    }));

    return {
      videos,
      nextPageToken: response.data.nextPageToken || null,
      totalResults: response.data.pageInfo.totalResults
    };
  } catch (error) {
    console.error('YouTube Search Error:', error.message);
    return {
      videos: [],
      nextPageToken: null,
      totalResults: 0
    };
  }
}

// 🆕 NEW: Advanced search with fallback system
async function searchYouTubeWithFallback(query, musicGenerationFunction, maxBatches = 3) {
  let currentPageToken = null;
  let batchNumber = 1;
  let totalVideosSearched = 0;
  let allFailedVideos = [];

  console.log('🎯 ===============================================');
  console.log('🎯 YOUTUBE SEARCH WITH FALLBACK SYSTEM');
  console.log('🎯 ===============================================');
  console.log(`🔍 Query: "${query}"`);
  console.log(`📊 Max batches: ${maxBatches}`);
  console.log(`📋 Videos per batch: 5`);

  while (batchNumber <= maxBatches) {
    try {
      console.log(`\n🔄 ===============================================`);
      console.log(`🔄 BATCH ${batchNumber}/${maxBatches}`);
      console.log(`🔄 ===============================================`);

      // Search for videos in current batch
      const searchResult = await searchYouTubeVideos(query, 5, currentPageToken);
      
      if (!searchResult.videos || searchResult.videos.length === 0) {
        console.log('❌ No more videos found in search results');
        break;
      }

      console.log(`📹 Found ${searchResult.videos.length} videos in batch ${batchNumber}`);
      totalVideosSearched += searchResult.videos.length;

      // Try each video in the current batch
      for (let i = 0; i < searchResult.videos.length; i++) {
        const video = searchResult.videos[i];
        const videoNumber = i + 1;
        
        console.log(`\n🎵 ===============================================`);
        console.log(`🎵 TRYING VIDEO ${videoNumber}/5 (Batch ${batchNumber})`);
        console.log(`🎵 ===============================================`);
        console.log(`📹 Title: ${video.title}`);
        console.log(`🔗 URL: ${video.url}`);

        try {
          // Attempt music generation for this video
          console.log(`🎼 Attempting music generation...`);
          const musicResult = await musicGenerationFunction(video);

          if (musicResult && musicResult.success) {
            console.log('✅ SUCCESS! Music generated successfully!');
            console.log(`📊 Total videos searched: ${totalVideosSearched}`);
            console.log(`📊 Successful on video ${videoNumber} of batch ${batchNumber}`);
            
            return {
              success: true,
              video: video,
              musicResult: musicResult,
              searchStats: {
                totalVideosSearched,
                batchNumber,
                videoInBatch: videoNumber,
                failedVideos: allFailedVideos.length
              }
            };
          } else {
            console.log(`❌ Music generation failed for: ${video.title}`);
            allFailedVideos.push({
              ...video,
              batch: batchNumber,
              position: videoNumber,
              error: musicResult?.error || 'Unknown error'
            });
          }

        } catch (videoError) {
          console.error(`❌ Error processing video: ${videoError.message}`);
          allFailedVideos.push({
            ...video,
            batch: batchNumber,
            position: videoNumber,
            error: videoError.message
          });
        }

        // Add delay between video attempts
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Move to next batch if available
      if (searchResult.nextPageToken && batchNumber < maxBatches) {
        currentPageToken = searchResult.nextPageToken;
        batchNumber++;
        console.log(`\n⏭️ Moving to next batch (${batchNumber})...`);
        
        // Add delay between batches
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log(`\n🛑 No more pages available or reached max batches`);
        break;
      }

    } catch (batchError) {
      console.error(`❌ Error in batch ${batchNumber}:`, batchError.message);
      break;
    }
  }

  // If we reach here, all videos failed
  console.log('\n❌ ===============================================');
  console.log('❌ ALL VIDEOS FAILED');
  console.log('❌ ===============================================');
  console.log(`📊 Total videos searched: ${totalVideosSearched}`);
  console.log(`📊 Total batches tried: ${batchNumber - 1}`);
  console.log(`📊 Failed videos: ${allFailedVideos.length}`);

  return {
    success: false,
    error: 'No suitable videos found for music generation',
    searchStats: {
      totalVideosSearched,
      batchesTried: batchNumber - 1,
      failedVideos: allFailedVideos
    },
    failedVideos: allFailedVideos
  };
}

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
  downloadYouTubeAudio, 
  searchYouTubeWithFallback,  // 🆕 NEW
  getVideoInfo                // 🆕 NEW
};