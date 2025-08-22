const axios = require('axios');

// Use your existing API configuration
const MUSICGPT_API_BASE = 'https://api.musicgpt.com/api/public/v1';
const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

// ✅ EXISTING FUNCTION - Keep as is for backward compatibility
async function generateMusicWithMusicGPT({ prompt, genre, videoUrl, duration = 30 }) {
  try {
    console.log('🎼 ===============================================');
    console.log('🎼 CALLING MUSICGPT API');
    console.log('🎼 ===============================================');
    console.log('📝 Prompt length:', prompt.length, 'characters');
    console.log('🎭 Genre:', genre);
    console.log('⏱️ Duration:', duration, 'seconds');
    
    if (!MUSICGPT_API_KEY) {
      throw new Error('MUSICGPT_API_KEY not configured');
    }

    const requestData = {
      prompt: prompt,
      duration: duration,
      genre: genre || 'cinematic',
      format: 'mp3',
      quality: 'high'
    };

    console.log('📤 Sending request to MusicGPT...');
    const startTime = Date.now();

    const response = await axios.post(`${MUSICGPT_API_BASE}/generate`, requestData, {
      headers: {
        'Authorization': `Bearer ${MUSICGPT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5 * 60 * 1000 // 5 minutes
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ ===============================================');
    console.log('✅ MUSICGPT RESPONSE RECEIVED');
    console.log('✅ ===============================================');
    console.log('⏱️ Processing time:', processingTime + 's');
    console.log('📊 Status:', response.status);

    if (response.data && (response.data.audio_url || response.data.url)) {
      const audioUrl = response.data.audio_url || response.data.url;
      console.log('🎶 GENERATED MUSIC URL:', audioUrl);
      console.log('🎵 Duration:', response.data.duration || duration);
      
      return {
        success: true,
        audioUrl: audioUrl,
        duration: response.data.duration || duration,
        trackId: response.data.id || null,
        processingTime: processingTime
      };
    } else {
      throw new Error('No audio URL in response');
    }

  } catch (err) {
    console.error('❌ ===============================================');
    console.error('❌ MUSICGPT API ERROR');
    console.error('❌ ===============================================');
    console.error('💥 Error:', err.message);
    
    if (err.response) {
      console.error('📊 Status:', err.response.status);
      console.error('📊 Data:', err.response.data);
    }

    return {
      success: false,
      error: err.message,
      details: err.response?.data
    };
  }
}

// ✅ NEW FUNCTION: Generate music using dual-output format (prompt + music_style)
async function generateMusicWithDualOutput({ prompt, music_style, genre, duration = 30, trackName = null }) {
  try {
    console.log('🎼 ===============================================');
    console.log('🎼 CALLING MUSICGPT API WITH DUAL OUTPUTS');
    console.log('🎼 ===============================================');
    console.log('📝 Visual Prompt:', prompt.substring(0, 100) + '...');
    console.log('🎵 Music Style:', music_style.substring(0, 100) + '...');
    console.log('🎭 Genre:', genre);
    console.log('⏱️ Duration:', duration, 'seconds');
    console.log('🎶 Track Name:', trackName || 'Generated Track');
    
    if (!MUSICGPT_API_KEY) {
      throw new Error('MUSICGPT_API_KEY not configured');
    }

    // 🚨 NEW: Use the correct MusicGPT API format for dual outputs
    const requestData = {
      prompt: prompt,           // Visual description (from detailed_description line 1)
      music_style: music_style, // Musical specifications (from detailed_description line 2)
      make_instrumental: true,  // Ensure instrumental
      vocal_only: false,        // No vocals
      webhook_url: "	https://webhook.site/f607d31a-bd7b-4aaa-8f4e-43772fe2db52" // For async processing
    };

    console.log('📤 Sending dual-output request to MusicGPT...');
    console.log('🔗 Using MusicAI endpoint for dual format...');
    const startTime = Date.now();

    // 🚨 IMPORTANT: Use the MusicAI endpoint which supports dual-output format
    const response = await axios.post(`${MUSICGPT_API_BASE}/MusicAI`, requestData, {
      headers: {
        'accept': 'application/json',
        'Authorization': MUSICGPT_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 2 * 60 * 1000 // 2 minutes timeout for initial response
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ ===============================================');
    console.log('✅ MUSICGPT DUAL-OUTPUT RESPONSE RECEIVED');
    console.log('✅ ===============================================');
    console.log('⏱️ Processing time:', processingTime + 's');
    console.log('📊 Status:', response.status);
    console.log('📄 Response keys:', Object.keys(response.data));

    const musicData = response.data;

    if (musicData.audio_url || musicData.conversion_path) {
      // 🎉 Music generated immediately
      const audioUrl = musicData.audio_url || musicData.conversion_path;
      console.log('🎶 IMMEDIATE MUSIC URL:', audioUrl);
      
      return {
        success: true,
        status: 'completed_immediately',
        audioUrl: audioUrl,
        audio_url: audioUrl, // For compatibility
        url: audioUrl,       // For compatibility
        duration: musicData.conversion_duration || musicData.duration || duration,
        title: trackName || musicData.title || 'Generated Track',
        trackId: musicData.task_id || musicData.conversion_id || null,
        processingTime: processingTime,
        generationMethod: 'musicgpt_dual_output_immediate'
      };
    } else if (musicData.task_id || musicData.conversion_id || musicData.conversion_id_1) {
      // 🔄 Music generation started - return task info for webhook monitoring
      const taskId = musicData.task_id || musicData.conversion_id_1 || musicData.conversion_id;
      console.log('🔄 MUSIC GENERATION STARTED - Task ID:', taskId);
      console.log('⏰ ETA:', musicData.eta || 120, 'seconds');
      
      return {
        success: true,
        status: 'processing_async',
        taskId: taskId,
        task_id: taskId, // For compatibility
        eta: musicData.eta || 120,
        processingTime: processingTime,
        message: 'Music generation started, use webhook monitoring',
        generationMethod: 'musicgpt_dual_output_async',
        webhookUrl: requestData.webhook_url
      };
    } else {
      console.warn('⚠️ Unexpected MusicGPT response format:', musicData);
      throw new Error('Unexpected MusicGPT response format - no audio URL or task ID found');
    }

  } catch (err) {
    console.error('❌ ===============================================');
    console.error('❌ MUSICGPT DUAL-OUTPUT API ERROR');
    console.error('❌ ===============================================');
    console.error('💥 Error:', err.message);
    
    if (err.response) {
      console.error('📊 Status:', err.response.status);
      console.error('📊 Response data:', JSON.stringify(err.response.data, null, 2));
    }

    return {
      success: false,
      status: 'failed',
      error: err.message,
      details: err.response?.data,
      generationMethod: 'musicgpt_dual_output_failed'
    };
  }
}

// ✅ NEW FUNCTION: Extract prompt and music_style from detailed_description
function extractDualOutputComponents(detailedDescription) {
  console.log('🔍 Extracting dual-output components from detailed_description...');
  console.log('📄 Input:', detailedDescription?.substring(0, 200) + '...');

  if (!detailedDescription || typeof detailedDescription !== 'string') {
    console.log('⚠️ No detailed_description provided, using defaults');
    return {
      prompt: 'Video segment requiring background music with appropriate mood and atmosphere',
      music_style: '80 BPM, C major, ambient instrumental, soft piano and strings, intro → development → resolution, mezzo-forte dynamics'
    };
  }

  try {
    // 🚨 IMPORTANT: Split by \\n (JSON escaped newline) first, then by \n
    let lines = detailedDescription.split('\\n');
    
    // If no \\n found, try regular \n
    if (lines.length === 1) {
      lines = detailedDescription.split('\n');
    }
    
    console.log('📊 Found', lines.length, 'lines after splitting');
    
    if (lines.length >= 2) {
      // Extract the two components
      let prompt = lines[0].replace(/^Prompt:\s*/i, '').trim();
      let music_style = lines[1].replace(/^Music Style:\s*/i, '').trim();
      
      // Ensure minimum length and quality
      if (prompt.length < 20) {
        prompt = 'Video segment with visual content requiring musical accompaniment, ' + prompt;
      }
      
      if (music_style.length < 20) {
        music_style = '80 BPM, C major, ' + music_style + ', intro → build → resolution, mezzo-forte';
      }
      
      console.log('✅ Successfully extracted dual components:');
      console.log('   📝 Prompt (' + prompt.length + ' chars):', prompt.substring(0, 80) + '...');
      console.log('   🎵 Music Style (' + music_style.length + ' chars):', music_style.substring(0, 80) + '...');
      
      return { prompt, music_style };
      
    } else {
      // ⚠️ No dual-output format detected
      console.log('⚠️ No dual-output format detected in detailed_description');
      console.log('📄 Content:', detailedDescription.substring(0, 100) + '...');
      
      // Try to detect if it contains musical terms to determine which component it is
      const containsMusicalTerms = /\b(BPM|major|minor|key|tempo|dynamics|forte|piano|strings|guitar|drums|intro|outro|verse|chorus)\b/i.test(detailedDescription);
      
      if (containsMusicalTerms) {
        // Treat as music_style
        console.log('🎵 Detected musical terms, treating as music_style');
        return {
          prompt: 'Video segment with visual content requiring background music to enhance the viewing experience',
          music_style: detailedDescription.substring(0, 280)
        };
      } else {
        // Treat as prompt
        console.log('📝 No musical terms detected, treating as visual prompt');
        return {
          prompt: detailedDescription.substring(0, 280),
          music_style: '80 BPM, C major, cinematic instrumental, orchestral strings and piano, intro → build → climax → resolution, mezzo-forte dynamics'
        };
      }
    }
  } catch (error) {
    console.error('❌ Error extracting dual components:', error);
    
    return {
      prompt: 'Video segment with visual content requiring musical background',
      music_style: '80 BPM, C major, ambient instrumental, soft piano and light strings, gentle intro → warm development → peaceful resolution, dolce dynamics'
    };
  }
}

// ✅ NEW FUNCTION: Check MusicGPT task status
async function checkMusicGPTTaskStatus(taskId) {
  try {
    console.log('🔍 Checking MusicGPT task status:', taskId);
    
    const response = await axios.get(`${MUSICGPT_API_BASE}/task/${taskId}`, {
      headers: {
        'accept': 'application/json',
        'Authorization': MUSICGPT_API_KEY
      },
      timeout: 30000 // 30 seconds
    });
    
    const taskData = response.data;
    console.log('📊 Task status:', taskData.status);
    
    if (taskData.audio_url || taskData.conversion_path) {
      console.log('🎵 Task completed! Audio URL:', taskData.audio_url || taskData.conversion_path);
    }
    
    return {
      success: true,
      status: taskData.status,
      audio_url: taskData.audio_url || taskData.conversion_path || null,
      title: taskData.title || null,
      duration: taskData.duration || taskData.conversion_duration || null,
      progress: taskData.progress || 0,
      eta: taskData.eta || null,
      taskData: taskData
    };
    
  } catch (error) {
    console.error('❌ Error checking task status:', error.message);
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

// ✅ NEW FUNCTION: Wait for task completion with polling
async function waitForMusicGPTCompletion(taskId, maxWaitMinutes = 5, pollIntervalSeconds = 10) {
  try {
    console.log('⏳ Waiting for MusicGPT task completion:', taskId);
    console.log('⏰ Max wait time:', maxWaitMinutes, 'minutes');
    console.log('🔄 Poll interval:', pollIntervalSeconds, 'seconds');
    
    const maxAttempts = Math.floor((maxWaitMinutes * 60) / pollIntervalSeconds);
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      console.log(`🔍 Check ${attempts}/${maxAttempts}...`);
      
      const statusResult = await checkMusicGPTTaskStatus(taskId);
      
      if (!statusResult.success) {
        console.log(`❌ Status check failed: ${statusResult.error}`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
        continue;
      }
      
      if (statusResult.audio_url) {
        console.log('✅ Task completed successfully!');
        return {
          success: true,
          status: 'completed',
          audioUrl: statusResult.audio_url,
          title: statusResult.title,
          duration: statusResult.duration,
          attempts: attempts,
          waitTime: (attempts * pollIntervalSeconds) + 's'
        };
      } else if (statusResult.status === 'failed') {
        throw new Error('Task failed on MusicGPT side');
      } else {
        console.log(`🔄 Status: ${statusResult.status}, progress: ${statusResult.progress || 0}%`);
        if (statusResult.eta) {
          console.log(`⏰ ETA: ${statusResult.eta} seconds`);
        }
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    }
    
    // Timeout reached
    throw new Error(`Task did not complete within ${maxWaitMinutes} minutes`);
    
  } catch (error) {
    console.error('❌ Error waiting for task completion:', error);
    
    return {
      success: false,
      status: 'timeout_or_error',
      error: error.message
    };
  }
}

// ✅ Export all functions
module.exports = { 
  generateMusicWithMusicGPT,           // Existing function - keep for backward compatibility
  generateMusicWithDualOutput,         // NEW: For ClipTune integration
  extractDualOutputComponents,         // NEW: Parse detailed_description
  checkMusicGPTTaskStatus,            // NEW: Check task status
  waitForMusicGPTCompletion           // NEW: Wait for completion with polling
};