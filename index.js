const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const fsPromises = require('fs/promises');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const stripe = require('stripe');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const axios = require('axios');

const { getVideoDurationInSeconds } = require('get-video-duration');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIPTUNE_API = 'https://nback-6gqw.onrender.com/api';

// Firebase Admin Set
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: firebasePrivateKey,
  }),
});

// ClipTune Response Mapping Function - FIXED VERSION
const mapClipTuneResponse = (cliptuneSegments) => {
  if (!cliptuneSegments || !Array.isArray(cliptuneSegments)) {
    return [];
  }
  
  return cliptuneSegments.map(segment => ({
    ...segment,
    // Map ClipTune field names to your expected field names
    fade_algorithm: segment.fade_type || 'linear',
    fadein_duration: segment.fade_in_seconds ? segment.fade_in_seconds.toString() : '2.0',
    fadeout_duration: segment.fade_out_seconds ? segment.fade_out_seconds.toString() : '2.0',
    
    // Keep original fields for reference
    original_fade_type: segment.fade_type,
    original_fade_in_seconds: segment.fade_in_seconds,
    original_fade_out_seconds: segment.fade_out_seconds
  }));
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer and FFmpeg setup
const storage = multer.memoryStorage();
const upload = multer({ storage });
ffmpeg.setFfmpegPath(ffmpegPath);

// Temp directory setup
const tempDir = path.join(__dirname, 'temp_videos');
fsPromises.mkdir(tempDir, { recursive: true }).then(() => {
  console.log(`Ã¢Å“â€¦ Temp directory ready: ${tempDir}`);
}).catch(err => {
  console.error("Ã¢ÂÅ’ Temp dir error:", err);
  process.exit(1);
});

app.use('/trimmed', express.static(tempDir));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Stripe Setup
const stripeInstance = stripe(process.env.STRIPE_SECRET_KEY);

// Upload proxy endpoint to handle CORS issues with Google Cloud Storage
// Enhanced /signup endpoint in index.js
app.post('/signup', async (req, res) => {
  const { email, password, paymentIntentId } = req.body;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create Stripe customer
    const customer = await stripeInstance.customers.create({ email });

    // Determine account type based on payment
    const paymentStatus = paymentIntentId ? 'Premium' : 'Free';

    // Create new user
    const newUser = new User({
      email,
      password: hashedPassword,
      username: email.split('@')[0],
      stripeCustomerId: customer.id,
      isVerified: false,
      verificationToken,
      lastPaymentIntentId: paymentIntentId || null,
      paymentStatus
    });

    // Ã¢Å“â€¦ NEW: If premium signup, retrieve and save the payment method
    if (paymentIntentId) {
      try {
        console.log('Ã°Å¸â€™Â³ Premium signup detected - saving payment method...');
        
        // Retrieve the PaymentIntent to get the payment method
        const paymentIntent = await stripeInstance.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.payment_method) {
          // Retrieve the full payment method details
          const paymentMethod = await stripeInstance.paymentMethods.retrieve(paymentIntent.payment_method);
          
          // Attach payment method to customer
          await stripeInstance.paymentMethods.attach(paymentMethod.id, {
            customer: customer.id,
          });

          // Set as default payment method
          await stripeInstance.customers.update(customer.id, {
            invoice_settings: {
              default_payment_method: paymentMethod.id,
            },
          });

          // Initialize paymentInfo and save card details to MongoDB
          const card = paymentMethod.card;
          newUser.paymentInfo = {
            hasPaymentMethod: true,
            defaultPaymentMethodId: paymentMethod.id,
            cards: [{
              stripePaymentMethodId: paymentMethod.id,
              last4: card.last4,
              brand: card.brand,
              expMonth: card.exp_month,
              expYear: card.exp_year,
              isDefault: true,
              addedAt: new Date(),
              nickname: `${card.brand.toUpperCase()} ending in ${card.last4}`
            }],
            billingAddress: {},
            totalPayments: 1,
            failedPaymentAttempts: 0,
            lastPaymentDate: new Date()
          };

          console.log('Ã¢Å“â€¦ Payment method saved for premium signup:', {
            paymentMethodId: paymentMethod.id,
            cardBrand: card.brand,
            last4: card.last4
          });
        }
      } catch (paymentMethodError) {
        console.error('Ã¢Å¡ Ã¯Â¸Â Failed to save payment method during signup:', paymentMethodError);
        // Don't fail the entire signup, just log the error
      }
    }

    await newUser.save();

    // Send verification email
    const verificationLink = `https://nback-6gqw.onrender.com/api/verify-email/${verificationToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your SoundAI Account',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Welcome to SoundAI!</h2>
          <p>Thank you for signing up for a ${paymentStatus} account.</p>
          ${paymentStatus === 'Premium' ? '<p>Ã°Å¸Å½â€° Your payment method has been saved for future billing.</p>' : ''}
          <p>Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationLink}</p>
          <p>This link will expire in 24 hours.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">
            If you didn't create this account, please ignore this email.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({ 
      message: `${paymentStatus} account created successfully! Please check your email to verify your account.`,
      userId: newUser._id,
      accountType: paymentStatus,
      paymentMethodSaved: !!paymentIntentId
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      message: 'Server error during signup', 
      details: error.message 
    });
  }
});
// Add these endpoints to your index.js file (before the "Start server" line)

// Check if user has a credit card on file
app.post('/check-credit-card', async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log('Ã°Å¸â€Â Checking credit card for user:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        hasCreditCard: false 
      });
    }

    if (!user.stripeCustomerId) {
      return res.json({ 
        hasCreditCard: false,
        message: 'No Stripe customer ID found' 
      });
    }

    // Check if customer has payment methods in Stripe
    const paymentMethods = await stripeInstance.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });

    const hasCreditCard = paymentMethods.data.length > 0;
    
    console.log(`Ã¢Å“â€¦ Credit card check: ${hasCreditCard ? 'HAS' : 'NO'} cards for ${email}`);
    
    res.json({ 
      hasCreditCard,
      cardCount: paymentMethods.data.length,
      message: hasCreditCard 
        ? `Found ${paymentMethods.data.length} payment method(s)`
        : 'No payment methods found'
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error checking credit card:', error);
    res.status(500).json({ 
      error: 'Failed to check credit card status',
      details: error.message,
      hasCreditCard: false
    });
  }
});

// Upgrade user to premium using existing payment method
app.post('/upgrade-to-premium', async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log('Ã°Å¸Å¡â‚¬ Upgrading user to premium:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.paymentStatus === 'Premium') {
      return res.json({ 
        message: 'User is already Premium',
        accountType: 'Premium'
      });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ 
        message: 'No Stripe customer found. Please add a payment method first.' 
      });
    }

    // Get the customer's default payment method
    const customer = await stripeInstance.customers.retrieve(user.stripeCustomerId);
    
    if (!customer.invoice_settings?.default_payment_method) {
      return res.status(400).json({ 
        message: 'No default payment method found. Please add a payment method first.' 
      });
    }

    // Create a payment intent for the upgrade
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount: 1000, // $10.00 in cents
      currency: 'usd',
      customer: user.stripeCustomerId,
      payment_method: customer.invoice_settings.default_payment_method,
      confirm: true,
      return_url: 'https://nback-6gqw.onrender.com/settings', // Add return URL for compliance
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never' // Prevent redirects for immediate confirmation
      }
    });

    if (paymentIntent.status === 'succeeded') {
      // Update user to Premium
      user.paymentStatus = 'Premium';
      user.lastPaymentIntentId = paymentIntent.id;
      await user.save();

      console.log('Ã¢Å“â€¦ User upgraded to Premium successfully');
      
      res.json({ 
        message: 'Successfully upgraded to Premium!',
        accountType: 'Premium',
        paymentIntentId: paymentIntent.id
      });
    } else {
      console.warn('Ã¢Å¡ Ã¯Â¸Â Payment intent not succeeded:', paymentIntent.status);
      res.status(400).json({ 
        message: `Payment not completed. Status: ${paymentIntent.status}`,
        paymentStatus: paymentIntent.status
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error upgrading to premium:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      res.status(400).json({ 
        message: 'Payment failed: ' + error.message,
        details: 'Please check your payment method'
      });
    } else {
      res.status(500).json({ 
        message: 'Failed to upgrade to premium',
        details: error.message
      });
    }
  }
});
function getErrorSuggestions(analysisResult) {
  const suggestions = [];
  
  if (analysisResult.httpStatus === 403) {
    suggestions.push('Check if the GCS bucket has public read access enabled');
    suggestions.push('Verify that the service account has Storage Object Viewer permissions');
    suggestions.push('Try regenerating the signed URL');
  } else if (analysisResult.httpStatus === 404) {
    suggestions.push('Verify the video file exists in the GCS bucket');
    suggestions.push('Check if the file path is correct');
  } else if (analysisResult.error?.includes('timeout')) {
    suggestions.push('Try a smaller video file');
    suggestions.push('Check your internet connection');
    suggestions.push('Increase the timeout duration');
  } else if (analysisResult.error?.includes('network')) {
    suggestions.push('Check your internet connection');
    suggestions.push('Verify the GCS bucket URL is correct');
  }
  
  return suggestions;
}
// Cancel premium subscription
app.post('/cancel-premium', async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log('Ã°Å¸Å¡Â« Canceling premium for user:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.paymentStatus !== 'Premium') {
      return res.json({ 
        message: 'User is not currently Premium',
        accountType: user.paymentStatus || 'Free'
      });
    }

    // Update user to Free (immediate cancellation)
    // In a real app, you might want to set a cancellation date instead
    user.paymentStatus = 'Free';
    await user.save();

    console.log('Ã¢Å“â€¦ Premium subscription canceled successfully');
    
    res.json({ 
      message: 'Premium subscription canceled successfully',
      accountType: 'Free'
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error canceling premium:', error);
    res.status(500).json({ 
      message: 'Failed to cancel premium subscription',
      details: error.message
    });
  }
});
// Add this import at the top of your index.js file
async function analyzeVideoSegmentsShared(videoBuffer, mimeType, options = {}) {
  try {
    const { 
      customPrompt = '', 
      analysisType = 'segments',
      detailLevel = 'detailed',
      showTerminalOutput = true 
    } = options;

    if (showTerminalOutput) {
      console.log('Ã°Å¸Å½Â¬ ===============================================');
      console.log('Ã°Å¸Å½Â¬ SHARED SEGMENT ANALYSIS STARTING');
      console.log('Ã°Å¸Å½Â¬ ===============================================');
      console.log('Ã°Å¸â€œÅ  Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
      console.log('Ã°Å¸Å½Â¯ Analysis type:', analysisType);
      console.log('Ã°Å¸â€œÂ Custom prompt:', customPrompt || 'None provided');
      console.log('Ã°Å¸â€Â Detail level:', detailLevel);
    }

    // Import Gemini utilities
    const { analyzeVideoForMusicSegments } = require('./gemini-utils');

    const startTime = Date.now();

    // Perform segment analysis
    const segmentationResult = await analyzeVideoForMusicSegments(
      videoBuffer, 
      mimeType, 
      { 
        customPrompt,
        analysisType,
        detailLevel 
      }
    );

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    if (segmentationResult.success && showTerminalOutput) {
      displaySegmentAnalysisResults(segmentationResult, processingTime);
    }

    return {
      success: segmentationResult.success,
      segments: segmentationResult.musicSegments || [],
      totalSegments: segmentationResult.totalSegments || 0,
      rawAnalysis: segmentationResult.rawResponse,
      processingTime: processingTime + 's',
      analysisType: 'music_segments',
      error: segmentationResult.error,
      metadata: {
        promptUsed: customPrompt,
        detailLevel: detailLevel,
        bufferSize: videoBuffer.length,
        mimeType: mimeType
      }
    };

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in shared segment analysis:', error);
    return {
      success: false,
      segments: [],
      totalSegments: 0,
      error: error.message,
      processingTime: '0s'
    };
  }
}

/**
 * Fetch webhook.site data and parse MusicGPT responses
- The webhook.site token
 * @param {number} maxRetries - Maximum number of polling attempts
 * @param {number} pollInterval - Interval between polls in milliseconds
 * @param {number} minRequests - Minimum number of POST requests to wait for (default: 3)
 * @returns {Promise<Object>} - The webhook data or null if not found
 */
// Ã°Å¸Å¡Â¨ REPLACE your existing monitorWebhookForMusicGPT function in index.js with this FIXED version:

// Ã¢Å“â€¦ REPLACE your existing monitorWebhookForMusicGPT function with this enhanced version
// This version will display final timing recommendations at the end

// Ã°Å¸Å¡Â¨ REPLACE your existing monitorWebhookForMusicGPT function in index.js with this ENHANCED version
// This version collects ALL 3 requests and finds MP3 URLs in any of them

async function monitorWebhookForMusicGPT(webhookToken, maxRetries = 30, pollInterval = 10000, minRequests = 3) {
  const API_KEY = '563460a6-5c0b-4f4f-9240-2c714823510c';
  
  console.log('🎵 ===============================================');
  console.log('🎵 ENHANCED WEBHOOK MONITORING FOR ALL 3 MUSICGPT REQUESTS');
  console.log('🎵 ===============================================');
  console.log('🔑 Webhook Token:', webhookToken);
  console.log('🔄 Max retries:', maxRetries);
  console.log('⏰ Poll interval:', pollInterval / 1000, 'seconds');
  console.log('🎯 Waiting for', minRequests, 'NEW POST requests (album cover + processing + final MP3)');
  
  const webhookApiUrl = `https://webhook.site/token/${webhookToken}/requests`;
  let seenRequestUuids = new Set();
  let newMusicGPTRequests = [];
  
  // Configure headers with API key
  const apiHeaders = {
    'Accept': 'application/json',
    'Api-Key': API_KEY,
    'User-Agent': 'ClipTune-Webhook-Monitor/1.0'
  };
  
  // Get baseline requests to mark as seen
  console.log('\n🔍 Getting baseline requests...');
  try {
    const baselineResponse = await axios.get(webhookApiUrl, {
      timeout: 15000,
      headers: apiHeaders
    });
    
    if (baselineResponse.data && baselineResponse.data.data) {
      baselineResponse.data.data.forEach(request => {
        seenRequestUuids.add(request.uuid);
      });
      console.log('✅ Marked', seenRequestUuids.size, 'existing requests as seen');
    }
  } catch (error) {
    console.log('⚠️ Could not get baseline requests:', error.message);
    if (error.response?.status === 401) {
      console.log('🔑 Authentication failed - check API key');
    }
  }
  
  console.log('\n🎵 Starting monitoring for NEW requests...');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\n🔍 Poll ${attempt}/${maxRetries} - Checking for NEW requests...`);
      
      const response = await axios.get(webhookApiUrl, {
        timeout: 15000,
        headers: apiHeaders,
        params: {
          sorting: 'newest'  // Ensure we get newest requests first
        }
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        const allRequests = response.data.data;
        
        // Filter for NEW POST requests only
        const newPostRequests = allRequests.filter(request => {
          return request.method === 'POST' && 
                 !seenRequestUuids.has(request.uuid) && 
                 request.content;
        });
        
        if (newPostRequests.length > 0) {
          console.log(`🎉 Found ${newPostRequests.length} NEW POST request(s)!`);
          
          // Process each NEW request
          for (const request of newPostRequests) {
            try {
              const content = JSON.parse(request.content);
              
              // 🎨 ENHANCED: Detect ANY MusicGPT-related request
              const isMusicGPTRequest = content.conversion_path || 
                                        content.audio_url || 
                                        content.task_id || 
                                        content.conversion_id ||
                                        content.conversion_id_1 ||
                                        content.conversion_id_2 ||
                                        content.success !== undefined ||
                                        content.conversion_duration ||
                                        content.title ||
                                        content.lyrics !== undefined ||
                                        content.conversion_type ||
                                        content.subtype ||
                                        content.image_path;
              
              if (isMusicGPTRequest) {
                const newRequest = {
                  content: content,
                  requestInfo: {
                    uuid: request.uuid,
                    timestamp: request.created_at,
                    ip: request.ip,
                    size: request.size,
                    method: request.method
                  }
                };
                
                newMusicGPTRequests.push(newRequest);
                seenRequestUuids.add(request.uuid);
                
                console.log(`\n🎵 ===============================================`);
                console.log(`🎵 NEW MUSICGPT REQUEST #${newMusicGPTRequests.length} DETECTED!`);
                console.log(`🎵 ===============================================`);
                console.log('🕐 Time:', request.created_at);
                console.log('🔑 UUID:', request.uuid);
                console.log('📊 Size:', request.size, 'bytes');
                
                // Enhanced content logging
                console.log('\n📄 REQUEST CONTENT:');
                console.log('='.repeat(60));
                console.log(JSON.stringify(content, null, 2));
                console.log('='.repeat(60));
                
                // 🎨 ENHANCED: Check for different types of MusicGPT responses
                console.log('\n🎵 CONTENT ANALYSIS:');
                console.log('🎵 ===============================================');
                
                if (content.subtype === 'album_cover_generation') {
                  console.log('🎨 REQUEST TYPE: Album Cover Generation');
                  console.log('🖼️ Image path:', content.image_path || 'None');
                  console.log('🎯 Task ID:', content.task_id || 'None');
                } else if (content.conversion_path || content.audio_url) {
                  console.log('🎵 REQUEST TYPE: Audio File Ready!');
                  const audioUrl = content.conversion_path || content.audio_url;
                  console.log('🎵 ✅ MP3 URL FOUND:', audioUrl);
                  console.log('⏱️ Duration:', content.conversion_duration || 'Unknown', 'seconds');
                  console.log('🎼 Title:', content.title || 'Untitled');
                } else if (content.task_id || content.conversion_id) {
                  console.log('🔄 REQUEST TYPE: Processing Status');
                  console.log('🎯 Task ID:', content.task_id || content.conversion_id);
                  console.log('📊 Status:', content.status || 'Processing');
                } else {
                  console.log('❓ REQUEST TYPE: Unknown MusicGPT Response');
                  console.log('🔍 Available fields:', Object.keys(content).join(', '));
                }
                
                console.log(`⏳ Progress: ${newMusicGPTRequests.length}/${minRequests} NEW requests`);
                
                // 🎨 CONTINUE COLLECTING until we reach minRequests
                if (newMusicGPTRequests.length >= minRequests) {
                  console.log(`\n🎯 ===============================================`);
                  console.log(`🎯 COLLECTED ${minRequests} NEW REQUESTS!`);
                  console.log(`🎯 ===============================================`);
                  
                  // 🎨 ENHANCED: Extract MP3 files from ALL collected requests
                  const mp3Files = extractMP3FilesFromAllRequests(newMusicGPTRequests);
                  
                  console.log(`📊 Total MP3 files found across all requests: ${mp3Files.length}`);
                  
                  if (mp3Files.length > 0) {
                    // 🎨 SUCCESS: Found MP3 file(s) in collected requests
                    const primaryMp3 = mp3Files[0]; // Use the first MP3 found
                    
                    console.log('\n🎵 ===============================================');
                    console.log('🎵 MP3 FILE FOUND IN COLLECTED REQUESTS!');
                    console.log('🎵 ===============================================');
                    console.log('🎵 Primary MP3 URL:', primaryMp3.url);
                    console.log('🎼 Title:', primaryMp3.title);
                    console.log('⏱️ Duration:', primaryMp3.mp3Duration, 'seconds');
                    console.log(`📊 Found in request #${primaryMp3.requestNumber} of ${newMusicGPTRequests.length}`);
                    
                    return {
                      success: true,
                      webhookData: primaryMp3.originalContent, // Return the content that had the MP3
                      requestInfo: primaryMp3.requestInfo,
                      attempt: attempt,
                      totalPolls: attempt,
                      allRequests: newMusicGPTRequests,
                      totalRequestsFound: newMusicGPTRequests.length,
                      onlyNewRequests: true,
                      mp3Files: mp3Files,
                      allMP3Files: mp3Files  // 🎨 IMPORTANT: Include all MP3 files
                    };
                  } else {
                    // 🎨 NO MP3 found yet - continue collecting more requests
                    console.log(`⚠️ No MP3 URLs found in ${newMusicGPTRequests.length} requests yet, continuing...`);
                    
                    // 🎨 OPTIONAL: Increase minRequests if no MP3 found
                    if (newMusicGPTRequests.length >= 5) {
                      console.log('⚠️ Already collected 5+ requests with no MP3 - something may be wrong');
                      break;
                    }
                  }
                }
              } else {
                console.log('⚠️ Non-MusicGPT request detected, skipping');
              }
            } catch (parseError) {
              console.log('⚠️ Could not parse request content:', parseError.message);
            }
          }
        } else {
          console.log('🔍 No NEW requests found');
        }
      } else {
        console.log('🔍 No requests at all');
      }
      
      if (attempt < maxRetries) {
        console.log(`⏳ Waiting ${pollInterval / 1000}s for next check... (${newMusicGPTRequests.length}/${minRequests})`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
    } catch (error) {
      console.error(`❌ Webhook polling error (attempt ${attempt}):`, error.message);
      
      if (error.response?.status === 401) {
        console.error('🔑 Authentication failed - check API key');
      } else if (error.response?.status === 404) {
        console.error('🔍 Webhook token not found');
      }
      
      if (attempt < maxRetries) {
        console.log(`🔄 Retrying in ${pollInterval / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }
  
  console.log('\n⏰ ===============================================');
  console.log('⏰ WEBHOOK MONITORING TIMEOUT');
  console.log('⏰ ===============================================');
  console.log(`❌ Collected ${newMusicGPTRequests.length}/${minRequests} requests`);
  
  // 🎨 ENHANCED: Even on timeout, show what we collected and check for MP3s
  if (newMusicGPTRequests.length > 0) {
    const mp3Files = extractMP3FilesFromAllRequests(newMusicGPTRequests);
    console.log(`🎵 Partial collection: ${mp3Files.length} MP3 files found`);
    
    if (mp3Files.length > 0) {
      console.log('\n🎵 PARTIAL MP3 COLLECTION:');
      mp3Files.forEach((mp3, index) => {
        console.log(`${index + 1}. "${mp3.title}" - ${mp3.url}`);
      });
      
      // 🎨 RETURN SUCCESS if we found MP3s even on timeout
      return {
        success: true,
        webhookData: mp3Files[0].originalContent,
        requestInfo: mp3Files[0].requestInfo,
        attempt: maxRetries,
        totalPolls: maxRetries,
        allRequests: newMusicGPTRequests,
        totalRequestsFound: newMusicGPTRequests.length,
        mp3Files: mp3Files,
        allMP3Files: mp3Files,
        timeoutButFound: true
      };
    }
  }
  
  return {
    success: false,
    error: 'Webhook monitoring timeout - no MP3 URLs found',
    totalPolls: maxRetries,
    partialRequests: newMusicGPTRequests,
    mp3Files: extractMP3FilesFromAllRequests(newMusicGPTRequests)
  };
}
// Ã°Å¸Å¡Â¨ ENHANCED: Extract MP3 files from ALL collected requests
function extractMP3FilesFromAllRequests(requests) {
  const mp3Files = [];
  
  console.log('\nÃ°Å¸Å½Âµ ===============================================');
  console.log('Ã°Å¸Å½Âµ EXTRACTING MP3 FILES FROM ALL WEBHOOK REQUESTS');
  console.log('Ã°Å¸Å½Âµ ===============================================');
  
  requests.forEach((request, index) => {
    const content = request.content;
    
    console.log(`\nÃ°Å¸â€Â Checking request #${index + 1}:`);
    console.log(`   Type: ${content.subtype || content.conversion_type || 'Unknown'}`);
    console.log(`   UUID: ${request.requestInfo.uuid}`);
    
    // Ã°Å¸Å¡Â¨ ENHANCED: Check multiple possible audio URL fields
    const audioFields = [
      'conversion_path',
      'audio_url', 
      'conversion_path_wav',
      'download_url',
      'audio_file_url',
      'music_url'
    ];
    
    let mp3Url = null;
    let foundField = null;
    
    for (const field of audioFields) {
      if (content[field]) {
        mp3Url = content[field];
        foundField = field;
        break;
      }
    }
    
    if (mp3Url) {
      const mp3File = {
        url: mp3Url,
        title: content.title || `Generated Track ${index + 1}`,
        mp3Duration: content.conversion_duration || content.duration || null,
        requestNumber: index + 1,
        uuid: request.requestInfo.uuid,
        timestamp: request.requestInfo.timestamp,
        foundInField: foundField,
        // Additional metadata
        wavUrl: content.conversion_path_wav || null,
        lyrics: content.lyrics || null,
        albumCover: content.album_cover_path || content.image_path || null,
        isFlagged: content.is_flagged || false,
        taskId: content.task_id || content.conversion_id || content.conversion_id_1 || null,
        // Keep original content for reference
        originalContent: content,
        requestInfo: request.requestInfo,
        // Ã¢Å“â€¦ NEW: Add timing metadata for full video coverage
        suggestedStartTime: 0,
        suggestedEndTime: null, // Will be set to video duration
        placementType: 'FULL_VIDEO_BACKGROUND'
      };
      
      mp3Files.push(mp3File);
      
      console.log(`Ã°Å¸Å½Âµ Ã¢Å“â€¦ FOUND MP3 #${index + 1}:`);
      console.log(`   Ã°Å¸Å½Â¼ Title: "${mp3File.title}"`);
      console.log(`   Ã°Å¸â€â€” URL: ${mp3File.url}`);
      console.log(`   Ã°Å¸â€œÅ  Found in field: ${foundField}`);
      console.log(`   Ã¢ÂÂ±Ã¯Â¸Â Duration: ${mp3File.mp3Duration || 'Unknown'} seconds`);
      console.log(`   Ã°Å¸â€œâ€¦ Generated: ${mp3File.timestamp}`);
      console.log(`   Ã°Å¸Å½Â¯ Suggested Placement: Full video background (0s to end)`);
      
    } else {
      console.log(`   Ã¢ÂÅ’ No MP3 URL found in request #${index + 1}`);
      console.log(`   Ã°Å¸â€Â Available fields: ${Object.keys(content).join(', ')}`);
    }
    
    console.log('   ---');
  });
  
  console.log(`Ã°Å¸â€œÅ  Total MP3 files extracted: ${mp3Files.length} from ${requests.length} requests`);
  console.log('Ã°Å¸Å½Âµ ===============================================\n');
  
  return mp3Files;
}

// Ã¢Å“â€¦ ENHANCED: Update your extractMP3FilesFromRequests function to include more metadata
function extractMP3FilesFromRequests(requests) {
  const mp3Files = [];
  
  console.log('\nÃ°Å¸Å½Âµ ===============================================');
  console.log('Ã°Å¸Å½Âµ EXTRACTING MP3 FILES FROM WEBHOOK REQUESTS');
  console.log('Ã°Å¸Å½Âµ ===============================================');
  
  requests.forEach((request, index) => {
    const content = request.content;
    
    const mp3Url = content.conversion_path || content.audio_url;
    if (mp3Url) {
      const mp3File = {
        url: mp3Url,
        title: content.title || `Generated Track ${index + 1}`,
        mp3Duration: content.conversion_duration || null,
        requestNumber: index + 1,
        uuid: request.requestInfo.uuid,
        timestamp: request.requestInfo.timestamp,
        // Additional metadata
        wavUrl: content.conversion_path_wav || null,
        lyrics: content.lyrics || null,
        albumCover: content.album_cover_path || null,
        isFlagged: content.is_flagged || false,
        taskId: content.task_id || content.conversion_id || null,
        // Ã¢Å“â€¦ NEW: Add timing metadata for full video coverage
        suggestedStartTime: 0,
        suggestedEndTime: null, // Will be set to video duration
        placementType: 'FULL_VIDEO_BACKGROUND'
      };
      
      mp3Files.push(mp3File);
      
      console.log(`Ã°Å¸Å½Âµ Extracted MP3 #${index + 1}:`);
      console.log(`   Ã°Å¸Å½Â¼ Title: "${mp3File.title}"`);
      console.log(`   Ã°Å¸â€â€” URL: ${mp3File.url}`);
      console.log(`   Ã¢ÂÂ±Ã¯Â¸Â Duration: ${mp3File.mp3Duration || 'Unknown'} seconds`);
      console.log(`   Ã°Å¸â€œâ€¦ Generated: ${mp3File.timestamp}`);
      console.log(`   Ã°Å¸Å½Â¯ Suggested Placement: Full video background (0s to end)`);
      console.log('   ---');
    }
  });
  
  console.log(`Ã°Å¸â€œÅ  Total MP3 files extracted: ${mp3Files.length}`);
  console.log('Ã°Å¸Å½Âµ ===============================================\n');
  
  return mp3Files;
}

// Ã¢Å“â€¦ ADD this function to your main endpoint's success section
// Insert this right before your final res.json() response:

function displayWebhookTimingResults(musicResult, videoDurationSeconds) {
  if (!musicResult || !musicResult.allMP3Files) {
    console.log('Ã¢Å¡ Ã¯Â¸Â No music result or MP3 files to display timing for');
    return;
  }

  console.log('\nÃ°Å¸Å½Â¼ ===============================================');
  console.log('Ã°Å¸Å½Â¼ FINAL WEBHOOK TIMING RECOMMENDATIONS');
  console.log('Ã°Å¸Å½Â¼ ===============================================');
  console.log(`Ã°Å¸Å½Â¬ Video Duration: ${videoDurationSeconds} seconds`);
  console.log(`Ã°Å¸Å½Âµ Total Tracks Generated: ${musicResult.allMP3Files.length}`);
  console.log('Ã°Å¸â€œâ€¹ All tracks will cover the COMPLETE video duration');
  
  console.log('\nÃ°Å¸â€œÅ  TRACK TIMING DETAILS:');
  console.log('Ã°Å¸â€œÅ  ===============================================');

  musicResult.allMP3Files.forEach((track, index) => {
    const trackNumber = index + 1;
    const startTime = 0;
    const endTime = videoDurationSeconds;
    
    console.log(`\nÃ°Å¸Å½Âµ TRACK ${trackNumber}: "${track.title}"`);
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log(`Ã°Å¸â€œÂ START TIME: ${startTime} seconds`);
    console.log(`Ã°Å¸ÂÂ END TIME: ${endTime} seconds`);
    console.log(`Ã¢ÂÂ±Ã¯Â¸Â DURATION: ${endTime - startTime} seconds (FULL VIDEO)`);
    console.log(`Ã°Å¸Å½Â¼ SONG NAME: "${track.title}"`);
    console.log(`Ã°Å¸â€â€” MP3 URL: ${track.url}`);
    console.log(`Ã°Å¸Å½Âµ ORIGINAL MP3 LENGTH: ${track.mp3Duration || 'Unknown'} seconds`);
    console.log(`Ã°Å¸â€œâ€¦ GENERATED AT: ${track.timestamp}`);
    console.log(`Ã°Å¸Å½Â¯ PLACEMENT: Full video background music`);
    console.log(`Ã¢Å“â€¦ COVERAGE: Complete ${videoDurationSeconds}s video duration`);
    console.log('Ã°Å¸Å½Âµ ===============================================');
  });

  console.log('\nÃ°Å¸â€œâ€¹ QUICK REFERENCE - COPY THIS:');
  console.log('Ã°Å¸â€œâ€¹ ===============================================');
  musicResult.allMP3Files.forEach((track, index) => {
    console.log(`Track ${index + 1}: "${track.title}" | 0s-${videoDurationSeconds}s | ${track.url}`);
  });
  console.log('Ã°Å¸â€œâ€¹ ===============================================');
  
  console.log('\nÃ°Å¸Å½Â¼ ===============================================');
  console.log('Ã°Å¸Å½Â¼ END OF WEBHOOK TIMING RECOMMENDATIONS');
  console.log('Ã°Å¸Å½Â¼ ===============================================\n');
}

// Ã¢Å“â€¦ IN YOUR MAIN ENDPOINT: Add this right before res.json():
/*
    // Just before your res.json() call, add:
    
    // Display webhook timing results if available
    if (musicResult?.status === 'completed_via_webhook' && musicResult.allMP3Files) {
      displayWebhookTimingResults(musicResult, videoDurationSeconds);
    }
    
    // Then your existing res.json()...
*/

// Ã°Å¸Å¡Â¨ NEW: Extract MP3 files from webhook requests
function extractMP3FilesFromRequests(requests) {
  const mp3Files = [];
  
  requests.forEach((request, index) => {
    const content = request.content;
    
    const mp3Url = content.conversion_path || content.audio_url;
    if (mp3Url) {
      mp3Files.push({
        url: mp3Url,
        title: content.title || `Generated Track ${index + 1}`,
        mp3Duration: content.conversion_duration || null,
        requestNumber: index + 1,
        uuid: request.requestInfo.uuid,
        timestamp: request.requestInfo.timestamp,
        // Additional metadata
        wavUrl: content.conversion_path_wav || null,
        lyrics: content.lyrics || null,
        albumCover: content.album_cover_path || null,
        isFlagged: content.is_flagged || false,
        taskId: content.task_id || content.conversion_id || null
      });
      
      console.log(`Ã°Å¸Å½Âµ Extracted MP3 #${index + 1}: ${content.title || 'Untitled'}`);
      console.log(`   URL: ${mp3Url}`);
      console.log(`   Duration: ${content.conversion_duration || 'Unknown'}s`);
    }
  });
  
  console.log(`Ã°Å¸â€œÅ  Total MP3 files extracted: ${mp3Files.length}`);
  return mp3Files;
}

/**
 * Extract webhook token from webhook URL
 * @param {string} webhookUrl - The full webhook.site URL
 * @returns {string} - The extracted token
 */
function extractWebhookToken(webhookUrl) {
  const match = webhookUrl.match(/webhook\.site\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * Extract timing recommendations from Gemini analysis text
 * @param {string} analysisText - The Gemini analysis response
 * @param {Array} mp3Files - Array of MP3 file objects
 * @returns {Array} - Array of timing recommendations
 */
/**
 * Extract timing recommendations from Gemini analysis text
 * @param {string} analysisText - The Gemini analysis response
 * @param {Array} mp3Files - Array of MP3 file objects
 * @returns {Array} - Array of timing recommendations
 */
/**
 * Extract timing recommendations from Gemini analysis text
 * @param {string} analysisText - The Gemini analysis response
 * @param {Array} mp3Files - Array of MP3 file objects
 * @returns {Array} - Array of timing recommendations
 */
/**
 * Extract timing recommendations from Gemini analysis text
 * @param {string} analysisText - The Gemini analysis response
 * @param {Array} mp3Files - Array of MP3 file objects
 * @returns {Array} - Array of timing recommendations
 */
// Ã°Å¸Å¡Â¨ REPLACE your existing extractTimingFromAnalysis function in index.js with this FIXED version:

// Ã¢Å“â€¦ CRITICAL FIX: Replace your existing extractTimingFromAnalysis function in index.js with this:

// Ã¢Å“â€¦ FIXED VERSION - Replace the extractTimingFromAnalysis function in your index.js
// Ã¢Å“â€¦ REPLACE your extractTimingFromAnalysis function with this enhanced version
// This version extracts the ACTUAL start/end times from Gemini's analysis




// Ã¢Å“â€¦ IN YOUR MAIN ENDPOINT: Replace the existing timing display with this simple version
// Find this section in your /api/analyze-gcs-video-for-music-with-generation endpoint:

/*
    // Display final timing recommendations summary
    if (musicResult?.geminiTimingRecommendations && musicResult.geminiTimingRecommendations.length > 0) {
      displayFinalTimingSummary(musicResult.geminiTimingRecommendations, videoDurationSeconds);
    } else if (musicResult?.allMP3Files && musicResult.allMP3Files.length > 0) {
      // ... existing code ...
    }
*/

// Ã¢Å“â€¦ REPLACE it with this simpler version:

    // Show ONLY the final Gemini timing at the very end
    
// Ã¢Å“â€¦ ADD this function to display final timing summary


// Ã¢Å“â€¦ ADD this function to display webhook timing results
function displayWebhookTimingResults(musicResult, videoDurationSeconds) {
  if (!musicResult || !musicResult.allMP3Files) {
    console.log('Ã¢Å¡ Ã¯Â¸Â No music result or MP3 files to display timing for');
    return;
  }

  console.log('\nÃ°Å¸Å½Â¼ ===============================================');
  console.log('Ã°Å¸Å½Â¼ FINAL WEBHOOK TIMING RECOMMENDATIONS');
  console.log('Ã°Å¸Å½Â¼ ===============================================');
  console.log(`Ã°Å¸Å½Â¬ Video Duration: ${videoDurationSeconds} seconds`);
  console.log(`Ã°Å¸Å½Âµ Total Tracks Generated: ${musicResult.allMP3Files.length}`);
  console.log('Ã°Å¸â€œâ€¹ All tracks will cover the COMPLETE video duration');
  
  console.log('\nÃ°Å¸â€œÅ  TRACK TIMING DETAILS:');
  console.log('Ã°Å¸â€œÅ  ===============================================');

  musicResult.allMP3Files.forEach((track, index) => {
    const trackNumber = index + 1;
    const startTime = 0;
    const endTime = videoDurationSeconds;
    
    console.log(`\nÃ°Å¸Å½Âµ TRACK ${trackNumber}: "${track.title}"`);
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log(`Ã°Å¸â€œÂ START TIME: ${startTime} seconds`);
    console.log(`Ã°Å¸ÂÂ END TIME: ${endTime} seconds`);
    console.log(`Ã¢ÂÂ±Ã¯Â¸Â DURATION: ${endTime - startTime} seconds (FULL VIDEO)`);
    console.log(`Ã°Å¸Å½Â¼ SONG NAME: "${track.title}"`);
    console.log(`Ã°Å¸â€â€” MP3 URL: ${track.url}`);
    console.log(`Ã°Å¸Å½Âµ ORIGINAL MP3 LENGTH: ${track.mp3Duration || 'Unknown'} seconds`);
    console.log(`Ã°Å¸â€œâ€¦ GENERATED AT: ${track.timestamp}`);
    console.log(`Ã°Å¸Å½Â¯ PLACEMENT: Full video background music`);
    console.log(`Ã¢Å“â€¦ COVERAGE: Complete ${videoDurationSeconds}s video duration`);
    console.log('Ã°Å¸Å½Âµ ===============================================');
  });

  console.log('\nÃ°Å¸â€œâ€¹ QUICK REFERENCE - COPY THIS:');
  console.log('Ã°Å¸â€œâ€¹ ===============================================');
  musicResult.allMP3Files.forEach((track, index) => {
    console.log(`Track ${index + 1}: "${track.title}" | 0s-${videoDurationSeconds}s | ${track.url}`);
  });
  console.log('Ã°Å¸â€œâ€¹ ===============================================');
  
  console.log('\nÃ°Å¸Å½Â¼ ===============================================');
  console.log('Ã°Å¸Å½Â¼ END OF WEBHOOK TIMING RECOMMENDATIONS');
  console.log('Ã°Å¸Å½Â¼ ===============================================\n');
}
// ===============================================
// ENHANCED ENDPOINT - REPLACE YOUR EXISTING ONE
// ===============================================
// Add this endpoint to your index.js file

// Ã°Å¸Å½Â¬ NEW: Analyze video for optimal music placement segments
app.post('/api/analyze-video-music-segments', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { customPrompt = '' } = req.body;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ VIDEO MUSIC SEGMENTATION ANALYSIS REQUEST');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Ã°Å¸â€œÂ Custom prompt:', customPrompt || 'None provided');

    // Import the music segmentation function
    const { analyzeVideoForMusicSegments } = require('./gemini-utils');

    // Analyze video for music segments
    const segmentationResult = await analyzeVideoForMusicSegments(
      req.file.buffer, 
      req.file.mimetype, 
      { customPrompt }
    );

    if (segmentationResult.success) {
      console.log('\nÃ°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸Å½â€° MUSIC SEGMENTATION ANALYSIS COMPLETED');
      console.log('Ã°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸â€œÅ  Total music segments found:', segmentationResult.totalSegments);
      console.log('Ã¢ÂÂ±Ã¯Â¸Â Processing time:', segmentationResult.processingTime);
      
      // Log segment summary
      if (segmentationResult.musicSegments.length > 0) {
        console.log('\nÃ°Å¸â€œâ€¹ SEGMENT SUMMARY:');
        segmentationResult.musicSegments.forEach((segment, index) => {
          console.log(`   ${index + 1}. ${segment.start}s-${segment.end}s: ${segment.type} (${segment.intensity})`);
        });
      }

      res.json({
        success: true,
        message: 'Video music segmentation analysis completed successfully!',
        rawGeminiResponse: segmentationResult.rawResponse,
        musicSegments: segmentationResult.musicSegments,
        totalSegments: segmentationResult.totalSegments,
        processingTime: segmentationResult.processingTime,
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        },
        analysisMetadata: {
          promptLength: segmentationResult.promptUsed?.length || 0,
          parseError: segmentationResult.parseError,
          analysisType: segmentationResult.analysisType
        }
      });

    } else {
      console.error('Ã¢ÂÅ’ Music segmentation analysis failed:', segmentationResult.error);
      
      res.status(500).json({
        success: false,
        error: segmentationResult.error,
        details: segmentationResult.details,
        rawGeminiResponse: segmentationResult.rawResponse
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform video music segmentation analysis',
      details: error.message
    });
  }
});

// Ã°Å¸Å’Â NEW: Analyze GCS video for music segments
app.post('/api/analyze-gcs-video-music-segments', async (req, res) => {
  try {
    const { 
      gcsUrl, 
      publicUrl, 
      customPrompt = ''
    } = req.body;

    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL or public URL provided'
      });
    }

    const videoUrl = publicUrl || gcsUrl;

    console.log('Ã°Å¸Å’Â ===============================================');
    console.log('Ã°Å¸Å’Â GCS VIDEO MUSIC SEGMENTATION ANALYSIS REQUEST');
    console.log('Ã°Å¸Å’Â ===============================================');
    console.log('Ã°Å¸â€â€” Video URL:', videoUrl);
    console.log('Ã°Å¸â€œÂ Custom prompt:', customPrompt || 'None provided');

    // Import the GCS music segmentation function
    const { analyzeGCSVideoForMusicSegments } = require('./gemini-utils');

    // Analyze GCS video for music segments
    const segmentationResult = await analyzeGCSVideoForMusicSegments(videoUrl, { customPrompt });

    if (segmentationResult.success) {
      console.log('\nÃ°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸Å½â€° GCS MUSIC SEGMENTATION ANALYSIS COMPLETED');
      console.log('Ã°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸â€œÅ  Total music segments found:', segmentationResult.totalSegments);
      console.log('Ã¢ÂÂ±Ã¯Â¸Â Processing time:', segmentationResult.processingTime);
      console.log('Ã°Å¸â€œÂ Source file:', segmentationResult.sourceFile);

      res.json({
        success: true,
        message: 'GCS video music segmentation analysis completed successfully!',
        rawGeminiResponse: segmentationResult.rawResponse,
        musicSegments: segmentationResult.musicSegments,
        totalSegments: segmentationResult.totalSegments,
        processingTime: segmentationResult.processingTime,
        sourceFile: segmentationResult.sourceFile,
        gcsUrl: segmentationResult.gcsUrl,
        analysisMetadata: {
          promptLength: segmentationResult.promptUsed?.length || 0,
          parseError: segmentationResult.parseError,
          analysisType: segmentationResult.analysisType
        }
      });

    } else {
      console.error('Ã¢ÂÅ’ GCS music segmentation analysis failed:', segmentationResult.error);
      
      const statusCode = segmentationResult.error.includes('404') ? 404 :
                        segmentationResult.error.includes('403') ? 403 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: segmentationResult.error,
        details: segmentationResult.details,
        gcsUrl: videoUrl,
        rawGeminiResponse: segmentationResult.rawResponse
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in GCS music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform GCS video music segmentation analysis',
      details: error.message
    });
  }
});

// Ã°Å¸Â§Âª NEW: Test music segmentation with sample video
app.post('/api/test-music-segmentation', async (req, res) => {
  try {
    const { testPrompt = '' } = req.body;

    console.log('Ã°Å¸Â§Âª ===============================================');
    console.log('Ã°Å¸Â§Âª TESTING MUSIC SEGMENTATION FUNCTIONALITY');
    console.log('Ã°Å¸Â§Âª ===============================================');

    // This is a test endpoint that explains the functionality
    const sampleResponse = {
      success: true,
      message: 'Music segmentation test endpoint - upload a video to /api/analyze-video-music-segments',
      functionality: {
        purpose: 'Analyze video to identify optimal music placement segments',
        input: 'Video file (MP4, AVI, MOV, etc.)',
        output: 'JSON array of music segments with timing and descriptions',
        analysisType: 'Cinematic and emotional analysis for music supervision'
      },
      sampleOutput: [
        {
          start: 0.0,
          end: 15.2,
          reason: "Opening scene with slow character introduction requires ambient background music to establish mood",
          intensity: "low",
          type: "ambient"
        },
        {
          start: 23.5,
          end: 34.8,
          reason: "Fast-paced montage sequence needs rhythmic music to match visual tempo",
          intensity: "high", 
          type: "rhythmic"
        },
        {
          start: 45.1,
          end: 52.3,
          reason: "Emotional dialogue scene benefits from subtle dramatic underscore",
          intensity: "medium",
          type: "emotional"
        }
      ],
      usage: {
        uploadEndpoint: '/api/analyze-video-music-segments',
        gcsEndpoint: '/api/analyze-gcs-video-music-segments',
        method: 'POST',
        contentType: 'multipart/form-data (for upload) or application/json (for GCS)'
      }
    };

    res.json(sampleResponse);

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in test music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Test endpoint error',
      details: error.message
    });
  }
});
// Find and REPLACE your existing /api/analyze-gcs-video-for-music-with-generation endpoint with this:
// REPLACE your existing /api/analyze-gcs-video-for-music-with-generation endpoint with this enhanced version
// Ã¢Å“â€¦ CORRECT ORDER: Dual Analysis Ã¢â€ â€™ Main Music + Webhook Ã¢â€ â€™ Segmentation Ã¢â€ â€™ Segment Music Ã¢â€ â€™ Final Analysis

// Ã¢Å“â€¦ COMPLETE /api/analyze-gcs-video-for-music-with-generation ENDPOINT
// Replace your existing endpoint with this complete version


// ===============================================
// BONUS: Standalone webhook monitoring endpoint
// ===============================================
// Ã¢Å“â€¦ STEP 1: Add this function to your index.js file (before your endpoints)

// Ã°Å¸Å¡Â¨ PROBLEM: Backend ignores Gemini timing recommendations and uses default values
// GEMINI SAYS: Track 1: 10-30s, Track 2: 35-55s  
// BACKEND RETURNS: Both tracks 0:00-0:20 (WRONG!)

// Ã°Å¸Å¡Â¨ SOLUTION: Extract timing from Gemini analysis text

// 1. ADD THIS TIMING EXTRACTION FUNCTION TO YOUR BACKEND
// Ã°Å¸Å¡Â¨ FIXED TIMING EXTRACTION FUNCTION FOR YOUR SPECIFIC GEMINI FORMAT

function extractTimingFromGeminiAnalysis(analysisText, mp3Files, clipDuration) {
  console.log('Ã°Å¸Å½Â¯ EXTRACTING TIMING FROM GEMINI ANALYSIS...');
  console.log('Ã°Å¸â€œâ€ž Analysis text length:', analysisText.length);
  console.log('Ã°Å¸â€œâ€ž First 500 chars:', analysisText.substring(0, 500));
  
  const recommendations = [];
  
  try {
    // Helper function to format seconds as MM:SS
    const formatTime = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };
    
    // Ã°Å¸Å¡Â¨ NEW PATTERNS FOR YOUR GEMINI FORMAT:
    // Looking for patterns like:
    // "* **Start time:** 10 seconds"
    // "* **End time:** 30.02 seconds" 
    // "* **Volume recommendation:** 60%"
    
    // Split by Track sections - look for **Track 1:** or **Track 2:**
    const trackMatches = analysisText.match(/\*\*Track \d+:.*?(?=\*\*Track \d+:|$)/gs);
    
    if (!trackMatches) {
      console.warn('Ã¢ÂÅ’ No **Track N:** sections found in analysis');
      console.log('Ã°Å¸â€œâ€ž Trying alternative splitting...');
      
      // Alternative: split by lines containing "Track"
      const lines = analysisText.split('\n');
      const trackLines = [];
      let currentTrack = '';
      
      for (const line of lines) {
        if (line.includes('Track ') && line.includes(':')) {
          if (currentTrack) trackLines.push(currentTrack);
          currentTrack = line + '\n';
        } else {
          currentTrack += line + '\n';
        }
      }
      if (currentTrack) trackLines.push(currentTrack);
      
      console.log(`Ã°Å¸â€œÅ  Found ${trackLines.length} track sections via line splitting`);
      trackLines.forEach((section, i) => {
        console.log(`Ã°Å¸â€œâ€ž Track section ${i + 1}:`, section.substring(0, 200));
      });
    } else {
      console.log(`Ã°Å¸â€œÅ  Found ${trackMatches.length} track sections via regex`);
    }
    
    const sectionsToProcess = trackMatches || trackLines || [];
    
    // Process each track section
    sectionsToProcess.forEach((trackSection, index) => {
      const trackNumber = index + 1;
      const mp3File = mp3Files[index];
      
      if (!mp3File) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â No MP3 file for track ${trackNumber}`);
        return;
      }
      
      console.log(`\nÃ°Å¸Å½Âµ Processing Track ${trackNumber} (${mp3File.title}):`);
      console.log(`Ã°Å¸â€œâ€ž Section (first 300 chars): ${trackSection.substring(0, 300)}...`);
      
      let startTime = 0;
      let endTime = clipDuration;
      let volume = 70;
      
      // Ã°Å¸Å¡Â¨ MULTIPLE REGEX PATTERNS FOR START TIME:
      const startPatterns = [
        /\*\s*\*\*\s*Start time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /\*\*\s*Start time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /Start time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /Start time:\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /start.*?(\d+(?:\.\d+)?)\s*seconds?/i
      ];
      
      for (const pattern of startPatterns) {
        const match = trackSection.match(pattern);
        if (match) {
          startTime = parseFloat(match[1]);
          console.log(`Ã¢Å“â€¦ Found start time with pattern: ${pattern} -> ${startTime}s`);
          break;
        }
      }
      
      // Ã°Å¸Å¡Â¨ MULTIPLE REGEX PATTERNS FOR END TIME:
      const endPatterns = [
        /\*\s*\*\*\s*End time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /\*\*\s*End time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /End time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /End time:\s*(\d+(?:\.\d+)?)\s*seconds?/i,
        /end.*?(\d+(?:\.\d+)?)\s*seconds?/i
      ];
      
      for (const pattern of endPatterns) {
        const match = trackSection.match(pattern);
        if (match) {
          endTime = parseFloat(match[1]);
          console.log(`Ã¢Å“â€¦ Found end time with pattern: ${pattern} -> ${endTime}s`);
          break;
        }
      }
      
      // Ã°Å¸Å¡Â¨ MULTIPLE REGEX PATTERNS FOR VOLUME:
      const volumePatterns = [
        /\*\s*\*\*\s*Volume recommendation:\s*\*\*\s*(\d+)%/i,
        /\*\*\s*Volume recommendation:\s*\*\*\s*(\d+)%/i,
        /Volume recommendation:\s*\*\*\s*(\d+)%/i,
        /Volume recommendation:\s*(\d+)%/i,
        /volume.*?(\d+)%/i
      ];
      
      for (const pattern of volumePatterns) {
        const match = trackSection.match(pattern);
        if (match) {
          volume = parseInt(match[1]);
          console.log(`Ã¢Å“â€¦ Found volume with pattern: ${pattern} -> ${volume}%`);
          break;
        }
      }
      
      // Calculate duration
      const duration = Math.round((endTime - startTime) * 100) / 100;
      
      console.log(`Ã°Å¸â€œÅ  Extracted values for Track ${trackNumber}:`, {
        startTime,
        endTime, 
        duration,
        volume
      });
      
      // Validate timing makes sense
      if (startTime >= 0 && endTime > startTime && duration > 0) {
        recommendations.push({
          trackNumber: trackNumber,
          title: mp3File.title,
          url: mp3File.url,
          originalDuration: mp3File.mp3Duration,
          videoDuration: clipDuration,
          
          // Ã°Å¸Å¡Â¨ EXTRACTED TIMING FROM GEMINI:
          startTime: startTime,
          endTime: endTime,
          duration: duration,
          
          // Ã°Å¸Å¡Â¨ FORMATTED FOR FRONTEND:
          startFormatted: formatTime(startTime),
          endFormatted: formatTime(endTime),
          durationFormatted: `${Math.round(duration)}s`,
          
          // Volume and fade info
          volume: volume,
          volumeDecimal: volume / 100,
          fadeIn: 2,
          fadeOut: 2
        });
        
        console.log(`Ã¢Å“â€¦ Track ${trackNumber} timing successfully extracted:`, {
          start: `${startTime}s (${formatTime(startTime)})`,
          end: `${endTime}s (${formatTime(endTime)})`,
          duration: `${duration}s`,
          volume: `${volume}%`
        });
        
      } else {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Track ${trackNumber} has invalid timing values:`, {
          startTime, endTime, duration, valid: false
        });
        
        // Still add a default recommendation to maintain array alignment
        recommendations.push({
          trackNumber: trackNumber,
          title: mp3File.title,
          url: mp3File.url,
          startTime: 0,
          endTime: clipDuration,
          duration: clipDuration,
          startFormatted: formatTime(0),
          endFormatted: formatTime(clipDuration),
          durationFormatted: `${clipDuration}s`,
          volume: 70,
          volumeDecimal: 0.7,
          isDefault: true
        });
      }
    });
    
    console.log(`Ã°Å¸Å½Â¯ Final extraction results: ${recommendations.length} recommendations`);
    recommendations.forEach((rec, i) => {
      console.log(`   Track ${rec.trackNumber}: ${rec.startFormatted} Ã¢â€ â€™ ${rec.endFormatted} (${rec.durationFormatted}) Vol: ${rec.volume}%${rec.isDefault ? ' [DEFAULT]' : ''}`);
    });
    
    return recommendations;
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error extracting Gemini timing:', error.message);
    console.error('Ã¢ÂÅ’ Stack trace:', error.stack);
    
    // Fallback: Create default recommendations for all MP3 files
    console.log('Ã°Å¸â€â€ž Creating fallback recommendations...');
    const fallbackRecs = mp3Files.map((file, index) => ({
      trackNumber: index + 1,
      title: file.title,
      url: file.url,
      startTime: 0,
      endTime: clipDuration,
      duration: clipDuration,
      startFormatted: formatTime(0),
      endFormatted: formatTime(clipDuration),
      durationFormatted: `${clipDuration}s`,
      volume: 70,
      volumeDecimal: 0.7,
      isDefault: true,
      fallbackReason: 'extraction_error'
    }));
    
    console.log(`Ã°Å¸â€â€ž Created ${fallbackRecs.length} fallback recommendations`);
    return fallbackRecs;
  }
}

// Ã°Å¸Å¡Â¨ ADDITIONAL DEBUG FUNCTION - ADD THIS TO TEST WITH YOUR ACTUAL GEMINI TEXT

function debugGeminiAnalysis(analysisText) {
  console.log('\nÃ°Å¸â€Â ===============================================');
  console.log('Ã°Å¸â€Â DEBUGGING GEMINI ANALYSIS TEXT');
  console.log('Ã°Å¸â€Â ===============================================');
  
  console.log('Ã°Å¸â€œâ€ž Full text length:', analysisText.length);
  console.log('Ã°Å¸â€œâ€ž First 1000 characters:');
  console.log(analysisText.substring(0, 1000));
  
  console.log('\nÃ°Å¸â€œÅ  Looking for track sections...');
  const trackMatches = analysisText.match(/\*\*Track \d+:/g);
  console.log('Ã°Å¸â€œÅ  Track headers found:', trackMatches);
  
  console.log('\nÃ°Å¸â€œÅ  Looking for timing patterns...');
  const startTimeMatches = analysisText.match(/start time.*?(\d+(?:\.\d+)?)\s*seconds?/gi);
  console.log('Ã°Å¸â€œÅ  Start time patterns found:', startTimeMatches);
  
  const endTimeMatches = analysisText.match(/end time.*?(\d+(?:\.\d+)?)\s*seconds?/gi);
  console.log('Ã°Å¸â€œÅ  End time patterns found:', endTimeMatches);
  
  const volumeMatches = analysisText.match(/volume.*?(\d+)%/gi);
  console.log('Ã°Å¸â€œÅ  Volume patterns found:', volumeMatches);
  
  console.log('\nÃ°Å¸â€œâ€ž Line by line analysis:');
  const lines = analysisText.split('\n');
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes('start') || 
        line.toLowerCase().includes('end') || 
        line.toLowerCase().includes('volume') ||
        line.toLowerCase().includes('track')) {
      console.log(`Line ${i + 1}: ${line.trim()}`);
    }
  });
  
  console.log('Ã°Å¸â€Â ===============================================');
}


function displayGeminiTimingResults(timingRecommendations) {
  console.log('\nÃ°Å¸Å½Âµ ===============================================');
  console.log('Ã°Å¸Å½Âµ GEMINI TIMING EXTRACTION RESULTS');
  console.log('Ã°Å¸Å½Âµ ===============================================');
  
  if (!timingRecommendations || timingRecommendations.length === 0) {
    console.log('Ã¢ÂÅ’ No timing recommendations available');
    return;
  }
  
  timingRecommendations.forEach((rec) => {
    console.log(`\nÃ°Å¸Å½Â¼ TRACK ${rec.trackNumber}: "${rec.title}"`);
    console.log('Ã°Å¸Å½Â¼ ===============================================');
    console.log(`Ã¢ÂÂ° START TIME: ${rec.recommendedStart} seconds`);
    console.log(`Ã¢ÂÂ° END TIME: ${rec.recommendedEnd} seconds`);  
    console.log(`Ã¢ÂÂ±Ã¯Â¸Â RECOMMENDED DURATION: ${rec.recommendedDuration.toFixed(2)} seconds`);
    console.log(`Ã°Å¸Å½Âµ ORIGINAL MP3 LENGTH: ${rec.originalDuration} seconds`);
    console.log(`Ã°Å¸â€â€” AUDIO URL: ${rec.url}`);
    console.log(`Ã¢Å“â€¦ EXTRACTION STATUS: ${rec.extractedSuccessfully ? 'SUCCESS' : 'FALLBACK USED'}`);
    console.log('Ã°Å¸Å½Â¼ ===============================================');
  });
  
  console.log('\nÃ°Å¸â€œâ€¹ QUICK COPY REFERENCE:');
  console.log('Ã°Å¸â€œâ€¹ ===============================================');
  timingRecommendations.forEach((rec) => {
    console.log(`Track ${rec.trackNumber}: "${rec.title}" | ${rec.recommendedStart}s-${rec.recommendedEnd}s | ${rec.url}`);
  });
  console.log('Ã°Å¸â€œâ€¹ ===============================================\n');
}

app.post('/api/monitor-webhook', async (req, res) => {
  try {
    const {
      webhookUrl = "a54d685c-b636-4641-a883-edd74a6b7981",
      maxPollMinutes = 3,
      pollIntervalSeconds = 10,
      minRequests = 3  // ✅ NEW: Configurable minimum requests to wait for
    } = req.body;

    console.log('🎵 Starting standalone webhook monitoring...');
    console.log('📊 Waiting for minimum', minRequests, 'POST requests');
    
    const webhookToken = extractWebhookToken(webhookUrl);
    if (!webhookToken) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook URL format'
      });
    }

    const maxRetries = Math.floor((maxPollMinutes * 60) / pollIntervalSeconds);
    const pollInterval = pollIntervalSeconds * 1000;

    const result = await monitorWebhookForMusicGPT(webhookToken, maxRetries, pollInterval, minRequests);

    res.json({
      success: result.success,
      webhookData: result.webhookData || null,
      requestInfo: result.requestInfo || null,
      allMP3Files: result.allMP3Files || [],  // Include all MP3 files found
      monitoringInfo: {
        totalAttempts: result.totalPolls,
        maxPollMinutes: maxPollMinutes,
        pollIntervalSeconds: pollIntervalSeconds,
        minRequests: minRequests,
        totalRequestsFound: result.totalRequestsFound || 0,
        webhookToken: webhookToken,
        webhookUrl: webhookUrl,
        timeoutButFound: result.timeoutButFound || false
      },
      error: result.error || null
    });

  } catch (error) {
    console.error('❌ Error in standalone webhook monitoring:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook monitoring failed',
      details: error.message
    });
  }
});
// Ã¢Å“â€¦ BONUS: Add standalone task checker endpoint
app.post('/api/check-musicgpt-task', async (req, res) => {
  try {
    const { taskId } = req.body;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'No task ID provided'
      });
    }

    console.log('Ã°Å¸â€Â Checking MusicGPT task:', taskId);

    const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

    const response = await axios.get(
      `https://api.musicgpt.com/api/public/v1/task/${taskId}`,
      {
        headers: {
          'accept': 'application/json',
          'Authorization': MUSICGPT_API_KEY
        },
        timeout: 30000
      }
    );

    const taskData = response.data;
    
    console.log('Ã°Å¸â€œÅ  Task status:', taskData.status);
    if (taskData.audio_url) {
      console.log('Ã°Å¸Å½Âµ Audio URL:', taskData.audio_url);
    }

    res.json({
      success: true,
      taskId: taskId,
      status: taskData.status,
      audio_url: taskData.audio_url || null,
      title: taskData.title || null,
      duration: taskData.duration || null,
      progress: taskData.progress || 0,
      eta: taskData.eta || null,
      taskData: taskData,
      message: taskData.audio_url ? 
        'Ã°Å¸Å½â€° Music is ready!' : 
        `Ã¢ÂÂ³ Status: ${taskData.status || 'processing'}`
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error checking MusicGPT task:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to check task status',
      details: error.message
    });
  }
});

// 2. HELPER FUNCTION TO OPTIMIZE GEMINI OUTPUT FOR MUSICGPT
function optimizeGeminiAnalysisForMusicGPT(geminiAnalysis) {
  console.log('Ã°Å¸â€Â§ Optimizing Gemini analysis for MusicGPT...');
  
  // Extract music-relevant sections
  const musicKeywords = [
    'tempo', 'bpm', 'beat', 'rhythm', 'drums', 'percussion',
    'bass', 'guitar', 'piano', 'keyboard', 'synth', 'strings',
    'brass', 'woodwind', 'vocal', 'melody', 'harmony', 'chord',
    'key', 'scale', 'major', 'minor', 'progression',
    'genre', 'style', 'mood', 'emotion', 'atmosphere',
    'verse', 'chorus', 'bridge', 'intro', 'outro', 'solo',
    'reverb', 'delay', 'distortion', 'compression', 'eq',
    'orchestral', 'electronic', 'acoustic', 'ambient', 'cinematic'
  ];

  // Split analysis into sentences
  const sentences = geminiAnalysis.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Find sentences with musical content
  const musicalSentences = sentences.filter(sentence => {
    const lowerSentence = sentence.toLowerCase();
    return musicKeywords.some(keyword => lowerSentence.includes(keyword));
  });

  // Build optimized prompt
  let optimizedPrompt = '';

  if (musicalSentences.length > 0) {
    optimizedPrompt = musicalSentences.join('. ').trim() + '.';
  } else {
    // Fallback: use first part of analysis
    optimizedPrompt = geminiAnalysis.substring(0, 800).trim();
  }

  // Add specific music generation instructions
  optimizedPrompt += `

MUSIC GENERATION PARAMETERS:
- Create instrumental background music that matches the visual content described above
- Use the specified genre, tempo, and mood characteristics
- Include the mentioned instruments and production style
- Structure the music with proper intro, development, and conclusion
- Ensure the energy and emotion align with the video content
- Generate high-quality audio suitable for video soundtrack use`;

  console.log('Ã¢Å“â€¦ Analysis optimized for MusicGPT');
  console.log('Ã°Å¸â€œÂ Original length:', geminiAnalysis.length, 'chars');
  console.log('Ã°Å¸â€œÂ Optimized length:', optimizedPrompt.length, 'chars');
  console.log('Ã°Å¸Å½Âµ Musical sentences found:', musicalSentences.length);

  return optimizedPrompt;
}
// Ã¢Å“â€¦ ENHANCED: Add this new endpoint for immediate analysis after upload
app.post('/api/upload-and-analyze-gcs', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { 
      customPrompt, 
      analysisType = 'full', 
      genre = null,
      detailLevel = 'detailed',
      waitForAvailability = true
    } = req.body;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ UPLOAD + IMMEDIATE GCS ANALYSIS WORKFLOW');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Ã¢ÂÂ° Wait for availability:', waitForAvailability);

    // Step 1: Upload to GCS
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ Uploading to Google Cloud Storage...');
    
    const { generateUploadUrl } = require('./gcs-utils');
    const uploadData = await generateUploadUrl(`videos/${Date.now()}_${req.file.originalname}`);
    
    const axios = require('axios');
    const uploadStartTime = Date.now();
    
    await axios.put(uploadData.put_url, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': req.file.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    
    console.log('Ã¢Å“â€¦ Upload completed in', uploadTime, 'seconds');
    console.log('Ã°Å¸â€â€” GCS URI:', uploadData.gcs_uri);
    console.log('Ã°Å¸Å’Â Signed URL:', uploadData.public_url);

    // Step 2: Wait for file availability (if requested)
    if (waitForAvailability) {
      console.log('\nÃ¢ÂÂ³ Waiting for file to be fully available...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
    }

    // Step 3: Analyze with retry logic
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ Starting Gemini analysis with retry logic...');
    
    const options = {
      customPrompt,
      genre,
      analysisType,
      detailLevel
    };

    let analysisResult;
    let lastError;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Ã°Å¸â€â€ž Analysis attempt ${attempt}/${maxRetries}...`);
        
        if (attempt > 1) {
          const delay = 2000 * attempt; // Increasing delay
          console.log(`Ã¢ÂÂ³ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        analysisResult = await analyzeVideoFromGCS(uploadData.public_url, options);
        
        if (analysisResult.success) {
          console.log(`Ã¢Å“â€¦ Analysis successful on attempt ${attempt}`);
          break;
        } else {
          lastError = analysisResult;
          console.log(`Ã¢ÂÅ’ Attempt ${attempt} failed:`, analysisResult.error);
        }
        
      } catch (error) {
        lastError = { 
          success: false, 
          error: error.message, 
          attempt: attempt 
        };
        console.log(`Ã¢ÂÅ’ Attempt ${attempt} threw error:`, error.message);
      }
    }

    // Return results
    if (analysisResult && analysisResult.success) {
      console.log('\nÃ¢Å“â€¦ ===============================================');
      console.log('Ã¢Å“â€¦ UPLOAD + ANALYSIS WORKFLOW COMPLETED');
      console.log('Ã¢Å“â€¦ ===============================================');
      console.log('Ã¢ÂÂ±Ã¯Â¸Â Total time: Upload (' + uploadTime + 's) + Analysis (' + analysisResult.processingTime + ')');
      
      res.json({
        success: true,
        message: 'Video uploaded and analyzed successfully!',
        
        // Upload results
        upload: {
          gcs_uri: uploadData.gcs_uri,
          public_url: uploadData.public_url,
          file_name: uploadData.file_name,
          upload_time: uploadTime + 's'
        },
        
        // Analysis results  
        analysis: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        detailLevel: analysisResult.detailLevel,
        genre: analysisResult.genre,
        
        // Metadata
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        },
        
        timing: {
          uploadTime: uploadTime + 's',
          analysisTime: analysisResult.processingTime,
          attemptsNeeded: analysisResult.attemptsNeeded || 1
        }
      });
    } else {
      console.error('\nÃ¢ÂÅ’ ===============================================');
      console.error('Ã¢ÂÅ’ ANALYSIS FAILED AFTER SUCCESSFUL UPLOAD');
      console.error('Ã¢ÂÅ’ ===============================================');
      
      res.status(500).json({
        success: false,
        error: 'Upload succeeded but analysis failed: ' + (lastError?.error || 'Unknown error'),
        upload: {
          gcs_uri: uploadData.gcs_uri,
          public_url: uploadData.public_url,
          upload_time: uploadTime + 's'
        },
        analysisError: lastError,
        suggestions: getErrorSuggestions(lastError)
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in upload + analysis workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed in upload and analysis workflow',
      details: error.message
    });
  }
});
// ===============================================
// MUSICGPT AI INTEGRATION MODULE
// ===============================================
// Add these functions and endpoints to your existing index.js
// MusicGPT AI Configuration
const MUSICGPT_API_BASE = 'https://api.musicgpt.com/api/public/v1';
const MUSICGPT_API_KEY =  'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

// ===============================================
// MUSICGPT AI UTILITY FUNCTIONS
// ===============================================

/**
 * Generate music from text description using MusicGPT AI
 * @param {string} textDescription - Music description from Gemini analysis
 * @param {Object} options - Additional options for music generation
 * @returns {Object} Generated music data
 */
async function generateMusicFromText(textDescription, options = {}) { try {
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸Å½Âµ GENERATING MUSIC FROM GEMINI ANALYSIS');
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸â€œÂ Gemini analysis length:', geminiAnalysis.length, 'characters');
    console.log('Ã°Å¸â€œÂ Analysis preview:', geminiAnalysis.substring(0, 200) + '...');

    const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

    // Use the FULL Gemini analysis as the music_style
    const payload = {
      music_style: geminiAnalysis, // Direct Gemini text here
      webhook_url: "https://httpbin.org/post" // Dummy webhook URL
    };

    console.log('Ã°Å¸â€œÂ¤ Sending Gemini analysis to MusicGPT...');
    console.log('Ã°Å¸â€â€” API URL: https://api.musicgpt.com/api/public/v1/MusicAI');
    
    const startTime = Date.now();

    const response = await axios.post(
      'https://api.musicgpt.com/api/public/v1/MusicAI',
      payload,
      {
        headers: {
          'accept': 'application/json',
          'Authorization': MUSICGPT_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 1000 * 60 * 2 // 2 minutes timeout
      }
    );

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('Ã¢Å“â€¦ ===============================================');
    console.log('Ã¢Å“â€¦ MUSICGPT RESPONSE RECEIVED');
    console.log('Ã¢Å“â€¦ ===============================================');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Processing time:', processingTime, 'seconds');
    console.log('Ã°Å¸â€œÅ  Status:', response.status);
    console.log('Ã°Å¸â€œâ€ž Full response:', JSON.stringify(response.data, null, 2));

    const musicData = response.data;

    // Check what we got back
    if (musicData.audio_url) {
      console.log('\nÃ°Å¸Å½Â¶ ===============================================');
      console.log('Ã°Å¸Å½Â¶ MUSIC GENERATED SUCCESSFULLY!');
      console.log('Ã°Å¸Å½Â¶ ===============================================');
      console.log('Ã°Å¸â€â€” AUDIO URL:', musicData.audio_url);
      console.log('Ã°Å¸Å½Âµ Title:', musicData.title || 'Generated from Gemini Analysis');
      console.log('Ã°Å¸â€œÂ Lyrics:', musicData.lyrics || 'Instrumental');
      console.log('Ã°Å¸â€™Â° Cost:', musicData.conversion_cost || 'Unknown');
      console.log('Ã°Å¸Å½Â¶ ===============================================');
    } else if (musicData.task_id || musicData.conversion_id) {
      const taskId = musicData.task_id || musicData.conversion_id;
      console.log('\nÃ°Å¸â€â€ž ===============================================');
      console.log('Ã°Å¸â€â€ž MUSIC GENERATION STARTED');
      console.log('Ã°Å¸â€â€ž ===============================================');
      console.log('Ã°Å¸â€ â€ Task ID:', taskId);
      console.log('Ã¢ÂÂ³ Generation in progress...');
      console.log('Ã°Å¸â€™Â¡ You can poll for results using the task ID');
      console.log('Ã°Å¸â€â€ž ===============================================');
    }

    return {
      success: true,
      music: musicData,
      processingTime: processingTime + 's',
      geminiAnalysisUsed: geminiAnalysis.substring(0, 100) + '...'
    };

  } catch (error) {
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã¢ÂÅ’ MUSICGPT AI GENERATION ERROR');
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã°Å¸â€™Â¥ Error message:', error.message);
    
    if (error.response) {
      console.error('Ã°Å¸â€œÅ  HTTP Status:', error.response.status);
      console.error('Ã°Å¸â€œÅ  Response data:', JSON.stringify(error.response.data, null, 2));
    }

    return {
      success: false,
      error: error.message,
      details: error.response?.data,
      httpStatus: error.response?.status
    };
  }
}

app.post('/api/gemini-to-musicgpt-complete', async (req, res) => {
  try {
    const { gcsUri, publicUrl, customPrompt = '' } = req.body;
    
    if (!gcsUri && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'Need GCS URI or public URL'
      });
    }

    const videoUrl = publicUrl || gcsUri;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ COMPLETE GEMINI Ã¢â€ â€™ MUSICGPT WORKFLOW');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video URL:', videoUrl);

    // STEP 1: Get Gemini analysis
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ANALYZING VIDEO WITH GEMINI');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const { analyzeVideoFromGCS } = require('./gemini-utils');
    
    const geminiOptions = {
      customPrompt: customPrompt + `
      
      Analyze this video and create detailed music generation instructions including:
      - Musical style and genre that would fit this video
      - Specific mood and emotional tone
      - Tempo and energy level recommendations
      - Suggested instruments and arrangement
      - Overall atmosphere and feeling the music should convey
      
      Be creative and descriptive in your music recommendations.`,
      analysisType: 'full',
      detailLevel: 'detailed'
    };

    const geminiResult = await analyzeVideoFromGCS(videoUrl, geminiOptions);

    if (!geminiResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Gemini analysis failed',
        details: geminiResult.error
      });
    }

    // Log the complete Gemini analysis
    console.log('\nÃ°Å¸â€œÂ ===============================================');
    console.log('Ã°Å¸â€œÂ COMPLETE GEMINI ANALYSIS OUTPUT');
    console.log('Ã°Å¸â€œÂ ===============================================');
    console.log(geminiResult.analysis);
    console.log('Ã°Å¸â€œÂ ===============================================\n');

    // STEP 2: Send Gemini analysis directly to MusicGPT
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ SENDING GEMINI TEXT TO MUSICGPT');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const musicResult = await generateMusicFromGeminiText(geminiResult.analysis, {});

    // STEP 3: Final results
    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° WORKFLOW COMPLETED!');
    console.log('Ã°Å¸Å½â€° ===============================================');
    
    if (musicResult.success) {
      if (musicResult.music.audio_url) {
        console.log('Ã¢Å“â€¦ Gemini analysis: Complete');
        console.log('Ã¢Å“â€¦ Music generation: Complete');
        console.log('Ã°Å¸â€â€” Final music URL:', musicResult.music.audio_url);
      } else if (musicResult.music.task_id || musicResult.music.conversion_id) {
        console.log('Ã¢Å“â€¦ Gemini analysis: Complete');
        console.log('Ã°Å¸â€â€ž Music generation: In progress');
        console.log('Ã°Å¸â€ â€ Track with task ID:', musicResult.music.task_id || musicResult.music.conversion_id);
      }
    } else {
      console.log('Ã¢Å“â€¦ Gemini analysis: Complete');
      console.log('Ã¢ÂÅ’ Music generation: Failed');
      console.log('Ã°Å¸â€™Â¥ Error:', musicResult.error);
    }
    console.log('Ã°Å¸Å½â€° ===============================================\n');

    // Return complete results
    res.json({
      success: true,
      message: musicResult.success ? 
        'Video analyzed and music generated successfully!' : 
        'Video analyzed, music generation failed',
      
      // Gemini results
      geminiAnalysis: geminiResult.analysis,
      geminiProcessingTime: geminiResult.processingTime,
      
      // MusicGPT results
      musicResult: musicResult,
      musicUrl: musicResult.success ? (musicResult.music.audio_url || null) : null,
      taskId: musicResult.success ? (musicResult.music.task_id || musicResult.music.conversion_id || null) : null,
      
      // Workflow info
      videoUrl: videoUrl,
      totalProcessingTime: geminiResult.processingTime + (musicResult.processingTime || '0s')
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Complete workflow error:', error);
    res.status(500).json({
      success: false,
      error: 'Complete workflow failed',
      details: error.message
    });
  }
});

/**
 * Enhanced text processing for better MusicGPT prompts
 * @param {string} geminiAnalysis - Raw analysis from Gemini
 * @returns {string} Optimized prompt for MusicGPT
 */
function optimizeTextForMusicGeneration(geminiAnalysis) {
  console.log('Ã°Å¸â€Â§ Optimizing Gemini analysis for MusicGPT...');
  
  // Extract key musical elements from Gemini analysis
  const musicKeywords = [
    'tempo', 'bpm', 'key', 'chord', 'melody', 'harmony', 'rhythm',
    'drums', 'bass', 'guitar', 'piano', 'strings', 'brass', 'woodwinds',
    'synthesizer', 'ambient', 'cinematic', 'orchestral', 'electronic',
    'jazz', 'rock', 'classical', 'folk', 'world', 'experimental',
    'major', 'minor', 'diminished', 'augmented', 'pentatonic',
    'reverb', 'delay', 'chorus', 'distortion', 'compression'
  ];

  // Extract sentences containing musical terms
  const sentences = geminiAnalysis.split(/[.!?]+/);
  const musicalSentences = sentences.filter(sentence => 
    musicKeywords.some(keyword => 
      sentence.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  // Build optimized prompt
  let optimizedPrompt = '';
  
  if (musicalSentences.length > 0) {
    optimizedPrompt = musicalSentences.join('. ').trim();
  } else {
    // Fallback: use first 500 characters of analysis
    optimizedPrompt = geminiAnalysis.substring(0, 500).trim();
  }

  // Add MusicGPT-specific instructions
  optimizedPrompt += "\n\nGenerate instrumental music that matches this description. Focus on the specified instruments, tempo, and mood. Create a cohesive musical piece that captures the essence of the visual content described.";

  console.log('Ã¢Å“â€¦ Text optimized for MusicGPT');
  console.log('Ã°Å¸â€œÂ Original length:', geminiAnalysis.length, 'chars');
  console.log('Ã°Å¸â€œÂ Optimized length:', optimizedPrompt.length, 'chars');
  console.log('Ã°Å¸Å½Âµ Musical sentences found:', musicalSentences.length);

  return optimizedPrompt;
}

// ===============================================
// NEW API ENDPOINTS FOR GEMINI + MUSICGPT WORKFLOW
// ===============================================
// Ã°Å¸Å¡Â¨ NEW: Enhanced segment music generation endpoint with webhook support
// ADD this to your index.js backend file

app.post('/api/generate-segment-music-with-webhook', upload.single('video'), async (req, res) => {
  let trimmedPath, originalPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded." });
    }

    const { 
      video_start, 
      video_end, 
      youtubeUrls, 
      lyrics, 
      extra_description,
      instrumental, 
      song_title,
      track_name,
      webhook_url // Ã°Å¸Å¡Â¨ NEW: Accept webhook URL from frontend
    } = req.body;

    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸Å½Âµ GENERATING SEGMENT MUSIC WITH WEBHOOK MONITORING');
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã¢ÂÂ° Segment timing:', `${video_start}s - ${video_end}s`);
    console.log('Ã°Å¸Å½Â¯ Detailed description:', extra_description?.substring(0, 100) + '...');
    console.log('Ã°Å¸Å½Âµ Song title:', song_title);
    console.log('Ã°Å¸Å½Â¶ Track name:', track_name);
    console.log('Ã°Å¸â€œÂ¡ Webhook URL:', webhook_url || 'Not provided');

    // Save original video temporarily
    originalPath = path.join(tempDir, `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);

    // Extract segment timing
    const start = parseInt(video_start);
    const end = parseInt(video_end);
    const clipDuration = end - start;
    
    if (clipDuration <= 0) {
      throw new Error("Invalid time range - end time must be greater than start time");
    }

    if (clipDuration > 300) { // 5 minutes max
      throw new Error("Segment too long - maximum 5 minutes (300 seconds) allowed");
    }

    console.log('Ã¢Å“â€šÃ¯Â¸Â Processing video segment...');
    console.log(`   Duration: ${clipDuration} seconds`);
    console.log(`   Range: ${start}s to ${end}s`);

    // Trim video to segment
    trimmedPath = path.join(tempDir, `trimmed_segment_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(start)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Video segment trimmed successfully');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    // Clean up original file
    await fsPromises.unlink(originalPath);
    originalPath = null;

    // Ã°Å¸Å¡Â¨ NEW: Extract dual components from detailed_description
    console.log('Ã°Å¸â€Â ===============================================');
    console.log('Ã°Å¸â€Â EXTRACTING DUAL-OUTPUT COMPONENTS FOR WEBHOOK');
    console.log('Ã°Å¸â€Â ===============================================');
    
    const { extractDualOutputComponents } = require('./musicgpt-utils');
    const { prompt, music_style } = extractDualOutputComponents(extra_description);

    console.log('Ã°Å¸â€œÂ Visual Prompt:', prompt);
    console.log('Ã°Å¸Å½Âµ Music Style:', music_style);

    // Ã°Å¸Å¡Â¨ NEW: Generate music using MusicGPT with webhook monitoring
    console.log('\nÃ°Å¸Å½Â¼ ===============================================');
    console.log('Ã°Å¸Å½Â¼ CALLING MUSICGPT WITH WEBHOOK MONITORING');
    console.log('Ã°Å¸Å½Â¼ ===============================================');

    // Use the webhook URL provided by frontend, or use default
    const finalWebhookUrl = webhook_url || "https://webhook.site/a54d685c-b636-4641-a883-edd74a6b7981";
    
    console.log('Ã°Å¸â€œÂ¡ Using webhook URL:', finalWebhookUrl);

    const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

    const musicgptPayload = {
      prompt: prompt,
      music_style: music_style,
      make_instrumental: true,
      vocal_only: false,
      webhook_url: finalWebhookUrl // Ã°Å¸Å¡Â¨ NEW: Include webhook URL in payload
    };

    console.log('Ã°Å¸â€œÂ¤ MusicGPT Payload with Webhook:');
    console.log('Ã°Å¸Å½Âµ Prompt:', prompt);
    console.log('Ã°Å¸Å½Â­ Music Style:', music_style);
    console.log('Ã°Å¸Å½Â¼ Make Instrumental:', true);
    console.log('Ã°Å¸â€œÂ¡ Webhook URL:', finalWebhookUrl);

    console.log('Ã°Å¸â€œÂ¤ Calling MusicGPT API with webhook...');
    
    const musicgptStartTime = Date.now();

    const musicgptResponse = await axios.post(
      'https://api.musicgpt.com/api/public/v1/MusicAI',
      musicgptPayload,
      {
        headers: {
          'accept': 'application/json',
          'Authorization': MUSICGPT_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 1000 * 60 * 2 // 2 minutes timeout
      }
    );

    const musicgptProcessingTime = ((Date.now() - musicgptStartTime) / 1000).toFixed(2);

    console.log('Ã¢Å“â€¦ MusicGPT API Response with Webhook:');
    console.log('Ã°Å¸â€œÅ  Status:', musicgptResponse.status);
    console.log('Ã°Å¸â€œâ€ž Response:', JSON.stringify(musicgptResponse.data, null, 2));

    const musicData = musicgptResponse.data;

    if (musicData.audio_url) {
      // Ã°Å¸Å½â€° SUCCESS: Music generated immediately
      console.log('\nÃ°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸Å½â€° MUSIC GENERATED IMMEDIATELY!');
      console.log('Ã°Å¸Å½â€° ===============================================');
      console.log('Ã°Å¸â€â€” Audio URL:', musicData.audio_url);
      
      res.status(200).json({
        success: true,
        status: 'completed_immediately',
        url: musicData.audio_url,
        audio_url: musicData.audio_url,
        audioUrl: musicData.audio_url,
        title: musicData.title,
        duration: musicData.duration,
        track_name: track_name || musicData.title,
        generation_method: 'musicgpt_webhook_immediate',
        prompt_used: prompt,
        music_style_used: music_style,
        processing_time: musicgptProcessingTime,
        webhook_url: finalWebhookUrl,
        segment_info: {
          start: start,
          end: end,
          duration: clipDuration,
          track_name: track_name || musicData.title
        }
      });
      
    } else if (musicData.task_id || musicData.conversion_id || musicData.conversion_id_1) {
      // Ã°Å¸â€â€ž PROCESSING: Music generation started asynchronously
      const taskId = musicData.task_id || musicData.conversion_id_1 || musicData.conversion_id;
      
      console.log('Ã°Å¸â€â€ž ===============================================');
      console.log('Ã°Å¸â€â€ž MUSIC GENERATION STARTED (ASYNC WITH WEBHOOK)');
      console.log('Ã°Å¸â€â€ž ===============================================');
      console.log('Ã°Å¸â€ â€ Task ID:', taskId);
      console.log('Ã¢ÂÂ° ETA:', musicData.eta, 'seconds');
      console.log('Ã°Å¸â€œÂ¡ Webhook URL:', finalWebhookUrl);
      console.log('Ã°Å¸â€™Â¡ Frontend should now monitor webhook for completion');
      
      // Return processing status - frontend will handle webhook monitoring
      res.status(202).json({
        success: true,
        status: 'processing',
        task_id: taskId,
        eta: musicData.eta,
        webhook_url: finalWebhookUrl,
        message: 'Music generation started - monitor webhook for completion',
        track_name: track_name || 'Generated Track',
        generation_method: 'musicgpt_webhook_async',
        prompt_used: prompt,
        music_style_used: music_style,
        processing_time: musicgptProcessingTime,
        segment_info: {
          start: start,
          end: end,
          duration: clipDuration,
          track_name: track_name || 'Generated Track'
        },
        instructions: {
          next_step: 'Monitor webhook URL for MusicGPT completion',
          webhook_monitoring: {
            url: `https://webhook.site/token/${extractWebhookToken(finalWebhookUrl)}/requests`,
            poll_interval: '10 seconds',
            expected_response: 'JSON with conversion_path or audio_url'
          }
        }
      });
      
    } else {
      throw new Error(`Unexpected MusicGPT response: ${JSON.stringify(musicData)}`);
    }

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° MUSICGPT WEBHOOK GENERATION REQUEST COMPLETED');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½Â¶ Track:', track_name || 'Generated Track');
    console.log('Ã°Å¸â€Â§ Method: MusicGPT with webhook monitoring');
    console.log('Ã°Å¸â€œÅ  Status:', musicData.audio_url ? 'immediate' : 'processing');
    console.log('Ã°Å¸â€œÂ¡ Webhook:', finalWebhookUrl);

  } catch (err) {
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã¢ÂÅ’ MUSICGPT WEBHOOK GENERATION ERROR');
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã°Å¸â€™Â¥ Error message:', err.message || err);
    console.error('Ã°Å¸â€™Â¥ Error stack:', err.stack);
    
    // Enhanced error response
    const errorResponse = {
      success: false,
      error: 'MusicGPT webhook generation failed', 
      details: err.message,
      generation_method: 'musicgpt_webhook_failed',
      segment_info: {
        start: parseInt(req.body.video_start) || 0,
        end: parseInt(req.body.video_end) || 30,
        track_name: req.body.track_name || 'Failed Track'
      },
      webhook_url: req.body.webhook_url
    };
    
    // Add more context for common errors
    if (err.message.includes('timeout')) {
      errorResponse.suggestion = 'Try with a shorter video segment or check your internet connection';
    } else if (err.message.includes('API key')) {
      errorResponse.suggestion = 'Check MusicGPT API configuration';
    } else if (err.message.includes('quota')) {
      errorResponse.suggestion = 'MusicGPT API quota exceeded - try again later';
    } else if (err.message.includes('webhook')) {
      errorResponse.suggestion = 'Check webhook URL format and accessibility';
    }
    
    res.status(500).json(errorResponse);
    
  } finally {
    // Clean up temporary files
    const filesToClean = [trimmedPath, originalPath].filter(Boolean);
    for (const file of filesToClean) {
      try {
        await fsPromises.unlink(file);
        console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up:', file);
      } catch (e) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete temporary file ${file}:`, e.message);
      }
    }
  }
});

// Ã°Å¸Å¡Â¨ NEW: Helper function to extract webhook token from URL
function extractWebhookToken(webhookUrl) {
  const match = webhookUrl.match(/webhook\.site\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

// Ã°Å¸Å¡Â¨ NEW: Enhanced endpoint to check MusicGPT task status with more details
app.post('/api/check-musicgpt-task-detailed', async (req, res) => {
  try {
    const { taskId, trackName } = req.body;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'No task ID provided'
      });
    }

    console.log('Ã°Å¸â€Â Checking detailed MusicGPT task status:', taskId, 'for track:', trackName);

    const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

    const response = await axios.get(
      `https://api.musicgpt.com/api/public/v1/task/${taskId}`,
      {
        headers: {
          'accept': 'application/json',
          'Authorization': MUSICGPT_API_KEY
        },
        timeout: 30000
      }
    );

    const taskData = response.data;
    
    console.log('Ã°Å¸â€œÅ  Detailed task status for', trackName + ':', taskData.status);
    if (taskData.audio_url) {
      console.log('Ã°Å¸Å½Âµ Audio URL ready:', taskData.audio_url);
    }

    res.json({
      success: true,
      taskId: taskId,
      trackName: trackName,
      status: taskData.status,
      audio_url: taskData.audio_url || null,
      title: taskData.title || trackName,
      duration: taskData.duration || null,
      progress: taskData.progress || 0,
      eta: taskData.eta || null,
      conversion_cost: taskData.conversion_cost || null,
      created_at: taskData.created_at || null,
      completed_at: taskData.completed_at || null,
      taskData: taskData,
      message: taskData.audio_url ? 
        `Ã°Å¸Å½â€° "${trackName}" is ready!` : 
        `Ã¢ÂÂ³ "${trackName}" status: ${taskData.status || 'processing'}`,
      isComplete: !!taskData.audio_url,
      webhookRecommendation: !taskData.audio_url ? 
        'Consider using webhook monitoring for real-time updates' : null
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error checking detailed MusicGPT task:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to check detailed task status',
      details: error.message,
      taskId: req.body.taskId,
      trackName: req.body.trackName
    });
  }
});

// Ã°Å¸Å¡Â¨ REPLACE your existing /api/monitor-webhook-for-segment endpoint in index.js with this ENHANCED version

app.post('/api/monitor-webhook-for-segment', async (req, res) => {
  try {
    const { 
      webhookToken,
      trackName,
      segmentIndex,
      maxPollMinutes = 5,
      pollIntervalSeconds = 10,
      minRequests = 3  // Ã°Å¸Å¡Â¨ CHANGED: Default to 3 requests to collect all MusicGPT responses
    } = req.body;

    if (!webhookToken) {
      return res.status(400).json({
        success: false,
        error: 'Webhook token is required'
      });
    }

    console.log('Ã°Å¸â€œÂ¡ Starting enhanced webhook monitoring for segment:', {
      trackName,
      segmentIndex,
      webhookToken,
      minRequests  // Ã°Å¸Å¡Â¨ LOG: Show how many requests we're waiting for
    });

    const maxRetries = Math.floor((maxPollMinutes * 60) / pollIntervalSeconds);
    const pollInterval = pollIntervalSeconds * 1000;

    // Ã°Å¸Å¡Â¨ ENHANCED: Use the enhanced monitorWebhookForMusicGPT function
    const result = await monitorWebhookForMusicGPT(webhookToken, maxRetries, pollInterval, minRequests);

    if (result.success) {
      console.log('Ã¢Å“â€¦ Enhanced webhook monitoring success for', trackName);
      console.log('Ã°Å¸â€œÅ  Total requests collected:', result.totalRequestsFound);
      console.log('Ã°Å¸Å½Âµ MP3 files found:', result.mp3Files?.length || 0);
      
      // Ã°Å¸Å¡Â¨ ENHANCED: Return comprehensive MP3 data
      const mp3Files = result.mp3Files || result.allMP3Files || [];
      const primaryMp3 = mp3Files.length > 0 ? mp3Files[0] : null;
      
      // Ã°Å¸Å¡Â¨ FALLBACK: Also check webhookData directly
      let audioUrl = null;
      let title = trackName;
      let duration = null;
      
      if (primaryMp3) {
        audioUrl = primaryMp3.url;
        title = primaryMp3.title;
        duration = primaryMp3.mp3Duration;
      } else if (result.webhookData) {
        // Check webhook data directly for audio URLs
        audioUrl = result.webhookData.conversion_path || 
                  result.webhookData.audio_url || 
                  result.webhookData.conversion_path_wav;
        title = result.webhookData.title || trackName;
        duration = result.webhookData.conversion_duration;
      }
      
      if (audioUrl) {
        console.log(`Ã°Å¸Å½Âµ Final audio URL for "${trackName}": ${audioUrl}`);
        
        res.json({
          success: true,
          trackName: trackName,
          segmentIndex: segmentIndex,
          webhookData: result.webhookData,
          audioUrl: audioUrl,
          title: title,
          duration: duration,
          allMp3Files: mp3Files,  // Ã°Å¸Å¡Â¨ INCLUDE: All MP3 files found
          monitoringInfo: {
            totalAttempts: result.totalPolls,
            requestsFound: result.totalRequestsFound,
            webhookToken: webhookToken,
            requestsCollected: result.allRequests?.length || 0,
            mp3FilesFound: mp3Files.length,
            timeoutButFound: result.timeoutButFound || false
          },
          message: `Enhanced webhook monitoring completed for "${trackName}" - found ${mp3Files.length} MP3 file(s) in ${result.totalRequestsFound} requests`
        });
      } else {
        console.log('Ã¢ÂÅ’ No audio URL found in any collected requests for', trackName);
        
        res.status(404).json({
          success: false,
          error: 'No audio URL found in collected webhook requests',
          trackName: trackName,
          segmentIndex: segmentIndex,
          monitoringInfo: {
            totalAttempts: result.totalPolls,
            requestsFound: result.totalRequestsFound,
            webhookToken: webhookToken,
            requestsCollected: result.allRequests?.length || 0,
            mp3FilesFound: 0
          },
          suggestion: 'Try polling the task ID directly as fallback',
          debugInfo: {
            collectedRequests: result.allRequests?.map(req => ({
              uuid: req.requestInfo.uuid,
              timestamp: req.requestInfo.timestamp,
              contentKeys: Object.keys(req.content),
              subtype: req.content.subtype || req.content.conversion_type || 'unknown'
            })) || []
          }
        });
      }
      
    } else {
      console.log('Ã¢ÂÅ’ Enhanced webhook monitoring failed for', trackName);
      
      res.status(408).json({
        success: false,
        error: result.error || 'Enhanced webhook monitoring timeout',
        trackName: trackName,
        segmentIndex: segmentIndex,
        monitoringInfo: {
          totalAttempts: result.totalPolls || maxRetries,
          timeoutMinutes: maxPollMinutes,
          webhookToken: webhookToken,
          requestsCollected: result.partialRequests?.length || 0,
          mp3FilesFound: result.mp3Files?.length || 0
        },
        partialResults: {
          requestsFound: result.partialRequests?.length || 0,
          mp3FilesFound: result.mp3Files?.length || 0,
          mp3Files: result.mp3Files || []
        },
        suggestion: 'Try polling the task ID directly as fallback or increase maxPollMinutes'
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in enhanced segment webhook monitoring:', error);
    res.status(500).json({
      success: false,
      error: 'Enhanced webhook monitoring failed',
      details: error.message,
      trackName: req.body.trackName,
      segmentIndex: req.body.segmentIndex
    });
  }
});

// Ã°Å¸Å¡Â¨ BONUS: Test endpoint to verify webhook integration
app.post('/api/test-segment-webhook-integration', async (req, res) => {
  try {
    const { testWebhookToken } = req.body;
    
    console.log('Ã°Å¸Â§Âª Testing segment webhook integration...');
    
    const webhookToken = testWebhookToken || "8bae6cf2-4553-4740-b969-fdf5f269c277";
    const webhookApiUrl = `https://webhook.site/token/${webhookToken}/requests`;
    
    // Test webhook accessibility
    const testResponse = await axios.get(webhookApiUrl, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ClipTune-Integration-Test/1.0'
      }
    });
    
    console.log('Ã¢Å“â€¦ Webhook integration test passed');
    
    res.json({
      success: true,
      message: 'Webhook integration working correctly',
      webhookToken: webhookToken,
      webhookApiUrl: webhookApiUrl,
      testResponse: {
        status: testResponse.status,
        requestCount: testResponse.data?.data?.length || 0,
        accessible: true
      },
      integration: {
        musicgptEndpoint: '/api/generate-segment-music-with-webhook',
        monitoringEndpoint: '/api/monitor-webhook-for-segment',
        taskCheckEndpoint: '/api/check-musicgpt-task-detailed'
      }
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Webhook integration test failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Webhook integration test failed',
      details: error.message,
      troubleshooting: [
        'Check webhook.site accessibility',
        'Verify webhook token format',
        'Ensure network connectivity',
        'Try with a different webhook token'
      ]
    });
  }
});
// Ã°Å¸Å¡Â¨ NEW: Complete workflow - Analyze video with Gemini Ã¢â€ â€™ Generate music with MusicGPT
app.post('/api/analyze-and-generate-music', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { 
      customPrompt = '', 
      genre = null, 
      analysisType = 'full',
      detailLevel = 'ultra',
      // MusicGPT options
      musicDuration = 30,
      musicStyle = 'cinematic',
      musicTempo = 'medium',
      musicKey = 'auto',
      musicMood = 'adaptive'
    } = req.body;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ COMPLETE GEMINI + MUSICGPT WORKFLOW');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã°Å¸Å½Â­ Genre focus:', genre || 'Adaptive');
    console.log('Ã°Å¸Å½Âµ Music duration:', musicDuration, 'seconds');
    console.log('Ã°Å¸Å½Â¨ Music style:', musicStyle);

    // STEP 1: Analyze video with Gemini
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ANALYZING VIDEO WITH GEMINI AI');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const { analyzeVideoForMusicWithValidation } = require('./gemini-utils');
    
    const geminiOptions = {
      customPrompt: customPrompt + 
        `\n\nProvide detailed music composition instructions that will be used to generate actual music. Include specific instruments, tempo, key signature, mood, and production techniques. Be very descriptive about the musical elements needed.`,
      genre,
      analysisType,
      detailLevel
    };

    const geminiResult = await analyzeVideoForMusicWithValidation(
      req.file.buffer, 
      req.file.mimetype, 
      geminiOptions
    );

    if (!geminiResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Gemini analysis failed',
        details: geminiResult.error
      });
    }

    console.log('Ã¢Å“â€¦ Gemini analysis completed');
    console.log('Ã°Å¸â€œâ€ž Analysis length:', geminiResult.analysis.length, 'characters');

    // STEP 2: Optimize text for MusicGPT
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ OPTIMIZING TEXT FOR MUSICGPT AI');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const optimizedPrompt = optimizeTextForMusicGeneration(geminiResult.analysis);

    // STEP 3: Generate music with MusicGPT
    console.log('\n3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ GENERATING MUSIC WITH MUSICGPT AI');
    console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const musicOptions = {
      duration: parseInt(musicDuration),
      style: musicStyle,
      tempo: musicTempo,
      key: musicKey,
      mood: musicMood,
      format: 'mp3',
      quality: 'high'
    };

    const musicResult = await generateMusicFromText(optimizedPrompt, musicOptions);

    if (!musicResult.success) {
      return res.status(500).json({
        success: false,
        error: 'MusicGPT generation failed',
        details: musicResult.error,
        geminiAnalysis: geminiResult.analysis // Include analysis even if music generation fails
      });
    }

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° COMPLETE WORKFLOW SUCCESSFUL');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã¢Å“â€¦ Gemini analysis: Ã¢Å“â€¦');
    console.log('Ã¢Å“â€¦ Text optimization: Ã¢Å“â€¦');
    console.log('Ã¢Å“â€¦ MusicGPT generation: Ã¢Å“â€¦');

    // Return complete results
    res.json({
      success: true,
      message: 'Video analyzed and music generated successfully!',
      
      // Gemini results
      gemini: {
        analysis: geminiResult.analysis,
        processingTime: geminiResult.processingTime,
        validation: geminiResult.validation,
        qualityScore: geminiResult.qualityScore
      },
      
      // MusicGPT results
      musicgpt: {
        music: musicResult.music,
        processingTime: musicResult.processingTime,
        optimizedPrompt: optimizedPrompt
      },
      
      // Combined metadata
      workflow: {
        totalProcessingTime: geminiResult.processingTime + musicResult.processingTime,
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB'
        },
        musicOptions: musicOptions
      }
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in complete Gemini + MusicGPT workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Complete workflow failed',
      details: error.message
    });
  }
});

// Ã°Å¸Å¡Â¨ NEW: Generate music from existing Gemini analysis text
app.post('/api/text-to-music', async (req, res) => {
  try {
    const { 
      textDescription, 
      duration = 30,
      style = 'cinematic',
      tempo = 'medium',
      key = 'auto',
      mood = 'adaptive',
      optimizeText = true
    } = req.body;

    if (!textDescription) {
      return res.status(400).json({
        success: false,
        error: 'No text description provided'
      });
    }

    console.log('Ã°Å¸â€œÂ ===============================================');
    console.log('Ã°Å¸â€œÂ CONVERTING TEXT TO MUSIC WITH MUSICGPT AI');
    console.log('Ã°Å¸â€œÂ ===============================================');
    console.log('Ã°Å¸â€œâ€ž Text length:', textDescription.length, 'characters');
    console.log('Ã°Å¸Å½Âµ Duration:', duration, 'seconds');
    console.log('Ã°Å¸Å½Â¨ Style:', style);

    // Optimize text if requested
    let finalPrompt = textDescription;
    if (optimizeText) {
      console.log('Ã°Å¸â€Â§ Optimizing text for music generation...');
      finalPrompt = optimizeTextForMusicGeneration(textDescription);
    }

    // Generate music
    const musicOptions = {
      duration: parseInt(duration),
      style,
      tempo,
      key,
      mood,
      format: 'mp3',
      quality: 'high'
    };

    const musicResult = await generateMusicFromText(finalPrompt, musicOptions);

    if (musicResult.success) {
      console.log('Ã¢Å“â€¦ Text-to-music conversion completed successfully');
      
      res.json({
        success: true,
        message: 'Music generated from text successfully!',
        music: musicResult.music,
        processingTime: musicResult.processingTime,
        originalText: textDescription,
        optimizedPrompt: optimizeText ? finalPrompt : null,
        options: musicOptions
      });
    } else {
      res.status(500).json(musicResult);
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in text-to-music conversion:', error);
    res.status(500).json({
      success: false,
      error: 'Text-to-music conversion failed',
      details: error.message
    });
  }
});

// Ã°Å¸Å¡Â¨ NEW: Test MusicGPT API connection
app.post('/api/test-musicgpt', async (req, res) => {
  try {
    console.log('Ã°Å¸Â§Âª Testing MusicGPT AI API connection...');
    
    if (!MUSICGPT_API_KEY) {
      throw new Error('MUSICGPT_API_KEY not found in environment variables');
    }

    const testPrompt = "Create a short upbeat electronic music piece with synthesizers and drums, 120 BPM, in C major.";
    
    console.log('Ã°Å¸â€œÂ¤ Sending test prompt to MusicGPT AI...');
    
    const testResult = await generateMusicFromText(testPrompt, {
      duration: 10, // Short test duration
      style: 'electronic',
      tempo: 'fast',
      quality: 'medium'
    });

    if (testResult.success) {
      console.log('Ã¢Å“â€¦ MusicGPT AI test successful!');
      
      res.json({
        success: true,
        message: 'MusicGPT AI is working correctly!',
        testResult: testResult,
        apiKeyConfigured: true
      });
    } else {
      throw new Error(testResult.error);
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ MusicGPT AI test failed:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid or missing MusicGPT API key. Please check MUSICGPT_API_KEY in .env file.';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      apiKeyConfigured: !!MUSICGPT_API_KEY
    });
  }
});

// Ã°Å¸Å¡Â¨ NEW: Batch process segments - Analyze with Gemini Ã¢â€ â€™ Generate music for each
app.post('/api/process-segments-with-musicgpt', async (req, res) => {
  try {
    const { segments, videoFile, batchOptions = {} } = req.body;

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({
        success: false,
        error: 'No segments array provided'
      });
    }

    console.log('Ã°Å¸â€â€ž ===============================================');
    console.log('Ã°Å¸â€â€ž BATCH PROCESSING SEGMENTS WITH MUSICGPT');
    console.log('Ã°Å¸â€â€ž ===============================================');
    console.log('Ã°Å¸â€œÅ  Total segments to process:', segments.length);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      console.log(`\nÃ°Å¸â€â€ž Processing segment ${i + 1}/${segments.length}...`);
      console.log(`Ã¢ÂÂ° Segment: ${segment.start_time}s - ${segment.end_time}s`);

      try {
        // Use existing music summary or generate from scratch
        let musicPrompt = segment.music_summary || segment.description || '';
        
        if (!musicPrompt) {
          musicPrompt = `Create background music for a video segment from ${segment.start_time} to ${segment.end_time} seconds. Style: cinematic, instrumental.`;
        }

        // Calculate segment duration
        const segmentDuration = Math.min(
          parseFloat(segment.end_time) - parseFloat(segment.start_time),
          60 // Cap at 60 seconds
        );

        // Generate music for this segment
        const musicResult = await generateMusicFromText(musicPrompt, {
          duration: Math.max(segmentDuration, 5), // Minimum 5 seconds
          style: batchOptions.style || 'cinematic',
          tempo: batchOptions.tempo || 'medium',
          mood: batchOptions.mood || 'adaptive',
          ...batchOptions.musicOptions
        });

        if (musicResult.success) {
          successCount++;
          console.log(`Ã¢Å“â€¦ Segment ${i + 1} processed successfully`);
          
          results.push({
            segmentIndex: i,
            segment: segment,
            music: musicResult.music,
            prompt: musicPrompt,
            success: true
          });
        } else {
          errorCount++;
          console.log(`Ã¢ÂÅ’ Segment ${i + 1} failed:`, musicResult.error);
          
          results.push({
            segmentIndex: i,
            segment: segment,
            error: musicResult.error,
            success: false
          });
        }

        // Add delay between requests to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }

      } catch (error) {
        errorCount++;
        console.error(`Ã¢ÂÅ’ Error processing segment ${i + 1}:`, error.message);
        
        results.push({
          segmentIndex: i,
          segment: segment,
          error: error.message,
          success: false
        });
      }
    }

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° BATCH PROCESSING COMPLETED');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã¢Å“â€¦ Successful segments:', successCount);
    console.log('Ã¢ÂÅ’ Failed segments:', errorCount);
    console.log('Ã°Å¸â€œÅ  Success rate:', Math.round((successCount / segments.length) * 100) + '%');

    res.json({
      success: true,
      message: `Batch processing completed: ${successCount}/${segments.length} segments successful`,
      results: results,
      summary: {
        totalSegments: segments.length,
        successCount: successCount,
        errorCount: errorCount,
        successRate: Math.round((successCount / segments.length) * 100)
      }
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in batch segment processing:', error);
    res.status(500).json({
      success: false,
      error: 'Batch segment processing failed',
      details: error.message
    });
  }
});

// ===============================================
// UTILITY ENDPOINT: Get MusicGPT API Status
// ===============================================

app.get('/api/musicgpt-status', (req, res) => {
  res.json({
    musicgptConfigured: !!MUSICGPT_API_KEY,
    hasApiKey: !!MUSICGPT_API_KEY,
    apiBaseUrl: MUSICGPT_API_BASE,
    keyPreview: MUSICGPT_API_KEY ? 
      MUSICGPT_API_KEY.substring(0, 8) + '...' : 'Not set'
  });
});

// ===============================================
// EXPORT FUNCTIONS FOR USE IN OTHER MODULES
// ===============================================

module.exports = {
  generateMusicFromText,
  optimizeTextForMusicGeneration
};
// Ã¢Å“â€¦ ADD: Test endpoint to verify GCS file accessibility
app.post('/api/test-gcs-file-access', async (req, res) => {
  try {
    const { gcsUrl, publicUrl } = req.body;
    
    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No URL provided'
      });
    }

    const testUrl = publicUrl || gcsUrl;
    
    console.log('Ã°Å¸Â§Âª Testing GCS file access:', testUrl);
    
    // Test HTTP access
    const axios = require('axios');
    try {
      const response = await axios.head(testUrl, { timeout: 10000 });
      
      console.log('Ã¢Å“â€¦ File is accessible:');
      console.log('   Status:', response.status);
      console.log('   Content-Length:', response.headers['content-length']);
      console.log('   Content-Type:', response.headers['content-type']);
      
      res.json({
        success: true,
        accessible: true,
        status: response.status,
        contentLength: response.headers['content-length'],
        contentType: response.headers['content-type'],
        message: 'File is accessible and ready for analysis'
      });
      
    } catch (httpError) {
      console.error('Ã¢ÂÅ’ File not accessible:', httpError.message);
      
      res.status(httpError.response?.status || 500).json({
        success: false,
        accessible: false,
        error: httpError.message,
        status: httpError.response?.status,
        message: 'File is not accessible - check URL and permissions'
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error testing file access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test file access',
      details: error.message
    });
  }
});

// Ã¢Å“â€¦ ADD: Helper function for error suggestions (if not already present)
function getErrorSuggestions(analysisResult) {
  const suggestions = [];
  
  if (analysisResult?.httpStatus === 403) {
    suggestions.push('Check if the GCS bucket has public read access enabled');
    suggestions.push('Verify that the service account has Storage Object Viewer permissions');
    suggestions.push('Try regenerating the signed URL with longer expiry');
  } else if (analysisResult?.httpStatus === 404) {
    suggestions.push('Verify the video file exists in the GCS bucket');
    suggestions.push('Check if the file path is correct');
    suggestions.push('Wait a few seconds and try again (file might still be uploading)');
  } else if (analysisResult?.error?.includes('timeout')) {
    suggestions.push('Try a smaller video file');
    suggestions.push('Check your internet connection');
    suggestions.push('Increase the timeout duration');
  } else if (analysisResult?.error?.includes('network') || analysisResult?.error?.includes('Not Found')) {
    suggestions.push('Check your internet connection');
    suggestions.push('Verify the GCS bucket URL is correct');
    suggestions.push('Wait 5-10 seconds and try again');
    suggestions.push('The file might still be processing in GCS');
  }
  
  return suggestions;
}
// Ã°Å¸Å¡Â¨ NEW: Combined upload + analysis workflow
app.post('/api/upload-and-analyze-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { customPrompt, analysisType = 'full', skipUpload = false } = req.body;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ COMBINED UPLOAD + GEMINI ANALYSIS WORKFLOW');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Ã°Å¸Å½Â¯ Custom prompt:', customPrompt || 'None');
    console.log('Ã°Å¸â€œâ€¹ Analysis type:', analysisType);
    console.log('Ã¢Â¬â€ Ã¯Â¸Â Skip GCS upload:', skipUpload);

    let uploadResult = null;

    // Step 1: Upload to GCS (unless skipped)
    if (!skipUpload) {
      console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ Uploading to Google Cloud Storage...');
      
      const { generateUploadUrl } = require('./gcs-utils');
      const uploadData = await generateUploadUrl(`videos/${Date.now()}_${req.file.originalname}`);
      
      await axios.put(uploadData.put_url, req.file.buffer, {
        headers: {
          'Content-Type': req.file.mimetype || 'video/mp4',
          'Content-Length': req.file.size
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      uploadResult = {
        gcs_uri: uploadData.gcs_uri,
        public_url: uploadData.public_url,
        file_name: uploadData.file_name
      };

      console.log('Ã¢Å“â€¦ Upload completed - GCS URI:', uploadResult.gcs_uri);
    }

    // Step 2: Analyze with Gemini
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ Analyzing with Gemini AI...');
    
    let analysisResult;
    if (analysisType === 'segments') {
      analysisResult = await analyzeVideoSegments(req.file.buffer, req.file.mimetype, customPrompt);
    } else {
      analysisResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, customPrompt);
    }

    if (analysisResult.success) {
      console.log('Ã¢Å“â€¦ ===============================================');
      console.log('Ã¢Å“â€¦ COMBINED WORKFLOW COMPLETED SUCCESSFULLY');
      console.log('Ã¢Å“â€¦ ===============================================');

      res.json({
        success: true,
        message: 'Video uploaded and analyzed successfully!',
        
        // Upload results
        upload: uploadResult,
        
        // Analysis results  
        analysis: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        
        // Video info
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        },
        
        // Request parameters
        customPrompt: customPrompt || null,
        analysisType: analysisType,
        uploadSkipped: skipUpload
      });
    } else {
      console.error('Ã¢ÂÅ’ Analysis failed:', analysisResult.error);
      res.status(500).json({
        success: false,
        error: `Upload ${uploadResult ? 'succeeded' : 'skipped'} but analysis failed: ${analysisResult.error}`,
        details: analysisResult.details,
        upload: uploadResult
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in combined upload + analysis workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed in combined upload and analysis workflow',
      details: error.message
    });
  }
});

// Ã°Å¸Å¡Â¨ NEW: Test Gemini API connection
app.post('/api/test-gemini', async (req, res) => {
  try {
    console.log('Ã°Å¸Â§Âª Testing Gemini API connection...');
    
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const testPrompt = "Hello! Please respond with a brief test message to confirm the API is working.";
    
    console.log('Ã°Å¸â€œÂ¤ Sending test prompt to Gemini...');
    const result = await model.generateContent(testPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('Ã¢Å“â€¦ Gemini API test successful!');
    console.log('Ã°Å¸â€œÂ¥ Response:', text.substring(0, 100) + '...');

    res.json({
      success: true,
      message: 'Gemini API is working correctly!',
      testResponse: text,
      apiKeyConfigured: true
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Gemini API test failed:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid or missing Gemini API key. Please check GEMINI_API_KEY in .env file.';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      apiKeyConfigured: !!process.env.GEMINI_API_KEY
    });
  }
});
// OPTIONAL: Add endpoint to add payment method
app.post('/add-payment-method', async (req, res) => {
  const { email, paymentMethodId } = req.body;
  
  try {
    console.log('Ã°Å¸â€™Â³ Adding payment method for user:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.stripeCustomerId) {
      // Create Stripe customer if doesn't exist
      const customer = await stripeInstance.customers.create({ 
        email: user.email 
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // Attach payment method to customer
    await stripeInstance.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    // Set as default payment method
    await stripeInstance.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    console.log('Ã¢Å“â€¦ Payment method added successfully');
    
    res.json({ 
      message: 'Payment method added successfully',
      paymentMethodId
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error adding payment method:', error);
    res.status(500).json({ 
      message: 'Failed to add payment method',
      details: error.message
    });
  }
});
// Add this import at the top of your index.js
const { generateUploadUrl, uploadBuffer } = require('./gcs-utils');

// ADD THESE NEW ROUTES BEFORE YOUR EXISTING ROUTES

// Ã°Å¸Å¡Â¨ NEW: Generate upload ticket for GCS
app.post('/api/upload-ticket', async (req, res) => {
  try {
    console.log('Ã°Å¸Å½Â« Generating GCS upload ticket with proper authentication...');
    
    const { generateUploadUrl } = require('./gcs-utils');
    const uploadData = await generateUploadUrl();
    
    console.log('Ã¢Å“â€¦ Upload ticket generated with signed URLs:', {
      gcs_uri: uploadData.gcs_uri,
      file_name: uploadData.file_name,
      has_signed_read_url: !!uploadData.public_url
    });

    res.json({
      put_url: uploadData.put_url,
      gcs_uri: uploadData.gcs_uri,
      public_url: uploadData.public_url, // This is now a signed read URL
      file_name: uploadData.file_name
    });
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generating upload ticket:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload ticket',
      details: error.message 
    });
  }
});

// Ã¢Å“â€¦ NEW: Test GCS access endpoint
app.post('/api/test-gcs-access', async (req, res) => {
  try {
    const { gcsUrl } = req.body;
    
    if (!gcsUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL provided'
      });
    }

    console.log('Ã°Å¸Â§Âª Testing GCS access for URL:', gcsUrl);
    
    const { testGCSAccess } = require('./gemini-utils');
    const testResult = await testGCSAccess(gcsUrl);
    
    if (testResult.success) {
      console.log('Ã¢Å“â€¦ GCS access test passed');
      res.json({
        success: true,
        message: 'GCS access working correctly',
        details: testResult
      });
    } else {
      console.error('Ã¢ÂÅ’ GCS access test failed:', testResult.error);
      res.status(400).json({
        success: false,
        error: testResult.error,
        details: testResult.details,
        httpStatus: testResult.httpStatus
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error testing GCS access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test GCS access',
      details: error.message
    });
  }
});

// Ã¢Å“â€¦ NEW: Get signed URL for existing GCS file
app.post('/api/get-signed-url', async (req, res) => {
  try {
    const { gcsUrl, fileName, expiryHours = 24 } = req.body;
    
    if (!gcsUrl && !fileName) {
      return res.status(400).json({
        success: false,
        error: 'Either gcsUrl or fileName must be provided'
      });
    }

    console.log('Ã°Å¸â€Â Generating signed URL...');
    
    const { getSignedDownloadUrl, extractFileNameFromUrl } = require('./gcs-utils');
    
    const fileNameToUse = fileName || extractFileNameFromUrl(gcsUrl);
    const signedUrl = await getSignedDownloadUrl(fileNameToUse, expiryHours);
    
    console.log('Ã¢Å“â€¦ Signed URL generated for:', fileNameToUse);
    
    res.json({
      success: true,
      signedUrl: signedUrl,
      fileName: fileNameToUse,
      expiryHours: expiryHours,
      message: 'Signed URL generated successfully'
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generating signed URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate signed URL',
      details: error.message
    });
  }
});

// Ã°Å¸Å¡Â¨ NEW: Upload video directly to GCS using ticket system


// Ã°Å¸Å¡Â¨ NEW: Alternative direct buffer upload (if needed)
app.post('/api/upload-video-direct', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    console.log('Ã°Å¸Å½Â¬ Direct upload to GCS...');
    console.log('Ã°Å¸â€œÂ File:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  Size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    const fileName = `videos/${Date.now()}_${req.file.originalname}`;
    const uploadResult = await uploadBuffer(req.file.buffer, fileName, req.file.mimetype);

    console.log('Ã¢Å“â€¦ Direct upload successful!');
    console.log('Ã°Å¸â€â€” GCS URI:', uploadResult.gcs_uri);

    res.json({
      success: true,
      message: 'Video uploaded directly to GCS successfully!',
      ...uploadResult
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Direct upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload video directly to GCS',
      details: error.message
    });
  }
});
app.post('/upload-proxy', upload.single('file'), async (req, res) => {
  try {
    const { put_url } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }
    
    if (!put_url) {
      return res.status(400).json({ 
        success: false, 
        error: 'No put_url provided' 
      });
    }

    console.log('Ã°Å¸â€œÂ¤ Proxying file upload to GCS...');
    console.log('File size:', req.file.size);
    console.log('File type:', req.file.mimetype);

    // Upload to Google Cloud Storage using the signed URL
    const uploadResponse = await axios.put(put_url, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': req.file.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('Ã¢Å“â€¦ Upload successful, status:', uploadResponse.status);

    res.json({
      success: true,
      message: 'File uploaded successfully via proxy',
      status_code: uploadResponse.status
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Upload proxy error:', error.message);
    
    // Provide more detailed error info
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      
      return res.status(500).json({
        success: false,
        error: 'Upload failed',
        details: error.response.data || error.message,
        status: error.response.status
      });
    }

    res.status(500).json({
      success: false,
      error: 'Upload proxy failed',
      details: error.message
    });
  }
});const buildAudioFilterWithFades = (audioIndex, volume, segment, segmentStart, arrayIndex) => {
  const filters = [];
  const inputLabel = `[${audioIndex}:a]`;
  let currentLabel = inputLabel;
  
  // Ã¢Å“â€¦ ADJUST: Reduce music volume to preserve original video audio
  const adjustedMusicVolume = Math.min(volume * 0.8, 0.7); // Cap music volume
  
  console.log(`   Ã°Å¸Å½Å¡Ã¯Â¸Â Music volume: ${Math.round(volume * 100)}% Ã¢â€ â€™ ${Math.round(adjustedMusicVolume * 100)}% (preserving original audio)`);
  
  // Map ClipTune algorithms to FFmpeg curve types
  const getFadeCurve = (algorithm) => {
    if (!algorithm) return 'tri'; // Default triangular (linear)
    
    const algo = algorithm.toLowerCase();
    switch (algo) {
      case 'linear':
        return 'tri';           // Triangular (linear)
      case 'exponential':
      case 'exp':
        return 'exp';           // Exponential
      case 'logarithmic':
      case 'log':
        return 'log';           // Logarithmic
      case 'cosine':
      case 'cos':
        return 'hsin';          // Half-sine (similar to cosine)
      case 'sigmoid':
      case 's-curve':
        return 'esin';          // Exponential sine (S-curve like)
      case 'step':
        return 'nofade';        // No fade (step)
      default:
        return 'tri';           // Default to linear
    }
  };
  
  const fadeAlgorithm = segment.fade_algorithm || 'linear';
  const fadeCurve = getFadeCurve(fadeAlgorithm);
  
  console.log(`   Ã°Å¸Å½Â­ Fade algorithm: ${fadeAlgorithm} Ã¢â€ â€™ FFmpeg curve: ${fadeCurve}`);
  
  // Step 1: Apply fade-in if specified
  if (segment.fadein_duration && parseFloat(segment.fadein_duration) > 0) {
    const fadeInDuration = parseFloat(segment.fadein_duration);
    const fadeInStart = segment.fadein_start ? parseFloat(segment.fadein_start) : 0;
    
    const fadeInLabel = `[fadein_${arrayIndex}]`;
    
    if (fadeCurve === 'nofade') {
      // Step fade: Use volume automation instead of afade
      filters.push(`${currentLabel}volume=enable='between(t,${fadeInStart},${fadeInStart + fadeInDuration})':volume=0:enable='gte(t,${fadeInStart + fadeInDuration})':volume=${adjustedMusicVolume}${fadeInLabel}`);
    } else {
      // Regular fade with curve
      filters.push(`${currentLabel}afade=t=in:st=${fadeInStart}:d=${fadeInDuration}:curve=${fadeCurve}${fadeInLabel}`);
    }
    
    currentLabel = fadeInLabel;
    console.log(`   Ã°Å¸â€Å  Applied ${fadeAlgorithm} fade-in: ${fadeInDuration}s starting at ${fadeInStart}s`);
  }
  
  // Step 2: Apply fade-out if specified
  if (segment.fadeout_duration && parseFloat(segment.fadeout_duration) > 0) {
    const fadeOutDuration = parseFloat(segment.fadeout_duration);
    const fadeOutStart = segment.fadeout_start 
      ? parseFloat(segment.fadeout_start) 
      : (parseFloat(segment.end_time) - parseFloat(segment.start_time) - fadeOutDuration);
    
    const fadeOutLabel = `[fadeout_${arrayIndex}]`;
    
    if (fadeCurve === 'nofade') {
      // Step fade: Immediate cut-off
      filters.push(`${currentLabel}volume=enable='gte(t,${fadeOutStart})':volume=0${fadeOutLabel}`);
    } else {
      // Regular fade with curve
      filters.push(`${currentLabel}afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}:curve=${fadeCurve}${fadeOutLabel}`);
    }
    
    currentLabel = fadeOutLabel;
    console.log(`   Ã°Å¸â€â€° Applied ${fadeAlgorithm} fade-out: ${fadeOutDuration}s starting at ${fadeOutStart}s`);
  }
  
  // Step 3: Apply final volume (adjusted to preserve original audio)
  const volumeLabel = `[vol_${arrayIndex}]`;
  filters.push(`${currentLabel}volume=${adjustedMusicVolume}${volumeLabel}`);
  
  console.log(`   Ã°Å¸Å½Å¡Ã¯Â¸Â Applied final volume: ${Math.round(adjustedMusicVolume * 100)}%`);
  
  return { filters, finalLabel: volumeLabel, algorithm: fadeAlgorithm, curve: fadeCurve };
};


const getEffectiveVolume = (musicInfo, segment) => {
  // Ã¢Å“â€¦ PRIORITY 1: Use custom volume if explicitly set (even if 0)
  if (musicInfo.customVolume !== undefined && musicInfo.customVolume !== null) {
    console.log(`   Using CUSTOM volume: ${musicInfo.customVolume} (was set by user)`);
    return parseFloat(musicInfo.customVolume);
  }
  
  // Ã¢Å“â€¦ PRIORITY 2: Use effectiveVolume if available (from state)
  if (musicInfo.effectiveVolume !== undefined && musicInfo.effectiveVolume !== null) {
    console.log(`   Using EFFECTIVE volume: ${musicInfo.effectiveVolume}`);
    return parseFloat(musicInfo.effectiveVolume);
  }
  
  // Ã¢Å“â€¦ PRIORITY 3: Use AI suggested volume from segment
  if (segment && segment.volume !== undefined && segment.volume !== null) {
    console.log(`   Using AI suggested volume: ${segment.volume}`);
    return parseFloat(segment.volume);
  }
  
  // Ã¢Å“â€¦ PRIORITY 4: Default volume
  console.log(`   Using DEFAULT volume: 0.3`);
  return 0.3;
};

// Ã¢Å“â€¦ STEP 1: Make sure this function exists in your index.js 
// Find your existing buildAudioFilterWithFades function and REPLACE it with this fixed version:


// Ã¢Å“â€¦ STEP 2: Fix the progressive video endpoint audio mixing
// In your /api/update-progressive-video endpoint, REPLACE the single segment processing with:


// Ã¢Å“â€¦ STEP 3: Also fix the complete video endpoint
// In your /api/create-complete-video endpoint, make sure the mixing logic is:


// Advanced fade preview function for complex algorithms
const buildComplexFadeFilter = (audioIndex, volume, segment, segmentStart, arrayIndex) => {
  const filters = [];
  const inputLabel = `[${audioIndex}:a]`;
  let currentLabel = inputLabel;
  const fadeAlgorithm = segment.fade_algorithm || 'linear';
  
  // For complex algorithms that need custom implementation
  if (fadeAlgorithm.toLowerCase() === 'sigmoid' || fadeAlgorithm.toLowerCase() === 's-curve') {
    // Sigmoid S-curve implementation using multiple volume points
    const fadeInDuration = parseFloat(segment.fadein_duration || 0);
    const fadeOutDuration = parseFloat(segment.fadeout_duration || 0);
    const fadeInStart = parseFloat(segment.fadein_start || 0);
    
    if (fadeInDuration > 0) {
      const sigmoidLabel = `[sigmoid_in_${arrayIndex}]`;
      // Create S-curve using multiple volume points
      const points = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const sigmoid = 1 / (1 + Math.exp(-12 * (t - 0.5))); // Sigmoid function
        const time = fadeInStart + (t * fadeInDuration);
        points.push(`'between(t,${time},${time + fadeInDuration/10})':${sigmoid}`);
      }
      
      filters.push(`${currentLabel}volume=${points.join(':')}${sigmoidLabel}`);
      currentLabel = sigmoidLabel;
      console.log(`   Ã°Å¸Å’Å  Applied custom sigmoid fade-in: ${fadeInDuration}s`);
    }
    
    if (fadeOutDuration > 0) {
      const fadeOutStart = segment.fadeout_start 
        ? parseFloat(segment.fadeout_start) 
        : (parseFloat(segment.end_time) - parseFloat(segment.start_time) - fadeOutDuration);
      
      const sigmoidOutLabel = `[sigmoid_out_${arrayIndex}]`;
      // Create inverse S-curve for fade-out
      const points = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const sigmoid = 1 - (1 / (1 + Math.exp(-12 * (t - 0.5)))); // Inverse sigmoid
        const time = fadeOutStart + (t * fadeOutDuration);
        points.push(`'between(t,${time},${time + fadeOutDuration/10})':${sigmoid}`);
      }
      
      filters.push(`${currentLabel}volume=${points.join(':')}${sigmoidOutLabel}`);
      currentLabel = sigmoidOutLabel;
      console.log(`   Ã°Å¸Å’Å  Applied custom sigmoid fade-out: ${fadeOutDuration}s`);
    }
  } else {
    // Use standard implementation for other algorithms
    return buildAudioFilterWithFades(audioIndex, volume, segment, segmentStart, arrayIndex);
  }
  
  // Apply final volume
  const volumeLabel = `[vol_${arrayIndex}]`;
  filters.push(`${currentLabel}volume=${volume}${volumeLabel}`);
  
  return { filters, finalLabel: volumeLabel, algorithm: fadeAlgorithm, curve: 'custom' };
};

// FIXED ClipTune Upload Endpoint - Now uses mapping function
// REPLACE your existing /api/cliptune-upload endpoint in index.js with this enhanced version
// This adds comprehensive debugging output to show exactly what ClipTune returns
// REPLACE your existing /api/cliptune-upload endpoint in index.js with this updated version

app.post('/api/cliptune-upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video uploaded' });
    }

    const { extra_prompt, total_seconds } = req.body;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ STARTING CLIPTUNE ANALYSIS WITH ENHANCED DEBUG');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('Ã°Å¸Å½Â¯ Extra prompt:', extra_prompt || 'None provided');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Video duration (total_seconds):', total_seconds || 'Not provided');
    console.log('Ã¢ÂÂ° Started at:', new Date().toLocaleTimeString());

    // Step 1: Get upload ticket from ClipTune
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ REQUESTING UPLOAD TICKET FROM CLIPTUNE');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('Ã°Å¸Å’Â API URL:', `${CLIPTUNE_API}/upload-ticket`);
    
    const ticketResponse = await axios.post(`${CLIPTUNE_API}/upload-ticket`);
    const { put_url, gcs_uri } = ticketResponse.data;
    
    console.log('Ã¢Å“â€¦ Upload ticket received successfully');
    console.log('Ã°Å¸â€â€” GCS URI:', gcs_uri);

    // Step 2: Upload video to GCS
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ UPLOADING VIDEO TO GOOGLE CLOUD STORAGE');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('Ã¢ËœÂÃ¯Â¸Â Uploading to GCS...');
    console.log('Ã°Å¸â€œÅ  Upload size:', req.file.size, 'bytes');
    console.log('Ã°Å¸Å½Â¥ Content type:', req.file.mimetype || 'video/mp4');
    
    const uploadStartTime = Date.now();
    
    await axios.put(put_url, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': req.file.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    console.log('Ã¢Å“â€¦ Video uploaded to GCS successfully');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Upload time:', uploadTime, 'seconds');

    // Step 3: Call video-segments endpoint for ANALYSIS
    console.log('\n3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ ANALYZING VIDEO WITH CLIPTUNE AI');
    console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('Ã°Å¸Â¤â€“ Starting AI analysis...');
    console.log('Ã°Å¸Å½Â¯ Processing instructions:', extra_prompt || 'Default processing');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Video duration to send:', total_seconds || 'Will be calculated by ClipTune');
    
    const formData = new URLSearchParams();
    formData.append('video_url', gcs_uri);
    if (extra_prompt) {
      formData.append('extra_prompt', extra_prompt);
    }
    // Ã°Å¸Å¡Â¨ ADD: Include total_seconds if provided (as integer)
    if (total_seconds) {
      const durationInt = parseInt(total_seconds);
      formData.append('total_seconds', durationInt);
      console.log('Ã°Å¸â€œÅ  Including video duration:', durationInt, 'seconds (as integer)');
    }

    console.log('Ã°Å¸â€œâ€¹ Form data prepared:');
    console.log('   - video_url:', gcs_uri);
    console.log('   - extra_prompt:', extra_prompt || 'Not provided');
    console.log('   - total_seconds:', total_seconds || 'Not provided');
    
    const processingStartTime = Date.now();
    console.log('Ã¢ÂÂ° AI analysis started at:', new Date().toLocaleTimeString());
    console.log('Ã¢ÂÂ³ This may take several minutes...');

    const segmentsResponse = await axios.post(`${CLIPTUNE_API}/video-segments`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 1000 * 60 * 10, // 10 minutes timeout
    });

    const processingTime = ((Date.now() - processingStartTime) / 1000).toFixed(2);
    
    console.log('\nÃ¢Å“â€¦ ===============================================');
    console.log('Ã¢Å“â€¦ CLIPTUNE AI ANALYSIS COMPLETED');
    console.log('Ã¢Å“â€¦ ===============================================');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Processing time:', processingTime, 'seconds');
    console.log('Ã°Å¸â€œÅ  Response status:', segmentsResponse.status);
    
    // Ã°Å¸Å¡Â¨ ENHANCED DEBUG: Show COMPLETE RAW RESPONSE
    console.log('\nÃ°Å¸â€Â ===============================================');
    console.log('Ã°Å¸â€Â COMPLETE RAW CLIPTUNE AI RESPONSE DEBUG');
    console.log('Ã°Å¸â€Â ===============================================');
    
    // Log the full response object structure
    console.log('Ã°Å¸â€œâ€¹ Response Object Keys:', Object.keys(segmentsResponse.data));
    console.log('Ã°Å¸â€œâ€¹ Response Headers:', JSON.stringify(segmentsResponse.headers, null, 2));
    console.log('Ã°Å¸â€œâ€¹ Response Status:', segmentsResponse.status);
    console.log('Ã°Å¸â€œâ€¹ Response Status Text:', segmentsResponse.statusText);
    
    // Log the complete response data in pretty format
    console.log('\nÃ°Å¸â€œâ€ž COMPLETE RESPONSE DATA:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(segmentsResponse.data, null, 2));
    console.log('='.repeat(80));
    
    // Analyze the response structure
    if (segmentsResponse.data) {
      console.log('\nÃ°Å¸â€Â¬ RESPONSE STRUCTURE ANALYSIS:');
      console.log('Ã°Å¸â€Â¬ ===============================================');
      
      const responseKeys = Object.keys(segmentsResponse.data);
      console.log('Ã°Å¸â€œÅ  Top-level keys in response:', responseKeys);
      
      responseKeys.forEach(key => {
        const value = segmentsResponse.data[key];
        console.log(`   - ${key}: ${typeof value} (${Array.isArray(value) ? `array of ${value.length} items` : typeof value})`);
      });
      
      // Check for segments specifically
      if (segmentsResponse.data.segments) {
        console.log('\nÃ°Å¸Å½Â¯ SEGMENTS ARRAY FOUND:');
        console.log('Ã°Å¸Å½Â¯ ===============================================');
        console.log('Ã°Å¸â€œÅ  Number of segments:', segmentsResponse.data.segments.length);
        console.log('Ã°Å¸â€œÅ  Segments type:', typeof segmentsResponse.data.segments);
        console.log('Ã°Å¸â€œÅ  Is array:', Array.isArray(segmentsResponse.data.segments));
        
        // Show first segment structure
        if (segmentsResponse.data.segments.length > 0) {
          console.log('\nÃ°Å¸â€œâ€¹ FIRST SEGMENT STRUCTURE SAMPLE:');
          console.log('-'.repeat(60));
          const firstSegment = segmentsResponse.data.segments[0];
          console.log('First segment keys:', Object.keys(firstSegment));
          console.log('First segment data:');
          console.log(JSON.stringify(firstSegment, null, 2));
          console.log('-'.repeat(60));
        }
        
        // Show all segments overview
        console.log('\nÃ°Å¸â€œÅ  ALL SEGMENTS OVERVIEW:');
        console.log('-'.repeat(60));
        segmentsResponse.data.segments.forEach((segment, index) => {
          console.log(`Segment ${index + 1}:`);
          console.log(`   Keys: ${Object.keys(segment).join(', ')}`);
          if (segment.start_time) console.log(`   Start: ${segment.start_time}`);
          if (segment.end_time) console.log(`   End: ${segment.end_time}`);
          if (segment.music_summary) console.log(`   Summary: ${segment.music_summary.substring(0, 50)}...`);
          if (segment.fade_type) console.log(`   Fade Type: ${segment.fade_type}`);
          if (segment.fade_algorithm) console.log(`   Fade Algorithm: ${segment.fade_algorithm}`);
          if (segment.fade_in_seconds) console.log(`   Fade In: ${segment.fade_in_seconds}s`);
          if (segment.fade_out_seconds) console.log(`   Fade Out: ${segment.fade_out_seconds}s`);
          if (segment.volume) console.log(`   Volume: ${segment.volume}`);
          console.log('   ---');
        });
        console.log('-'.repeat(60));
      } else {
        console.log('\nÃ¢ÂÅ’ NO SEGMENTS FOUND IN RESPONSE');
        console.log('Ã¢ÂÅ’ Available keys:', responseKeys);
      }
      
      // Check for other important fields
      console.log('\nÃ°Å¸â€Â OTHER RESPONSE FIELDS:');
      console.log('Ã°Å¸â€Â ===============================================');
      
      const importantFields = ['success', 'message', 'error', 'data', 'result', 'status'];
      importantFields.forEach(field => {
        if (segmentsResponse.data.hasOwnProperty(field)) {
          console.log(`Ã¢Å“â€¦ Found ${field}:`, typeof segmentsResponse.data[field]);
          if (typeof segmentsResponse.data[field] === 'string' && segmentsResponse.data[field].length < 200) {
            console.log(`   Value: ${segmentsResponse.data[field]}`);
          } else if (typeof segmentsResponse.data[field] === 'object') {
            console.log(`   Keys: ${Object.keys(segmentsResponse.data[field] || {}).join(', ')}`);
          }
        } else {
          console.log(`Ã¢ÂÅ’ Missing ${field}`);
        }
      });
    }

    // Ã°Å¸Å¡Â¨ FIXED: Apply field mapping after logging raw response
    let mappedSegments = [];
    if (segmentsResponse.data && segmentsResponse.data.segments) {
      console.log('\nÃ°Å¸â€â€ž ===============================================');
      console.log('Ã°Å¸â€â€ž APPLYING FIELD MAPPING TO RAW SEGMENTS');
      console.log('Ã°Å¸â€â€ž ===============================================');
      
      console.log('Ã°Å¸â€œÅ  Raw segments before mapping:', segmentsResponse.data.segments.length);
      
      // Map ClipTune response to expected field names
      mappedSegments = mapClipTuneResponse(segmentsResponse.data.segments);
      
      console.log('Ã°Å¸â€œÅ  Mapped segments after mapping:', mappedSegments.length);
      
      console.log('\nÃ°Å¸â€œâ€¹ MAPPED SEGMENTS STRUCTURE:');
      console.log('Ã°Å¸â€œâ€¹ ===============================================');
      
      mappedSegments.forEach((segment, index) => {
        console.log(`Mapped Segment ${index + 1}:`);
        console.log(`   - Start: ${segment.start_time || 'Unknown'}s`);
        console.log(`   - End: ${segment.end_time || 'Unknown'}s`);
        console.log(`   - Music Summary: ${segment.music_summary || 'No summary'}`);
        console.log(`   - AI Volume: ${segment.volume || 'Not specified'}`);
        console.log(`   - Fade Algorithm: ${segment.fade_algorithm || 'Not specified'} (mapped from: ${segment.original_fade_type || 'N/A'})`);
        console.log(`   - Fade In Duration: ${segment.fadein_duration || 'Not specified'}s (mapped from: ${segment.original_fade_in_seconds || 'N/A'}s)`);
        console.log(`   - Fade Out Duration: ${segment.fadeout_duration || 'Not specified'}s (mapped from: ${segment.original_fade_out_seconds || 'N/A'}s)`);
        console.log(`   - All Keys: ${Object.keys(segment).join(', ')}`);
        console.log('   ---');
      });
    } else {
      console.log('\nÃ¢ÂÅ’ ===============================================');
      console.log('Ã¢ÂÅ’ NO SEGMENTS FOUND TO MAP');
      console.log('Ã¢ÂÅ’ ===============================================');
      console.log('Ã°Å¸â€Â Response data type:', typeof segmentsResponse.data);
      console.log('Ã°Å¸â€Â Response data keys:', segmentsResponse.data ? Object.keys(segmentsResponse.data) : 'N/A');
    }

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° CLIPTUNE ANALYSIS DEBUG COMPLETED');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã¢Å“â€¦ Sending response to client...');
    console.log('Ã°Å¸â€œÅ  Final mapped segments count:', mappedSegments.length);
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Video duration was sent as:', total_seconds || 'Not provided');

    // Ã°Å¸Å¡Â¨ FIXED: Return mapped segments instead of original
    res.json({
      success: true,
      result: {
        ...segmentsResponse.data,
        segments: mappedSegments  // Use mapped segments with correct field names
      },
      debug: {
        rawResponseKeys: Object.keys(segmentsResponse.data),
        originalSegmentsCount: segmentsResponse.data.segments ? segmentsResponse.data.segments.length : 0,
        mappedSegmentsCount: mappedSegments.length,
        processingTime: processingTime + 's',
        videoDurationSent: total_seconds || 'Not provided'
      },
      message: 'Video analyzed successfully with enhanced debugging. Check terminal for complete data.'
    });

  } catch (error) {
    console.log('\nÃ¢ÂÅ’ ===============================================');
    console.log('Ã¢ÂÅ’ CLIPTUNE ANALYSIS ERROR');
    console.log('Ã¢ÂÅ’ ===============================================');
    console.error('Ã°Å¸â€™Â¥ Error message:', error.message);
    console.error('Ã°Å¸â€™Â¥ Error stack:', error.stack);
    
    if (error.response) {
      console.error('Ã°Å¸â€œÅ  HTTP Status:', error.response.status);
      console.error('Ã°Å¸â€œÅ  HTTP Status Text:', error.response.statusText);
      console.error('Ã°Å¸â€œÅ  Response Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Ã°Å¸â€™Â¾ Full Response Data:');
      console.error('='.repeat(80));
      console.error(JSON.stringify(error.response.data, null, 2));
      console.error('='.repeat(80));
    }

    if (error.config) {
      console.error('Ã°Å¸â€Â§ Request Config:');
      console.error('   URL:', error.config.url);
      console.error('   Method:', error.config.method);
      console.error('   Headers:', JSON.stringify(error.config.headers, null, 2));
    }

    res.status(500).json({
      success: false,
      error: 'ClipTune analysis failed',
      details: error.message,
      debugInfo: {
        hasResponse: !!error.response,
        responseStatus: error.response?.status,
        responseData: error.response?.data
      }
    });
  }
});
// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// MongoDB Schemas// Replace your existing userSchema in index.js with this enhanced version:

const userSchema = new mongoose.Schema({
  username: String,
  email: { type: String, required: true, unique: true },
  password: String,
  stripeCustomerId: String,
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  lastPaymentIntentId: String,
  paymentStatus: { type: String, default: 'Free' },
  
  // NEW: Payment information storage
  paymentInfo: {
    hasPaymentMethod: { type: Boolean, default: false },
    defaultPaymentMethodId: String,
    
    // Store card info (encrypted/tokenized for security)
    cards: [{
      stripePaymentMethodId: String,
      last4: String,
      brand: String, // visa, mastercard, amex, etc.
      expMonth: Number,
      expYear: Number,
      isDefault: { type: Boolean, default: false },
      addedAt: { type: Date, default: Date.now },
      nickname: String // Optional: "Personal Card", "Business Card", etc.
    }],
    
    // Billing address (optional)
    billingAddress: {
      name: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      postal_code: String,
      country: String
    },
    
    // Payment history metadata
    lastPaymentDate: Date,
    totalPayments: { type: Number, default: 0 },
    failedPaymentAttempts: { type: Number, default: 0 }
  }
});

const User = mongoose.model('User', userSchema);
// Add these endpoints to your index.js file (after the existing payment endpoints)

// Get user's payment methods
app.post('/api/get-payment-methods', async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log('Ã°Å¸â€™Â³ Fetching payment methods for:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return stored payment info from MongoDB
    const paymentInfo = user.paymentInfo || {
      hasPaymentMethod: false,
      cards: [],
      billingAddress: {}
    };

    // Also fetch latest from Stripe to ensure sync
    let stripeCards = [];
    if (user.stripeCustomerId) {
      try {
        const paymentMethods = await stripeInstance.paymentMethods.list({
          customer: user.stripeCustomerId,
          type: 'card',
        });
        stripeCards = paymentMethods.data;
      } catch (stripeError) {
        console.warn('Ã¢Å¡ Ã¯Â¸Â Could not fetch from Stripe:', stripeError.message);
      }
    }

    res.json({
      success: true,
      paymentInfo,
      stripeCards: stripeCards.length,
      hasPaymentMethod: paymentInfo.hasPaymentMethod || stripeCards.length > 0
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error fetching payment methods:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch payment methods',
      details: error.message
    });
  }
});

// Add new payment method
app.post('/api/add-payment-method', async (req, res) => {
  const { 
    email, 
    paymentMethodId, 
    cardInfo, 
    billingAddress,
    setAsDefault = true,
    nickname 
  } = req.body;
  
  try {
    console.log('Ã°Å¸â€™Â³ Adding payment method for:', email);
    console.log('Payment method ID:', paymentMethodId);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Ensure user has Stripe customer ID
    if (!user.stripeCustomerId) {
      const customer = await stripeInstance.customers.create({ 
        email: user.email,
        name: user.username
      });
      user.stripeCustomerId = customer.id;
    }

    // Attach payment method to Stripe customer
    await stripeInstance.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    // Get card details from Stripe
    const paymentMethod = await stripeInstance.paymentMethods.retrieve(paymentMethodId);
    const card = paymentMethod.card;

    // Initialize paymentInfo if it doesn't exist
    if (!user.paymentInfo) {
      user.paymentInfo = {
        hasPaymentMethod: false,
        cards: [],
        billingAddress: {},
        totalPayments: 0,
        failedPaymentAttempts: 0
      };
    }

    // If setting as default, unmark other cards
    if (setAsDefault) {
      user.paymentInfo.cards.forEach(existingCard => {
        existingCard.isDefault = false;
      });
      
      // Set as default in Stripe
      await stripeInstance.customers.update(user.stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
      
      user.paymentInfo.defaultPaymentMethodId = paymentMethodId;
    }

    // Add card to MongoDB
    const newCard = {
      stripePaymentMethodId: paymentMethodId,
      last4: card.last4,
      brand: card.brand,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      isDefault: setAsDefault,
      addedAt: new Date(),
      nickname: nickname || `${card.brand.toUpperCase()} ending in ${card.last4}`
    };

    user.paymentInfo.cards.push(newCard);
    user.paymentInfo.hasPaymentMethod = true;

    // Update billing address if provided
    if (billingAddress) {
      user.paymentInfo.billingAddress = {
        ...user.paymentInfo.billingAddress,
        ...billingAddress
      };
    }

    await user.save();

    console.log('Ã¢Å“â€¦ Payment method added successfully');
    
    res.json({ 
      success: true,
      message: 'Payment method added successfully',
      card: newCard,
      paymentMethodId
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error adding payment method:', error);
    
    // Handle specific Stripe errors
    if (error.type && error.type.includes('Stripe')) {
      res.status(400).json({ 
        success: false,
        message: 'Payment method error: ' + error.message,
        details: error.decline_code || error.code
      });
    } else {
      res.status(500).json({ 
        success: false,
        message: 'Failed to add payment method',
        details: error.message
      });
    }
  }
});

// Remove payment method
app.post('/api/remove-payment-method', async (req, res) => {
  const { email, paymentMethodId } = req.body;
  
  try {
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Removing payment method for:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Detach from Stripe
    if (user.stripeCustomerId && paymentMethodId) {
      try {
        await stripeInstance.paymentMethods.detach(paymentMethodId);
      } catch (stripeError) {
        console.warn('Ã¢Å¡ Ã¯Â¸Â Stripe detach failed:', stripeError.message);
        // Continue with MongoDB cleanup even if Stripe fails
      }
    }

    // Remove from MongoDB
    if (user.paymentInfo && user.paymentInfo.cards) {
      const removedCard = user.paymentInfo.cards.find(
        card => card.stripePaymentMethodId === paymentMethodId
      );
      
      user.paymentInfo.cards = user.paymentInfo.cards.filter(
        card => card.stripePaymentMethodId !== paymentMethodId
      );

      // If removed card was default, set another as default
      if (removedCard?.isDefault && user.paymentInfo.cards.length > 0) {
        user.paymentInfo.cards[0].isDefault = true;
        user.paymentInfo.defaultPaymentMethodId = user.paymentInfo.cards[0].stripePaymentMethodId;
        
        // Update Stripe default
        if (user.stripeCustomerId) {
          await stripeInstance.customers.update(user.stripeCustomerId, {
            invoice_settings: {
              default_payment_method: user.paymentInfo.cards[0].stripePaymentMethodId,
            },
          });
        }
      } else if (user.paymentInfo.cards.length === 0) {
        user.paymentInfo.hasPaymentMethod = false;
        user.paymentInfo.defaultPaymentMethodId = null;
      }

      await user.save();
    }

    console.log('Ã¢Å“â€¦ Payment method removed successfully');
    
    res.json({ 
      success: true,
      message: 'Payment method removed successfully'
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error removing payment method:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to remove payment method',
      details: error.message
    });
  }
});

// Update billing address
app.post('/api/update-billing-address', async (req, res) => {
  const { email, billingAddress } = req.body;
  
  try {
    console.log('Ã°Å¸â€œÂ® Updating billing address for:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize paymentInfo if needed
    if (!user.paymentInfo) {
      user.paymentInfo = {
        hasPaymentMethod: false,
        cards: [],
        billingAddress: {},
        totalPayments: 0,
        failedPaymentAttempts: 0
      };
    }

    // Update billing address
    user.paymentInfo.billingAddress = {
      name: billingAddress.name || '',
      line1: billingAddress.line1 || '',
      line2: billingAddress.line2 || '',
      city: billingAddress.city || '',
      state: billingAddress.state || '',
      postal_code: billingAddress.postal_code || '',
      country: billingAddress.country || 'US'
    };

    await user.save();

    console.log('Ã¢Å“â€¦ Billing address updated successfully');
    
    res.json({ 
      success: true,
      message: 'Billing address updated successfully',
      billingAddress: user.paymentInfo.billingAddress
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error updating billing address:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update billing address',
      details: error.message
    });
  }
});

// Set default payment method
app.post('/api/set-default-payment-method', async (req, res) => {
  const { email, paymentMethodId } = req.body;
  
  try {
    console.log('Ã¢Â­Â Setting default payment method for:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.paymentInfo && user.paymentInfo.cards) {
      // Update MongoDB
      user.paymentInfo.cards.forEach(card => {
        card.isDefault = card.stripePaymentMethodId === paymentMethodId;
      });
      user.paymentInfo.defaultPaymentMethodId = paymentMethodId;

      // Update Stripe
      if (user.stripeCustomerId) {
        await stripeInstance.customers.update(user.stripeCustomerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });
      }

      await user.save();
    }

    console.log('Ã¢Å“â€¦ Default payment method updated');
    
    res.json({ 
      success: true,
      message: 'Default payment method updated successfully'
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error setting default payment method:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to set default payment method',
      details: error.message
    });
  }
});
const trackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String, // This will now be the user-provided track name
  trackName: String, // NEW: Specific field for track name (same as title for consistency)
  audioUrl: String,
  duration: String,
  generatedAt: { type: Date, default: Date.now },
  description: String,
  lyrics: String,
  youtubeUrls: [String],
  start: String,
  end: String,
  // NEW: Additional metadata
  segmentInfo: {
    segmentIndex: Number,
    originalStart: String,
    originalEnd: String,
    wasAdjusted: Boolean
  },
  generationType: { type: String, default: 'segment' }, // 'segment' or 'full'
  originalFileName: String // Store original video file name if available
});

const Track = mongoose.model('Track', trackSchema);
// Define schema and model for combined videos
const combinedSchema = new mongoose.Schema({
  userId: String,
  title: String,
  combinedVideoUrl: String,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
});

const Combined = mongoose.model('Combined', combinedSchema);

const completeVideoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  videoUrl: String,
  duration: Number,
  segmentCount: Number,
  description: String,
  processedSegments: Number,
  createdAt: { type: Date, default: Date.now },
  // Additional metadata
  metadata: {
    fadeAlgorithms: [String],
    totalDuration: Number,
    originalVideoName: String
  }
});

const CompleteVideo = mongoose.model('CompleteVideo', completeVideoSchema);

// ADD this new endpoint to save complete videos to library:
// ADD this new endpoint to your index.js backend file
// REPLACE your existing /api/update-progressive-video endpoint with this updated version
app.post('/api/update-progressive-video', upload.single('video'), async (req, res) => {
  let videoFilePath;
  const audioFilePaths = [];
  
  try {
    const { segments, musicData, videoDuration, newSegmentIndex, trimInfo } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    if (!segments || !musicData) {
      return res.status(400).json({ error: 'Missing segments or music data' });
    }

    const parsedSegments = JSON.parse(segments);
    const parsedMusicData = JSON.parse(musicData);
    const newSegmentIdx = parseInt(newSegmentIndex);
    
    // Ã°Å¸Å¡Â¨ NEW: Parse trimmed video info if provided
    const parsedTrimInfo = trimInfo ? JSON.parse(trimInfo) : null;
    const isTrimmedVideo = !!parsedTrimInfo;
    
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ PROGRESSIVE VIDEO UPDATE - TRIMMED VIDEO SUPPORT');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log(`Ã°Å¸â€œÅ  Total segments: ${parsedSegments.length}`);
    console.log(`Ã°Å¸â€ â€¢ New segment with music: ${newSegmentIdx + 1}`);
    console.log(`Ã°Å¸Å½Âµ Total segments with music: ${Object.keys(parsedMusicData).length}`);
    console.log(`Ã¢Å“â€šÃ¯Â¸Â Is trimmed video: ${isTrimmedVideo ? 'YES' : 'NO'}`);
    
    if (isTrimmedVideo) {
      console.log(`Ã¢Å“â€šÃ¯Â¸Â Trimmed video info:`, {
        originalStart: parsedTrimInfo.original_start + 's',
        originalEnd: parsedTrimInfo.original_end + 's',
        trimmedDuration: parsedTrimInfo.trimmed_duration + 's'
      });
    }
    
    // Show which segments currently have music
    const segmentsWithMusic = Object.keys(parsedMusicData).map(k => parseInt(k) + 1);
    console.log(`Ã°Å¸Å½Âµ Segments with music: [${segmentsWithMusic.join(', ')}]`);
    
    // Save uploaded video
    videoFilePath = path.join(tempDir, `progressive_video_source_${Date.now()}.mp4`);
    await fsPromises.writeFile(videoFilePath, req.file.buffer);
    
    // Download and process ALL segments that have music (including the new one)
    const activeAudioSegments = [];
    
    for (const segmentIndexStr of Object.keys(parsedMusicData)) {
      const segmentIndex = parseInt(segmentIndexStr);
      const musicInfo = parsedMusicData[segmentIndexStr];
      const originalSegment = parsedSegments[segmentIndex];
      
      if (musicInfo && musicInfo.audioUrl && originalSegment) {
        const volume = getEffectiveVolume(musicInfo, originalSegment);
        
        // Ã°Å¸Å¡Â¨ NEW: Handle timing for both trimmed and full video
        let segmentStartTime, segmentEndTime, timingSource;

        if (musicInfo.actualMusicTiming) {
          // Use the exact timing stored when music was generated
          segmentStartTime = parseFloat(musicInfo.actualMusicTiming.start);
          segmentEndTime = parseFloat(musicInfo.actualMusicTiming.end);
          timingSource = musicInfo.actualMusicTiming.wasAdjusted ? 'ADJUSTED_TIMING' : 'ORIGINAL_TIMING';
          
          // Log trimmed video specific info
          if (musicInfo.actualMusicTiming.isTrimmedVideo) {
            console.log(`Ã°Å¸Å½Âµ Segment ${segmentIndex + 1} (TRIMMED VIDEO):`);
            console.log(`   Absolute placement: ${segmentStartTime}s - ${segmentEndTime}s`);
            console.log(`   Relative to trimmed: ${musicInfo.actualMusicTiming.trimmedVideoInfo.relativeStart}s - ${musicInfo.actualMusicTiming.trimmedVideoInfo.relativeEnd}s`);
          } else {
            console.log(`Ã°Å¸Å½Âµ Segment ${segmentIndex + 1} (FULL VIDEO):`);
            console.log(`   Placement: ${segmentStartTime}s - ${segmentEndTime}s`);
          }
          
        } else if (musicInfo.segmentStart !== undefined && musicInfo.segmentEnd !== undefined) {
          segmentStartTime = parseFloat(musicInfo.segmentStart);
          segmentEndTime = parseFloat(musicInfo.segmentEnd);
          timingSource = 'MUSIC_DATA_FALLBACK';
        } else {
          segmentStartTime = parseFloat(originalSegment.start_time || 0);
          segmentEndTime = parseFloat(originalSegment.end_time || segmentStartTime + 30);
          timingSource = 'FALLBACK_ORIGINAL';
        }

        console.log(`   Volume: ${Math.round(volume * 100)}%`);
        console.log(`   Timing source: ${timingSource}`);
        console.log(`   ${segmentIndex === newSegmentIdx ? 'Ã°Å¸â€ â€¢ NEW!' : 'Ã¢Å“â€¦ Existing'}`);
        
        if (volume > 0) {
          try {
            console.log(`Ã°Å¸â€œÂ¥ Downloading audio for segment ${segmentIndex + 1}...`);
            
            const audioResponse = await axios({
              method: 'get',
              url: musicInfo.audioUrl,
              responseType: 'stream'
            });
            
            const audioFilePath = path.join(tempDir, `progressive_audio_${segmentIndex}_${Date.now()}.mp3`);
            const audioWriter = fs.createWriteStream(audioFilePath);
            audioResponse.data.pipe(audioWriter);
            
            await new Promise((resolve, reject) => {
              audioWriter.on('finish', resolve);
              audioWriter.on('error', reject);
            });
            
            activeAudioSegments.push({ 
              index: segmentIndex, 
              path: audioFilePath, 
              musicInfo: { ...musicInfo, effectiveVolume: volume },
              segment: {
                ...originalSegment,
                start_time: segmentStartTime,
                end_time: segmentEndTime,
                music_placement_timing: {
                  start: segmentStartTime,
                  end: segmentEndTime,
                  wasAdjusted: musicInfo.actualMusicTiming?.wasAdjusted || false,
                  timingSource: timingSource,
                  isTrimmedVideo: musicInfo.actualMusicTiming?.isTrimmedVideo || false,
                  trimmedVideoInfo: musicInfo.actualMusicTiming?.trimmedVideoInfo || null
                }
              },
              isNew: segmentIndex === newSegmentIdx
            });
            
            console.log(`Ã¢Å“â€¦ Audio ready for segment ${segmentIndex + 1}`);
            
          } catch (error) {
            console.error(`Ã¢ÂÅ’ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
          }
        } else {
          console.log(`Ã°Å¸â€â€¡ Segment ${segmentIndex + 1} is muted - skipping`);
        }
      }
    }
    
    // Sort segments by start time for proper layering
    activeAudioSegments.sort((a, b) => parseFloat(a.segment.start_time) - parseFloat(b.segment.start_time));
    
    console.log('\nÃ°Å¸Å½Âµ FINAL PROGRESSIVE VIDEO COMPOSITION:');
    console.log('Ã°Å¸Å½Âµ ===============================================');
    activeAudioSegments.forEach(({ index, segment, musicInfo, isNew }) => {
      const trimmedIndicator = segment.music_placement_timing?.isTrimmedVideo ? ' (Trimmed)' : ' (Full)';
      console.log(`${isNew ? 'Ã°Å¸â€ â€¢' : 'Ã¢Å“â€¦'} Segment ${index + 1}: ${segment.start_time}s-${segment.end_time}s (${Math.round(musicInfo.effectiveVolume * 100)}%)${trimmedIndicator}`);
    });
    console.log('Ã°Å¸Å½Âµ ===============================================\n');
    
    const outputPath = path.join(tempDir, `progressive_video_${Date.now()}.mp4`);
    
    // Handle case where no active segments
    if (activeAudioSegments.length === 0) {
      console.log('Ã°Å¸â€â€¡ No active music segments - restoring original video with FULL VOLUME');
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoFilePath)
          .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-b:a 192k',
            '-ar 44100',
            '-ac 2',
            '-af volume=1.0'
          ])
          .output(outputPath)
          .on('end', () => {
            console.log('Ã¢Å“â€¦ Original video restored with FULL VOLUME (no music segments)');
            resolve();
          })
          .on('error', reject)
          .run();
      });
      
      const stats = await fsPromises.stat(outputPath);
      const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

      return res.json({
        success: true,
        combinedUrl,
        activeSegments: 0,
        totalSegments: parsedSegments.length,
        originalVolumeRestored: true,
        isTrimmedVideo,
        message: `Original video restored with full volume (no active music segments)`
      });
      
    } else {
      console.log(`Ã°Å¸Å½Âµ Creating progressive video with ${activeAudioSegments.length} music segments...`);
      
      await new Promise((resolve, reject) => {
        let command = ffmpeg(videoFilePath);
        
        // Add all active audio inputs
        activeAudioSegments.forEach(({ path }) => {
          command = command.input(path);
        });
        
        if (activeAudioSegments.length === 1) {
          // Single segment
          const { index, musicInfo, segment } = activeAudioSegments[0];
          const segmentStart = parseFloat(segment.start_time);
          const volume = musicInfo.effectiveVolume;
          
          console.log(`Ã°Å¸Å½Âµ Progressive single segment: ${index + 1}`);
          console.log(`   Music volume: ${Math.round(volume * 100)}%`);
          console.log(`   Original video audio: PRESERVED at full volume`);
          
          const { filters, finalLabel } = buildAudioFilterWithFades(1, volume, segment, segmentStart, 0);
          
          if (segmentStart > 0) {
            const silenceFilter = `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence]`;
            const concatFilter = `[silence]${finalLabel}concat=n=2:v=0:a=1[delayed_music]`;
            const mixFilter = `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
            
            command = command.complexFilter([
              silenceFilter,
              ...filters,
              concatFilter,
              mixFilter
            ]);
          } else {
            const mixFilter = `[0:a]${finalLabel}amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
            command = command.complexFilter([
              ...filters,
              mixFilter
            ]);
          }
        } else {
          // Multiple segments
          const filterParts = [];
          const mixInputs = ['[0:a]'];
          
          console.log(`Ã°Å¸Å½Âµ Progressive multiple segments: ${activeAudioSegments.length}`);
          console.log(`   Original video audio: PRESERVED`);
          
          activeAudioSegments.forEach(({ index, musicInfo, segment }, arrayIndex) => {
            const segmentStart = parseFloat(segment.start_time);
            const volume = musicInfo.effectiveVolume;
            const audioInputIndex = arrayIndex + 1;
            
            console.log(`   ${arrayIndex + 1}. Segment ${index + 1}: ${segmentStart}s (${Math.round(volume * 100)}%)`);
            
            const { filters, finalLabel } = buildAudioFilterWithFades(audioInputIndex, volume, segment, segmentStart, arrayIndex);
            filterParts.push(...filters);
            
            if (segmentStart > 0) {
              filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence_${arrayIndex}]`);
              filterParts.push(`[silence_${arrayIndex}]${finalLabel}concat=n=2:v=0:a=1[delayed_${arrayIndex}]`);
              mixInputs.push(`[delayed_${arrayIndex}]`);
            } else {
              mixInputs.push(finalLabel);
            }
          });
          
          filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[final_audio]`);
          command = command.complexFilter(filterParts);
        }

        command = command.outputOptions([
          '-map 0:v',
          '-map [final_audio]',
          '-c:v copy',
          '-c:a aac',
          '-b:a 192k',
          '-ar 44100',
          '-ac 2',
          '-avoid_negative_ts make_zero'
        ]);

        command
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('Ã°Å¸Å½Â¬ Progressive video FFmpeg command:', commandLine.substring(0, 200) + '...');
          })
          .on('end', () => {
            console.log('Ã¢Å“â€¦ Progressive video update completed');
            resolve();
          })
          .on('error', (err) => {
            console.error('Ã¢ÂÅ’ Progressive video error:', err.message);
            reject(err);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`Ã°Å¸â€â€ž Progressive update: ${Math.round(progress.percent)}% done`);
            }
          })
          .run();
      });
    }

    // Verify output
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Progressive video output is empty');
    }

    console.log('Ã¢Å“â€¦ Progressive video ready:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° PROGRESSIVE VIDEO UPDATE SUCCESSFUL');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸â€â€” Updated Video URL:', combinedUrl);
    console.log(`Ã°Å¸â€ â€¢ Added segment ${newSegmentIdx + 1} to the progressive video`);
    console.log(`Ã°Å¸Å½Âµ Total active segments: ${activeAudioSegments.length}`);
    console.log(`Ã¢Å“â€šÃ¯Â¸Â Video type: ${isTrimmedVideo ? 'Trimmed' : 'Full'} video`);
    
    res.json({ 
      success: true, 
      combinedUrl,
      updatedSegmentIndex: newSegmentIdx,
      totalActiveSegments: activeAudioSegments.length,
      allActiveSegments: activeAudioSegments.map(a => a.index + 1),
      isProgressive: true,
      isTrimmedVideo,
      trimInfo: parsedTrimInfo
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in progressive video update:', error);
    res.status(500).json({ 
      error: 'Failed to update progressive video', 
      details: error.message 
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [videoFilePath, ...audioFilePaths];
    for (const file of filesToClean) {
      if (file) {
        try {
          await fsPromises.unlink(file);
        } catch (e) {
          console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete ${file}:`, e.message);
        }
      }
    }
  }
});
app.post('/api/save-complete-video', async (req, res) => {
  const { userId, title, videoUrl, duration, segmentCount, description, processedSegments } = req.body;

  try {
    console.log('Ã°Å¸â€œÅ¡ Saving complete video to library:', {
      userId,
      title,
      videoUrl: videoUrl ? videoUrl.substring(0, 50) + '...' : 'None',
      duration,
      segmentCount,
      processedSegments
    });

    // Check if a complete video with the same URL already exists for this user
    const existingVideo = await CompleteVideo.findOne({ userId, videoUrl });

    if (existingVideo) {
      console.log(`Complete video with URL already exists for user ${userId}. Not saving duplicate.`);
      return res.status(200).json({ 
        message: 'Complete video already saved to library.', 
        video: existingVideo,
        isDuplicate: true
      });
    }

    // Create and save the new complete video
    const newCompleteVideo = new CompleteVideo({
      userId,
      title,
      videoUrl,
      duration,
      segmentCount,
      description,
      processedSegments,
      metadata: {
        totalDuration: duration,
        fadeAlgorithms: [], // Could be populated if needed
        originalVideoName: title
      }
    });

    await newCompleteVideo.save();
    
    console.log('Ã¢Å“â€¦ Complete video saved to library successfully:', newCompleteVideo._id);
    
    res.status(201).json({ 
      message: 'Complete video saved to library successfully!', 
      video: newCompleteVideo,
      isDuplicate: false
    });

  } catch (err) {
    console.error('Ã¢ÂÅ’ Error saving complete video to library:', err);
    res.status(500).json({ 
      error: 'Failed to save complete video to library', 
      details: err.message 
    });
  }
});

// ADD this endpoint to get complete videos from library:

app.post('/api/get-complete-videos', async (req, res) => {
  const { userId } = req.body;
  
  try {
    console.log('Ã°Å¸â€œÅ¡ Fetching complete videos from library for user:', userId);
    
    const completeVideos = await CompleteVideo.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to 50 most recent videos
    
    console.log(`Ã¢Å“â€¦ Found ${completeVideos.length} complete videos in library`);
    
    res.status(200).json(completeVideos);
    
  } catch (err) {
    console.error("Ã¢ÂÅ’ Error fetching complete videos from library:", err);
    res.status(500).json({ 
      message: 'Failed to fetch complete videos from library',
      error: err.message 
    });
  }
});

// ADD this endpoint to delete complete videos from library:

app.post('/api/delete-complete-video', async (req, res) => {
  const { userId, videoId } = req.body;
  
  try {
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Deleting complete video from library:', { userId, videoId });
    
    const deletedVideo = await CompleteVideo.findOneAndDelete({ 
      _id: videoId, 
      userId: userId // Ensure user can only delete their own videos
    });
    
    if (!deletedVideo) {
      return res.status(404).json({ 
        error: 'Complete video not found or not authorized to delete' 
      });
    }
    
    console.log('Ã¢Å“â€¦ Complete video deleted from library successfully');
    
    res.status(200).json({ 
      message: 'Complete video deleted from library successfully',
      deletedVideo: deletedVideo
    });
    
  } catch (err) {
    console.error("Ã¢ÂÅ’ Error deleting complete video from library:", err);
    res.status(500).json({ 
      message: 'Failed to delete complete video from library',
      error: err.message 
    });
  }
});

// OPTIONAL: ADD this endpoint to get recent complete videos (for dropdown):

app.post('/api/get-recent-complete-videos', async (req, res) => {
  const { userId } = req.body;
  
  try {
    const recentCompleteVideos = await CompleteVideo.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5); // Get 5 most recent
      
    res.json(recentCompleteVideos);
    
  } catch (err) {
    console.error('Ã¢ÂÅ’ Error fetching recent complete videos:', err);
    res.status(500).json({ 
      error: 'Failed to fetch recent complete videos',
      details: err.message 
    });
  }
});
// Video Processing Endpoint
// Extract the upload logic into a reusable async function
async function handleVideoUpload(fileBuffer, originalname, mimetype, size) {
  try {
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ UPLOADING VIDEO TO GCS WITH SIGNED URLS');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (size / 1024 / 1024).toFixed(2), 'MB');

    // Step 1: Generate upload ticket with signed URLs
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ Generating upload ticket with signed URLs...');
    const { generateUploadUrl } = require('./gcs-utils');
    const uploadData = await generateUploadUrl(`videos/${Date.now()}_${originalname}`);
        
    console.log('Ã¢Å“â€¦ Upload ticket generated');
    console.log('Ã°Å¸â€â€” GCS URI:', uploadData.gcs_uri);

    // Step 2: Upload to GCS using signed URL
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ Uploading to Google Cloud Storage...');
    const uploadStartTime = Date.now();
        
    const axios = require('axios');
    await axios.put(uploadData.put_url, fileBuffer, {
      headers: {
        'Content-Type': mimetype || 'video/mp4',
        'Content-Length': size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        
    console.log('\nÃ¢Å“â€¦ ===============================================');
    console.log('Ã¢Å“â€¦ VIDEO UPLOADED TO GCS WITH SIGNED URLS!');
    console.log('Ã¢Å“â€¦ ===============================================');
    console.log('Ã¢ÂÂ±Ã¯Â¸Â Upload time:', uploadTime, 'seconds');
    console.log('Ã°Å¸â€â€” GCS URI:', uploadData.gcs_uri);
    console.log('Ã°Å¸Å’Â Signed read URL available for analysis');
    console.log('Ã°Å¸â€œÂ File name:', uploadData.file_name);

    return {
      success: true,
      message: 'Video uploaded to GCS successfully with signed URLs!',
      gcs_uri: uploadData.gcs_uri,
      public_url: uploadData.public_url,
      file_name: uploadData.file_name,
      upload_time: uploadTime + 's',
      file_size: (size / 1024 / 1024).toFixed(2) + ' MB',
      note: 'public_url is a signed URL valid for 24 hours'
    };
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã¢ÂÅ’ VIDEO UPLOAD TO GCS FAILED');
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã°Å¸â€™Â¥ Error message:', error.message);
        
    if (error.response) {
      console.error('Ã°Å¸â€œÅ  HTTP Status:', error.response.status);
      console.error('Ã°Å¸â€œÅ  Response data:', error.response.data);
    }

    throw new Error(`Failed to upload video to GCS: ${error.message}`);
  }
}

async function handleVideoAnalysisAndMusicGeneration(videoUrl, options = {}, videoBuffer = null) {
  try {
    const { 
      customPrompt = '', 
      analysisType = 'full',
      genre = null,
      detailLevel = 'detailed',
      generateMusic = true,
      enableWebhookMonitoring = true,  
      maxPollMinutes = 5               
    } = options;

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ ENHANCED GEMINI Ã¢â€ â€™ MUSICGPT WITH WEBHOOK MONITORING');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Video URL:', videoUrl);
    console.log('Ã°Å¸Å½Â¯ Generate Music:', generateMusic);
    console.log('Ã°Å¸â€œÂ¡ Webhook Monitoring:', enableWebhookMonitoring);
    console.log('Ã¢ÂÂ° Max Poll Time:', maxPollMinutes, 'minutes');
    console.log('Ã°Å¸â€œÂ¦ Video buffer provided:', !!videoBuffer);

    // STEP 1: Get video buffer and duration
    console.log('\n1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ PREPARING VIDEO FOR ANALYSIS');
    console.log('1Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const { analyzeVideoForDualMusicOutputs, analyzeVideoWithAudioFiles } = require('./gemini-utils');
  
    
    let finalVideoBuffer;
    let videoDurationSeconds = 0;
    
    if (videoBuffer) {
      // Ã¢Å“â€¦ USE PROVIDED BUFFER (recommended for immediate processing)
      console.log('Ã°Å¸â€œÂ¦ Using provided video buffer (immediate processing)');
      finalVideoBuffer = videoBuffer;
      console.log('Ã°Å¸â€œÅ  Buffer size:', (finalVideoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    } else {
      // Ã¢Å“â€¦ ENHANCED: Download with retry logic and proper error handling
      console.log('Ã°Å¸â€œÂ¥ Downloading video from GCS with retry logic...');
      
      const fileName = extractFileNameFromUrl(videoUrl);
      console.log('Ã°Å¸â€œÂ File name:', fileName);
      
      let downloadAttempts = 0;
      const maxDownloadAttempts = 3;
      let downloadSuccess = false;
      
      while (!downloadSuccess && downloadAttempts < maxDownloadAttempts) {
        downloadAttempts++;
        
        try {
          console.log(`Ã°Å¸â€œÂ¥ Download attempt ${downloadAttempts}/${maxDownloadAttempts}...`);
          
          if (downloadAttempts > 1) {
            const delay = 5000 * downloadAttempts; // Increasing delay: 5s, 10s, 15s
            console.log(`Ã¢ÂÂ³ Waiting ${delay}ms for file to be ready...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          let downloadUrl;
          if (videoUrl.includes('storage.googleapis.com') && videoUrl.includes('X-Goog-Algorithm')) {
            // Already a signed URL
            downloadUrl = videoUrl;
            console.log('Ã°Å¸â€â€” Using provided signed URL');
          } else {
            // Generate new signed URL
            console.log('Ã°Å¸â€Â Generating new signed URL...');
            downloadUrl = await getSignedDownloadUrl(fileName, 1);
            console.log('Ã¢Å“â€¦ Signed URL generated');
          }
          
          console.log(`Ã°Å¸â€œÂ¡ Attempting download from: ${downloadUrl.substring(0, 100)}...`);
          
          const response = await fetch(downloadUrl, {
            timeout: 60000 // 60 second timeout
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          finalVideoBuffer = Buffer.from(await response.arrayBuffer());
          downloadSuccess = true;
          
          console.log('Ã¢Å“â€¦ Video downloaded successfully');
          console.log('Ã°Å¸â€œÅ  Downloaded size:', (finalVideoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
          
        } catch (downloadError) {
          console.error(`Ã¢ÂÅ’ Download attempt ${downloadAttempts} failed:`, downloadError.message);
          
          if (downloadAttempts === maxDownloadAttempts) {
            throw new Error(`Failed to download video after ${maxDownloadAttempts} attempts. Last error: ${downloadError.message}. The file may not be ready yet or the URL may be invalid.`);
          }
        }
      }
    }

    // Ã¢Å“â€¦ ENHANCED: Get video duration with better error handling
    try {
      const tempVideoPath = path.join(__dirname, 'temp_videos', `temp_analysis_${Date.now()}.mp4`);
      await fsPromises.writeFile(tempVideoPath, finalVideoBuffer);
      
      videoDurationSeconds = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempVideoPath, (err, metadata) => {
          if (err) {
            console.warn('Ã¢Å¡ Ã¯Â¸Â Could not get video duration with ffprobe:', err.message);
            reject(err);
          } else {
            const duration = metadata.format.duration;
            console.log('Ã¢ÂÂ±Ã¯Â¸Â Video duration detected:', duration, 'seconds');
            resolve(Math.round(duration * 100) / 100);
          }
        });
      }).catch(async (error) => {
        console.warn('Ã¢Å¡ Ã¯Â¸Â FFprobe failed, trying alternative method:', error.message);
        
        try {
          const { getVideoDurationInSeconds } = require('get-video-duration');
          const duration = await getVideoDurationInSeconds(tempVideoPath);
          console.log('Ã¢ÂÂ±Ã¯Â¸Â Video duration detected (alternative method):', duration, 'seconds');
          return Math.round(duration * 100) / 100;
        } catch (altError) {
          console.warn('Ã¢Å¡ Ã¯Â¸Â Alternative duration detection failed:', altError.message);
          return 120; // Default to 2 minutes if all methods fail
        }
      });
      
      await fsPromises.unlink(tempVideoPath).catch(() => {});
      
    } catch (durationError) {
      console.error('Ã¢ÂÅ’ Error detecting video duration:', durationError.message);
      videoDurationSeconds = 120; // Default fallback to 2 minutes
    }
    
    console.log('Ã°Å¸â€œÂ Final video duration:', videoDurationSeconds, 'seconds');

    // STEP 2: Analyze video for dual outputs using the buffer
    console.log('\n2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ANALYZING VIDEO BUFFER FOR DUAL 280-CHAR OUTPUTS');
    console.log('2Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

    const dualAnalysisResult = await analyzeVideoForDualMusicOutputs(finalVideoBuffer, 'video/mp4', {
      customPrompt: customPrompt + `
      
FOCUS ON MUSICAL TERMINOLOGY:
Include specific terms like: BPM, key signatures, time signatures, dynamics (pp, ff), articulations (legato, staccato), intervals (octaves, 5ths), scales (major, minor, dorian), chord types (maj7, min9), orchestration details, playing techniques (pizzicato, tremolo), tempo markings (andante, allegro), and instrument specifics.

Generate TWO separate 280-character outputs with maximum musical detail.`
    });

    if (!dualAnalysisResult.success) {
      throw new Error(`Dual output analysis failed: ${dualAnalysisResult.error}`);
    }

    console.log('Ã¢Å“â€¦ Dual output analysis completed successfully');
    console.log('Ã°Å¸â€œâ€ž Raw analysis length:', dualAnalysisResult.rawAnalysis.length, 'characters');
    
    console.log('\nÃ°Å¸â€œÂ EXTRACTED DUAL OUTPUTS:');
    console.log('='.repeat(80));
    console.log('Ã°Å¸Å½Âµ PROMPT (', dualAnalysisResult.prompt.length, 'chars):');
    console.log(dualAnalysisResult.prompt);
    console.log('-'.repeat(40));
    console.log('Ã°Å¸Å½Â­ MUSIC_STYLE (', dualAnalysisResult.music_style.length, 'chars):');
    console.log(dualAnalysisResult.music_style);
    console.log('='.repeat(80));

    let musicResult = null;

    if (generateMusic) {
      // STEP 3: Send dual outputs to MusicGPT with webhook monitoring
      console.log('\n3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');
      console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ SENDING TO MUSICGPT WITH WEBHOOK MONITORING');
      console.log('3Ã¯Â¸ÂÃ¢Æ’Â£ ===============================================');

      try {
        const webhookUrl = "https://webhook.site/a54d685c-b636-4641-a883-edd74a6b7981";
        const webhookToken = extractWebhookToken(webhookUrl);
        
        console.log('Ã°Å¸â€œÂ¡ Webhook URL:', webhookUrl);
        console.log('Ã°Å¸â€â€˜ Webhook Token:', webhookToken);

        const musicgptPayload = {
          prompt: dualAnalysisResult.prompt,
          music_style: dualAnalysisResult.music_style,
          make_instrumental: true,
          vocal_only: false,
          webhook_url: webhookUrl
        };

        console.log('Ã°Å¸â€œÂ¤ MusicGPT Payload:');
        console.log('Ã°Å¸Å½Âµ Prompt:', dualAnalysisResult.prompt);
        console.log('Ã°Å¸Å½Â­ Music Style:', dualAnalysisResult.music_style);
        console.log('Ã°Å¸Å½Â¼ Make Instrumental:', true);
        console.log('Ã°Å¸â€œÂ¡ Webhook URL:', webhookUrl);

        const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

        console.log('Ã°Å¸â€œÂ¤ Calling MusicGPT API...');
        
        const musicgptStartTime = Date.now();

        const musicgptResponse = await axios.post(
          'https://api.musicgpt.com/api/public/v1/MusicAI',
          musicgptPayload,
          {
            headers: {
              'accept': 'application/json',
              'Authorization': MUSICGPT_API_KEY,
              'Content-Type': 'application/json'
            },
            timeout: 1000 * 60 * 2
          }
        );

        const musicgptProcessingTime = ((Date.now() - musicgptStartTime) / 1000).toFixed(2);

        console.log('Ã¢Å“â€¦ MusicGPT API Response:');
        console.log('Ã°Å¸â€œÅ  Status:', musicgptResponse.status);
        console.log('Ã°Å¸â€œâ€ž Response:', JSON.stringify(musicgptResponse.data, null, 2));

        const musicData = musicgptResponse.data;

        if (musicData.audio_url) {
          console.log('\nÃ°Å¸Å½â€° MUSIC GENERATED IMMEDIATELY!');
          console.log('Ã°Å¸â€â€” Audio URL:', musicData.audio_url);
          
          musicResult = {
            success: true,
            status: 'completed_immediately',
            music: musicData,
            audio_url: musicData.audio_url,
            processingTime: musicgptProcessingTime + 's'
          };
          
        } else if (musicData.task_id || musicData.conversion_id || musicData.conversion_id_1) {
          const taskId = musicData.task_id || musicData.conversion_id_1 || musicData.conversion_id;
          
          console.log('Ã°Å¸â€â€ž MusicGPT generation started - beginning webhook monitoring...');
          console.log('Ã°Å¸â€ â€ Task ID:', taskId);
          console.log('Ã¢ÂÂ° ETA:', musicData.eta || 120, 'seconds');
          
          if (enableWebhookMonitoring && webhookToken) {
            console.log('\nÃ°Å¸â€œÂ¡ ===============================================');
            console.log('Ã°Å¸â€œÂ¡ STARTING REAL-TIME WEBHOOK MONITORING');
            console.log('Ã°Å¸â€œÂ¡ ===============================================');
            
            const maxRetries = Math.floor((maxPollMinutes * 60) / 10);
            const minRequestsToWaitFor = 3;
            const webhookResult = await monitorWebhookForMusicGPT(webhookToken, maxRetries, 10000, minRequestsToWaitFor);
            
            if (webhookResult.success) {
              console.log('\nÃ°Å¸Å½â€° ===============================================');
              console.log('Ã°Å¸Å½â€° WEBHOOK MONITORING SUCCESS!');
              console.log('Ã°Å¸Å½â€° ===============================================');
              
              const webhookData = webhookResult.webhookData;
              const allRequests = webhookResult.allRequests;
              
              console.log('\nÃ°Å¸Å½Âµ ===============================================');
              console.log('Ã°Å¸Å½Âµ EXTRACTING MP3 FILES FROM WEBHOOK DATA');
              console.log('Ã°Å¸Å½Âµ ===============================================');
              
              const mp3Files = [];
              allRequests.forEach((request, index) => {
                if (request.content.conversion_path) {
                  mp3Files.push({
                    url: request.content.conversion_path,
                    title: request.content.title || `Generated Track ${index + 1}`,
                    mp3Duration: request.content.conversion_duration || null,
                    videoDuration: videoDurationSeconds,
                    requestNumber: index + 1
                  });
                  console.log(`Ã°Å¸Å½Âµ MP3 #${index + 1}: ${request.content.conversion_path}`);
                  console.log(`   Title: ${request.content.title || 'Untitled'}`);
                  console.log(`   MP3 Duration: ${request.content.conversion_duration || 'Unknown'}s`);
                  console.log(`   Video Duration: ${videoDurationSeconds}s`);
                }
              });
              
              console.log(`Ã°Å¸â€œÅ  Total MP3 files found: ${mp3Files.length}`);
              
              // Ã°Å¸Å½Â¯ NEW: GEMINI TIMING ANALYSIS FOR MULTIPLE MP3 FILES
              let timingAnalysis = null;
              if (mp3Files.length >= 2) {
                console.log('\nÃ°Å¸Â§  ===============================================');
                console.log('Ã°Å¸Â§  ANALYZING VIDEO + MP3S WITH GEMINI FOR OPTIMAL TIMING');
                console.log('Ã°Å¸Â§  ===============================================');
                
                try {
                  console.log('Ã°Å¸â€œÂ¥ Downloading MP3 files for Gemini analysis...');
                  
                  const mp3Buffers = [];
                  for (const mp3File of mp3Files) {
                    try {
                      console.log(`Ã°Å¸â€œÂ¥ Downloading: ${mp3File.title}`);
                      const mp3Response = await axios({
                        method: 'get',
                        url: mp3File.url,
                        responseType: 'arraybuffer',
                        timeout: 60000
                      });
                      
                      mp3Buffers.push({
                        buffer: Buffer.from(mp3Response.data),
                        title: mp3File.title,
                        originalDuration: mp3File.mp3Duration,
                        mimeType: 'audio/mpeg'
                      });
                      
                      console.log(`Ã¢Å“â€¦ Downloaded ${mp3File.title}: ${(mp3Response.data.byteLength / 1024 / 1024).toFixed(2)} MB`);
                      
                    } catch (mp3Error) {
                      console.error(`Ã¢ÂÅ’ Failed to download ${mp3File.title}:`, mp3Error.message);
                    }
                  }
                  
                  console.log(`Ã°Å¸â€œÅ  Successfully downloaded ${mp3Buffers.length}/${mp3Files.length} MP3 files`);
                  
                  // Ã°Å¸Å½Â¯ PERFORM GEMINI TIMING ANALYSIS
                  timingAnalysis = await analyzeVideoWithAudioFiles(finalVideoBuffer, 'video/mp4', mp3Buffers, {
                    customPrompt: `
ANALYZE THIS VIDEO AND THE PROVIDED MP3 AUDIO FILES TO SUGGEST OPTIMAL TIMING.

VIDEO DURATION: ${videoDurationSeconds} seconds

AUDIO FILES PROVIDED:
${mp3Files.map((file, i) => `${i + 1}. ${file.title} (Original: ${file.mp3Duration}s)`).join('\n')}

CRITICAL REQUIREMENT: 
- EACH TRACK MUST BE EXACTLY ${videoDurationSeconds} SECONDS LONG
- Duration = ${videoDurationSeconds} seconds for ALL tracks

ANALYSIS TASK:
1. LISTEN TO EACH MP3 AUDIO FILE
2. WATCH THE VIDEO CONTENT
3. DETERMINE which audio track works best with the video's visual content
4. Consider how each audio track's rhythm, melody, and mood match the video
5. Recommend volume levels based on audio-visual harmony
6. Suggest fade patterns that work with both audio and video content

MUSIC-VIDEO SYNCHRONIZATION:
- Match audio energy levels to video scenes
- Consider audio tempo vs visual pacing
- Identify where audio climaxes align with visual highlights
- Determine optimal volume for each track based on audio content
- Recommend fade-in/out timing based on musical structure

OUTPUT FORMAT:
For each MP3 track, provide:
1. Start time: can be any second within song duration
2. End time: can be any second within song duration
3. Duration: ${videoDurationSeconds} seconds
4. Volume recommendation (0-100%): Based on audio dynamics and video content
5. Fade recommendations: Based on musical structure and video transitions

EXAMPLE OUTPUT:
Track 1: [Title]
Start time: 10 seconds
End time: 10 + ${videoDurationSeconds} seconds
Volume: 75%
Fade: 3-second fade-in, 2-second fade-out based on musical intro/outro

Analyze the ACTUAL AUDIO CONTENT, not just the video.`,
                    genre: null,
                    analysisType: 'audio-visual-sync',
                    detailLevel: 'ultra'
                  });
                  
                  if (timingAnalysis.success) {
                    console.log('Ã¢Å“â€¦ Gemini timing analysis completed successfully');
                    console.log('Ã°Å¸â€œâ€ž Analysis length:', timingAnalysis.analysis.length, 'characters');
                    
                    console.log('\nÃ°Å¸Å½Â¯ ===============================================');
                    console.log('Ã°Å¸Å½Â¯ GEMINI TIMING ANALYSIS RESULTS');
                    console.log('Ã°Å¸Å½Â¯ ===============================================');
                    console.log(timingAnalysis.analysis);
                    console.log('Ã°Å¸Å½Â¯ ===============================================');
                    
                    // Ã°Å¸Å½Â¯ EXTRACT TIMING RECOMMENDATIONS
                    console.log('\nÃ°Å¸Å½Âµ EXTRACTING TIMING FROM GEMINI ANALYSIS...');
                    
               
                    
                  } else {
                    console.error('Ã¢ÂÅ’ Gemini timing analysis failed:', timingAnalysis.error);
                  }
                  
                } catch (timingError) {
                  console.error('Ã¢ÂÅ’ Error in Gemini timing analysis:', timingError.message);
                  timingAnalysis = {
                    success: false,
                    error: timingError.message
                  };
                }
              } else {
                console.log('Ã¢Å¡ Ã¯Â¸Â Not enough MP3 files for timing analysis (need at least 2)');
              }
              
              musicResult = {
                success: true,
                status: 'completed_via_webhook',
                music: webhookData,
                audio_url: webhookData.conversion_path,
                audio_url_wav: webhookData.conversion_path_wav,
                duration: webhookData.conversion_duration,
                title: webhookData.title,
                lyrics: webhookData.lyrics,
                album_cover: webhookData.album_cover_path,
                task_id: webhookData.task_id,
                conversion_id: webhookData.conversion_id,
                processingTime: musicgptProcessingTime + 's',
                webhookInfo: {
                  monitoringAttempts: webhookResult.totalPolls,
                  timestamp: webhookResult.requestInfo.timestamp,
                  uuid: webhookResult.requestInfo.uuid,
                  totalRequestsFound: webhookResult.totalRequestsFound
                },
                allMP3Files: mp3Files,
                timingAnalysis: timingAnalysis  // Ã°Å¸Å½Â¯ INCLUDE TIMING ANALYSIS
              };
              
            } else {
              console.log('\nÃ¢ÂÂ° ===============================================');
              console.log('Ã¢ÂÂ° WEBHOOK MONITORING TIMEOUT');
              console.log('Ã¢ÂÂ° ===============================================');
              
              musicResult = {
                success: false,
                status: 'webhook_timeout',
                task_id: taskId,
                eta: musicData.eta,
                processingTime: musicgptProcessingTime + 's',
                error: 'Webhook monitoring timed out',
                webhookInfo: {
                  monitoringAttempts: webhookResult.totalPolls,
                  timeoutMinutes: maxPollMinutes
                }
              };
            }
            
          } else {
            musicResult = {
              success: true,
              status: 'webhook_processing_no_monitoring',
              music: musicData,
              taskId: taskId,
              eta: musicData.eta || 120,
              processingTime: musicgptProcessingTime + 's',
              message: 'Music generation started. Webhook monitoring disabled.'
            };
          }
          
        } else {
          throw new Error('Unexpected MusicGPT response format');
        }

      } catch (musicError) {
        console.error('Ã¢ÂÅ’ Error in MusicGPT generation:', musicError);
        
        musicResult = {
          success: false,
          status: 'api_error',
          error: musicError.message,
          details: musicError.response?.data || null
        };
      }
    }

    // Final logging and response preparation
    console.log('\nÃ°Å¸Å½Å  ===============================================');
    console.log('Ã°Å¸Å½Å  ENHANCED WORKFLOW WITH WEBHOOK MONITORING COMPLETE');
    console.log('Ã°Å¸Å½Å  ===============================================');
    console.log('Ã¢Å“â€¦ Gemini Analysis: COMPLETED');
    console.log('Ã°Å¸Å½Âµ Music Generation:', musicResult?.status?.toUpperCase() || 'UNKNOWN');
    console.log('Ã°Å¸â€œÂ¡ Webhook Monitoring:', enableWebhookMonitoring ? 'ENABLED' : 'DISABLED');
    
    if (musicResult?.audio_url) {
      console.log('Ã°Å¸â€â€” FINAL AUDIO URL:', musicResult.audio_url);
    }
    if (musicResult?.audio_url_wav) {
      console.log('Ã°Å¸â€â€” FINAL WAV URL:', musicResult.audio_url_wav);
    }
    if (musicResult?.webhookInfo) {
      console.log('Ã°Å¸â€œÂ¡ Webhook Attempts:', musicResult.webhookInfo.monitoringAttempts);
      console.log('Ã°Å¸â€œÅ  Total Requests Found:', musicResult.webhookInfo.totalRequestsFound);
    }
    if (musicResult?.allMP3Files) {
      console.log('Ã°Å¸Å½Âµ MP3 Files Collected:', musicResult.allMP3Files.length);
    }
    if (musicResult?.timingAnalysis?.success) {
      console.log('Ã°Å¸Å½Â¯ Timing Analysis: COMPLETED');
    }

    return {
      success: true,
      dualAnalysisResult: dualAnalysisResult,
      musicResult: musicResult,
      videoDurationSeconds: videoDurationSeconds,
      videoUrl: videoUrl
    };

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in enhanced workflow with webhook monitoring:', error);
    throw new Error(`Video analysis and music generation failed: ${error.message}`);
  }
}

function extractTimingFromGeminiAnalysis(analysisText, mp3Files, clipDuration) {
  console.log('Ã°Å¸Å½Â¯ EXTRACTING TIMING FROM GEMINI ANALYSIS...');
  console.log('Ã°Å¸â€œâ€ž Analysis text length:', analysisText.length);
  
  const recommendations = [];
  
  try {
    // Helper function to format seconds as MM:SS
    const formatTime = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };
    
    // Ã°Å¸Å¡Â¨ SIMPLE APPROACH: Extract all timing data directly without splitting
    // Since debug shows patterns exist, let's extract them directly
    
    // Extract all start times
    const startTimeMatches = analysisText.match(/\*\s*\*\*\s*Start Time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds/gi);
    console.log('Ã°Å¸â€Â Start time matches found:', startTimeMatches);
    
    // Extract all end times  
    const endTimeMatches = analysisText.match(/\*\s*\*\*\s*End Time:\s*\*\*\s*(\d+(?:\.\d+)?)\s*seconds/gi);
    console.log('Ã°Å¸â€Â End time matches found:', endTimeMatches);
    
    // Extract all volumes
    const volumeMatches = analysisText.match(/\*\s*\*\*\s*Volume:\s*\*\*\s*(\d+)%/gi);
    console.log('Ã°Å¸â€Â Volume matches found:', volumeMatches);
    
    // Extract numerical values
    const startTimes = [];
    const endTimes = [];
    const volumes = [];
    
    if (startTimeMatches) {
      startTimeMatches.forEach(match => {
        const timeMatch = match.match(/(\d+(?:\.\d+)?)/);
        if (timeMatch) {
          startTimes.push(parseFloat(timeMatch[1]));
        }
      });
    }
    
    if (endTimeMatches) {
      endTimeMatches.forEach(match => {
        const timeMatch = match.match(/(\d+(?:\.\d+)?)/);
        if (timeMatch) {
          endTimes.push(parseFloat(timeMatch[1]));
        }
      });
    }
    
    if (volumeMatches) {
      volumeMatches.forEach(match => {
        const volumeMatch = match.match(/(\d+)/);
        if (volumeMatch) {
          volumes.push(parseInt(volumeMatch[1]));
        }
      });
    }
    
    console.log('Ã°Å¸â€œÅ  Extracted values:');
    console.log('   Start times:', startTimes);
    console.log('   End times:', endTimes);  
    console.log('   Volumes:', volumes);
    
    // Process each track (ensure we don't exceed available MP3 files)
    const numTracks = Math.min(startTimes.length, endTimes.length, mp3Files.length);
    console.log(`Ã°Å¸â€œÅ  Processing ${numTracks} tracks (max of start/end/mp3 counts)`);
    
    for (let i = 0; i < numTracks; i++) {
      const mp3File = mp3Files[i];
      const startTime = startTimes[i];
      const endTime = endTimes[i];
      const volume = volumes[i] || 70; // Default volume if not found
      const duration = endTime - startTime;
      
      console.log(`\nÃ°Å¸Å½Âµ Processing Track ${i + 1}:`);
      console.log(`   MP3 File: ${mp3File.title}`);
      console.log(`   Start: ${startTime}s`);
      console.log(`   End: ${endTime}s`);
      console.log(`   Duration: ${duration}s`);
      console.log(`   Volume: ${volume}%`);
      
      // Validate timing makes sense
      if (startTime >= 0 && endTime > startTime && duration > 0) {
        recommendations.push({
          trackNumber: i + 1,
          title: mp3File.title,
          url: mp3File.url,
          originalDuration: mp3File.mp3Duration,
          videoDuration: clipDuration,
          
          // Ã°Å¸Å¡Â¨ EXTRACTED TIMING FROM GEMINI:
          startTime: startTime,
          endTime: endTime, 
          duration: duration,
          
          // Ã°Å¸Å¡Â¨ FORMATTED FOR FRONTEND:
          startFormatted: formatTime(startTime),
          endFormatted: formatTime(endTime),
          durationFormatted: `${Math.round(duration)}s`,
          
          // Volume and fade info
          volume: volume,
          volumeDecimal: volume / 100,
          fadeIn: 2,
          fadeOut: 2
        });
        
        console.log(`Ã¢Å“â€¦ Track ${i + 1} timing successfully extracted:`, {
          start: `${startTime}s (${formatTime(startTime)})`,
          end: `${endTime}s (${formatTime(endTime)})`, 
          duration: `${duration}s`,
          volume: `${volume}%`
        });
        
      } else {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Track ${i + 1} has invalid timing values:`, {
          startTime, endTime, duration, valid: false
        });
        
        // Add default recommendation
        recommendations.push({
          trackNumber: i + 1,
          title: mp3File.title,
          url: mp3File.url,
          startTime: 0,
          endTime: clipDuration,
          duration: clipDuration,
          startFormatted: formatTime(0),
          endFormatted: formatTime(clipDuration),
          durationFormatted: `${clipDuration}s`,
          volume: 70,
          volumeDecimal: 0.7,
          isDefault: true
        });
      }
    }
    
    console.log(`Ã°Å¸Å½Â¯ Final extraction results: ${recommendations.length} recommendations`);
    recommendations.forEach((rec, i) => {
      console.log(`   Track ${rec.trackNumber}: ${rec.startFormatted} Ã¢â€ â€™ ${rec.endFormatted} (${rec.durationFormatted}) Vol: ${rec.volume}%${rec.isDefault ? ' [DEFAULT]' : ' [GEMINI]'}`);
    });
    
    return recommendations;
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error extracting Gemini timing:', error.message);
    console.error('Ã¢ÂÅ’ Stack trace:', error.stack);
    
    // Fallback: Create default recommendations
    console.log('Ã°Å¸â€â€ž Creating fallback recommendations...');
    const fallbackRecs = mp3Files.map((file, index) => ({
      trackNumber: index + 1,
      title: file.title,
      url: file.url,
      startTime: 0,
      endTime: clipDuration,
      duration: clipDuration,
      startFormatted: formatTime(0),
      endFormatted: formatTime(clipDuration),
      durationFormatted: `${clipDuration}s`,
      volume: 70,
      volumeDecimal: 0.7,
      isDefault: true,
      fallbackReason: 'extraction_error'
    }));
    
    console.log(`Ã°Å¸â€â€ž Created ${fallbackRecs.length} fallback recommendations`);
    return fallbackRecs;
  }
}

function displayGeminiTimingResults(recommendations) {
  console.log('\nÃ°Å¸Å½Â¯ ===============================================');
  console.log('Ã°Å¸Å½Â¯ EXTRACTED TIMING RECOMMENDATIONS');
  console.log('Ã°Å¸Å½Â¯ ===============================================');
  
  recommendations.forEach((rec, index) => {
    console.log(`\nÃ°Å¸Å½Âµ Track ${rec.trackNumber}: ${rec.title}`);
    console.log(`   Start Time: ${rec.startTime}s`);
    console.log(`   End Time: ${rec.endTime}s`);
    console.log(`   Duration: ${rec.endTime - rec.startTime}s`);
    console.log(`   Volume: ${rec.volume}%`);
    console.log(`   Fade In: ${rec.fadeIn}s`);
    console.log(`   Fade Out: ${rec.fadeOut}s`);
    console.log(`   URL: ${rec.url}`);
  });
  
  console.log('Ã°Å¸Å½Â¯ ===============================================');
}

module.exports = { 
  handleVideoAnalysisAndMusicGeneration,
  extractTimingFromGeminiAnalysis,
  displayGeminiTimingResults
};

// Modified process-video route using the shared analysis function instead of ClipTune
// REPLACE your existing /api/process-video route in index.js with this fixed version

app.post('/api/process-video', multer({ storage: multer.memoryStorage() }).single('video'), async (req, res) => {
  let trimmedPath, originalPath;
  
  try {
    // 1. VALIDATE REQUEST
    if (!req.file) {
      return res.status(400).json({ 
        error: "No video uploaded.",
        success: false 
      });
    }

    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ PROCESSING VIDEO WITH INTERVAL TIMING FIX');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸â€œÂ Original video:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  Original size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    // 2. EXTRACT TIMING PARAMETERS
    const videoStart = parseInt(req.body.video_start) || 0;
    const videoEnd = parseInt(req.body.video_end) || 30;
    const clipDuration = videoEnd - videoStart;
    const trackName = req.body.track_name || req.body.song_title || 'Generated Track';
    const userId = req.body.userId || 'anonymous';

    console.log('Ã¢ÂÂ±Ã¯Â¸Â Timing parameters:');
    console.log(`   Video start: ${videoStart}s`);
    console.log(`   Video end: ${videoEnd}s`);
    console.log(`   Clip duration: ${clipDuration}s`);
    console.log(`   Track name: "${trackName}"`);

    // Validate timing
    if (clipDuration <= 0) {
      return res.status(400).json({ 
        error: "Invalid time range: end time must be greater than start time",
        success: false 
      });
    }

    if (clipDuration > 300) { // 5 minutes max
      return res.status(400).json({ 
        error: "Clip duration too long (max 5 minutes)",
        success: false 
      });
    }

    // 3. SAVE ORIGINAL VIDEO
    originalPath = path.join(__dirname, 'temp_videos', `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);
    console.log('Ã°Å¸â€™Â¾ Original video saved to:', originalPath);

    // 4. TRIM VIDEO
    console.log(`Ã¢Å“â€šÃ¯Â¸Â Trimming video: ${videoStart}s - ${videoEnd}s (${clipDuration}s)`);
    trimmedPath = path.join(__dirname, 'temp_videos', `trimmed_${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(videoStart)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Video trimming completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('Ã¢ÂÅ’ Video trimming failed:', err.message);
          reject(new Error(`Video trimming failed: ${err.message}`));
        })
        .run();
    });

    // 5. CLEAN UP ORIGINAL FILE
    await fsPromises.unlink(originalPath);
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Original video file cleaned up');

    // 6. READ TRIMMED VIDEO INTO BUFFER
    console.log('Ã°Å¸â€œÂ¦ Reading trimmed video into buffer for analysis...');
    const trimmedBuffer = await fsPromises.readFile(trimmedPath);
    console.log('Ã°Å¸â€œÅ  Trimmed buffer size:', (trimmedBuffer.length / 1024 / 1024).toFixed(2), 'MB');

    // 7. UPLOAD TO GCS FOR BACKUP
    console.log('Ã¢ËœÂÃ¯Â¸Â Uploading trimmed video to GCS...');
    const uploadResult = await handleVideoUpload(
      trimmedBuffer, 
      `trimmed_${trackName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.mp4`, 
      req.file.mimetype, 
      trimmedBuffer.length
    );
    console.log('Ã¢Å“â€¦ GCS upload completed:', uploadResult.gcs_uri);

    // 8. PREPARE ANALYSIS OPTIONS
    const analysisOptions = {
      customPrompt: req.body.extra_description || `Generate music for "${trackName}"`,
      generateMusic: true,
      enableWebhookMonitoring: true,
      maxPollMinutes: 5,
      trackName: trackName,
      instrumental: req.body.instrumental === 'true',
      userId: userId
    };

    console.log('Ã°Å¸Â§  Analysis options:', analysisOptions);

    // 9. ANALYZE VIDEO AND GENERATE MUSIC
    console.log('Ã°Å¸Å½Âµ Starting video analysis and music generation...');
    const analysisResult = await handleVideoAnalysisAndMusicGeneration(
      uploadResult.gcs_uri,
      analysisOptions,
      trimmedBuffer  // Pass buffer directly to avoid download delays
    );

    console.log('Ã¢Å“â€¦ Analysis completed:', analysisResult.musicResult?.status || 'Unknown');

    // 10. HELPER FUNCTION FOR TIME FORMATTING
    const formatTime = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };
if (analysisResult.musicResult.timingAnalysis?.success) {
  console.log('Ã°Å¸â€Â DEBUGGING GEMINI ANALYSIS FORMAT...');
  debugGeminiAnalysis(analysisResult.musicResult.timingAnalysis.analysis);
  
  console.log('Ã°Å¸Å½Â¯ Now extracting timing...');
  timingRecommendations = extractTimingFromGeminiAnalysis(
    analysisResult.musicResult.timingAnalysis.analysis,
    analysisResult.musicResult.allMP3Files,
    clipDuration
  );
}
    // 11. PREPARE RESPONSE WITH PROPER TIMING
    let responseData = {
      success: true,
      tracks: [],
      processing_method: 'direct_buffer_analysis',
      gcs_backup: uploadResult.gcs_uri,
      trimmed_duration: clipDuration,
      original_timing: {
        video_start: videoStart,
        video_end: videoEnd,
        clip_duration: clipDuration
      }
    };

    // 12. PROCESS MUSIC RESULT AND CREATE TRACKS ARRAY
    if (analysisResult.musicResult?.success && analysisResult.musicResult?.audio_url) {
      console.log('Ã°Å¸Å½Âµ Processing successful music result...');
      
      // Handle multiple MP3 files if available
   if (analysisResult.musicResult.allMP3Files && analysisResult.musicResult.allMP3Files.length > 0) {
  console.log(`Ã°Å¸Å½Âµ Found ${analysisResult.musicResult.allMP3Files.length} MP3 files`);
  
  // Ã°Å¸Å¡Â¨ NEW: Extract timing recommendations from Gemini analysis
  let timingRecommendations = [];
  
  if (analysisResult.musicResult.timingAnalysis && analysisResult.musicResult.timingAnalysis.success) {
    console.log('Ã°Å¸Å½Â¯ Extracting timing from Gemini analysis...');
    timingRecommendations = extractTimingFromGeminiAnalysis(
      analysisResult.musicResult.timingAnalysis.analysis,
      analysisResult.musicResult.allMP3Files,
      clipDuration
    );
    
    console.log(`Ã¢Å“â€¦ Extracted ${timingRecommendations.length} timing recommendations`);
  }
  
  analysisResult.musicResult.allMP3Files.forEach((mp3File, index) => {
    // Ã°Å¸Å¡Â¨ USE GEMINI TIMING IF AVAILABLE, OTHERWISE DEFAULTS
    const timingRec = timingRecommendations.find(rec => rec.trackNumber === index + 1);
    
    let trackStart, trackEnd, trackDuration;
    
    if (timingRec) {
      // Ã°Å¸Å¡Â¨ USE GEMINI RECOMMENDATIONS:
      trackStart = timingRec.startFormatted;     // e.g., "0:10" 
      trackEnd = timingRec.endFormatted;         // e.g., "0:30"
      trackDuration = timingRec.durationFormatted; // e.g., "20s"
      
      console.log(`Ã°Å¸Å½Â¯ Using Gemini timing for Track ${index + 1}:`, {
        start: trackStart,
        end: trackEnd, 
        duration: trackDuration,
        volume: timingRec.volume + '%'
      });
      
    } else {
      // Ã°Å¸Å¡Â¨ FALLBACK TO DEFAULTS:
      trackStart = formatTime(0);
      trackEnd = formatTime(clipDuration);
      trackDuration = `${clipDuration}s`;
      
      console.log(`Ã¢Å¡ Ã¯Â¸Â Using default timing for Track ${index + 1}:`, {
        start: trackStart,
        end: trackEnd,
        duration: trackDuration
      });
    }
    
    responseData.tracks.push({
      // Audio URLs
      audioUrl: mp3File.url,
      url: mp3File.url,
      audio_url: mp3File.url,
      
      // Track metadata
      title: mp3File.title || `${trackName} (Version ${index + 1})`,
      trackName: mp3File.title || `${trackName} (Version ${index + 1})`,
      originalTrackName: trackName,
      
      // Ã°Å¸Å¡Â¨ CRITICAL: USE EXTRACTED TIMING FROM GEMINI:
      start: trackStart,        // e.g., "0:10" (from Gemini)
      end: trackEnd,            // e.g., "0:30" (from Gemini) 
      duration: trackDuration,  // e.g., "20s" (from Gemini)
      
      // Additional timing metadata
      originalVideoStart: videoStart,
      originalVideoEnd: videoEnd,
      clipDuration: clipDuration,
      musicDurationSeconds: mp3File.mp3Duration || clipDuration,
      
      // Ã°Å¸Å¡Â¨ ADD GEMINI RECOMMENDATIONS:
      ...(timingRec && {
        geminiStartTime: timingRec.startTime,
        geminiEndTime: timingRec.endTime,
        geminiVolume: timingRec.volume,
        geminiVolumeDecimal: timingRec.volumeDecimal,
        hasGeminiTiming: true
      }),
      
      // Music generation metadata
      generationType: 'full_generation_with_timing',
      index: index,
      isInstrumental: req.body.instrumental === 'true',
      generatedAt: new Date().toISOString()
    });
  });
}
else {
        // Single track result
        console.log('Ã°Å¸Å½Âµ Processing single track result...');
        responseData.tracks.push({
          // Audio URLs
          audioUrl: analysisResult.musicResult.audio_url,
          url: analysisResult.musicResult.audio_url,
          audio_url: analysisResult.musicResult.audio_url,
          
          // Track metadata
          title: analysisResult.musicResult.title || trackName,
          trackName: analysisResult.musicResult.title || trackName,
          originalTrackName: trackName,
          
          // Ã°Å¸Å¡Â¨ CRITICAL: INTERVAL TIMING FOR SPOTIFY PLAYER
          start: formatTime(0),           // "0:00" - Start of music
          end: formatTime(clipDuration),  // "0:30" - End based on clip duration
          duration: `${clipDuration}s`,   // "30s" - Duration
          
          // Additional timing metadata
          originalVideoStart: videoStart,
          originalVideoEnd: videoEnd,
          clipDuration: clipDuration,
          musicDurationSeconds: analysisResult.musicResult.duration || clipDuration,
          
          // Music generation metadata
          generationType: 'full_generation',
          isInstrumental: req.body.instrumental === 'true',
          generatedAt: new Date().toISOString(),
          
          // Include additional music metadata if available
          ...(analysisResult.musicResult.title && { musicTitle: analysisResult.musicResult.title }),
          ...(analysisResult.musicResult.lyrics && { lyrics: analysisResult.musicResult.lyrics }),
          ...(analysisResult.musicResult.album_cover && { albumCover: analysisResult.musicResult.album_cover })
        });
      }
      
      // Add analysis metadata to response
      responseData.analysis = {
        success: true,
        videoDurationSeconds: analysisResult.videoDurationSeconds,
        musicGenerationMethod: analysisResult.musicResult.status,
        processingTime: analysisResult.musicResult.processingTime,
        webhookInfo: analysisResult.musicResult.webhookInfo
      };
      
    } else if (analysisResult.musicResult?.task_id) {
      // Music generation started but not completed
      console.log('Ã°Å¸â€â€ž Music generation in progress...');
      responseData.success = false;
      responseData.status = 'processing';
      responseData.task_id = analysisResult.musicResult.task_id;
      responseData.eta = analysisResult.musicResult.eta;
      responseData.message = 'Music generation started. Please check back in a few minutes.';
      
    } else {
      // Music generation failed
      console.error('Ã¢ÂÅ’ Music generation failed');
      responseData.success = false;
      responseData.error = analysisResult.musicResult?.error || 'Music generation failed';
      responseData.details = analysisResult.musicResult?.details;
    }

    // 13. LOG FINAL RESPONSE FOR DEBUG
    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° RESPONSE PREPARED WITH INTERVAL TIMING');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã¢Å“â€¦ Success:', responseData.success);
    console.log('Ã¢Å“â€¦ Tracks count:', responseData.tracks.length);
    
    if (responseData.tracks.length > 0) {
      responseData.tracks.forEach((track, index) => {
        console.log(`Ã°Å¸Å½Âµ Track ${index + 1}:`);
        console.log(`   Title: ${track.title}`);
        console.log(`   Start: ${track.start}`);
        console.log(`   End: ${track.end}`);
        console.log(`   Duration: ${track.duration}`);
        console.log(`   Audio URL: ${track.audioUrl?.substring(0, 50)}...`);
      });
    }
    console.log('Ã°Å¸Å½â€° ===============================================');

    // 14. SEND RESPONSE
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Ã¢ÂÅ’ Process video error:', error);
    
    // Clean up any temporary files
    const cleanup = async () => {
      try {
        if (originalPath && fs.existsSync(originalPath)) {
          await fsPromises.unlink(originalPath);
          console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up original file');
        }
        if (trimmedPath && fs.existsSync(trimmedPath)) {
          await fsPromises.unlink(trimmedPath);
          console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up trimmed file');
        }
      } catch (cleanupError) {
        console.warn('Ã¢Å¡ Ã¯Â¸Â Cleanup error:', cleanupError.message);
      }
    };
    
    await cleanup();
    
    // Send error response
    res.status(500).json({
      success: false,
      error: 'Music generation failed',
      details: error.message,
      processing_method: 'direct_buffer_analysis',
      timestamp: new Date().toISOString()
    });
  } finally {
    // Final cleanup
    if (trimmedPath) {
      try {
        await fsPromises.unlink(trimmedPath);
        console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Final cleanup completed');
      } catch (cleanupError) {
        console.warn('Ã¢Å¡ Ã¯Â¸Â Final cleanup error:', cleanupError.message);
      }
    }
  }
});

// Simplified analyze-gcs-video route (now using shared function)
app.post('/api/analyze-gcs-video-for-music-with-generation', async (req, res) => {
  try {
    const { gcsUrl, publicUrl } = req.body;

    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL or public URL provided'
      });
    }

    const videoUrl = publicUrl || gcsUrl;
    
    const result = await handleVideoAnalysisAndMusicGeneration(videoUrl, req.body);

    res.json(result);

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in enhanced workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Enhanced workflow failed',
      details: error.message
    });
  }
});
// Simplified upload-video-to-gcs route using the shared function
app.post('/api/upload-video-to-gcs', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file uploaded'
      });
    }

    // Call the shared upload function
    const result = await handleVideoUpload(
      req.file.buffer, 
      req.file.originalname, 
      req.file.mimetype, 
      req.file.size
    );

    res.json(result);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to upload video to Google Cloud Storage',
      details: error.message,
      httpStatus: error.response?.status
    });
  }
});
// Endpoint to save combined video
app.post('/api/save-combined', async (req, res) => {
  const { userId, title, combinedVideoUrl, duration } = req.body;

  try {
    // Check if a combined video with the same URL already exists for this user
    const existingCombinedVideo = await Combined.findOne({ userId, combinedVideoUrl });

    if (existingCombinedVideo) {
      // If it exists, return a success response but don't save a duplicate
      console.log(`Combined video with URL ${combinedVideoUrl} already exists for user ${userId}. Not saving duplicate.`);
      return res.status(200).json({ message: 'Combined video already saved.', combined: existingCombinedVideo });
    }

    // If it does not exist, create and save the new combined video
    const newCombined = new Combined({
      userId,
      title,
      combinedVideoUrl,
      duration,
    });
    await newCombined.save();
    res.status(201).json({ message: 'Combined video saved successfully!', combined: newCombined });
  } catch (err) {
    console.error('Error saving combined video:', err);
    res.status(500).json({ error: 'Failed to save combined video', details: err.message });
  }
});

app.post('/api/get-tracks', async (req, res) => {
  const { userId } = req.body;
  try {
    const tracks = await Track.find({ userId }).sort({ generatedAt: -1 });
    res.status(200).json(tracks);
  } catch (err) {
    console.error("Error fetching tracks:", err);
    res.status(500).json({ message: 'Failed to fetch tracks' });
  }
});

// Get recent combined videos for a user (most recent 5)
app.post('/api/get-recent-combined', async (req, res) => {
  const { userId } = req.body;
  try {
    const recentCombined = await Combined.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5); // Get 5 most recent instead of 1
    res.json(recentCombined); // Return array instead of single item
  } catch (err) {
    console.error('Error fetching recent combined videos:', err);
    res.status(500).json({ error: 'Failed to fetch recent combined videos' });
  }
});

app.post('/get-user', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.status(200).json({
      email: user.email,
      username: user.username,
      userId: user._id,
    });
  } catch (err) {
    console.error("Get User Error:", err);
    res.status(500).json({ message: 'Server error retrieving user data' });
  }
});

// REPLACE your existing /api/generate-segment-music endpoint in index.js with this updated version:


app.post('/api/generate-segment-music', upload.single('video'), async (req, res) => {
  let trimmedPath, originalPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded." });
    }

    const { 
      video_start, 
      video_end, 
      youtubeUrls, 
      lyrics, 
      extra_description, // Ã°Å¸Å¡Â¨ This now contains detailed_description from ClipTune
      instrumental, 
      song_title,
      track_name
    } = req.body;

    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸Å½Âµ GENERATING MUSIC WITH MUSICGPT + DUAL-OUTPUT');
    console.log('Ã°Å¸Å½Âµ ===============================================');
    console.log('Ã°Å¸â€œÂ Video file:', req.file.originalname);
    console.log('Ã¢ÂÂ° Segment timing:', `${video_start}s - ${video_end}s`);
    console.log('Ã°Å¸Å½Â¯ Detailed description length:', extra_description?.length || 0, 'characters');
    console.log('Ã°Å¸Å½Âµ Song title:', song_title || 'segment_music');
    console.log('Ã°Å¸Å½Â¶ Track name:', track_name || 'Unnamed Track');

    // Save original video temporarily (still needed for context)
    originalPath = path.join(tempDir, `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);

    // Extract segment timing
    const start = parseInt(video_start);
    const end = parseInt(video_end);
    const clipDuration = end - start;
    
    if (clipDuration <= 0) {
      throw new Error("Invalid time range - end time must be greater than start time");
    }

    if (clipDuration > 300) { // 5 minutes max
      throw new Error("Segment too long - maximum 5 minutes (300 seconds) allowed");
    }

    console.log('Ã¢Å“â€šÃ¯Â¸Â Processing video segment...');
    console.log(`   Duration: ${clipDuration} seconds`);
    console.log(`   Range: ${start}s to ${end}s`);

    // Trim video to segment (may be needed for future video context features)
    trimmedPath = path.join(tempDir, `trimmed_segment_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(start)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Video segment trimmed successfully');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    // Clean up original file
    await fsPromises.unlink(originalPath);
    originalPath = null;

    // Ã°Å¸Å¡Â¨ NEW: Extract dual components from detailed_description
    console.log('Ã°Å¸â€Â ===============================================');
    console.log('Ã°Å¸â€Â EXTRACTING DUAL-OUTPUT COMPONENTS');
    console.log('Ã°Å¸â€Â ===============================================');
    
    const { extractDualOutputComponents, generateMusicWithDualOutput } = require('./musicgpt-utils');
    const { prompt, music_style } = extractDualOutputComponents(extra_description);

    console.log('Ã°Å¸â€œÂ Visual Prompt:', prompt);
    console.log('Ã°Å¸Å½Âµ Music Style:', music_style);

    // Ã°Å¸Å¡Â¨ NEW: Generate music using MusicGPT with dual-output format
    console.log('\nÃ°Å¸Å½Â¼ ===============================================');
    console.log('Ã°Å¸Å½Â¼ CALLING MUSICGPT WITH DUAL-OUTPUT FORMAT');
    console.log('Ã°Å¸Å½Â¼ ===============================================');

    const musicResult = await generateMusicWithDualOutput({
      prompt: prompt,
      music_style: music_style,
      genre: 'cinematic', // Default genre - could be made configurable
      duration: Math.min(clipDuration, 180), // Cap at 3 minutes
      trackName: track_name || song_title || 'Generated Track'
    });

    console.log('Ã°Å¸â€œÅ  MusicGPT result status:', musicResult.status || 'unknown');
    
    if (musicResult.success) {
      if (musicResult.status === 'completed_immediately' && musicResult.audioUrl) {
        // Ã°Å¸Å½â€° SUCCESS: Music generated immediately
        console.log('Ã°Å¸Å½Â¶ ===============================================');
        console.log('Ã°Å¸Å½Â¶ MUSIC GENERATED IMMEDIATELY!');
        console.log('Ã°Å¸Å½Â¶ ===============================================');
        console.log('Ã°Å¸â€â€” Audio URL:', musicResult.audioUrl);
        console.log('Ã¢ÂÂ±Ã¯Â¸Â Duration:', musicResult.duration);
        console.log('Ã°Å¸Å½Âµ Title:', musicResult.title);
        
        res.status(200).json({
          success: true,
          // Multiple URL formats for compatibility
          url: musicResult.audioUrl,
          audio_url: musicResult.audioUrl,
          audioUrl: musicResult.audioUrl,
          // Track metadata
          title: musicResult.title,
          duration: musicResult.duration,
          track_name: track_name || musicResult.title,
          // Generation metadata
          generation_method: 'musicgpt_dual_output_immediate',
          prompt_used: prompt,
          music_style_used: music_style,
          processing_time: musicResult.processingTime,
          // Segment info
          segment_info: {
            start: start,
            end: end,
            duration: clipDuration,
            track_name: track_name || musicResult.title
          }
        });
        
      } else if (musicResult.status === 'processing_async' && musicResult.taskId) {
        // Ã°Å¸â€â€ž PROCESSING: Music generation started asynchronously
        console.log('Ã°Å¸â€â€ž ===============================================');
        console.log('Ã°Å¸â€â€ž MUSIC GENERATION STARTED (ASYNC)');
        console.log('Ã°Å¸â€â€ž ===============================================');
        console.log('Ã°Å¸â€ â€ Task ID:', musicResult.taskId);
        console.log('Ã¢ÂÂ° ETA:', musicResult.eta, 'seconds');
        console.log('Ã°Å¸â€œÂ¡ Webhook URL:', musicResult.webhookUrl);
        
        // Option 1: Return task info for frontend polling
        res.status(202).json({
          success: true,
          status: 'processing',
          task_id: musicResult.taskId,
          eta: musicResult.eta,
          message: 'Music generation started - poll task status or use webhook monitoring',
          track_name: track_name || 'Generated Track',
          generation_method: 'musicgpt_dual_output_async',
          webhook_url: musicResult.webhookUrl,
          segment_info: {
            start: start,
            end: end,
            duration: clipDuration,
            track_name: track_name || 'Generated Track'
          }
        });
        
    
      } else {
        throw new Error(`Unexpected MusicGPT result: ${JSON.stringify(musicResult)}`);
      }
    } else {
      throw new Error(musicResult.error || 'MusicGPT generation failed');
    }

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° MUSICGPT SEGMENT GENERATION COMPLETED');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½Â¶ Track:', track_name || 'Generated Track');
    console.log('Ã°Å¸â€Â§ Method: MusicGPT with dual-output format (prompt + music_style)');
    console.log('Ã°Å¸â€œÅ  Status:', musicResult.status);

  } catch (err) {
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã¢ÂÅ’ MUSICGPT SEGMENT GENERATION ERROR');
    console.error('Ã¢ÂÅ’ ===============================================');
    console.error('Ã°Å¸â€™Â¥ Error message:', err.message || err);
    console.error('Ã°Å¸â€™Â¥ Error stack:', err.stack);
    
    // Enhanced error response
    const errorResponse = {
      success: false,
      error: 'MusicGPT segment generation failed', 
      details: err.message,
      generation_method: 'musicgpt_dual_output_failed',
      segment_info: {
        start: parseInt(req.body.video_start) || 0,
        end: parseInt(req.body.video_end) || 30,
        track_name: req.body.track_name || 'Failed Track'
      }
    };
    
    // Add more context for common errors
    if (err.message.includes('timeout')) {
      errorResponse.suggestion = 'Try with a shorter video segment or check your internet connection';
    } else if (err.message.includes('API key')) {
      errorResponse.suggestion = 'Check MusicGPT API configuration';
    } else if (err.message.includes('quota')) {
      errorResponse.suggestion = 'MusicGPT API quota exceeded - try again later';
    }
    
    res.status(500).json(errorResponse);
    
  } finally {
    // Clean up temporary files
    const filesToClean = [trimmedPath, originalPath].filter(Boolean);
    for (const file of filesToClean) {
      try {
        await fsPromises.unlink(file);
        console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up:', file);
      } catch (e) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete temporary file ${file}:`, e.message);
      }
    }
  }
});
app.post('/api/check-musicgpt-task', async (req, res) => {
  try {
    const { taskId } = req.body;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'No task ID provided'
      });
    }

    console.log('Ã°Å¸â€Â Checking MusicGPT task status:', taskId);

    const { checkMusicGPTTaskStatus } = require('./musicgpt-utils');
    const result = await checkMusicGPTTaskStatus(taskId);
    
    if (result.success) {
      console.log('Ã°Å¸â€œÅ  Task status:', result.status);
      if (result.audio_url) {
        console.log('Ã°Å¸Å½Âµ Audio ready:', result.audio_url);
      }
      
      res.json({
        success: true,
        taskId: taskId,
        status: result.status,
        audio_url: result.audio_url,
        title: result.title,
        duration: result.duration,
        progress: result.progress,
        eta: result.eta,
        message: result.audio_url ? 
          'Ã°Å¸Å½â€° Music is ready!' : 
          `Ã¢ÂÂ³ Status: ${result.status || 'processing'}`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error checking MusicGPT task:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to check task status',
      details: error.message
    });
  }
});
app.post('/api/create-complete-video-from-segments', upload.single('video'), async (req, res) => {
  let videoFilePath;
  const audioFilePaths = [];
  
  try {
    const { segments, musicData, videoDuration } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    if (!segments || !musicData) {
      return res.status(400).json({ error: 'Missing segments or music data' });
    }

    const parsedSegments = JSON.parse(segments);
    const parsedMusicData = JSON.parse(musicData);
    
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ CREATING COMPLETE VIDEO FROM GENERATED SEGMENTS');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log(`Ã°Å¸â€œÅ  Total segments: ${parsedSegments.length}`);
    
    // Debug: Log the raw music data to see what timing we have
    console.log('Ã°Å¸â€Â RAW MUSIC DATA DEBUG:');
    Object.keys(parsedMusicData).forEach(key => {
      const music = parsedMusicData[key];
      console.log(`  Segment ${key}:`, {
        actualMusicTiming: music.actualMusicTiming,
        segmentStart: music.segmentStart,
        segmentEnd: music.segmentEnd,
        hasAdjustedTiming: music.actualMusicTiming?.wasAdjusted
      });
    });
    
    // Count segments with music
    const segmentsWithMusic = Object.keys(parsedMusicData).length;
    console.log(`Ã°Å¸Å½Âµ Segments with music: ${segmentsWithMusic}/${parsedSegments.length}`);
    
    if (segmentsWithMusic === 0) {
      return res.status(400).json({ 
        error: 'No music segments provided. Generate music for at least one segment first.' 
      });
    }
    
    // Save uploaded video
    videoFilePath = path.join(tempDir, `complete_video_source_${Date.now()}.mp4`);
    await fsPromises.writeFile(videoFilePath, req.file.buffer);
    
    // Download and process only the active audio segments
    const activeAudioSegments = [];
    // ðŸŽ›ï¸ PRE-RENDER VOLUME VARIATIONS FOR INSTANT CHANGES
let preRenderedAudio = null;
try {
  console.log('\nðŸŽ›ï¸ Starting volume pre-rendering for instant changes...');
  preRenderedAudio = await preRenderVolumeVariations(
    activeAudioSegments, 
    parsedSegments.filter((_, index) => Object.keys(parsedMusicData).includes(index.toString())),
    videoDuration
  );
  console.log('âœ… Volume pre-rendering completed successfully');
} catch (preRenderError) {
  console.error('âŒ Volume pre-rendering failed:', preRenderError.message);
  console.log('âš ï¸ Continuing without pre-rendered volumes...');
}
    for (const segmentIndexStr of Object.keys(parsedMusicData)) {
      const segmentIndex = parseInt(segmentIndexStr);
      const musicInfo = parsedMusicData[segmentIndexStr];
      const originalSegment = parsedSegments[segmentIndex];
      
      if (musicInfo && musicInfo.audioUrl && originalSegment) {
        const volume = getEffectiveVolume(musicInfo, originalSegment);
        
        // Ã°Å¸Å¡Â¨ CRITICAL FIX: Use the EXACT timing the music was generated for
        let segmentStartTime, segmentEndTime, timingSource;

        if (musicInfo.actualMusicTiming) {
          // PRIORITY 1: Use the exact timing stored when music was generated
          segmentStartTime = parseFloat(musicInfo.actualMusicTiming.start);
          segmentEndTime = parseFloat(musicInfo.actualMusicTiming.end);
          timingSource = musicInfo.actualMusicTiming.wasAdjusted ? 'ADJUSTED_TIMING' : 'ORIGINAL_TIMING';
          console.log(`Ã°Å¸Å½Âµ Using EXACT music generation timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s (${timingSource})`);
        } else if (musicInfo.segmentStart !== undefined && musicInfo.segmentEnd !== undefined) {
          // PRIORITY 2: Fallback to stored segment timing from music generation
          segmentStartTime = parseFloat(musicInfo.segmentStart);
          segmentEndTime = parseFloat(musicInfo.segmentEnd);
          timingSource = 'MUSIC_DATA_FALLBACK';
          console.log(`Ã°Å¸Å½Âµ Using music data timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s`);
        } else {
          // PRIORITY 3: Final fallback to original segment timing (should not happen with adjusted timing)
          segmentStartTime = parseFloat(originalSegment.start_time || 0);
          segmentEndTime = parseFloat(originalSegment.end_time || segmentStartTime + 30);
          timingSource = 'FALLBACK_ORIGINAL';
          console.log(`Ã°Å¸Å½Âµ WARNING: Using fallback original timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s`);
        }

        // Ã°Å¸Å¡Â¨ ENHANCED DEBUG LOGGING
        console.log(`Ã°Å¸â€Â TIMING DEBUG for Segment ${segmentIndex + 1}:`);
        console.log(`   ClipTune original: ${originalSegment.start_time}s - ${originalSegment.end_time}s`);
        if (musicInfo.actualMusicTiming) {
          console.log(`   Music generated for: ${musicInfo.actualMusicTiming.start}s - ${musicInfo.actualMusicTiming.end}s`);
          console.log(`   Was timing adjusted: ${musicInfo.actualMusicTiming.wasAdjusted ? 'YES' : 'NO'}`);
          if (musicInfo.actualMusicTiming.wasAdjusted) {
            const startDelta = musicInfo.actualMusicTiming.start - musicInfo.actualMusicTiming.originalStart;
            const endDelta = musicInfo.actualMusicTiming.end - musicInfo.actualMusicTiming.originalEnd;
            console.log(`   Adjustment: Start ${startDelta >= 0 ? '+' : ''}${startDelta}s, End ${endDelta >= 0 ? '+' : ''}${endDelta}s`);
          }
        }
        console.log(`   Will place music at: ${segmentStartTime}s - ${segmentEndTime}s`);
        console.log(`   Timing source: ${timingSource}`);
        console.log(`   Volume: ${Math.round(volume * 100)}%`);
        console.log(`   ----`);
        
        if (volume > 0) {
          try {
            console.log(`Ã°Å¸â€œÂ¥ Downloading audio for segment ${segmentIndex + 1} (${Math.round(volume * 100)}%):`, musicInfo.audioUrl);
            
            const audioResponse = await axios({
              method: 'get',
              url: musicInfo.audioUrl,
              responseType: 'stream'
            });
            
            const audioFilePath = path.join(tempDir, `segment_audio_${segmentIndex}_${Date.now()}.mp3`);
            const audioWriter = fs.createWriteStream(audioFilePath);
            audioResponse.data.pipe(audioWriter);
            
            await new Promise((resolve, reject) => {
              audioWriter.on('finish', resolve);
              audioWriter.on('error', reject);
            });
            
            // Store with the EXACT timing to be used for placement
            activeAudioSegments.push({ 
              index: segmentIndex, 
              path: audioFilePath, 
              musicInfo: { ...musicInfo, effectiveVolume: volume },
              segment: {
                ...originalSegment,
                // Ã°Å¸Å¡Â¨ CRITICAL: Use the EXACT timing the music was generated for
                start_time: segmentStartTime,
                end_time: segmentEndTime,
                music_placement_timing: {
                  start: segmentStartTime,
                  end: segmentEndTime,
                  wasAdjusted: musicInfo.actualMusicTiming?.wasAdjusted || false,
                  timingSource: timingSource,
                  originalClipTuneStart: originalSegment.start_time,
                  originalClipTuneEnd: originalSegment.end_time
                }
              }
            });
            
            console.log(`Ã¢Å“â€¦ Audio downloaded for segment ${segmentIndex + 1} - WILL BE PLACED AT ${segmentStartTime}s-${segmentEndTime}s with ${Math.round(volume * 100)}% volume`);
            
          } catch (error) {
            console.error(`Ã¢ÂÅ’ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
          }
        } else {
          console.log(`Ã°Å¸â€â€¡ Segment ${segmentIndex + 1} is muted (0%) - skipping audio download`);
        }
      }
    }
    
    // Ã°Å¸Å¡Â¨ CRITICAL DEBUG: Show exactly where each audio will be placed
    console.log('\nÃ°Å¸â€Â FINAL AUDIO PLACEMENT VERIFICATION:');
    console.log('Ã°Å¸â€Â ===============================================');
    activeAudioSegments.forEach(({ index, segment, musicInfo }) => {
      console.log(`Segment ${index + 1}:`);
      console.log(`  Ã°Å¸Å½Âµ Music will be placed at: ${segment.start_time}s - ${segment.end_time}s`);
      console.log(`  Ã°Å¸â€œÅ  Original ClipTune timing: ${segment.music_placement_timing?.originalClipTuneStart}s - ${segment.music_placement_timing?.originalClipTuneEnd}s`);
      console.log(`  Ã¢Å“â€šÃ¯Â¸Â Was timing adjusted: ${segment.music_placement_timing?.wasAdjusted ? 'YES' : 'NO'}`);
      console.log(`  Ã°Å¸â€œË† Volume: ${Math.round(musicInfo.effectiveVolume * 100)}%`);
      console.log(`  Ã°Å¸â€Â§ Timing source: ${segment.music_placement_timing?.timingSource || 'UNKNOWN'}`);
      console.log(`  ---`);
    });
    console.log('Ã°Å¸â€Â ===============================================\n');
    
    const outputPath = path.join(tempDir, `complete_video_${Date.now()}.mp4`);
    
   if (activeAudioSegments.length === 0) {
  console.log('Ã°Å¸â€â€¡ No active segments - restoring original video with FULL VOLUME');
  
  await new Promise((resolve, reject) => {
    ffmpeg(videoFilePath)
      .outputOptions([
        '-c:v copy',           // Copy video without re-encoding
        '-c:a aac',            // Re-encode audio to ensure consistency
        '-b:a 192k',           // High quality audio
        '-ar 44100',           // Standard sample rate
        '-ac 2',               // Stereo
        '-af volume=1.0'       // Ã¢Å“â€¦ EXPLICIT: Restore to 100% volume
      ])
      .output(outputPath)
      .on('end', () => {
        console.log('Ã¢Å“â€¦ Progressive video: Original volume fully restored');
        resolve();
      })
      .on('error', reject)
      .run();
  });
    } else {
      console.log(`Ã°Å¸Å½Âµ Processing ${activeAudioSegments.length} active audio segments with exact timing placement...`);
      
      // Process active audio segments with exact timing
      await new Promise((resolve, reject) => {
        let command = ffmpeg(videoFilePath);
        
        // Add only active audio inputs
        activeAudioSegments.forEach(({ path }) => {
          command = command.input(path);
        });
        // Ã¢Å“â€¦ REPLACE your audio mixing logic in /api/create-complete-video endpoint
// This ensures BOTH original video audio AND music play simultaneously

if (activeAudioSegments.length === 1) {
  // Single active audio segment - PROPER MIXING
  const { index, musicInfo, segment } = activeAudioSegments[0];
  const segmentStart = parseFloat(segment.start_time);
  const musicVolume = musicInfo.effectiveVolume;
  
  // Ã¢Å“â€¦ KEEP original video audio at reasonable volume (don't reduce too much)
  const originalVideoVolume = 0.8; // Keep original video prominent but not overwhelming
  
  console.log(`Ã°Å¸Å½Âµ Single active segment mixing: ${index + 1}`);
  console.log(`   Music volume: ${Math.round(musicVolume * 100)}%`);
  console.log(`   Original video audio: ${Math.round(originalVideoVolume * 100)}% (PRESERVED)`);
  console.log(`   Placement: ${segmentStart}s - ${segment.end_time}s`);
  
  const { filters, finalLabel } = buildAudioFilterWithFades(1, musicVolume, segment, segmentStart, 0);
  
  if (segmentStart > 0) {
    // Ã¢Å“â€¦ PROPER MIXING: Both original audio + delayed music
    const silenceFilter = `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence]`;
    const concatFilter = `[silence]${finalLabel}concat=n=2:v=0:a=1[delayed_music]`;
    
    // Ã¢Å“â€¦ CRITICAL: MIX original video audio WITH music (not replace)
    const mixFilter = `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
    
    command = command.complexFilter([
      silenceFilter,
      ...filters,
      concatFilter,
      mixFilter  // Ã¢Å“â€¦ This mixes BOTH audio streams
    ]);
  } else {
    // Ã¢Å“â€¦ DIRECT MIXING: Original audio + music from start
    const mixFilter = `[0:a]${finalLabel}amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
    
    command = command.complexFilter([
      ...filters,
      mixFilter  // Ã¢Å“â€¦ This mixes BOTH audio streams
    ]);
  }
} else {
  // Multiple active audio segments - PROPER MULTI-STREAM MIXING
  const filterParts = [];
  const mixInputs = ['[0:a]']; // Ã¢Å“â€¦ ALWAYS include original video audio
  
  console.log(`Ã°Å¸Å½Âµ Multiple segments mixing: ${activeAudioSegments.length}`);
  console.log(`   Original video audio: 80% (PRESERVED)`);
  console.log(`   Music segments will be ADDED to original audio`);
  
  activeAudioSegments.forEach(({ index, musicInfo, segment }, arrayIndex) => {
    const segmentStart = parseFloat(segment.start_time);
    const musicVolume = musicInfo.effectiveVolume;
    const audioInputIndex = arrayIndex + 1;
    
    console.log(`   ${arrayIndex + 1}. Segment ${index + 1}: ${segmentStart}s (${Math.round(musicVolume * 100)}%)`);
    
    const { filters, finalLabel } = buildAudioFilterWithFades(audioInputIndex, musicVolume, segment, segmentStart, arrayIndex);
    filterParts.push(...filters);
    
    if (segmentStart > 0) {
      // Add silence padding for delayed music
      filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence_${arrayIndex}]`);
      filterParts.push(`[silence_${arrayIndex}]${finalLabel}concat=n=2:v=0:a=1[delayed_${arrayIndex}]`);
      mixInputs.push(`[delayed_${arrayIndex}]`);
    } else {
      mixInputs.push(finalLabel);
    }
  });
  
  // Ã¢Å“â€¦ CRITICAL: Mix original video audio + ALL music segments together
  const inputCount = mixInputs.length;
  filterParts.push(`${mixInputs.join('')}amix=inputs=${inputCount}:duration=first:dropout_transition=0[final_audio]`);
  command = command.complexFilter(filterParts);
}

        
        
        command = command.outputOptions([
          '-map 0:v',
          '-map [final_audio]',
          '-c:v copy',
          '-c:a aac',
          '-b:a 192k',
          '-ar 44100',
          '-ac 2',
          '-avoid_negative_ts make_zero'
        ]);

        command
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('Ã°Å¸Å½Â¬ FFmpeg command:', commandLine);
          })
          .on('end', () => {
            console.log('Ã¢Å“â€¦ Complete video processing with EXACT timing placement finished');
            resolve();
          })
          .on('error', (err) => {
            console.error('Ã¢ÂÅ’ FFmpeg error:', err.message);
            
            // Fallback: copy original video
            console.log('Ã°Å¸â€â€ž Fallback: copying original video...');
            ffmpeg(videoFilePath)
              .output(outputPath)
              .on('end', () => {
                console.log('Ã¢Å“â€¦ Fallback completed - original video');
                resolve();
              })
              .on('error', reject)
              .run();
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log('Ã°Å¸â€â€ž Progress: ' + Math.round(progress.percent) + '% done');
            }
          })
          .run();
      });
    }

    // Verify output file
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Output file is empty');
    }

    console.log('Ã¢Å“â€¦ Complete video created with EXACT timing placement:', outputPath, 'Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    // Return the URL for the complete video
    const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° COMPLETE VIDEO WITH EXACT MUSIC TIMING READY');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸â€â€” Video URL:', combinedUrl);
    
    // Enhanced response with timing details
    res.json({ 
      success: true, 
      combinedUrl,
      activeSegments: activeAudioSegments.length,
      totalSegments: parsedSegments.length,
        preRenderedVolumes: preRenderedAudio ? {
    available: true,
    segments: Object.keys(preRenderedAudio).length,
    volumeLevels: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    totalVariations: Object.keys(preRenderedAudio).reduce((total, segmentKey) => {
      return total + Object.keys(preRenderedAudio[segmentKey]).length;
    }, 0),
    sessionId: Date.now().toString() // For tracking this session
  } : {
    available: false,
    reason: 'Pre-rendering failed or disabled'
  },
      timingDetails: activeAudioSegments.map(({ index, segment }) => ({
        segmentIndex: index + 1,
        placement: `${segment.start_time}s - ${segment.end_time}s`,
        wasAdjusted: segment.music_placement_timing?.wasAdjusted || false,
        timingSource: segment.music_placement_timing?.timingSource || 'UNKNOWN',
        originalClipTuneStart: segment.music_placement_timing?.originalClipTuneStart,
        originalClipTuneEnd: segment.music_placement_timing?.originalClipTuneEnd
      }))
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error creating complete video from segments:', error);
    res.status(500).json({ 
      error: 'Failed to create complete video from segments', 
      details: error.message 
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [videoFilePath, ...audioFilePaths.map(a => a.path)];
    for (const file of filesToClean) {
      if (file) {
        try {
          await fsPromises.unlink(file);
          console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up:', file);
        } catch (e) {
          console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete temporary file ${file}:`, e.message);
        }
      }
    }
  }
});

// Trim audio between two times and return a direct download URL
app.post('/api/trim-audio', async (req, res) => {
  const { audioUrl, start, duration } = req.body;
  if (!audioUrl || start === undefined || duration === undefined) {
    return res.status(400).json({ error: 'Missing audioUrl, start, or duration' });
  }

  const outputFileName = `trimmed_audio_${Date.now()}.mp3`;
  const outputPath = path.join(tempDir, outputFileName);

  try {
    // Use axios to download the audio file temporarily
    const audioResponse = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'stream'
    });

    const tempAudioPath = path.join(tempDir, `temp_audio_${Date.now()}.mp3`);
    const writer = fs.createWriteStream(tempAudioPath);
    audioResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await new Promise((resolve, reject) => {
      ffmpeg(tempAudioPath)
        .setStartTime(start)
        .setDuration(duration)
        .output(outputPath)
        .on('end', async () => {
          await fsPromises.unlink(tempAudioPath); // Clean up temporary downloaded audio
          resolve();
        })
        .on('error', async (err) => {
          await fsPromises.unlink(tempAudioPath); // Clean up on error as well
          reject(err);
        })
        .run();
    });

    const trimmedUrl = `https://nback-6gqw.onrender.com/trimmed/${outputFileName}`;
    res.json({ trimmedUrl });
  } catch (err) {
    console.error('Error trimming audio:', err);
    res.status(500).json({ error: 'Failed to trim audio', details: err.message });
  }
});

// Ã¢Å“â€¦ UPDATE your existing /api/create-complete-video endpoint in index.js
// Replace the existing endpoint with this enhanced version that handles removed segments
// Ã¢Å“â€¦ BONUS: Add a dedicated endpoint for volume restoration testing
app.post('/api/restore-original-volume', upload.single('video'), async (req, res) => {
  let videoFilePath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    console.log('Ã°Å¸â€Å  ===============================================');
    console.log('Ã°Å¸â€Å  RESTORING ORIGINAL VIDEO VOLUME');
    console.log('Ã°Å¸â€Å  ===============================================');

    // Save uploaded video
    videoFilePath = path.join(tempDir, `volume_restore_${Date.now()}.mp4`);
    await fsPromises.writeFile(videoFilePath, req.file.buffer);

    const outputPath = path.join(tempDir, `restored_volume_${Date.now()}.mp4`);

    // Process video to restore original volume
    await new Promise((resolve, reject) => {
      ffmpeg(videoFilePath)
        .outputOptions([
          '-c:v copy',           // Copy video without re-encoding
          '-c:a aac',            // Re-encode audio for consistency
          '-b:a 192k',           // High quality audio
          '-ar 44100',           // Standard sample rate
          '-ac 2',               // Stereo
          '-af volume=1.0'       // Ensure 100% volume
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Ã°Å¸â€Å  Restoring volume:', commandLine);
        })
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Original volume fully restored');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    const stats = await fsPromises.stat(outputPath);
    const restoredUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

    console.log('Ã°Å¸â€Å  Volume restoration completed');
    console.log('Ã°Å¸â€â€” Restored video URL:', restoredUrl);

    res.json({ 
      success: true, 
      restoredUrl,
      message: 'Original video volume fully restored',
      fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error restoring original volume:', error);
    res.status(500).json({ 
      error: 'Failed to restore original volume', 
      details: error.message 
    });
  } finally {
    if (videoFilePath) {
      try {
        await fsPromises.unlink(videoFilePath);
      } catch (e) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete ${videoFilePath}:`, e.message);
      }
    }
  }
});
// Pre-render all volume variations for instant volume changes
async function preRenderVolumeVariations(audioFilePaths, segments, videoDuration) {
  const volumeLevels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // 11 volume levels
  const preRenderedAudio = {};
  
  console.log('ðŸŽ›ï¸ ===============================================');
  console.log('ðŸŽ›ï¸ PRE-RENDERING VOLUME VARIATIONS FOR INSTANT CHANGES');
  console.log('ðŸŽ›ï¸ ===============================================');
  console.log(`ðŸŽµ Processing ${audioFilePaths.length} segments`);
  console.log(`ðŸ”Š Volume levels: ${volumeLevels.join(', ')}%`);
  
  for (let segmentIndex = 0; segmentIndex < Math.min(audioFilePaths.length, 10); segmentIndex++) {
    const audioData = audioFilePaths[segmentIndex];
    const segment = segments[segmentIndex];
    
    if (!audioData || !segment) continue;
    
    console.log(`\nðŸŽµ Pre-rendering segment ${segmentIndex + 1}...`);
    preRenderedAudio[segmentIndex] = {};
    
    for (const volumeLevel of volumeLevels) {
      try {
        const volumeDecimal = volumeLevel / 100;
        const outputPath = path.join(tempDir, `prerendered_s${segmentIndex}_v${volumeLevel}_${Date.now()}.mp3`);
        
        console.log(`   ðŸ”Š Rendering volume ${volumeLevel}%...`);
        
        // Apply volume and fade effects to audio
        await new Promise((resolve, reject) => {
          const { filters, finalLabel } = buildAudioFilterWithFades(
            0, // Input index 0 since we're processing single file
            volumeDecimal,
            segment,
            parseFloat(segment.start_time || 0),
            segmentIndex
          );
          
          let command = ffmpeg(audioData.path);
          
          if (filters.length > 0) {
            // Apply volume and fade filters
            command = command.complexFilter(filters.map(filter => 
              filter.replace('[0:a]', '[0:a]').replace(`[vol_${segmentIndex}]`, '[output]')
            ));
            command = command.outputOptions(['-map [output]']);
          } else {
            // Simple volume adjustment
            command = command.audioFilters(`volume=${volumeDecimal}`);
          }
          
          command
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        
        preRenderedAudio[segmentIndex][volumeLevel] = {
          path: outputPath,
          url: `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`,
          volume: volumeLevel,
          segmentIndex: segmentIndex,
          ready: true
        };
        
      } catch (error) {
        console.error(`âŒ Failed to render segment ${segmentIndex + 1} at ${volumeLevel}%:`, error.message);
        preRenderedAudio[segmentIndex][volumeLevel] = {
          path: null,
          url: null,
          volume: volumeLevel,
          segmentIndex: segmentIndex,
          ready: false,
          error: error.message
        };
      }
    }
    
    console.log(`âœ… Segment ${segmentIndex + 1}: ${volumeLevels.length} volume variations ready`);
  }
  
  console.log('\nðŸŽ›ï¸ ===============================================');
  console.log('ðŸŽ›ï¸ VOLUME PRE-RENDERING COMPLETED');
  console.log('ðŸŽ›ï¸ ===============================================');
  
  const totalVariations = Object.keys(preRenderedAudio).reduce((total, segmentKey) => {
    return total + Object.keys(preRenderedAudio[segmentKey]).length;
  }, 0);
  
  console.log(`âœ… Total volume variations pre-rendered: ${totalVariations}`);
  console.log(`ðŸŽµ Segments processed: ${Object.keys(preRenderedAudio).length}`);
  
  return preRenderedAudio;
}
// Get pre-rendered volume variation for instant volume changes
app.post('/api/get-volume-variation', async (req, res) => {
  try {
    const { segmentIndex, volumeLevel, sessionId } = req.body;
    
    if (segmentIndex === undefined || volumeLevel === undefined) {
      return res.status(400).json({
        success: false,
        error: 'segmentIndex and volumeLevel are required'
      });
    }
    
    console.log(`ðŸŽ›ï¸ Getting volume variation: Segment ${segmentIndex}, Volume ${volumeLevel}%`);
    
    // In a real app, you'd store preRenderedAudio in Redis or similar
    // For now, we'll return a placeholder response
    const volumeVariationUrl = `https://nback-6gqw.onrender.com/trimmed/volume_${segmentIndex}_${volumeLevel}.mp3`;
    
    res.json({
      success: true,
      segmentIndex: segmentIndex,
      volumeLevel: volumeLevel,
      audioUrl: volumeVariationUrl,
      ready: true,
      message: `Volume variation ${volumeLevel}% for segment ${segmentIndex} ready`
    });
    
  } catch (error) {
    console.error('âŒ Error getting volume variation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get volume variation',
      details: error.message
    });
  }
});
app.post('/api/create-complete-video', upload.single('video'), async (req, res) => {
  let videoFilePath;
  const audioFilePaths = [];
  
  try {
    const { segments, musicData, videoDuration, allowEmptyMusic } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    if (!segments || !musicData) {
      return res.status(400).json({ error: 'Missing segments or music data' });
    }

    const parsedSegments = JSON.parse(segments);
    const parsedMusicData = JSON.parse(musicData);
    
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log('Ã°Å¸Å½Â¬ CREATING COMPLETE VIDEO WITH REMOVE/RESTORE SUPPORT');
    console.log('Ã°Å¸Å½Â¬ ===============================================');
    console.log(`Ã°Å¸â€œÅ  Total segments: ${parsedSegments.length}`);
    console.log(`Ã°Å¸Å½Âµ Music data provided for: ${Object.keys(parsedMusicData).length} segments`);
    console.log(`Ã°Å¸â€Â§ Allow empty music: ${allowEmptyMusic === 'true' ? 'YES' : 'NO'}`);
    
    // Save uploaded video
    videoFilePath = path.join(tempDir, `complete_video_source_${Date.now()}.mp4`);
    await fsPromises.writeFile(videoFilePath, req.file.buffer);
    
    // Ã¢Å“â€¦ ENHANCED: Filter out removed segments and process only active ones
    const activeAudioSegments = [];
    let removedSegmentCount = 0;
    
    for (const segmentIndexStr of Object.keys(parsedMusicData)) {
      const segmentIndex = parseInt(segmentIndexStr);
      const musicInfo = parsedMusicData[segmentIndexStr];
      const originalSegment = parsedSegments[segmentIndex];
      
      if (!musicInfo || !originalSegment) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Segment ${segmentIndex + 1}: Missing music info or segment data`);
        continue;
      }
      
      // Ã¢Å“â€¦ CHECK FOR REMOVED STATUS
      if (musicInfo.removed === true || musicInfo.isRemovedFromVideo === true) {
        removedSegmentCount++;
        console.log(`Ã°Å¸Å¡Â« Segment ${segmentIndex + 1}: SKIPPED (marked as removed)`);
        continue;
      }
      
      if (!musicInfo.audioUrl) {
        console.warn(`Ã¢Å¡ Ã¯Â¸Â Segment ${segmentIndex + 1}: Missing audio URL`);
        continue;
      }
      
      // Get effective volume (respects custom volume settings)
      const volume = getEffectiveVolume(musicInfo, originalSegment);
      
      // Get exact timing for music placement
      let segmentStartTime, segmentEndTime, timingSource;

      if (musicInfo.actualMusicTiming) {
        segmentStartTime = parseFloat(musicInfo.actualMusicTiming.start);
        segmentEndTime = parseFloat(musicInfo.actualMusicTiming.end);
        timingSource = musicInfo.actualMusicTiming.wasAdjusted ? 'ADJUSTED_TIMING' : 'ORIGINAL_TIMING';
      } else if (musicInfo.segmentStart !== undefined && musicInfo.segmentEnd !== undefined) {
        segmentStartTime = parseFloat(musicInfo.segmentStart);
        segmentEndTime = parseFloat(musicInfo.segmentEnd);
        timingSource = 'MUSIC_DATA_FALLBACK';
      } else {
        segmentStartTime = parseFloat(originalSegment.start_time || 0);
        segmentEndTime = parseFloat(originalSegment.end_time || segmentStartTime + 30);
        timingSource = 'FALLBACK_ORIGINAL';
      }

      console.log(`Ã¢Å“â€¦ Segment ${segmentIndex + 1}: ACTIVE`);
      console.log(`   Placement: ${segmentStartTime}s - ${segmentEndTime}s`);
      console.log(`   Volume: ${Math.round(volume * 100)}%`);
      console.log(`   Timing source: ${timingSource}`);
      console.log(`   Audio URL: ${musicInfo.audioUrl.substring(0, 50)}...`);
      
      // Ã¢Å“â€¦ ONLY PROCESS IF VOLUME > 0
      if (volume > 0) {
        try {
          console.log(`Ã°Å¸â€œÂ¥ Downloading audio for segment ${segmentIndex + 1}...`);
          
          const audioResponse = await axios({
            method: 'get',
            url: musicInfo.audioUrl,
            responseType: 'stream'
          });
          
          const audioFilePath = path.join(tempDir, `complete_audio_${segmentIndex}_${Date.now()}.mp3`);
          const audioWriter = fs.createWriteStream(audioFilePath);
          audioResponse.data.pipe(audioWriter);
          
          await new Promise((resolve, reject) => {
            audioWriter.on('finish', resolve);
            audioWriter.on('error', reject);
          });
          
          activeAudioSegments.push({ 
            index: segmentIndex, 
            path: audioFilePath, 
            musicInfo: { ...musicInfo, effectiveVolume: volume },
            segment: {
              ...originalSegment,
              start_time: segmentStartTime,
              end_time: segmentEndTime,
              music_placement_timing: {
                start: segmentStartTime,
                end: segmentEndTime,
                wasAdjusted: musicInfo.actualMusicTiming?.wasAdjusted || false,
                timingSource: timingSource
              }
            }
          });
          
          audioFilePaths.push(audioFilePath); // For cleanup
          console.log(`Ã¢Å“â€¦ Audio ready for segment ${segmentIndex + 1}`);
          
        } catch (error) {
          console.error(`Ã¢ÂÅ’ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
        }
      } else {
        console.log(`Ã°Å¸â€â€¡ Segment ${segmentIndex + 1} is muted (0%) - skipping audio download`);
      }
    }
    
    const outputPath = path.join(tempDir, `complete_video_${Date.now()}.mp4`);
    
    console.log('\nÃ°Å¸â€œÅ  PROCESSING SUMMARY:');
    console.log('Ã°Å¸â€œÅ  ===============================================');
    console.log(`Ã°Å¸Å½Âµ Active segments with music: ${activeAudioSegments.length}`);
    console.log(`Ã°Å¸Å¡Â« Removed segments: ${removedSegmentCount}`);
    console.log(`Ã°Å¸â€œÅ  Total segments: ${parsedSegments.length}`);
    console.log('Ã°Å¸â€œÅ  ===============================================\n');
    
    // Ã¢Å“â€¦ HANDLE CASE WHERE NO ACTIVE SEGMENTS (ALL REMOVED OR MUTED)
    if (activeAudioSegments.length === 0) {
      if (allowEmptyMusic === 'true') {
        console.log('Ã°Å¸â€â€¡ No active music segments - restoring original video with FULL VOLUME');
        
        await new Promise((resolve, reject) => {
          ffmpeg(videoFilePath)
            // Ã¢Å“â€¦ CRITICAL: Use original audio at full volume (no mixing)
            .outputOptions([
              '-c:v copy',           // Copy video without re-encoding
              '-c:a aac',            // Re-encode audio to ensure consistency
              '-b:a 192k',           // High quality audio
              '-ar 44100',           // Standard sample rate
              '-ac 2',               // Stereo
              '-af volume=1.0'       // Ã¢Å“â€¦ EXPLICIT: Set audio to 100% volume
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('Ã¢Å“â€¦ Original video restored with FULL VOLUME (no music segments)');
              resolve();
            })
            .on('error', reject)
            .run();
        });
        
        // Verify output
        const stats = await fsPromises.stat(outputPath);
        const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

        console.log('\nÃ°Å¸Å½â€° ===============================================');
        console.log('Ã°Å¸Å½â€° ORIGINAL VIDEO VOLUME FULLY RESTORED');
        console.log('Ã°Å¸Å½â€° ===============================================');
        console.log('Ã°Å¸â€â€” Video URL:', combinedUrl);
        console.log('Ã°Å¸â€Å  Original audio: 100% volume (no music mixing)');
        console.log(`Ã°Å¸â€œÅ  File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        return res.json({ 
          success: true, 
          combinedUrl,
          activeSegments: 0,
          removedSegments: removedSegmentCount,
          totalSegments: parsedSegments.length,
          originalVolumeRestored: true,
          message: `Original video restored with full volume (${removedSegmentCount} music segments removed)`
        });
        
      } else {
        return res.status(400).json({ 
          error: 'No active music segments to include in video',
          details: `${removedSegmentCount} segments were removed. Enable allowEmptyMusic to restore original video.`,
          removedSegments: removedSegmentCount,
          totalSegments: parsedSegments.length
        });
      }
    }
    
    // Ã¢Å“â€¦ PROCESS VIDEO WITH ACTIVE MUSIC SEGMENTS
    console.log(`Ã°Å¸Å½Âµ Creating video with ${activeAudioSegments.length} active music segments...`);
    
    // Sort segments by start time for proper layering
    activeAudioSegments.sort((a, b) => parseFloat(a.segment.start_time) - parseFloat(b.segment.start_time));
    
    console.log('Ã°Å¸Å½Âµ FINAL AUDIO COMPOSITION:');
    activeAudioSegments.forEach(({ index, segment, musicInfo }) => {
      console.log(`   Segment ${index + 1}: ${segment.start_time}s-${segment.end_time}s (${Math.round(musicInfo.effectiveVolume * 100)}%)`);
    });
    
    await new Promise((resolve, reject) => {
      let command = ffmpeg(videoFilePath);
      
      // Add all active audio inputs
      activeAudioSegments.forEach(({ path }) => {
        command = command.input(path);
      });
      
      if (activeAudioSegments.length === 1) {
        // Single active audio segment - PROPER MIXING
        const { index, musicInfo, segment } = activeAudioSegments[0];
        const segmentStart = parseFloat(segment.start_time);
        const musicVolume = musicInfo.effectiveVolume;
        
        console.log(`Ã°Å¸Å½Âµ Single active segment mixing: ${index + 1}`);
        console.log(`   Music volume: ${Math.round(musicVolume * 100)}%`);
        console.log(`   Original video audio: PRESERVED`);
        console.log(`   Placement: ${segmentStart}s - ${segment.end_time}s`);
        
        const { filters, finalLabel } = buildAudioFilterWithFades(1, musicVolume, segment, segmentStart, 0);
        
        if (segmentStart > 0) {
          // Ã¢Å“â€¦ PROPER MIXING: Both original audio + delayed music
          const silenceFilter = `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence]`;
          const concatFilter = `[silence]${finalLabel}concat=n=2:v=0:a=1[delayed_music]`;
          
          // Ã¢Å“â€¦ CRITICAL: MIX original video audio WITH music (not replace)
          const mixFilter = `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
          
          command = command.complexFilter([
            silenceFilter,
            ...filters,
            concatFilter,
            mixFilter  // Ã¢Å“â€¦ This mixes BOTH audio streams
          ]);
        } else {
          // Ã¢Å“â€¦ DIRECT MIXING: Original audio + music from start
          const mixFilter = `[0:a]${finalLabel}amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
          
          command = command.complexFilter([
            ...filters,
            mixFilter  // Ã¢Å“â€¦ This mixes BOTH audio streams
          ]);
        }
      } else {
        // Multiple active audio segments - FIXED MIXING
        const filterParts = [];
        const mixInputs = ['[0:a]']; // Always include original video audio
        
        console.log(`Ã°Å¸Å½Âµ Multiple active segments processing: ${activeAudioSegments.length}`);
        console.log(`   Original video audio: PRESERVED at full volume`);
        
        activeAudioSegments.forEach(({ index, musicInfo, segment }, arrayIndex) => {
          const segmentStart = parseFloat(segment.start_time);
          const musicVolume = musicInfo.effectiveVolume;
          const audioInputIndex = arrayIndex + 1;
          
          console.log(`   ${arrayIndex + 1}. Segment ${index + 1}: ${segmentStart}s (${Math.round(musicVolume * 100)}%)`);
          
          // Ã¢Å“â€¦ FIXED: Proper function call with correct parameters
          const { filters, finalLabel } = buildAudioFilterWithFades(audioInputIndex, musicVolume, segment, segmentStart, arrayIndex);
          filterParts.push(...filters);
          
          if (segmentStart > 0) {
            // Add silence padding for delayed music
            filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence_${arrayIndex}]`);
            filterParts.push(`[silence_${arrayIndex}]${finalLabel}concat=n=2:v=0:a=1[delayed_${arrayIndex}]`);
            mixInputs.push(`[delayed_${arrayIndex}]`);
          } else {
            mixInputs.push(finalLabel);
          }
        });
        
        // Ã¢Å“â€¦ SIMPLIFIED: Mix all inputs without complex weights
        const inputCount = mixInputs.length;
        filterParts.push(`${mixInputs.join('')}amix=inputs=${inputCount}:duration=first:dropout_transition=0[final_audio]`);
        
        console.log(`Ã°Å¸Å½Âµ FFmpeg filter: Mixing ${inputCount} audio streams (1 original + ${activeAudioSegments.length} music)`);
        
        command = command.complexFilter(filterParts);
      }
      
      command = command.outputOptions([
        '-map 0:v',
        '-map [final_audio]',
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-ar 44100',
        '-ac 2',
        '-avoid_negative_ts make_zero'
      ]);

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Ã°Å¸Å½Â¬ FFmpeg command:', commandLine);
          
          // Ã¢Å“â€¦ DEBUG: Log the complex filter being used
          const filterMatch = commandLine.match(/-filter_complex\s+"([^"]+)"/);
          if (filterMatch) {
            console.log('Ã°Å¸â€Â Complex filter being used:');
            console.log(filterMatch[1]);
          }
        })
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Complete video with active segments finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('Ã¢ÂÅ’ FFmpeg error:', err.message);
          
          // Ã¢Å“â€¦ ENHANCED: Better error logging
          if (err.message.includes('Invalid stream specifier')) {
            console.error('Ã°Å¸Å¡Â¨ Stream specifier error - likely too many audio inputs or invalid filter syntax');
          }
          if (err.message.includes('filter_complex')) {
            console.error('Ã°Å¸Å¡Â¨ Complex filter error - check filter syntax');
          }
          
          console.log('Ã°Å¸â€â€ž Attempting fallback: copy original video...');
          
          // Ã¢Å“â€¦ FALLBACK: Copy original video if mixing fails
          ffmpeg(videoFilePath)
            .output(outputPath)
            .on('end', () => {
              console.log('Ã¢Å“â€¦ Fallback completed - original video without music');
              resolve();
            })
            .on('error', (fallbackErr) => {
              console.error('Ã¢ÂÅ’ Fallback also failed:', fallbackErr.message);
              reject(fallbackErr);
            })
            .run();
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Ã°Å¸â€â€ž Progress: ${Math.round(progress.percent)}% done`);
          }
        })
        .run();
    });

    // Verify output file
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Output file is empty');
    }

    const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;

    console.log('\nÃ°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸Å½â€° COMPLETE VIDEO WITH REMOVE/RESTORE READY');
    console.log('Ã°Å¸Å½â€° ===============================================');
    console.log('Ã°Å¸â€â€” Video URL:', combinedUrl);
    console.log(`Ã°Å¸Å½Âµ Active segments: ${activeAudioSegments.length}`);
    console.log(`Ã°Å¸Å¡Â« Removed segments: ${removedSegmentCount}`);
    console.log(`Ã°Å¸â€œÅ  File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    res.json({ 
      success: true, 
      combinedUrl,
      activeSegments: activeAudioSegments.length,
      removedSegments: removedSegmentCount,
      totalSegments: parsedSegments.length,
      message: removedSegmentCount > 0 
        ? `Video created with ${activeAudioSegments.length} segments (${removedSegmentCount} removed)`
        : `Video created with ${activeAudioSegments.length} segments`
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error creating complete video with remove/restore:', error);
    res.status(500).json({ 
      error: 'Failed to create complete video', 
      details: error.message 
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [videoFilePath, ...audioFilePaths];
    for (const file of filesToClean) {
      if (file) {
        try {
          await fsPromises.unlink(file);
        } catch (e) {
          console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete ${file}:`, e.message);
        }
      }
    }
  }
});
app.post('/api/combine-video-audio', upload.single('video'), async (req, res) => {
  const { audioUrl, videoDuration, videoStart, musicDuration, audioStart, musicVolume, videoUrl } = req.body;
  let videoFilePath;
  let audioFilePath;

  try {
    // Handle video source (URL or uploaded file)
    if (videoUrl) {
      console.log('Downloading video from URL:', videoUrl);
      const videoResponse = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'stream'
      });
      videoFilePath = path.join(tempDir, `downloaded_video_${Date.now()}.mp4`);
      const writer = fs.createWriteStream(videoFilePath);
      videoResponse.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      console.log('Video downloaded to:', videoFilePath);

    } else if (req.file) {
      videoFilePath = path.join(tempDir, `uploaded_video_${Date.now()}.mp4`);
      await fsPromises.writeFile(videoFilePath, req.file.buffer);
      console.log('Video uploaded to:', videoFilePath);
    } else {
      return res.status(400).json({ error: 'No video source provided (file or URL).' });
    }

    if (!audioUrl) {
      return res.status(400).json({ error: 'No audio URL provided.' });
    }

    // Download audio file
    const audioFileName = `downloaded_audio_${Date.now()}.mp3`;
    audioFilePath = path.join(tempDir, audioFileName);
    console.log('Downloading audio from URL:', audioUrl);

    const audioResponse = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'stream'
    });
    const audioWriter = fs.createWriteStream(audioFilePath);
    audioResponse.data.pipe(audioWriter);

    await new Promise((resolve, reject) => {
      audioWriter.on('finish', resolve);
      audioWriter.on('error', reject);
    });
    console.log('Audio downloaded to:', audioFilePath);

    const outputPath = path.join(tempDir, `combined_video_${Date.now()}.mp4`);

    // Parse and validate numeric parameters
    const videoStartNum = parseFloat(videoStart);
    const musicDurationNum = parseFloat(musicDuration);
    const audioStartNum = parseFloat(audioStart);
    const musicVolumeNum = parseFloat(musicVolume);
    const videoDurationNum = parseFloat(videoDuration);

    if (isNaN(videoStartNum) || isNaN(musicDurationNum) || isNaN(audioStartNum) || isNaN(musicVolumeNum)) {
      throw new Error('Invalid numeric parameters for video/audio combination.');
    }

    console.log('Ã°Å¸Å½Âµ Audio mixing parameters:');
    console.log('   - Video duration:', videoDurationNum, 'seconds');
    console.log('   - Video start time:', videoStartNum, 'seconds');
    console.log('   - Music duration:', musicDurationNum, 'seconds');
    console.log('   - Music volume:', Math.round(musicVolumeNum * 100) + '%');
    console.log('   - Audio start:', audioStartNum, 'seconds');

    // Ã¢Å“â€¦ FIXED: Simplified audio stream detection (no ffprobe needed)
    const hasAudioStream = true; // Assume video has audio by default

    console.log('Assuming video has audio stream (simplified approach)');

    // Ã¢Å“â€¦ FIXED: Better audio mixing logic with proper delay and volume
    await new Promise((resolve, reject) => {
      let command = ffmpeg(videoFilePath)
        .input(audioFilePath);

      console.log('Ã°Å¸Å½Âµ Processing video with audio mixing');
      
      const backgroundMusicVolume = musicVolumeNum;
      
      console.log('   - Original audio volume: 100% (unchanged)');
      console.log('   - Background music volume:', Math.round(backgroundMusicVolume * 100) + '%');
      
      if (videoStartNum > 0) {
        // Music starts after some delay - CREATE PROPER SILENCE PADDING
        command = command.complexFilter([
          // Create silence padding for the delay
          `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${videoStartNum}[silence]`,
          // Trim and adjust music volume
          `[1:a]atrim=start=${audioStartNum}:duration=${musicDurationNum},volume=${backgroundMusicVolume}[music_trimmed]`,
          // Concatenate silence + music to create delayed track
          `[silence][music_trimmed]concat=n=2:v=0:a=1[delayed_music]`,
          // Mix original video audio with delayed music
          `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`
        ]);
      } else {
        // Music starts immediately  
        command = command.complexFilter([
          // Trim and volume adjust the music
          `[1:a]atrim=start=${audioStartNum}:duration=${musicDurationNum},volume=${backgroundMusicVolume}[music]`,
          // Mix original video audio with music
          `[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`
        ]);
      }

      command = command.outputOptions([
        '-map 0:v',              // Keep original video
        '-map [final_audio]',    // Use mixed audio
        '-c:v copy',             // Copy video without re-encoding
        '-c:a aac',              // Encode audio as AAC
        '-b:a 192k',             // Audio bitrate
        '-ar 44100',             // Audio sample rate
        '-ac 2',                 // Stereo audio
        '-avoid_negative_ts make_zero'
      ]);

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Ã°Å¸Å½Â¬ FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log('Ã¢Å“â€¦ Video processing completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('Ã¢ÂÅ’ FFmpeg error:', err.message);
          reject(err);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log('Ã°Å¸â€â€ž Processing: ' + Math.round(progress.percent) + '% done');
          }
        })
        .run();
    });

    // Verify output file
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Output file is empty');
    }

    console.log('Ã¢Å“â€¦ Combined video created:', outputPath, 'Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    // Return the URL for the combined video
    const combinedUrl = `https://nback-6gqw.onrender.com/trimmed/${path.basename(outputPath)}`;
    res.json({ combinedUrl });

  } catch (err) {
    console.error('Ã¢ÂÅ’ Error combining video and audio:', err);
    res.status(500).json({ 
      error: 'Failed to combine video and audio', 
      details: err.message 
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [videoFilePath, audioFilePath];
    for (const file of filesToClean) {
      if (file) {
        try {
          await fsPromises.unlink(file);
          console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Cleaned up:', file);
        } catch (e) {
          console.warn(`Ã¢Å¡ Ã¯Â¸Â Could not delete temporary file ${file}:`, e.message);
        }
      }
    }
  }
});

// User authentication routes (example, not fully implemented here)
app.post('/api/register', async (req, res) => { /* ... */ });
app.post('/api/login', async (req, res) => { /* ... */ });
app.post('/api/request-password-reset', async (req, res) => { /* ... */ });
app.post('/api/reset-password', async (req, res) => { /* ... */ });
app.get('/api/verify-email/:token', async (req, res) => { /* ... */ });

// Track management endpoints
app.post('/api/save-track', async (req, res) => {
  const { userId, title, audioUrl, duration, description, lyrics, youtubeUrls } = req.body;
  try {
    const user = await User.findById(userId); // Assuming userId is MongoDB ObjectId
    if (!user) return res.status(404).json({ message: 'User not found' });

    const newTrack = new Track({
      userId,
      title,
      audioUrl,
      duration,
      description,
      lyrics,
      youtubeUrls
    });
    await newTrack.save();
    res.status(201).json({ message: 'Track saved successfully!', track: newTrack });
  } catch (error) {
    res.status(500).json({ message: 'Error saving track', error: error.message });
  }
});

app.post('/api/get-recent-tracks', async (req, res) => {
  const { userId } = req.body;
  try {
    // Assuming userId is for querying recent tracks related to a user
    const recentTracks = await Track.find({ userId }).sort({ generatedAt: -1 }).limit(5);
    res.json(recentTracks);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching recent tracks', error: error.message });
  }
});

// REPLACE your existing /api/save-recent-track endpoint in index.js:

app.post('/api/save-recent-track', async (req, res) => {
  const { 
    userId, 
    audioUrl, 
    duration, 
    description, 
    lyrics, 
    youtubeUrls, 
    start, 
    end,
    trackName, // Ã°Å¸Å¡Â¨ NEW: Accept track name
    segmentIndex,
    originalFileName
  } = req.body;
  
  try {
    console.log('Ã°Å¸â€™Â¾ Saving recent track with name:', trackName || 'Unnamed Track');
    
    // Find if a track with the same audioUrl and userId already exists
    const existingTrack = await Track.findOne({ userId, audioUrl });

    if (existingTrack) {
      // Update existing track with new track name and timestamp
      existingTrack.generatedAt = Date.now();
      existingTrack.trackName = trackName || existingTrack.trackName || 'Unnamed Track';
      existingTrack.title = trackName || existingTrack.title || 'Unnamed Track'; // Keep title in sync
      await existingTrack.save();
      console.log(`Ã¢Å“â€¦ Track "${trackName}" updated for user ${userId}`);
    } else {
      // Create new entry with track name
      const newTrack = new Track({
        userId,
        audioUrl,
        duration,
        description,
        lyrics,
        youtubeUrls,
        start,
        end,
        title: trackName || 'Unnamed Track', // Use track name as title
        trackName: trackName || 'Unnamed Track', // Ã°Å¸Å¡Â¨ NEW: Store track name
        segmentInfo: {
          segmentIndex: segmentIndex || 0,
          originalStart: start,
          originalEnd: end,
          wasAdjusted: false
        },
        generationType: 'segment',
        originalFileName: originalFileName || 'unknown_video'
      });
      await newTrack.save();
      console.log(`Ã¢Å“â€¦ New track "${trackName}" saved for user ${userId}`);
    }

    // Fetch the latest recent tracks to send back
    const recentTracks = await Track.find({ userId }).sort({ generatedAt: -1 }).limit(5);
    res.status(200).json({ 
      message: 'Recent track saved/updated successfully!', 
      recentTracks 
    });
    
  } catch (err) {
    console.error('Error saving recent track:', err);
    res.status(500).json({ 
      error: 'Failed to save recent track', 
      details: err.message 
    });
  }
});

// REPLACE your existing /api/save-track endpoint:

app.post('/api/save-track', async (req, res) => {
  const { 
    userId, 
    title, 
    audioUrl, 
    duration, 
    description, 
    lyrics, 
    youtubeUrls,
    trackName, // Ã°Å¸Å¡Â¨ NEW: Accept track name (could be same as title)
    segmentIndex,
    originalFileName
  } = req.body;
  
  try {
    console.log('Ã°Å¸â€™Â¾ Saving track to library with name:', trackName || title || 'Unnamed Track');
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const finalTrackName = trackName || title || 'Unnamed Track';

    const newTrack = new Track({
      userId,
      title: finalTrackName,
      trackName: finalTrackName, // Ã°Å¸Å¡Â¨ NEW: Store track name
      audioUrl,
      duration,
      description,
      lyrics,
      youtubeUrls,
      segmentInfo: {
        segmentIndex: segmentIndex || 0,
        wasAdjusted: false
      },
      generationType: 'segment',
      originalFileName: originalFileName || 'unknown_video'
    });
    
    await newTrack.save();
    console.log(`Ã¢Å“â€¦ Track "${finalTrackName}" saved to library`);
    
    res.status(201).json({ 
      message: 'Track saved successfully!', 
      track: newTrack 
    });
    
  } catch (error) {
    console.error('Error saving track to library:', error);
    res.status(500).json({ 
      message: 'Error saving track', 
      error: error.message 
    });
  }
});
app.post('/google-login', async (req, res) => {
  const { token } = req.body;
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const customer = await stripeInstance.customers.create({ email });
      user = new User({
        email,
        username: email.split('@')[0],
        stripeCustomerId: customer.id,
        isVerified: true,
        paymentStatus: 'Free',
      });
      await user.save();
    }

    res.status(200).json({
      message: 'Google login successful',
      email: user.email,
      isNewUser,
      userId: user._id,
    });
  } catch (err) {
    console.error("Google Login Error:", err);
    res.status(401).json({ message: 'Google login failed' });
  }
});

app.post('/check-payment-status', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ accountType: user.paymentStatus || 'Free' });
  } catch (err) {
    console.error("Payment status error:", err);
    res.status(500).json({ message: 'Failed to check payment status' });
  }
});
// Replace your existing /create-payment-intent endpoint with this fixed version:

const fs = require('fs');     

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Compress video to meet Gemini API size limits
 * @param {Buffer} videoBuffer - Original video buffer
 * @param {string} originalFilename - Original filename for extension detection
 * @param {Object} options - Compression options
 * @returns {Promise<Buffer>} - Compressed video buffer
 */
async function compressVideoForGemini(videoBuffer, originalFilename = 'video.mp4', options = {}) {
  const {
    targetSizeMB = 60, // Target 18MB to be safe under 20MB limit
    maxResolution = '720p', // Max resolution to maintain quality
    crf = 28, // Constant Rate Factor (18-28 for good quality, higher = smaller file)
    audioBitrate = '96k', // Audio bitrate
    preset = 'fast', // Encoding speed vs compression (ultrafast, fast, medium, slow)
    frameRate = null // Limit frame rate if needed
  } = options;

  try {
    console.log('🗜️ ===============================================');
    console.log('🗜️ COMPRESSING VIDEO FOR GEMINI API');
    console.log('🗜️ ===============================================');
    console.log('📊 Original size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('🎯 Target size:', targetSizeMB, 'MB');
    console.log('📺 Max resolution:', maxResolution);
    console.log('🎛️ CRF:', crf);
    console.log('📊 Audio bitrate:', audioBitrate);

    const tempDir = path.join(__dirname, 'temp_videos');
    // ✅ FIXED: Use fsPromises instead of fs
    await fsPromises.mkdir(tempDir, { recursive: true });

    // Generate unique filenames
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `input_${timestamp}.mp4`);
    const outputPath = path.join(tempDir, `compressed_${timestamp}.mp4`);

    // ✅ FIXED: Use fsPromises.writeFile instead of fs.writeFile
    await fsPromises.writeFile(inputPath, videoBuffer);

    // Calculate resolution settings
    const resolutionSettings = getResolutionSettings(maxResolution);

    const startTime = Date.now();

    // Compress video with FFmpeg
    await new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate(audioBitrate)
        .outputOptions([
          `-crf ${crf}`,
          `-preset ${preset}`,
          '-movflags +faststart', // Optimize for web streaming
          '-pix_fmt yuv420p', // Ensure compatibility
          '-profile:v baseline', // Better compatibility
          '-level 3.0'
        ]);

      // Add resolution scaling if needed
      if (resolutionSettings.scale) {
        command = command.size(resolutionSettings.scale);
      }

      // Add frame rate limiting if specified
      if (frameRate) {
        command = command.fps(frameRate);
      }

      command
        .on('start', (commandLine) => {
          console.log('🎬 FFmpeg compression started:', commandLine.substring(0, 100) + '...');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🗜️ Compression progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log('✅ Video compression completed in', processingTime, 'seconds');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg compression error:', err.message);
          reject(err);
        })
        .run();
    });

    // ✅ FIXED: Use fsPromises.readFile instead of fs.readFile
    const compressedBuffer = await fsPromises.readFile(outputPath);
    const compressedSizeMB = compressedBuffer.length / 1024 / 1024;

    console.log('📊 COMPRESSION RESULTS:');
    console.log('📊 ===============================================');
    console.log('📊 Original size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('📊 Compressed size:', compressedSizeMB.toFixed(2), 'MB');
    console.log('📊 Compression ratio:', (((videoBuffer.length - compressedBuffer.length) / videoBuffer.length) * 100).toFixed(1) + '%');
    console.log('📊 Size reduction:', ((videoBuffer.length - compressedBuffer.length) / 1024 / 1024).toFixed(2), 'MB');

    // Clean up temporary files
    try {
      // ✅ FIXED: Use fsPromises.unlink instead of fs.unlink
      await fsPromises.unlink(inputPath);
      await fsPromises.unlink(outputPath);
      console.log('🗑️ Temporary files cleaned up');
    } catch (cleanupError) {
      console.warn('⚠️ Could not clean up temporary files:', cleanupError.message);
    }

    // Check if compression was successful
    if (compressedSizeMB > targetSizeMB) {
      console.warn('⚠️ Compressed video still exceeds target size. Consider using more aggressive settings.');
    } else {
      console.log('✅ Video successfully compressed to target size!');
    }

    return compressedBuffer;

  } catch (error) {
    console.error('❌ Error compressing video:', error);
    throw new Error(`Video compression failed: ${error.message}`);
  }
}

/**
 * Get resolution settings based on target resolution
 */
function getResolutionSettings(maxResolution) {
  const resolutions = {
    '1080p': { scale: '1920x1080', bitrate: '2000k' },
    '720p': { scale: '1280x720', bitrate: '1500k' },
    '480p': { scale: '854x480', bitrate: '1000k' },
    '360p': { scale: '640x360', bitrate: '700k' },
    '240p': { scale: '426x240', bitrate: '400k' }
  };

  return resolutions[maxResolution] || resolutions['720p'];
}

async function smartCompressVideo(videoBuffer, originalFilename, targetSizeMB = 60) {
  console.log('🧠 SMART COMPRESSION: Using aggressive compression directly...');
  
  // 🚨 SKIP TO MOST AGGRESSIVE LEVEL (Level 5) IMMEDIATELY
  const aggressiveLevel = { 
    crf: 35, 
    resolution: '360p', 
    audioBitrate: '64k', 
    name: 'Very Low Quality' 
  };
  
  try {
    console.log(`🎯 Using aggressive compression: ${aggressiveLevel.name}`);
    console.log(`   Settings: CRF=${aggressiveLevel.crf}, Resolution=${aggressiveLevel.resolution}, Audio=${aggressiveLevel.audioBitrate}`);
    
    const compressedBuffer = await compressVideoForGemini(videoBuffer, originalFilename, {
      targetSizeMB,
      maxResolution: aggressiveLevel.resolution,
      crf: aggressiveLevel.crf,
      audioBitrate: aggressiveLevel.audioBitrate,
      preset: 'fast'
    });

    const sizeMB = compressedBuffer.length / 1024 / 1024;
    
    console.log(`🎯 AGGRESSIVE COMPRESSION COMPLETE: ${sizeMB.toFixed(2)} MB`);
    
    if (sizeMB <= targetSizeMB) {
      console.log(`✅ Target reached! ${sizeMB.toFixed(2)}MB ≤ ${targetSizeMB}MB`);
    } else {
      console.log(`📊 Result: ${sizeMB.toFixed(2)}MB (larger than ${targetSizeMB}MB target, but much smaller than original)`);
    }

    // ✅ ALWAYS RETURN THE RESULT - EVEN IF TARGET NOT REACHED
    return {
      success: true,
      buffer: compressedBuffer,
      originalSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
      compressedSize: sizeMB.toFixed(2) + ' MB',
      compressionLevel: aggressiveLevel.name,
      settings: aggressiveLevel,
      compressionRatio: (((videoBuffer.length - compressedBuffer.length) / videoBuffer.length) * 100).toFixed(1) + '%'
    };
    
  } catch (error) {
    console.error(`❌ Aggressive compression failed:`, error.message);
    throw new Error(`Compression failed: ${error.message}`);
  }
}

/**
 * Enhanced video analysis with automatic compression
 */
async function analyzeVideoSegmentsWithCompression(videoBuffer, mimeType, options = {}) {
  try {
    const originalSizeMB = videoBuffer.length / 1024 / 1024;
    const GEMINI_SIZE_LIMIT = 60; // Conservative limit

    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸŽ¬ VIDEO ANALYSIS WITH SMART COMPRESSION');
    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸ“Š Original video size:', originalSizeMB.toFixed(2), 'MB');
    console.log('ðŸŽ¯ Gemini size limit:', GEMINI_SIZE_LIMIT, 'MB');

    let finalVideoBuffer = videoBuffer;
    let compressionInfo = null;

    // Check if compression is needed
    if (originalSizeMB > GEMINI_SIZE_LIMIT) {
      console.log('ðŸ—œï¸ Video exceeds Gemini limit - starting smart compression...');
      
      try {
        const compressionResult = await smartCompressVideo(
          videoBuffer, 
          'uploaded_video.mp4', 
          GEMINI_SIZE_LIMIT
        );
        
        finalVideoBuffer = compressionResult.buffer;
        compressionInfo = compressionResult;
        
        console.log('âœ… Video successfully compressed for Gemini API');
        console.log('ðŸ“Š Compression details:', compressionResult.settings);
        
      } catch (compressionError) {
        console.error('âŒ Video compression failed:', compressionError.message);
        throw new Error(`Cannot analyze video: ${compressionError.message}`);
      }
    } else {
      console.log('âœ… Video size is within Gemini limits - no compression needed');
    }

    // Proceed with analysis using the (possibly compressed) video
    console.log('ðŸ§  Starting Gemini analysis...');
    
    const { analyzeVideoForMusicSegments } = require('./gemini-utils');
    
    const analysisResult = await analyzeVideoForMusicSegments(finalVideoBuffer, mimeType, options);

    // Add compression info to result
    if (compressionInfo) {
      analysisResult.compressionInfo = compressionInfo;
      analysisResult.wasCompressed = true;
    } else {
      analysisResult.wasCompressed = false;
    }

    return analysisResult;

  } catch (error) {
    console.error('âŒ Error in video analysis with compression:', error);
    throw error;
  }
}
app.post('/create-payment-intent', async (req, res) => {
    try {
        // Check if Stripe is properly initialized
        if (!stripeInstance) {
            console.error('Stripe is not initialized. Check your STRIPE_SECRET_KEY environment variable.');
            return res.status(500).send({ 
                error: { message: 'Payment system not configured' } 
            });
        }

        console.log('Creating payment intent...');
        
        const paymentIntent = await stripeInstance.paymentIntents.create({
            amount: 1000, // $10.00 in cents
            currency: 'usd',
            automatic_payment_methods: { enabled: true },
        });
        
        console.log('Payment intent created successfully:', paymentIntent.id);
        
        res.send({ 
            clientSecret: paymentIntent.client_secret 
        });
    } catch (e) {
        console.error("Error creating payment intent:", e);
        return res.status(400).send({ 
            error: { message: e.message } 
        });
    }
});

// Also fix the complete-checkout endpoint:
app.post('/complete-checkout', async (req, res) => {
  const { email, paymentIntentId } = req.body;

  if (!email || !paymentIntentId) {
    return res.status(400).json({ message: 'Email and Payment Intent ID are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Use stripeInstance instead of stripeInstance.customers
    const customer = await stripeInstance.customers.create({ email });

    user.lastPaymentIntentId = paymentIntentId;
    user.paymentStatus = 'Premium';
    user.stripeCustomerId = customer.id;
    await user.save();

    res.status(200).json({ 
      message: 'Checkout completed successfully. Account is now Premium.' 
    });

  } catch (error) {
    console.error('Error completing checkout:', error);
    res.status(500).json({ 
      message: 'Server error while updating account.' 
    });
  }
});
// ===================================================
// STEP-BY-STEP IMPLEMENTATION GUIDE
// ===================================================

// STEP 1: Add these imports at the top of your index.js (after your existing imports)
const os = require('os');

// STEP 2: Add platform detection right after your existing constants
const PLATFORM_CONFIG = {
  isRender: process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID,
  isProduction: process.env.NODE_ENV === 'production',
  
  // Memory and processing limits
  limits: {
    render: {
      maxVideoSizeMB: 10000,        // 20MB max for Render
      maxDurationSeconds: 60,    // 1 minute max
      chunkSizeSeconds: 20,      // 20-second chunks
      timeoutMs: 120000,         // 2 minutes timeout
      memoryLimitMB: 400         // 400MB memory limit
    },
    local: {
      maxVideoSizeMB: 100,       // 100MB for local
      maxDurationSeconds: 300,   // 5 minutes
      chunkSizeSeconds: 60,      // 60-second chunks
      timeoutMs: 600000,         // 10 minutes
      memoryLimitMB: 1024        // 1GB memory
    }
  }
};

// Get current platform limits
const getCurrentLimits = () => {
  return PLATFORM_CONFIG.isRender ? PLATFORM_CONFIG.limits.render : PLATFORM_CONFIG.limits.local;
};

// STEP 3: Add memory monitoring class (add this after your existing utilities)
class MemoryMonitor {
  constructor() {
    const limits = getCurrentLimits();
    this.maxMemoryMB = limits.memoryLimitMB;
    this.warningThreshold = 0.7; // 70%
    this.criticalThreshold = 0.85; // 85%
  }
  
  getCurrentUsageMB() {
    const usage = process.memoryUsage();
    return Math.round(usage.rss / 1024 / 1024);
  }
  
  getMemoryStatus() {
    const usageMB = this.getCurrentUsageMB();
    const percentage = usageMB / this.maxMemoryMB;
    
    if (percentage > this.criticalThreshold) {
      return {
        status: 'critical',
        usageMB,
        percentage: Math.round(percentage * 100),
        shouldAbort: true,
        message: `Critical memory: ${usageMB}MB/${this.maxMemoryMB}MB (${Math.round(percentage * 100)}%)`
      };
    } else if (percentage > this.warningThreshold) {
      return {
        status: 'warning',
        usageMB,
        percentage: Math.round(percentage * 100),
        shouldAbort: false,
        message: `High memory: ${usageMB}MB/${this.maxMemoryMB}MB (${Math.round(percentage * 100)}%)`
      };
    }
    
    return {
      status: 'ok',
      usageMB,
      percentage: Math.round(percentage * 100),
      shouldAbort: false,
      message: `Memory OK: ${usageMB}MB/${this.maxMemoryMB}MB (${Math.round(percentage * 100)}%)`
    };
  }
  
  forceGC() {
    if (global.gc) {
      console.log('🗑️ Forcing garbage collection...');
      global.gc();
    }
  }
}

// STEP 4: Enhanced FFmpeg processing function (add this after your existing functions)
async function processVideoSafely(inputPath, outputPath, startTime, duration) {
  const limits = getCurrentLimits();
  const memoryMonitor = new MemoryMonitor();
  
  return new Promise((resolve, reject) => {
    console.log(`🎬 Starting safe video processing...`);
    console.log(`   Platform: ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Max allowed: ${limits.maxDurationSeconds}s`);
    
    // Pre-flight memory check
    const initialMemory = memoryMonitor.getMemoryStatus();
    console.log(`💾 ${initialMemory.message}`);
    
    if (initialMemory.shouldAbort) {
      reject(new Error('Insufficient memory to start processing'));
      return;
    }
    
    let ffmpegProcess;
    let memoryInterval;
    let lastProgress = 0;
    
    // Setup timeout
    const timeout = setTimeout(() => {
      console.log('⏰ Processing timeout - killing FFmpeg');
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGTERM');
      }
      reject(new Error('Processing timeout. Try with a shorter video segment.'));
    }, limits.timeoutMs);
    
    // Memory monitoring during processing
    memoryInterval = setInterval(() => {
      const memStatus = memoryMonitor.getMemoryStatus();
      
      if (memStatus.shouldAbort) {
        console.error(`🚨 ${memStatus.message} - Aborting process`);
        if (ffmpegProcess && !ffmpegProcess.killed) {
          ffmpegProcess.kill('SIGTERM');
        }
        reject(new Error(`Memory exhausted: ${memStatus.message}. Try with a much smaller video file.`));
        return;
      } else if (memStatus.status === 'warning') {
        console.warn(`⚠️ ${memStatus.message}`);
        memoryMonitor.forceGC();
      }
    }, 3000); // Check every 3 seconds
    
    try {
      // Platform-specific FFmpeg settings
      const settings = PLATFORM_CONFIG.isRender ? {
        preset: 'ultrafast',
        crf: 30,
        scale: '640:360',  // Force small resolution
        audioBitrate: '64k',
        videoBitrate: '300k',
        threads: 1
      } : {
        preset: 'fast',
        crf: 26,
        scale: null,
        audioBitrate: '128k',
        videoBitrate: '1000k',
        threads: 2
      };
      
      console.log(`⚙️ Using ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'} optimized settings`);
      
      ffmpegProcess = ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate(settings.audioBitrate)
        .outputOptions([
          `-preset ${settings.preset}`,
          `-crf ${settings.crf}`,
          `-maxrate ${settings.videoBitrate}`,
          `-bufsize ${parseInt(settings.videoBitrate) * 2}k`,
          `-threads ${settings.threads}`,
          '-pix_fmt yuv420p',
          '-profile:v baseline',
          '-level 3.0'
        ]);
      
      // Apply scaling for Render
      if (settings.scale) {
        ffmpegProcess = ffmpegProcess.size(settings.scale);
        console.log(`📐 Forcing resolution: ${settings.scale}`);
      }
      
      ffmpegProcess
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🎬 Optimized FFmpeg started');
        })
        .on('progress', (progress) => {
          if (progress.percent && progress.percent > lastProgress + 15) {
            console.log(`⚡ Progress: ${Math.round(progress.percent)}%`);
            lastProgress = Math.round(progress.percent);
          }
        })
        .on('end', () => {
          console.log('✅ Safe processing completed');
          clearTimeout(timeout);
          clearInterval(memoryInterval);
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err.message);
          clearTimeout(timeout);
          clearInterval(memoryInterval);
          
          // Enhanced error messages
          if (err.message.includes('SIGKILL')) {
            reject(new Error('Process killed by system (out of memory). Use a much shorter video (under 30 seconds) or smaller file (under 10MB).'));
          } else if (err.message.includes('SIGTERM')) {
            reject(new Error('Process terminated due to resource limits. Try with a shorter/smaller video.'));
          } else {
            reject(new Error(`Video processing failed: ${err.message}`));
          }
        })
        .run();
        
    } catch (error) {
      clearTimeout(timeout);
      clearInterval(memoryInterval);
      reject(error);
    }
  });
}

// STEP 5: Replace your existing /api/cliptune-upload-trimmed endpoint with this safer version
app.post('/api/cliptune-upload-trimmed', upload.single('video'), async (req, res) => {
  const limits = getCurrentLimits();
  const memoryMonitor = new MemoryMonitor();
  let originalPath, trimmedPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video uploaded' });
    }

    const { extra_prompt, video_start = 0, video_end, total_seconds } = req.body;
    const start = parseFloat(video_start);
    const end = parseFloat(video_end);
    const duration = end - start;
    const fileSizeMB = req.file.size / 1024 / 1024;

    console.log('🚀 ===============================================');
    console.log('🚀 SAFE VIDEO PROCESSING');
    console.log('🚀 ===============================================');
    console.log(`📁 File: ${req.file.originalname}`);
    console.log(`📊 Size: ${fileSizeMB.toFixed(2)} MB`);
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`🖥️ Platform: ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'}`);

    // VALIDATION CHECKS
    if (fileSizeMB > limits.maxVideoSizeMB) {
      return res.status(400).json({
        success: false,
        error: `Video file too large: ${fileSizeMB.toFixed(1)}MB`,
        details: `Maximum allowed on ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'}: ${limits.maxVideoSizeMB}MB`,
        suggestions: [
          `Try with a file under ${limits.maxVideoSizeMB}MB`,
          'Compress your video before upload',
          'Use a shorter video clip'
        ]
      });
    }
    
    if (duration > limits.maxDurationSeconds) {
      return res.status(400).json({
        success: false,
        error: `Video segment too long: ${duration}s`,
        details: `Maximum allowed on ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'}: ${limits.maxDurationSeconds}s`,
        suggestions: [
          `Keep segments under ${limits.maxDurationSeconds} seconds`,
          PLATFORM_CONFIG.isRender ? 'Render free tier has strict limits' : 'Try shorter segments',
          'Split your video into smaller parts'
        ]
      });
    }
    
    // Memory check before starting
    const memoryStatus = memoryMonitor.getMemoryStatus();
    if (memoryStatus.shouldAbort) {
      return res.status(503).json({
        success: false,
        error: 'Server memory full',
        details: memoryStatus.message,
        suggestion: 'Please try again in a few minutes when server load is lower'
      });
    }

    // Save original video
    originalPath = path.join(__dirname, 'temp_videos', `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);
    console.log('💾 Original video saved');

    // Process video safely
    trimmedPath = path.join(__dirname, 'temp_videos', `trimmed_${Date.now()}.mp4`);
    
    console.log(`⚡ Starting safe processing with ${PLATFORM_CONFIG.isRender ? 'Render' : 'Local'} limits...`);
    await processVideoSafely(originalPath, trimmedPath, start, duration);

    // Verify output
    const trimmedStats = await fsPromises.stat(trimmedPath);
    if (trimmedStats.size === 0) {
      throw new Error('Processed video is empty');
    }

    const trimmedSizeMB = trimmedStats.size / 1024 / 1024;
    console.log(`✅ Processed video: ${trimmedSizeMB.toFixed(2)} MB`);

    // Continue with your existing analysis logic here...
    // For now, return success with the processed video info
    
    res.json({
      success: true,
      message: 'Video processed successfully with safety checks',
      processing_info: {
        platform: PLATFORM_CONFIG.isRender ? 'render' : 'local',
        original_size_mb: fileSizeMB.toFixed(2),
        processed_size_mb: trimmedSizeMB.toFixed(2),
        duration_seconds: duration,
        memory_used_mb: memoryMonitor.getCurrentUsageMB(),
        limits_applied: limits
      },
      // Add your segments analysis here when ready
      result: {
        segments: [], // Your analysis results go here
        analysis_method: 'safe_processing'
      }
    });

  } catch (error) {
    console.error('❌ Safe processing error:', error);
    
    // User-friendly error messages
    let errorMessage = 'Video processing failed';
    const suggestions = [];
    
    if (error.message.includes('memory') || error.message.includes('SIGKILL')) {
      errorMessage = 'Not enough memory to process this video';
      suggestions.push('Try with a much smaller video file (under 10MB)');
      suggestions.push('Use a shorter video segment (under 30 seconds)');
      if (PLATFORM_CONFIG.isRender) {
        suggestions.push('Render free tier has limited resources');
      }
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Video processing took too long';
      suggestions.push('Try with a shorter video segment');
      suggestions.push('Use a smaller file size');
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      suggestions,
      platform_info: {
        platform: PLATFORM_CONFIG.isRender ? 'render' : 'local',
        limits: limits,
        memory_status: memoryMonitor.getMemoryStatus()
      }
    });
    
  } finally {
    // Cleanup
    const filesToClean = [originalPath, trimmedPath].filter(Boolean);
    for (const file of filesToClean) {
      try {
        if (fs.existsSync(file)) {
          await fsPromises.unlink(file);
          console.log('🗑️ Cleaned up:', path.basename(file));
        }
      } catch (error) {
        console.warn('⚠️ Cleanup failed:', path.basename(file));
      }
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = memoryMonitor.getMemoryStatus();
    console.log(`💾 Final memory: ${finalMemory.message}`);
  }
});

// STEP 6: Add a health check endpoint
app.get('/api/health-memory', (req, res) => {
  const memoryMonitor = new MemoryMonitor();
  const limits = getCurrentLimits();
  const memStatus = memoryMonitor.getMemoryStatus();
  
  res.json({
    status: memStatus.shouldAbort ? 'unhealthy' : 'healthy',
    platform: PLATFORM_CONFIG.isRender ? 'render' : 'local',
    memory: memStatus,
    limits: limits,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// STEP 7: Add environment variable detection (add this near your other console.log statements at startup)
console.log('🔧 ===============================================');
console.log('🔧 PLATFORM CONFIGURATION');
console.log('🔧 ===============================================');
console.log('Platform detected:', PLATFORM_CONFIG.isRender ? 'Render' : 'Local/Other');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Memory limit:', getCurrentLimits().memoryLimitMB + 'MB');
console.log('Max video size:', getCurrentLimits().maxVideoSizeMB + 'MB');
console.log('Max duration:', getCurrentLimits().maxDurationSeconds + 's');
console.log('🔧 ===============================================');
// ADD this debugging endpoint to test the parsing functions
app.post('/api/test-json-parsing', async (req, res) => {
  try {
    const { testResponse, maxSegments = 10 } = req.body;

    if (!testResponse) {
      return res.status(400).json({ 
        error: 'No testResponse provided for parsing test' 
      });
    }

    console.log('Ã°Å¸Â§Âª ===============================================');
    console.log('Ã°Å¸Â§Âª TESTING JSON PARSING WITH SAMPLE RESPONSE');
    console.log('Ã°Å¸Â§Âª ===============================================');
    console.log('Ã°Å¸â€œâ€ž Response length:', testResponse.length);

    // Import the enhanced parsing function
    const { extractSegmentsFromGeminiResponse } = require('./gemini-utils');

    const { segments, parseError, strategy } = extractSegmentsFromGeminiResponse(testResponse, maxSegments);

    console.log('\nÃ¢Å“â€¦ ===============================================');
    console.log('Ã¢Å“â€¦ PARSING TEST COMPLETED');
    console.log('Ã¢Å“â€¦ ===============================================');
    console.log('Ã°Å¸â€º Ã¯Â¸Â Strategy used:', strategy);
    console.log('Ã°Å¸â€œÅ  Segments found:', segments.length);
    console.log('Ã¢ÂÅ’ Parse error:', parseError || 'None');

    if (segments.length > 0) {
      console.log('\nÃ°Å¸Å½Âµ PARSED SEGMENTS:');
      segments.forEach((segment, index) => {
        console.log(`${index + 1}. ${segment.start}s-${segment.end}s: ${segment.type} (${segment.intensity})`);
        console.log(`   Reason: ${segment.reason}`);
      });
    }

    res.json({
      success: segments.length > 0,
      segments: segments,
      totalSegments: segments.length,
      parseStrategy: strategy,
      parseError: parseError,
      message: segments.length > 0 
        ? `Successfully parsed ${segments.length} segments using ${strategy} strategy`
        : `Failed to parse any segments. Strategy attempted: ${strategy}`,
      testInfo: {
        originalLength: testResponse.length,
        maxSegments: maxSegments,
        parsingStrategiesAvailable: [
          'direct_json',
          'json_repair', 
          'text_extraction',
          'regex_extraction'
        ]
      }
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in JSON parsing test:', error);
    res.status(500).json({
      success: false,
      error: 'JSON parsing test failed',
      details: error.message
    });
  }
});

// ADD this endpoint to manually fix malformed JSON
app.post('/api/fix-malformed-json', async (req, res) => {
  try {
    const { malformedJson, maxSegments = 10 } = req.body;

    if (!malformedJson) {
      return res.status(400).json({ 
        error: 'No malformedJson provided' 
      });
    }

    console.log('Ã°Å¸â€Â§ ===============================================');
    console.log('Ã°Å¸â€Â§ ATTEMPTING TO FIX MALFORMED JSON');
    console.log('Ã°Å¸â€Â§ ===============================================');
    console.log('Ã°Å¸â€œâ€ž Input length:', malformedJson.length);

    let fixedJson = malformedJson;

    // Apply comprehensive JSON fixes
    const jsonFixes = [
      // Remove markdown code blocks
      { name: 'Remove markdown', pattern: /```json\s*/gi, replacement: '' },
      { name: 'Remove closing markdown', pattern: /```\s*/g, replacement: '' },
      
      // Fix trailing commas
      { name: 'Fix trailing commas', pattern: /,(\s*[}\]])/g, replacement: '$1' },
      
      // Fix missing quotes around keys
      { name: 'Quote object keys', pattern: /(\w+):/g, replacement: '"$1":' },
      
      // Fix single quotes to double quotes
      { name: 'Convert single quotes', pattern: /'/g, replacement: '"' },
      
      // Fix unquoted string values (be careful with numbers)
      { name: 'Quote string values', pattern: /:\s*([a-zA-Z][a-zA-Z\s]*?)(?=[,}\]])/g, replacement: ': "$1"' },
      
      // Remove text before first array bracket
      { name: 'Remove prefix text', pattern: /^[^[]*/, replacement: '' },
      
      // Remove text after last array bracket
      { name: 'Remove suffix text', pattern: /][^]*$/, replacement: ']' },
      
      // Fix broken string concatenation
      { name: 'Fix broken strings', pattern: /"\s*\+\s*"/g, replacement: '' },
      
      // Fix duplicate quotes
      { name: 'Fix duplicate quotes', pattern: /""+/g, replacement: '"' },
      
      // Fix empty values
      { name: 'Fix empty values', pattern: /:\s*,/g, replacement: ': null,' },
      
      // Fix missing commas between objects
      { name: 'Add missing commas', pattern: /}\s*{/g, replacement: '},{' }
    ];

    console.log('Ã°Å¸â€Â§ Applying JSON fixes...');
    jsonFixes.forEach((fix, index) => {
      const before = fixedJson.length;
      fixedJson = fixedJson.replace(fix.pattern, fix.replacement);
      const after = fixedJson.length;
      
      if (before !== after) {
        console.log(`   Ã¢Å“â€¦ Applied fix ${index + 1}: ${fix.name} (${before} Ã¢â€ â€™ ${after} chars)`);
      }
    });

    // Try to parse the fixed JSON
    let parsedSegments = [];
    let parseError = null;
    let parseSuccess = false;

    try {
      // Look for JSON array pattern
      const jsonMatch = fixedJson.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedSegments = JSON.parse(jsonMatch[0]);
        parseSuccess = true;
        console.log('Ã¢Å“â€¦ Successfully parsed fixed JSON');
      } else {
        throw new Error('No JSON array pattern found after fixes');
      }
    } catch (error) {
      parseError = error.message;
      console.log('Ã¢ÂÅ’ JSON still malformed after fixes:', error.message);
    }

    // Limit segments if needed
    if (parsedSegments.length > maxSegments) {
      parsedSegments = parsedSegments.slice(0, maxSegments);
      console.log(`Ã¢Å“â€šÃ¯Â¸Â Limited to ${maxSegments} segments`);
    }

    // Validate and clean up segments
    const validSegments = parsedSegments.filter(segment => {
      return segment && 
             (segment.start !== undefined || segment.start_time !== undefined) &&
             (segment.end !== undefined || segment.end_time !== undefined) &&
             segment.reason;
    }).map(segment => ({
      start: segment.start || segment.start_time || 0,
      end: segment.end || segment.end_time || 30,
      reason: segment.reason || segment.description || 'Music segment',
      intensity: segment.intensity || 'medium',
      type: segment.type || 'ambient'
    }));

    console.log('\nÃ°Å¸â€œÅ  REPAIR RESULTS:');
    console.log('Ã°Å¸â€œÅ  ===============================================');
    console.log('Ã°Å¸â€œâ€ž Original length:', malformedJson.length);
    console.log('Ã°Å¸â€œâ€ž Fixed length:', fixedJson.length);
    console.log('Ã¢Å“â€¦ Parse successful:', parseSuccess);
    console.log('Ã°Å¸â€œÅ  Raw segments parsed:', parsedSegments.length);
    console.log('Ã°Å¸â€œÅ  Valid segments:', validSegments.length);
    console.log('Ã¢ÂÅ’ Parse error:', parseError || 'None');

    res.json({
      success: parseSuccess && validSegments.length > 0,
      originalJson: malformedJson.substring(0, 500) + (malformedJson.length > 500 ? '...' : ''),
      fixedJson: fixedJson.substring(0, 500) + (fixedJson.length > 500 ? '...' : ''),
      fullFixedJson: fixedJson,
      segments: validSegments,
      totalSegments: validSegments.length,
      parseError: parseError,
      repairInfo: {
        fixesApplied: jsonFixes.length,
        originalLength: malformedJson.length,
        fixedLength: fixedJson.length,
        parsedRawSegments: parsedSegments.length,
        validSegments: validSegments.length
      },
      message: parseSuccess && validSegments.length > 0
        ? `Successfully repaired JSON and extracted ${validSegments.length} valid segments`
        : `JSON repair ${parseSuccess ? 'succeeded' : 'failed'}. ${validSegments.length} valid segments found.`
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error in JSON repair:', error);
    res.status(500).json({
      success: false,
      error: 'JSON repair failed',
      details: error.message
    });
  }
});

// ADD this comprehensive debugging endpoint
app.post('/api/debug-segment-analysis', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video uploaded for debugging' });
    }

    const { customPrompt = 'Debug analysis' } = req.body;

    console.log('Ã°Å¸Ââ€º ===============================================');
    console.log('Ã°Å¸Ââ€º COMPREHENSIVE SEGMENT ANALYSIS DEBUG');
    console.log('Ã°Å¸Ââ€º ===============================================');
    console.log('Ã°Å¸â€œÂ Debug video:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    // Use the enhanced analysis function
    const { analyzeVideoForMusicSegments } = require('./gemini-utils');

    const debugOptions = {
      customPrompt: customPrompt + '\n\nDEBUG MODE: Return clear, parseable JSON only.',
      maxSegments: 5, // Limit to 5 for debugging
      analysisType: 'debug_segments',
      detailLevel: 'detailed',
      showTerminalOutput: true
    };

    console.log('Ã°Å¸Ââ€º Debug analysis starting...');
    const debugResult = await analyzeVideoForMusicSegments(
      req.file.buffer,
      req.file.mimetype,
      debugOptions
    );

    // Comprehensive debug output
    const debugInfo = {
      success: debugResult.success,
      totalSegments: debugResult.totalSegments,
      parseStrategy: debugResult.parseStrategy,
      parseError: debugResult.parseError,
      processingTime: debugResult.processingTime,
      
      rawResponse: {
        length: debugResult.rawResponse?.length || 0,
        preview: debugResult.rawResponse?.substring(0, 200) + '...',
        hasJsonArray: debugResult.rawResponse?.includes('['),
        hasJsonObject: debugResult.rawResponse?.includes('{'),
        hasMarkdown: debugResult.rawResponse?.includes('```')
      },
      
      segments: debugResult.musicSegments || [],
      
      videoInfo: {
        filename: req.file.originalname,
        size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
        mimeType: req.file.mimetype
      },
      
      promptInfo: {
        promptLength: debugResult.promptUsed?.length || 0,
        customPrompt: customPrompt
      }
    };

    console.log('\nÃ°Å¸Ââ€º DEBUG RESULTS:');
    console.log('Ã°Å¸Ââ€º ===============================================');
    console.log('Ã¢Å“â€¦ Success:', debugInfo.success);
    console.log('Ã°Å¸â€œÅ  Segments:', debugInfo.totalSegments);
    console.log('Ã°Å¸â€º Ã¯Â¸Â Parse Strategy:', debugInfo.parseStrategy);
    console.log('Ã¢ÂÅ’ Parse Error:', debugInfo.parseError || 'None');
    console.log('Ã°Å¸â€œâ€ž Response Length:', debugInfo.rawResponse.length);
    console.log('Ã°Å¸Ââ€º ===============================================');

    res.json({
      success: true,
      message: 'Debug analysis completed',
      debugInfo: debugInfo,
      fullRawResponse: debugResult.rawResponse,
      recommendations: debugInfo.success 
        ? ['Analysis working correctly', 'Segments parsed successfully']
        : [
            'Check the raw response for malformed JSON',
            'Simplify the custom prompt',
            'Try a different video or shorter duration',
            'Use the JSON repair endpoint to fix malformed responses'
          ]
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Debug analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Debug analysis failed',
      details: error.message
    });
  }
});

// Ã°Å¸Å¡Â¨ BONUS: Add a standalone endpoint to test the GCS-based analysis function
app.post('/api/test-gcs-segment-analysis', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No video file uploaded for testing' 
      });
    }

    const { customPrompt = '' } = req.body;

    console.log('Ã°Å¸Â§Âª ===============================================');
    console.log('Ã°Å¸Â§Âª TESTING GCS-BASED SEGMENT ANALYSIS FUNCTION');
    console.log('Ã°Å¸Â§Âª ===============================================');
    console.log('Ã°Å¸â€œÂ Test video:', req.file.originalname);
    console.log('Ã°Å¸â€œÅ  File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    // Upload test video to GCS first
    const uploadResult = await handleVideoUpload(
      req.file.buffer,
      `test_${req.file.originalname}_${Date.now()}.mp4`,
      req.file.mimetype || 'video/mp4',
      req.file.size
    );

    console.log('Ã¢Å“â€¦ Test video uploaded to GCS:', uploadResult.gcs_uri);

    const testOptions = {
      customPrompt: customPrompt || 'Test analysis of video for music segments'
    };

    console.log('Ã°Å¸â€Â¬ Testing with options:', testOptions);

    // Use the GCS-based analysis function
    const { analyzeGCSVideoForMusicSegments } = require('./gemini-utils');
    
    const testResult = await analyzeGCSVideoForMusicSegments(
      uploadResult.public_url || uploadResult.gcs_uri,
      testOptions
    );

    if (testResult.success) {
      console.log('Ã¢Å“â€¦ GCS-based function test passed!');
      
      res.json({
        success: true,
        message: 'GCS-based segment analysis function is working correctly!',
        testResult: {
          segments: testResult.musicSegments || [],
          totalSegments: testResult.totalSegments || 0,
          processingTime: testResult.processingTime,
          analysisType: testResult.analysisType || 'music_segments'
        },
        uploadInfo: {
          gcs_uri: uploadResult.gcs_uri,
          public_url: uploadResult.public_url,
          file_name: uploadResult.file_name
        },
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        }
      });
    } else {
      console.error('Ã¢ÂÅ’ GCS-based function test failed:', testResult.error);
      
      res.status(500).json({
        success: false,
        error: 'GCS-based function test failed',
        details: testResult.error,
        rawAnalysis: testResult.rawResponse
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Test endpoint failed',
      details: error.message
    });
  }
});
// Also add this debugging endpoint to check Stripe setup:
app.get('/api/stripe-status', (req, res) => {
  res.json({
    stripeConfigured: !!stripeInstance,
    hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    keyPreview: process.env.STRIPE_SECRET_KEY ? 
      process.env.STRIPE_SECRET_KEY.substring(0, 12) + '...' : 'Not set'
  });
});
app.post('/complete-checkout', async (req, res) => {
  const { email, paymentIntentId } = req.body;

  if (!email || !paymentIntentId) {
    return res.status(400).json({ message: 'Email and Payment Intent ID are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.lastPaymentIntentId = paymentIntentId;
    user.paymentStatus = 'Premium';
    await user.save();

    res.status(200).json({ message: 'Checkout completed successfully. Account is now Premium.' });

  } catch (error) {
    console.error('Error completing checkout:', error);
    res.status(500).json({ message: 'Server error while updating account.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
  