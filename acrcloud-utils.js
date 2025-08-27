const axios = require('axios');
require('dotenv').config();

const ACRCLOUD_TOKEN = process.env.ACRCLOUD_BEARER_TOKEN; // Your Bearer token from .env
const REGION = process.env.ACRCLOUD_REGION || 'eu-west-1'; // Example: 'eu-west-1'
const CONTAINER_ID = process.env.ACRCLOUD_CONTAINER_ID;    // Your container ID

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
 * Get the music recognition result for a file in AcrCloud FS Container.
 * @param {string} fileId - The file id returned from upload.
 * @returns {Promise<object|null>} - The results object containing recognized music.
 */
async function getAcrCloudFileResult(fileId) {
  const endpoint = `https://api-${REGION}.acrcloud.com/api/fs-containers/${CONTAINER_ID}/files/${fileId}`;
  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${ACRCLOUD_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    const file = response.data.data;
    console.log("🎵 Music Recognition Result for:", file.name);
    if (file.results && file.results.music && file.results.music.length > 0) {
      file.results.music.forEach((track, idx) => {
        const res = track.result;
        console.log(`${idx+1}. Title: ${res.title}`);
        console.log(`   Artists: ${res.artists.map(a => a.name).join(", ")}`);
        if (res.external_metadata && res.external_metadata.spotify) {
          console.log(`   Spotify: https://open.spotify.com/track/${res.external_metadata.spotify.track.id}`);
        }
        if (res.external_metadata && res.external_metadata.deezer) {
          console.log(`   Deezer: https://www.deezer.com/track/${res.external_metadata.deezer.track.id}`);
        }
        if (res.external_metadata && res.external_metadata.youtube) {
          console.log(`   YouTube: https://www.youtube.com/watch?v=${res.external_metadata.youtube.vid}`);
        }
      });
    } else {
      console.log("No music found in this video.");
    }
    return file.results;
  } catch (err) {
    console.error("AcrCloud Get Result Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Recognize music from a YouTube video URL using AcrCloud FS Container workflow.
 * Uploads video, polls for result, prints recognized music URLs.
 * @param {string} youtubeUrl - The YouTube video URL.
 * @param {string} [name] - Optional name for the file.
 */
async function recognizeMusicFromYouTube(youtubeUrl, name) {
  // Upload to AcrCloud
  const uploadResult = await uploadYouTubeToAcrCloud(youtubeUrl, name);
  if (!uploadResult || !uploadResult.id) {
    console.log("❌ Upload failed or no file ID received.");
    return false;
  }

  let tries = 0;
  while (tries < 20) {
    await new Promise(res => setTimeout(res, 5000)); // Wait 5 seconds
    const file = await getAcrCloudFileStatus(uploadResult.id); // <-- returns file.status and results
    if (!file) {
      console.log("Error fetching file status.");
      return false;
    }

    // Print status each poll
    const statusText = file.state === 0 ? "Processing" :
                       file.state === 1 ? "Ready" :
                       file.state === -1 ? "No results" : `Error (${file.state})`;
    process.stdout.write(`Polling attempt ${tries + 1}, state: ${statusText}\r`);

    // If still processing, keep polling
    if (file.state === 0) {
      tries++;
      continue;
    }

    // If ready, print music info (if any)
    if (file.state === 1) {
      console.log(`\n🎵 Music Recognition Result for: ${name}`);
      if (file.results && file.results.music && file.results.music.length > 0) {
        file.results.music.forEach((track, idx) => {
          const res = track.result;
          console.log(`${idx + 1}. Title: ${res.title}`);
          console.log(`   Artists: ${res.artists.map(a => a.name).join(", ")}`);
          console.log(`   ISRC: ${res.external_ids?.isrc || "N/A"}`);
          // ...print more metadata as needed
        });
        return true;
      } else {
        console.log("No music found in this video.");
        return false;
      }
    }

    // If no results or error, break
    if (file.state === -1) {
      console.log("\n❌ No music found in this video.");
      return false;
    }
    if (file.state < 0) {
      console.log(`\n❌ Error processing video. State: ${file.state}`);
      return false;
    }
    tries++;
  }
  console.log("\n❌ Timed out polling for results.");
  return false;
}
module.exports = {
  uploadYouTubeToAcrCloud,
  getAcrCloudFileResult,
  recognizeMusicFromYouTube,
};