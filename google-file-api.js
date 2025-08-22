// google-file-api.js - Google File API integration for large video uploads

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs').promises;
const path = require('path');

/**
 * Enhanced file upload to Google File API for large videos
 * Supports files larger than 20MB that can't be sent directly to Gemini
 */
class GoogleFileAPIManager {
  constructor(apiKey) {
    this.fileManager = new GoogleAIFileManager(apiKey);
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Upload large video file to Google File API
   * @param {Buffer} videoBuffer - Video file buffer
   * @param {string} originalFilename - Original filename
   * @param {string} mimeType - MIME type of the video
   * @returns {Promise<Object>} Upload result with file URI
   */
  async uploadLargeVideoFile(videoBuffer, originalFilename = 'video.mp4', mimeType = 'video/mp4') {
    try {
      console.log('🗂️ ===============================================');
      console.log('🗂️ UPLOADING LARGE VIDEO TO GOOGLE FILE API');
      console.log('🗂️ ===============================================');
      console.log('📁 Original filename:', originalFilename);
      console.log('📊 File size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
      console.log('🎬 MIME type:', mimeType);

      // Create temporary file for upload
      const tempDir = path.join(__dirname, 'temp_videos');
      await fs.mkdir(tempDir, { recursive: true });
      
      const timestamp = Date.now();
      const tempFilePath = path.join(tempDir, `large_video_${timestamp}.mp4`);
      
      // Write buffer to temporary file
      await fs.writeFile(tempFilePath, videoBuffer);
      console.log('💾 Temporary file created:', tempFilePath);

      const startTime = Date.now();

      // Upload to Google File API
      const uploadResponse = await this.fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Large Video - ${originalFilename} - ${new Date().toISOString()}`
      });

      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('✅ ===============================================');
      console.log('✅ GOOGLE FILE API UPLOAD COMPLETED');
      console.log('✅ ===============================================');
      console.log('⏱️ Upload time:', uploadTime, 'seconds');
      console.log('🆔 File URI:', uploadResponse.file.uri);
      console.log('📝 Display name:', uploadResponse.file.displayName);
      console.log('📊 File size in API:', uploadResponse.file.sizeBytes, 'bytes');
      console.log('🏷️ MIME type:', uploadResponse.file.mimeType);

      // Clean up temporary file
      try {
        await fs.unlink(tempFilePath);
        console.log('🗑️ Temporary file cleaned up');
      } catch (cleanupError) {
        console.warn('⚠️ Could not clean up temporary file:', cleanupError.message);
      }

      return {
        success: true,
        fileUri: uploadResponse.file.uri,
        fileName: uploadResponse.file.name,
        displayName: uploadResponse.file.displayName,
        sizeBytes: uploadResponse.file.sizeBytes,
        mimeType: uploadResponse.file.mimeType,
        uploadTime: uploadTime + 's',
        originalSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB'
      };

    } catch (error) {
      console.error('❌ ===============================================');
      console.error('❌ GOOGLE FILE API UPLOAD FAILED');
      console.error('❌ ===============================================');
      console.error('💥 Error message:', error.message);
      console.error('💥 Error details:', error);

      throw new Error(`Google File API upload failed: ${error.message}`);
    }
  }

  /**
   * Analyze large video file using Gemini with File API reference
   * @param {string} fileUri - Google File API URI
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeLargeVideoForMusicSegments(fileUri, options = {}) {
    try {
      const {
        customPrompt = '',
        maxSegments = 10,
        analysisType = 'music_segments',
        detailLevel = 'detailed'
      } = options;

      console.log('🧠 ===============================================');
      console.log('🧠 ANALYZING LARGE VIDEO WITH GEMINI + FILE API');
      console.log('🧠 ===============================================');
      console.log('🆔 File URI:', fileUri);
      console.log('🎯 Max segments:', maxSegments);
      console.log('📝 Analysis type:', analysisType);

      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

      // Enhanced prompt for music segmentation
      const systemPrompt = `You are an expert music supervisor and video editor. Analyze this video file and identify optimal segments for background music placement.

ANALYSIS REQUIREMENTS:
- Identify ${maxSegments} distinct segments where background music would enhance the video
- For each segment, provide precise start and end times in seconds
- Consider visual pacing, scene changes, dialogue breaks, and emotional moments
- Suggest appropriate music characteristics for each segment

CUSTOM INSTRUCTIONS:
${customPrompt}

OUTPUT FORMAT (JSON only, no markdown):
[
  {
    "start_time": 0.0,
    "end_time": 15.2,
    "reason": "Opening scene with slow character introduction requires ambient background music to establish mood",
    "intensity": "low",
    "type": "ambient",
    "volume": 50,
    "fade_algorithm": "linear",
    "fadein_duration": "2.0",
    "fadeout_duration": "2.0",
    "music_summary": "Soft ambient background music with gentle fade-in",
    "detailed_description": "Create a gentle, atmospheric piece with soft pads and minimal percussion. Keep volume low to not interfere with dialogue.\\nAmbient electronic with warm pads, subtle reverb, 70 BPM, C major, minimal percussion, evolving textures"
  }
]

Return exactly ${maxSegments} segments as a valid JSON array.`;

      const startTime = Date.now();

      // Make request to Gemini with file reference
      const result = await model.generateContent([
        {
          fileData: {
            mimeType: "video/mp4", // Adjust based on actual file type
            fileUri: fileUri
          }
        },
        { text: systemPrompt }
      ]);

      const response = await result.response;
      const analysisText = response.text();
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('✅ ===============================================');
      console.log('✅ LARGE VIDEO ANALYSIS COMPLETED');
      console.log('✅ ===============================================');
      console.log('⏱️ Processing time:', processingTime, 'seconds');
      console.log('📝 Response length:', analysisText.length, 'characters');

      // Parse the response (reuse existing parsing logic)
      const { extractSegmentsFromGeminiResponse } = require('./gemini-utils');
      const { segments, parseError, strategy } = extractSegmentsFromGeminiResponse(analysisText, maxSegments);

      if (segments.length > 0) {
        console.log('🎵 ===============================================');
        console.log('🎵 SEGMENTS EXTRACTED FROM LARGE VIDEO');
        console.log('🎵 ===============================================');
        segments.forEach((segment, index) => {
          console.log(`${index + 1}. ${segment.start_time || segment.start}s-${segment.end_time || segment.end}s: ${segment.type} (${segment.intensity})`);
          console.log(`   Reason: ${segment.reason}`);
        });
        console.log('🎵 ===============================================');
      }

      return {
        success: true,
        musicSegments: segments,
        totalSegments: segments.length,
        rawResponse: analysisText,
        processingTime: processingTime + 's',
        parseStrategy: strategy,
        parseError: parseError,
        analysisType: 'large_video_file_api',
        fileUri: fileUri,
        metadata: {
          promptUsed: systemPrompt,
          detailLevel: detailLevel,
          maxSegments: maxSegments,
          analysisMethod: 'google_file_api'
        }
      };

    } catch (error) {
      console.error('❌ Error analyzing large video with File API:', error);
      return {
        success: false,
        error: error.message,
        details: error,
        fileUri: fileUri
      };
    }
  }

  /**
   * Get file information from Google File API
   * @param {string} fileName - File name from upload response
   * @returns {Promise<Object>} File information
   */
  async getFileInfo(fileName) {
    try {
      const fileInfo = await this.fileManager.getFile(fileName);
      
      console.log('📋 File Information:');
      console.log('📋 ===============================================');
      console.log('🆔 Name:', fileInfo.name);
      console.log('📝 Display Name:', fileInfo.displayName);
      console.log('📊 Size:', fileInfo.sizeBytes, 'bytes');
      console.log('🏷️ MIME Type:', fileInfo.mimeType);
      console.log('📅 Create Time:', fileInfo.createTime);
      console.log('🔄 Update Time:', fileInfo.updateTime);
      console.log('🆔 URI:', fileInfo.uri);

      return {
        success: true,
        fileInfo: fileInfo
      };
    } catch (error) {
      console.error('❌ Error getting file info:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete file from Google File API
   * @param {string} fileName - File name to delete
   * @returns {Promise<Object>} Deletion result
   */
  async deleteFile(fileName) {
    try {
      await this.fileManager.deleteFile(fileName);
      
      console.log('🗑️ File deleted successfully:', fileName);
      
      return {
        success: true,
        message: 'File deleted successfully',
        fileName: fileName
      };
    } catch (error) {
      console.error('❌ Error deleting file:', error);
      return {
        success: false,
        error: error.message,
        fileName: fileName
      };
    }
  }

  /**
   * List all uploaded files
   * @returns {Promise<Object>} List of files
   */
  async listFiles() {
    try {
      const listResponse = await this.fileManager.listFiles();
      
      console.log('📂 ===============================================');
      console.log('📂 GOOGLE FILE API - UPLOADED FILES');
      console.log('📂 ===============================================');
      console.log('📊 Total files:', listResponse.files.length);
      
      listResponse.files.forEach((file, index) => {
        console.log(`${index + 1}. ${file.displayName}`);
        console.log(`   📊 Size: ${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   📅 Created: ${file.createTime}`);
        console.log(`   🆔 URI: ${file.uri}`);
        console.log('   ---');
      });

      return {
        success: true,
        files: listResponse.files,
        totalFiles: listResponse.files.length
      };
    } catch (error) {
      console.error('❌ Error listing files:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

/**
 * Enhanced video analysis function that automatically chooses the best method
 * @param {Buffer} videoBuffer - Video buffer
 * @param {string} mimeType - MIME type
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeVideoForMusicSegmentsEnhanced(videoBuffer, mimeType, options = {}) {
  try {
    const fileSizeMB = videoBuffer.length / 1024 / 1024;
    const DIRECT_UPLOAD_LIMIT = 18; // Conservative limit for direct upload
    
    console.log('🎬 ===============================================');
    console.log('🎬 ENHANCED VIDEO ANALYSIS - AUTOMATIC METHOD SELECTION');
    console.log('🎬 ===============================================');
    console.log('📊 Video size:', fileSizeMB.toFixed(2), 'MB');
    console.log('🎯 Direct upload limit:', DIRECT_UPLOAD_LIMIT, 'MB');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    if (fileSizeMB <= DIRECT_UPLOAD_LIMIT) {
      // Use direct upload method for smaller files
      console.log('📤 Using DIRECT UPLOAD method (file size within limits)');
      
      const { analyzeVideoForMusicSegments } = require('./gemini-utils');
      return await analyzeVideoForMusicSegments(videoBuffer, mimeType, options);
      
    } else {
      // Use Google File API for larger files
      console.log('🗂️ Using GOOGLE FILE API method (large file detected)');
      
      const fileManager = new GoogleFileAPIManager(apiKey);
      
      // Upload to File API
      const uploadResult = await fileManager.uploadLargeVideoFile(videoBuffer, 'large_video.mp4', mimeType);
      
      if (!uploadResult.success) {
        throw new Error('Failed to upload large video to Google File API');
      }
      
      // Analyze using File API reference
      const analysisResult = await fileManager.analyzeLargeVideoForMusicSegments(uploadResult.fileUri, options);
      
      // Add upload info to result
      analysisResult.uploadInfo = uploadResult;
      analysisResult.method = 'google_file_api';
      
      // Optional: Clean up the uploaded file after analysis
      if (options.cleanupAfterAnalysis !== false) {
        console.log('🗑️ Cleaning up uploaded file...');
        await fileManager.deleteFile(uploadResult.fileName);
      }
      
      return analysisResult;
    }

  } catch (error) {
    console.error('❌ Error in enhanced video analysis:', error);
    throw error;
  }
}

module.exports = {
  GoogleFileAPIManager,
  analyzeVideoForMusicSegmentsEnhanced
};