const axios = require('axios');
require('dotenv').config();

const ACRCLOUD_TOKEN = process.env.ACRCLOUD_BEARER_TOKEN; // Your Bearer token from .env
const REGION = process.env.ACRCLOUD_REGION || 'eu-west-1'; // Example: 'eu-west-1'
const CONTAINER_ID = process.env.ACRCLOUD_CONTAINER_ID;    // Your container ID
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;       // Your YouTube API key

/**
 * Upload a YouTube URL to AcrCloud FS Container for music recognition.
 * @param {string} youtubeUrl - The YouTube video URL.
 * @param {string} [name] - Optional name for the file.
 * @returns {Promise<object|null>} - The upload result containing file id, uri, etc.
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
    return response.data.data; // Contains id, uri, etc.
  } catch (err) {
    console.error("AcrCloud Upload Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Get the music recognition results for a file in AcrCloud FS Container.
 * Returns the array of file info objects.
 * @param {string} fileId - The file id returned from upload.
 * @returns {Promise<object[]|null>} - The array of file info objects.
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
    return response.data.data; // Should be an array
  } catch (err) {
    console.error("AcrCloud File Status Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * YouTube search by song title and artist, returns the most viewed video URL.
 * @param {string} query - Song and artist query.
 * @returns {Promise<string|null>} - YouTube video URL or null.
 */
async function searchYouTubeMostViewed(query) {
  const endpoint = `https://www.googleapis.com/youtube/v3/search`;
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: 5,
    key: YOUTUBE_API_KEY,
    order: 'viewCount'
  };
  try {
    const url = endpoint + '?' + new URLSearchParams(params).toString();
    const response = await axios.get(url);
    const items = response.data.items;
    if (!items || items.length === 0) return null;
    // Return most viewed video's URL
    return `https://www.youtube.com/watch?v=${items[0].id.videoId}`;
  } catch (err) {
    console.error("YouTube Search Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Print music title and artist(s) and show YouTube most viewed video for the recognized song.
 * @param {object[]} fileArray - The array of file info objects.
 * @returns {Promise<boolean>} - True if music found, false otherwise.
 */
async function printAcrCloudMusic(fileArray) {
  if (!Array.isArray(fileArray) || fileArray.length === 0) {
    console.log("No file data received.");
    return false;
  }
  const file = fileArray[0];
  if (file.state !== 1) {
    console.log("File not ready for music results. State:", file.state);
    return false;
  }
  if (file.results && Array.isArray(file.results.music) && file.results.music.length > 0) {
    for (const track of file.results.music) {
      const res = track.result;
      const artists = res.artists.map(a => a.name).join(", ");
      const songTitle = res.title;
      console.log(`🎵 Song Name: ${songTitle}`);
      console.log(`🎤 Artist(s): ${artists}`);
      // Search YouTube for the most viewed video
      const ytQuery = `${songTitle} ${artists}`;
      const mostViewedUrl = await searchYouTubeMostViewed(ytQuery);
      if (mostViewedUrl) {
        console.log(`🔥 Most Viewed YouTube Video: ${mostViewedUrl}`);
      } else {
        console.log("No YouTube video found for this song/artist.");
      }
    }
    return true;
  } else {
    console.log("No music found in this video.");
    return false;
  }
}

/**
 * Recognize music from a YouTube video URL using AcrCloud FS Container workflow.
 * Uploads video, polls for result, prints recognized music name, artist, and YouTube video.
 * @param {string} youtubeUrl - The YouTube video URL.
 * @param {string} [name] - Optional name for the file.
 */
async function recognizeMusicFromYouTube(youtubeUrl, name) {
  const uploadResult = await uploadYouTubeToAcrCloud(youtubeUrl, name);
  if (!uploadResult || !uploadResult.id) {
    console.log("❌ Upload failed or no file ID received.");
    return false;
  }

  let tries = 0;
  let foundMusic = false;
  while (tries < 20) {
    await new Promise(res => setTimeout(res, 5000));
    const fileArray = await getAcrCloudFileStatus(uploadResult.id);
    if (!fileArray || !Array.isArray(fileArray) || fileArray.length === 0) {
      console.log("Error fetching file status or empty file array.");
      return false;
    }

    // Always print debug response for inspection
    if (tries === 0) console.log("DEBUG raw file response:", JSON.stringify(fileArray, null, 2));

    const file = fileArray[0];
    const state = file.state;
    const statusText = state === 0 ? "Processing" :
                       state === 1 ? "Ready" :
                       state === -1 ? "No results" :
                       state === undefined ? "Unknown" : `Error (${state})`;
    process.stdout.write(`Polling attempt ${tries + 1}, state: ${statusText}\r`);

    // Check for music results ANYTIME they're present
    if (file.results && Array.isArray(file.results.music) && file.results.music.length > 0) {
      foundMusic = true;
      console.log(""); // newline after polling
      await printAcrCloudMusic(fileArray);
      return true; // Music found, exit polling
    }

    if (state === 1) {
      // If ready but no music, only then print "No music found"
      if (!foundMusic) {
        console.log("\nNo music found in this video.");
        return false;
      }
    }
    if (state === -1) {
      console.log("\n❌ No music found in this video.");
      return false;
    }
    if (state < 0) {
      console.log(`\n❌ Error processing video. State: ${state}`);
      return false;
    }
    tries++;
  }
  console.log("\n❌ Timed out polling for results.");
  return false;
}

module.exports = {
  uploadYouTubeToAcrCloud,
  getAcrCloudFileStatus,
  printAcrCloudMusic,
  recognizeMusicFromYouTube,
  searchYouTubeMostViewed,
};