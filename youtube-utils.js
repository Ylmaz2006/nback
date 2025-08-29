const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

/**
 * Parse YouTube URL and extract timing parameters
 * @param {string} youtubeUrl - YouTube URL to parse
 * @returns {Object} - Parsed URL information with timing
 */
function parseYouTubeUrl(youtubeUrl) {
  if (!youtubeUrl || typeof youtubeUrl !== 'string') {
    return {
      isValid: false,
      error: 'Invalid YouTube URL provided'
    };
  }

  try {
    const url = new URL(youtubeUrl);
    let videoId = null;
    let timingSeconds = null;
    let originalUrl = youtubeUrl;
    let normalizedUrl = null;

    // Handle different YouTube URL formats
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
      // Standard format: https://www.youtube.com/watch?v=VIDEO_ID
      videoId = url.searchParams.get('v');
      
      // Check for timing parameter
      const timeParam = url.searchParams.get('t');
      if (timeParam) {
        timingSeconds = parseYouTubeTimeParam(timeParam);
      }
    } else if (url.hostname === 'youtu.be') {
      // Short format: https://youtu.be/VIDEO_ID?t=timing
      videoId = url.pathname.slice(1); // Remove leading '/'
      
      // Check for timing parameter
      const timeParam = url.searchParams.get('t');
      if (timeParam) {
        timingSeconds = parseYouTubeTimeParam(timeParam);
      }
    } else {
      return {
        isValid: false,
        error: 'URL is not a valid YouTube URL'
      };
    }

    if (!videoId) {
      return {
        isValid: false,
        error: 'Could not extract video ID from YouTube URL'
      };
    }

    // Create normalized URL without timing parameters
    normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Create URL with timing if specified
    let urlWithTiming = normalizedUrl;
    if (timingSeconds !== null && timingSeconds >= 0) {
      urlWithTiming = `${normalizedUrl}&t=${timingSeconds}s`;
    }

    return {
      isValid: true,
      videoId: videoId,
      originalUrl: originalUrl,
      normalizedUrl: normalizedUrl,
      urlWithTiming: urlWithTiming,
      timingSeconds: timingSeconds,
      hasTimingParameter: timingSeconds !== null,
      formattedTiming: timingSeconds !== null ? formatSecondsToTime(timingSeconds) : null
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Failed to parse YouTube URL: ${error.message}`
    };
  }
}

/**
 * Parse YouTube timing parameter into seconds
 * @param {string} timeParam - Time parameter from URL (e.g., "123", "123s", "2m30s")
 * @returns {number|null} - Time in seconds or null if invalid
 */
function parseYouTubeTimeParam(timeParam) {
  if (!timeParam || typeof timeParam !== 'string') {
    return null;
  }

  timeParam = timeParam.trim();

  // Handle direct seconds (just numbers)
  if (/^\d+$/.test(timeParam)) {
    const seconds = parseInt(timeParam, 10);
    return isNaN(seconds) ? null : seconds;
  }

  // Handle seconds with 's' suffix (e.g., "123s")
  if (/^\d+s$/i.test(timeParam)) {
    const seconds = parseInt(timeParam.slice(0, -1), 10);
    return isNaN(seconds) ? null : seconds;
  }

  // Handle minutes and seconds (e.g., "2m30s", "1m", "30s")
  const timeMatch = timeParam.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1] || '0', 10);
    const minutes = parseInt(timeMatch[2] || '0', 10);
    const seconds = parseInt(timeMatch[3] || '0', 10);
    
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return null;
    }
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Handle MM:SS or HH:MM:SS format
  const colonTimeMatch = timeParam.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (colonTimeMatch) {
    const hours = parseInt(colonTimeMatch[1] || '0', 10);
    const minutes = parseInt(colonTimeMatch[2], 10);
    const seconds = parseInt(colonTimeMatch[3], 10);
    
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return null;
    }
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null; // Couldn't parse timing parameter
}

/**
 * Format seconds into human-readable time string
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time string (e.g., "2m30s", "1h5m", "45s")
 */
function formatSecondsToTime(seconds) {
  if (typeof seconds !== 'number' || seconds < 0 || isNaN(seconds)) {
    return '0s';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  let result = '';

  if (hours > 0) {
    result += `${hours}h`;
  }

  if (minutes > 0) {
    result += `${minutes}m`;
  }

  if (remainingSeconds > 0 || result === '') {
    result += `${remainingSeconds}s`;
  }

  return result;
}

/**
 * Create YouTube URL with specific timing
 * @param {string} videoId - YouTube video ID
 * @param {number} timingSeconds - Time in seconds
 * @returns {string} - YouTube URL with timing parameter
 */
function createYouTubeUrlWithTiming(videoId, timingSeconds = null) {
  if (!videoId) {
    throw new Error('Video ID is required');
  }

  let url = `https://www.youtube.com/watch?v=${videoId}`;
  
  if (timingSeconds !== null && timingSeconds >= 0) {
    url += `&t=${timingSeconds}s`;
  }

  return url;
}

/**
 * Validate and normalize YouTube URLs with timing parameters
 * @param {string[]} youtubeUrls - Array of YouTube URLs
 * @returns {Object[]} - Array of parsed and normalized URL objects
 */
function validateAndNormalizeYouTubeUrls(youtubeUrls) {
  if (!Array.isArray(youtubeUrls)) {
    return [];
  }

  return youtubeUrls.map((url, index) => {
    const parsed = parseYouTubeUrl(url);
    return {
      index: index,
      originalUrl: url,
      ...parsed
    };
  }).filter(item => item.isValid); // Only return valid URLs
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

module.exports = { 
  searchYouTubeVideos,
  parseYouTubeUrl,
  parseYouTubeTimeParam,
  formatSecondsToTime,
  createYouTubeUrlWithTiming,
  validateAndNormalizeYouTubeUrls
};