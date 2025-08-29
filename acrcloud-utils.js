const axios = require('axios');
require('dotenv').config();

const ACRCLOUD_TOKEN = process.env.ACRCLOUD_BEARER_TOKEN;
const REGION = process.env.ACRCLOUD_REGION || 'eu-west-1';
const CONTAINER_ID = process.env.ACRCLOUD_CONTAINER_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

/**
 * Upload a YouTube URL to AcrCloud FS Container for music recognition.
 */
async function uploadYouTubeToAcrCloud(youtubeUrl, name) {
  const endpoint = `https://api-${REGION}.acrcloud.com/api/fs-containers/${CONTAINER_ID}/files`;
  const body = {
    data_type: "platforms",
    url: youtubeUrl,
    name: name || youtubeUrl,
  };
  try {
    const response = await axios.post(endpoint, body, {
      headers: {
        'Authorization': `Bearer ${ACRCLOUD_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    console.log("📤 Uploaded to AcrCloud:", response.data.data);
    return response.data.data;
  } catch (err) {
    console.error("AcrCloud Upload Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Get music recognition results from AcrCloud FS Container.
 */
async function getAcrCloudFileStatus(fileId) {
  const endpoint = `https://api-${REGION}.acrcloud.com/api/fs-containers/${CONTAINER_ID}/files/${fileId}`;
  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${ACRCLOUD_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    return response.data.data;
  } catch (err) {
    console.error("AcrCloud File Status Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * YouTube search: "artist - song" and get the most relevant video (first result).
 */
async function searchYouTubeMostRelevant(artist, songTitle) {
  const endpoint = `https://www.googleapis.com/youtube/v3/search`;
  const query = `${artist} - ${songTitle}`;
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: 1,
    key: YOUTUBE_API_KEY,
    order: 'relevance'
  };
  try {
    const url = endpoint + '?' + new URLSearchParams(params).toString();
    const response = await axios.get(url);
    const items = response.data.items;
    if (!items || items.length === 0) return null;
    // Return the first (most relevant) video's URL
    return `https://www.youtube.com/watch?v=${items[0].id.videoId}`;
  } catch (err) {
    console.error("YouTube Search Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Print music title, artist and the most relevant YouTube video.
 */
async function printAcrCloudMusic(fileArray) {
  const detectedSongs = [];
  
  for (const file of fileArray) {
    if (file.results && file.results.music && Array.isArray(file.results.music)) {
      for (const song of file.results.music) {
        const songTitle = song.title || 'Unknown';
        const artistName = song.artists ? song.artists.map(a => a.name).join(', ') : 'Unknown';
        
        console.log(`🎵 Song Name: ${songTitle}`);
        console.log(`🎤 Artist(s): ${artistName}`);
        
        // Search YouTube for this song
        try {
          const { searchYouTubeVideos } = require('./youtube-utils');
          const searchQuery = `${songTitle} ${artistName}`;
          const songSearchResults = await searchYouTubeVideos(searchQuery, 1);
          
          if (songSearchResults && songSearchResults.length > 0) {
            const songYouTubeUrl = songSearchResults[0].url;
            console.log(`🔗 Most Relevant YouTube Video: ${songYouTubeUrl}`);
            
            detectedSongs.push({
              title: `${songTitle} - ${artistName}`,
              url: songYouTubeUrl,
              artist: artistName,
              songTitle: songTitle,
              duration: song.duration_ms ? Math.round(song.duration_ms / 1000) : null
            });
          }
        } catch (error) {
          console.error(`❌ Error searching for ${songTitle}:`, error.message);
        }
      }
    }
  }
  
  return detectedSongs;
}
/**
 * Recognize music from a YouTube video URL using AcrCloud FS Container workflow.
 * Uploads video, polls for result, prints recognized music name, artist, and YouTube video.
 */
async function recognizeMusicFromYouTube(youtubeUrl, name) {
  const uploadResult = await uploadYouTubeToAcrCloud(youtubeUrl, name);
  if (!uploadResult || !uploadResult.id) {
    console.log("❌ Upload failed or no file ID received.");
    return { success: false, detectedSongs: [] };
  }

  let tries = 0;
  let foundMusic = false;
  let detectedSongs = [];
  
  while (tries < 20) {
    await new Promise(res => setTimeout(res, 5000));
    const fileArray = await getAcrCloudFileStatus(uploadResult.id);
    if (!fileArray || !Array.isArray(fileArray) || fileArray.length === 0) {
      console.log("Error fetching file status or empty file array.");
      return { success: false, detectedSongs: [] };
    }
    if (tries === 0) console.log("DEBUG raw file response:", JSON.stringify(fileArray, null, 2));
    const file = fileArray[0];
    const state = file.state;
    const statusText = state === 0 ? "Processing" :
                       state === 1 ? "Ready" :
                       state === -1 ? "No results" :
                       state === undefined ? "Unknown" : `Error (${state})`;
    process.stdout.write(`Polling attempt ${tries + 1}, state: ${statusText}\r`);
    
    if (file.results && Array.isArray(file.results.music) && file.results.music.length > 0) {
      foundMusic = true;
      console.log(""); // newline after polling
      
      // Extract detected songs and search for YouTube URLs
      for (const song of file.results.music) {
        const songTitle = song.title || 'Unknown';
        const artistName = song.artists ? song.artists.map(a => a.name).join(', ') : 'Unknown';
        
        console.log(`🎵 Song Name: ${songTitle}`);
        console.log(`🎤 Artist(s): ${artistName}`);
        
        // Search YouTube for this specific song
        try {
          const { searchYouTubeVideos } = require('./youtube-utils');
          const searchQuery = `${songTitle} ${artistName}`;
          console.log(`🔍 Searching YouTube for: "${searchQuery}"`);
          
          const songSearchResults = await searchYouTubeVideos(searchQuery, 1);
          
          if (songSearchResults && songSearchResults.length > 0) {
            const songYouTubeUrl = songSearchResults[0].url;
            
            detectedSongs.push({
              title: `${songTitle} - ${artistName}`,
              url: songYouTubeUrl,
              artist: artistName,
              songTitle: songTitle,
              duration: song.duration_ms ? Math.round(song.duration_ms / 1000) : null
            });
            
            console.log(`🔗 Most Relevant YouTube Video: ${songYouTubeUrl}`);
          } else {
            console.log(`❌ No YouTube video found for: ${searchQuery}`);
          }
          
        } catch (searchError) {
          console.error(`❌ Error searching YouTube for ${songTitle}:`, searchError.message);
        }
      }
      
      await printAcrCloudMusic(fileArray); // Keep original printing
      
      return { success: true, detectedSongs: detectedSongs };
    }
    
    if (state === 1) {
      if (!foundMusic) {
        console.log("\nNo music found in this video.");
        return { success: false, detectedSongs: [] };
      }
    }
    if (state === -1) {
      console.log("\n❌ No music found in this video.");
      return { success: false, detectedSongs: [] };
    }
    if (state < 0) {
      console.log(`\n❌ Error processing video. State: ${state}`);
      return { success: false, detectedSongs: [] };
    }
    tries++;
  }
  console.log("\n❌ Timed out polling for results.");
  return { success: false, detectedSongs: [] };
}
module.exports = {
  uploadYouTubeToAcrCloud,
  getAcrCloudFileStatus,
  printAcrCloudMusic,
  recognizeMusicFromYouTube,
  searchYouTubeMostRelevant,
};