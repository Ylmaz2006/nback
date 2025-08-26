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

module.exports = { searchYouTubeVideos };