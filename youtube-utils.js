const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // Store your key in env!

async function searchYouTubeVideos(query, maxResults = 7) {
  const url = `https://www.googleapis.com/youtube/v3/search`;
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults,
    order: 'viewCount',    // <--- This gets videos by view count
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
async function recognizeYouTubeMusic(youtubeUrl) {
  const acrHost = process.env.ACRCLOUD_HOST;
  const acrKey = process.env.ACRCLOUD_ACCESS_KEY;
  const acrSecret = process.env.ACRCLOUD_ACCESS_SECRET;

  const endpoint = `https://${acrHost}/v1/identify`;

  // You need to generate a signature for AcrCloud
  const crypto = require('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = ['POST', endpoint, acrKey, 'audio', timestamp].join('\n');
  const signature = crypto.createHmac('sha1', acrSecret).update(stringToSign).digest('base64');

  const data = {
    url: youtubeUrl
  };

  try {
    const response = await axios.post(endpoint, data, {
      headers: {
        'access-key': acrKey,
        'signature': signature,
        'timestamp': timestamp,
        'Content-Type': 'application/json'
      }
    });
    console.log('AcrCloud Output:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    console.error('AcrCloud Error:', err.response?.data || err.message);
    return null;
  }
}
module.exports = { searchYouTubeVideos , recognizeYouTubeMusic };