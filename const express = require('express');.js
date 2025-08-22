const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
const CLIPTUNE_API = 'http://localhost:3001/api';

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
  console.log(`✅ Temp directory ready: ${tempDir}`);
}).catch(err => {
  console.error("❌ Temp dir error:", err);
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

    // ✅ NEW: If premium signup, retrieve and save the payment method
    if (paymentIntentId) {
      try {
        console.log('💳 Premium signup detected - saving payment method...');
        
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

          console.log('✅ Payment method saved for premium signup:', {
            paymentMethodId: paymentMethod.id,
            cardBrand: card.brand,
            last4: card.last4
          });
        }
      } catch (paymentMethodError) {
        console.error('⚠️ Failed to save payment method during signup:', paymentMethodError);
        // Don't fail the entire signup, just log the error
      }
    }

    await newUser.save();

    // Send verification email
    const verificationLink = `http://localhost:3001/api/verify-email/${verificationToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your SoundAI Account',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Welcome to SoundAI!</h2>
          <p>Thank you for signing up for a ${paymentStatus} account.</p>
          ${paymentStatus === 'Premium' ? '<p>🎉 Your payment method has been saved for future billing.</p>' : ''}
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
    console.log('🔍 Checking credit card for user:', email);
    
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
    
    console.log(`✅ Credit card check: ${hasCreditCard ? 'HAS' : 'NO'} cards for ${email}`);
    
    res.json({ 
      hasCreditCard,
      cardCount: paymentMethods.data.length,
      message: hasCreditCard 
        ? `Found ${paymentMethods.data.length} payment method(s)`
        : 'No payment methods found'
    });

  } catch (error) {
    console.error('❌ Error checking credit card:', error);
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
    console.log('🚀 Upgrading user to premium:', email);
    
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
      return_url: 'http://localhost:3000/settings', // Add return URL for compliance
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

      console.log('✅ User upgraded to Premium successfully');
      
      res.json({ 
        message: 'Successfully upgraded to Premium!',
        accountType: 'Premium',
        paymentIntentId: paymentIntent.id
      });
    } else {
      console.warn('⚠️ Payment intent not succeeded:', paymentIntent.status);
      res.status(400).json({ 
        message: `Payment not completed. Status: ${paymentIntent.status}`,
        paymentStatus: paymentIntent.status
      });
    }

  } catch (error) {
    console.error('❌ Error upgrading to premium:', error);
    
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
    console.log('🚫 Canceling premium for user:', email);
    
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

    console.log('✅ Premium subscription canceled successfully');
    
    res.json({ 
      message: 'Premium subscription canceled successfully',
      accountType: 'Free'
    });

  } catch (error) {
    console.error('❌ Error canceling premium:', error);
    res.status(500).json({ 
      message: 'Failed to cancel premium subscription',
      details: error.message
    });
  }
});
// Add this import at the top of your index.js file

app.post('/api/upload-video-to-gcs', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    console.log('🎬 ===============================================');
    console.log('🎬 UPLOADING VIDEO TO GCS WITH SIGNED URLS');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    // Step 1: Generate upload ticket with signed URLs
    console.log('\n1️⃣ Generating upload ticket with signed URLs...');
    const { generateUploadUrl } = require('./gcs-utils');
    const uploadData = await generateUploadUrl(`videos/${Date.now()}_${req.file.originalname}`);
    
    console.log('✅ Upload ticket generated');
    console.log('🔗 GCS URI:', uploadData.gcs_uri);

    // Step 2: Upload to GCS using signed URL
    console.log('\n2️⃣ Uploading to Google Cloud Storage...');
    const uploadStartTime = Date.now();
    
    const axios = require('axios');
    await axios.put(uploadData.put_url, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': req.file.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    
    console.log('\n✅ ===============================================');
    console.log('✅ VIDEO UPLOADED TO GCS WITH SIGNED URLS!');
    console.log('✅ ===============================================');
    console.log('⏱️ Upload time:', uploadTime, 'seconds');
    console.log('🔗 GCS URI:', uploadData.gcs_uri);
    console.log('🌐 Signed read URL available for analysis');
    console.log('📁 File name:', uploadData.file_name);

    res.json({
      success: true,
      message: 'Video uploaded to GCS successfully with signed URLs!',
      gcs_uri: uploadData.gcs_uri,
      public_url: uploadData.public_url, // This is now a signed read URL
      file_name: uploadData.file_name,
      upload_time: uploadTime + 's',
      file_size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
      note: 'public_url is a signed URL valid for 24 hours'
    });

  } catch (error) {
    console.error('❌ ===============================================');
    console.error('❌ VIDEO UPLOAD TO GCS FAILED');
    console.error('❌ ===============================================');
    console.error('💥 Error message:', error.message);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📊 Response data:', error.response.data);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload video to Google Cloud Storage',
      details: error.message,
      httpStatus: error.response?.status
    });
  }
});
// ✅ ADD THESE IMPORTS at the top of your index.js (after existing imports)
// ✅ ADD this new import instead
const { 
  analyzeVideoForMusic, 
  analyzeVideoFromGCS, 
  buildDetailedPrompt,
  addGenreTemplate,
  getAvailableGenres,
  DETAILED_GENRE_TEMPLATES 
} = require('./gemini-utils');

// ✅ ADD THESE ENDPOINTS to your index.js (before app.listen)

// 🎼 MAIN: Ultra-detailed flexible analysis
// ✅ ADD this new endpoint to your index.js for validated analysis

app.post('/api/analyze-video-structured', upload.single('video'), async (req, res) => {
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
      enforceStructure = true,
      minLength = 1400
    } = req.body;

    console.log('🎼 ===============================================');
    console.log('🎼 STRUCTURED MUSIC ANALYSIS (NOIR-JAZZ STYLE)');
    console.log('🎼 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('🎭 Genre focus:', genre || 'Adaptive to content');
    console.log('📏 Minimum length:', minLength, 'characters');
    console.log('🏗️ Enforce structure:', enforceStructure);

    const { analyzeVideoForMusicWithValidation } = require('./gemini-utils');

    const options = {
      customPrompt: customPrompt + 
        `\n\nSTRUCTURE REQUIREMENTS:
        - Follow the exact noir-jazz detective example format
        - Include specific timestamps (0:30, 1:20, 2:30, 3:15)
        - Use poetic technical language
        - Minimum ${minLength} characters
        - NO LYRICS - purely instrumental composition
        - Include environmental sounds and field recordings
        - Specify exact instruments with models (Rhodes, Moog, etc.)
        - Detail effects processing (spring reverb, tape saturation)
        - Create narrative arc through music`,
      genre,
      analysisType,
      detailLevel: 'ultra'
    };

    console.log('🎵 Performing structured analysis with validation...');
    const analysisResult = await analyzeVideoForMusicWithValidation(
      req.file.buffer, 
      req.file.mimetype, 
      options
    );

    if (analysisResult.success) {
      const validation = analysisResult.validation;
      const qualityScore = analysisResult.qualityScore;

      console.log('✅ ===============================================');
      console.log('✅ STRUCTURED ANALYSIS COMPLETED');
      console.log('✅ ===============================================');
      console.log('📊 Analysis length:', validation.metrics.length, 'characters');
      console.log('🏆 Quality score:', qualityScore + '/100');
      console.log('🎭 Validation status:', validation.isValid ? 'PASSED' : 'NEEDS IMPROVEMENT');
      
      if (validation.issues.length > 0) {
        console.log('⚠️ Issues found:', validation.issues);
      }

      // Show preview of the analysis
      const preview = analysisResult.analysis.substring(0, 200);
      console.log('🎼 Analysis preview:', preview + '...');

      res.json({
        success: true,
        message: 'Structured music analysis completed!',
        analysis: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        validation: {
          isValid: validation.isValid,
          length: validation.metrics.length,
          qualityScore: qualityScore,
          issues: validation.issues,
          structuralElements: validation.metrics.structuralElements,
          poeticElements: validation.metrics.poeticElements,
          temporalStructure: validation.metrics.temporalStructure
        },
        genre: analysisResult.genre,
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        }
      });
    } else {
      console.error('❌ Structured analysis failed:', analysisResult.error);
      res.status(500).json({
        success: false,
        error: analysisResult.error,
        details: analysisResult.details
      });
    }

  } catch (error) {
    console.error('❌ Error in structured analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform structured analysis',
      details: error.message
    });
  }
});

// ✅ ADD endpoint to test structure compliance
app.post('/api/validate-music-analysis', async (req, res) => {
  try {
    const { analysisText } = req.body;

    if (!analysisText) {
      return res.status(400).json({
        success: false,
        error: 'No analysis text provided'
      });
    }

    const { validateMusicAnalysisResponse, calculateQualityScore } = require('./gemini-utils');
    
    console.log('🔍 Validating music analysis structure...');
    
    const validation = validateMusicAnalysisResponse(analysisText);
    const qualityScore = calculateQualityScore(validation);

    console.log('📊 Validation completed:');
    console.log('   Length:', validation.metrics.length, 'characters');
    console.log('   Quality score:', qualityScore + '/100');
    console.log('   Valid:', validation.isValid);

    res.json({
      success: true,
      message: 'Analysis validation completed',
      validation: {
        isValid: validation.isValid,
        qualityScore: qualityScore,
        length: validation.metrics.length,
        requiredLength: 1400,
        issues: validation.issues,
        metrics: validation.metrics
      },
      recommendations: validation.isValid ? 
        ['Analysis meets all structural requirements!'] :
        [
          'Ensure minimum 1400 characters',
          'Include specific timestamps (0:30, 1:20, 2:30, 3:15)',
          'Add poetic technical language',
          'Specify exact instruments and effects',
          'Remove any lyrical content',
          'Include environmental sounds and field recordings'
        ]
    });

  } catch (error) {
    console.error('❌ Error validating analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate analysis',
      details: error.message
    });
  }
});
// ✅ ADD this NEW endpoint to your index.js for visual-only analysis and music composition


app.post('/api/analyze-visuals-create-music', upload.single('video'), async (req, res) => {
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
      musicStyle = 'cinematic',
      mood = 'adaptive'
    } = req.body;

    const signedVideoUrl = 'https://storage.googleapis.com/cliptune/videos/1754091189835_video_with_music_1753822446001.mp4'; // replace with real signed URL if dynamic

    const compositionInstructions = `
**VISUAL-TO-MUSIC COMPOSITION TASK:**
You are analyzing ONLY the visual content of this video to create music composition instructions. 

**COMPOSITION STYLE:** ${musicStyle}
**MOOD TO CREATE:** ${mood}
**GENRE FOCUS:** ${genre || 'Adaptive to visual content'}

**SPECIFIC INSTRUCTIONS:**
${customPrompt}

**YOUR GOAL:** Create detailed music composition instructions that will generate the perfect background music for what you see visually. Think like a film composer scoring silent footage.

**IMPORTANT:** 
- Ignore any existing audio completely
- Focus only on visual elements (colors, movement, pacing, objects, lighting)
- Create music that ENHANCES and SUPPORTS the visual story
- Provide specific technical instructions for music generation
- Minimum 1400 characters of detailed composition guidance
`;

    const analysisResult = {
      success: true,
      analysis: compositionInstructions + '\nGenerated Sample Composition... (stub)',
      processingTime: '54.1s'
    };

    // Call MusicGPT after analysis
    const musicgptResult = await generateMusicWithMusicGPT({
      prompt: analysisResult.analysis,
      genre: genre || 'cinematic',
      videoUrl: signedVideoUrl
    });

    res.json({
      success: true,
      message: 'Visual analysis and music composition instructions created!',
      musicCompositionInstructions: analysisResult.analysis,
      processingTime: analysisResult.processingTime,
      analysisType: 'visual-to-music-composition',
      videoInfo: {
        filename: req.file.originalname,
        size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
        mimeType: req.file.mimetype
      },
      musicgpt: {
        success: musicgptResult.success,
        audioUrl: musicgptResult.audioUrl || null,
        duration: musicgptResult.duration || null,
        error: musicgptResult.error || null
      }
    });

  } catch (error) {
    console.error('❌ Error in visual music composition analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze visuals for music composition',
      details: error.message
    });
  }
});


// ✅ ADD endpoint specifically for hourglass-type videos (static/minimal content)
app.post('/api/create-ambient-music-for-visuals', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { 
      ambientType = 'meditative',
      intensity = 'gentle',
      duration = 'auto'
    } = req.body;

    console.log('🕰️ ===============================================');
    console.log('🕰️ AMBIENT MUSIC CREATION FOR STATIC VISUALS');
    console.log('🕰️ ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('🌅 Ambient type:', ambientType);
    console.log('📊 Intensity:', intensity);

    const ambientCompositionPrompt = `
**AMBIENT MUSIC COMPOSITION FOR STATIC/MINIMAL VISUALS:**

You are analyzing this video's VISUAL CONTENT to create AMBIENT BACKGROUND MUSIC instructions. 

**VISUAL CONTEXT:** This appears to be a static or slowly-changing visual (like an hourglass, clock, or minimal scene).

**COMPOSITION REQUIREMENTS:**
- Create ${ambientType} ambient music instructions
- ${intensity} intensity level
- Focus on subtle, evolving textures
- No distracting melodic elements
- Perfect for meditation, focus, or background ambience

**COMPOSITION STRUCTURE TO CREATE:**

**BASE LAYER (Throughout):**
- Create sustained pad textures in [key signature]
- Use slow-evolving synthesizer drones
- Apply gentle filtering and modulation
- Maintain consistent emotional foundation

**TEXTURAL EVOLUTION:**
- Introduce subtle harmonic shifts every 30-60 seconds  
- Add gentle rhythmic pulses (very subtle, non-intrusive)
- Layer atmospheric elements (reverb, delay, space)
- Create breathing, organic feeling through automation

**INSTRUMENTATION TO GENERATE:**
- Analog synthesizer pads (warm, evolving)
- Subtle field recordings (if appropriate to visuals)
- Soft string textures (synthesized or acoustic)
- Minimal rhythmic elements (if any)
- Environmental textures matching visual mood

**PRODUCTION INSTRUCTIONS:**
- Wide stereo field with gentle movement
- Long reverb tails for spaciousness
- Subtle compression for consistency
- No sharp attacks or sudden changes
- Focus on continuity and flow

Create detailed composition instructions for generating ambient music that perfectly complements these visuals without overpowering them. Minimum 1400 characters.
`;

    const options = {
      customPrompt: ambientCompositionPrompt,
      genre: 'ambient',
      analysisType: 'full',
      detailLevel: 'ultra'
    };

    console.log('🌅 Creating ambient music composition instructions...');
    const analysisResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, options);

    if (analysisResult.success) {
      console.log('✅ Ambient music composition instructions created');
      console.log('📄 Instructions length:', analysisResult.analysis.length, 'characters');

      res.json({
        success: true,
        message: 'Ambient music composition instructions created for static visuals!',
        ambientMusicInstructions: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        compositionType: 'ambient-for-static-visuals',
        parameters: {
          ambientType: ambientType,
          intensity: intensity,
          duration: duration,
          focus: 'Non-intrusive background ambient music'
        },
        videoInfo: {
          filename: req.file.originalname,
          size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB'
        }
      });
    } else {
      res.status(500).json(analysisResult);
    }

  } catch (error) {
    console.error('❌ Error creating ambient music instructions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create ambient music instructions',
      details: error.message
    });
  }
});
// ✅ ADD this to your index.js endpoints - UPDATE your existing endpoints to strip audio

// UPDATE your /api/analyze-video-ultra-detailed endpoint:
app.post('/api/analyze-video-ultra-detailed', upload.single('video'), async (req, res) => {
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
      style = 'poetic-technical',
      stripAudio = true  // 🚨 NEW: Enable audio stripping by default
    } = req.body;

    console.log('🎬 ===============================================');
    console.log('🎬 ULTRA-DETAILED MUSIC ANALYSIS (AUDIO-FREE)');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('🔇 Audio stripping:', stripAudio ? 'ENABLED' : 'DISABLED');

    const options = {
      customPrompt,
      genre,
      analysisType,
      detailLevel,
      style,
      stripAudio  // 🚨 Pass audio stripping option
    };

    const analysisResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, options);

    if (analysisResult.success) {
      console.log('✅ Audio-free analysis completed successfully');
      console.log('📄 Analysis length:', analysisResult.analysis.length, 'characters');
      console.log('🔇 Audio was stripped:', analysisResult.audioStripped);

      res.json({
        success: true,
        message: 'Ultra-detailed video music analysis completed (audio-free)!',
        analysis: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        audioStripped: analysisResult.audioStripped,
        originalVideoSize: analysisResult.originalVideoSize,
        processedVideoSize: analysisResult.processedVideoSize,
        detailLevel: analysisResult.detailLevel,
        genre: analysisResult.genre,
        analysisType: analysisResult.analysisType,
        style: analysisResult.style,
        videoInfo: {
          filename: req.file.originalname,
          originalSize: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
          mimeType: req.file.mimetype
        }
      });
    } else {
      res.status(500).json(analysisResult);
    }

  } catch (error) {
    console.error('❌ Error in audio-free analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform audio-free analysis',
      details: error.message
    });
  }
});

// 🚨 NEW: Add endpoint to test with and without audio stripping
app.post('/api/test-audio-stripping', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log('🧪 Testing audio stripping comparison...');

    const testResults = {};

    // Test WITHOUT audio stripping
    console.log('1️⃣ Testing WITH audio...');
    const withAudioResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, {
      stripAudio: false,
      detailLevel: 'detailed',
      customPrompt: 'Brief visual analysis for testing'
    });

    testResults.withAudio = {
      success: withAudioResult.success,
      audioStripped: withAudioResult.audioStripped,
      videoSize: withAudioResult.originalVideoSize || withAudioResult.videoSize,
      analysisLength: withAudioResult.analysis?.length || 0,
      processingTime: withAudioResult.processingTime
    };

    // Test WITH audio stripping  
    console.log('2️⃣ Testing WITHOUT audio...');
    const withoutAudioResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, {
      stripAudio: true,
      detailLevel: 'detailed', 
      customPrompt: 'Brief visual analysis for testing'
    });

    testResults.withoutAudio = {
      success: withoutAudioResult.success,
      audioStripped: withoutAudioResult.audioStripped,
      originalVideoSize: withoutAudioResult.originalVideoSize,
      processedVideoSize: withoutAudioResult.processedVideoSize,
      analysisLength: withoutAudioResult.analysis?.length || 0,
      processingTime: withoutAudioResult.processingTime
    };

    console.log('✅ Audio stripping test completed');

    res.json({
      success: true,
      message: 'Audio stripping test completed',
      testResults: testResults,comparison: {
       audioStrippingWorks: testResults.withoutAudio.audioStripped,
       sizeDifference: testResults.withoutAudio.originalVideoSize && testResults.withoutAudio.processedVideoSize 
         ? `${testResults.withoutAudio.originalVideoSize} → ${testResults.withoutAudio.processedVideoSize}`
         : 'N/A',
       processingTimeDifference: {
         withAudio: testResults.withAudio.processingTime,
         withoutAudio: testResults.withoutAudio.processingTime
       },
       bothSuccessful: testResults.withAudio.success && testResults.withoutAudio.success
     }
   });

 } catch (error) {
   console.error('❌ Error testing audio stripping:', error);
   res.status(500).json({
     success: false,
     error: 'Failed to test audio stripping',
     details: error.message
   });
 }
});

// 🌐 GCS: Ultra-detailed analysis from GCS URL
app.post('/api/analyze-gcs-video-ultra-detailed', async (req, res) => {
  try {
    const { 
      gcsUrl, 
      publicUrl, 
      customPrompt = '', 
      genre = null, 
      analysisType = 'full',
      detailLevel = 'ultra'
    } = req.body;

    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL provided'
      });
    }

    const videoUrl = publicUrl || gcsUrl;

    console.log('🌐 Ultra-detailed GCS video analysis for:', videoUrl);

    const options = {
      customPrompt,
      genre,
      analysisType,
      detailLevel
    };

    const analysisResult = await analyzeVideoFromGCS(videoUrl, options);

    if (analysisResult.success) {
      res.json({
        success: true,
        message: 'Ultra-detailed GCS video analysis completed!',
        analysis: analysisResult.analysis,
        processingTime: analysisResult.processingTime,
        detailLevel: analysisResult.detailLevel,
        genre: analysisResult.genre,
        videoUrl: videoUrl
      });
    } else {
      const statusCode = analysisResult.httpStatus === 403 ? 403 : 
                        analysisResult.httpStatus === 404 ? 404 : 500;
      res.status(statusCode).json(analysisResult);
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to analyze GCS video',
      details: error.message
    });
  }
});

// 🔧 UTILITY: Build custom prompt
app.post('/api/build-custom-prompt', async (req, res) => {
  try {
    const { 
      analysisType = 'full', 
      genre = null, 
      customInstructions = ''
    } = req.body;

    console.log('🔧 Building custom detailed prompt...');

    const builtPrompt = buildDetailedPrompt(analysisType, genre, customInstructions);

    res.json({
      success: true,
      message: 'Custom detailed prompt built successfully',
      prompt: builtPrompt,
      promptLength: builtPrompt.length,
      parameters: {
        analysisType,
        genre,
        hasCustomInstructions: !!customInstructions
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to build custom prompt',
      details: error.message
    });
  }
});

// 📋 UTILITY: Get available genre templates
app.get('/api/get-genre-templates', (req, res) => {
  try {
    const availableGenres = getAvailableGenres();
    
    const templates = availableGenres.map(genre => ({
      id: genre,
      name: genre.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' '),
      description: DETAILED_GENRE_TEMPLATES[genre].substring(0, 200) + '...'
    }));

    res.json({
      success: true,
      message: 'Available genre templates retrieved',
      templates: templates,
      count: templates.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get genre templates',
      details: error.message
    });
  }
});

// ➕ UTILITY: Add new genre template
app.post('/api/add-genre-template', async (req, res) => {
  try {
    const { genreId, template, overwrite = false } = req.body;

    if (!genreId || !template) {
      return res.status(400).json({
        success: false,
        error: 'Genre ID and template are required'
      });
    }

    // Check if genre already exists
    if (DETAILED_GENRE_TEMPLATES[genreId] && !overwrite) {
      return res.status(400).json({
        success: false,
        error: 'Genre template already exists. Set overwrite=true to replace.',
        existingGenre: genreId
      });
    }

    addGenreTemplate(genreId, template);

    res.json({
      success: true,
      message: `Genre template '${genreId}' added successfully`,
      genreId: genreId,
      templateLength: template.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add genre template',
      details: error.message
    });
  }
});

// 🧪 TESTING: Test different detail levels
app.post('/api/test-detail-levels', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log('🧪 Testing different detail levels...');

    const testPrompts = {
      basic: '',
      detailed: 'Provide detailed music analysis with specific instruments and production techniques.',
      ultra: 'Use ultra-detailed analysis'
    };

    const results = {};

    for (const [level, prompt] of Object.entries(testPrompts)) {
      try {
        console.log(`Testing ${level} level...`);
        
        const options = {
          customPrompt: prompt,
          detailLevel: level === 'ultra' ? 'ultra' : level,
          genre: level === 'ultra' ? 'cinematic-orchestral' : null
        };

        const result = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, options);
        
        results[level] = {
          success: result.success,
          length: result.analysis?.length || 0,
          processingTime: result.processingTime,
          preview: result.analysis?.substring(0, 200) + '...' || 'No analysis'
        };

      } catch (error) {
        results[level] = { 
          success: false, 
          error: error.message 
        };
      }
    }

    res.json({
      success: true,
      message: 'Detail level testing completed',
      results: results,
      comparison: {
        basic_length: results.basic?.length || 0,
        detailed_length: results.detailed?.length || 0,
        ultra_length: results.ultra?.length || 0
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to test detail levels',
      details: error.message
    });
  }
});

// 🎯 EXAMPLE: Get example of ultra-detailed analysis
app.get('/api/get-example-analysis', (req, res) => {
  try {
    const exampleAnalysis = `
F minor, ≈115 BPM, synthwave / cyberpunk / electronic-noir hybrid. Opens with distant digital rain (8-bit processed white noise) and vintage console startup beeps. A Yamaha DX7 electric piano lays down a melancholic four-chord progression (Fm - Ab - Bb - Cm) in staccato eighth notes, soon joined by a Roland TR-808 kick pattern and compressed snare hits with gated reverb. Analog Moog bass (Sub 37) provides a pulsing foundation with side-chain compression synced to the kick, while arpeggiated sequences from a Prophet-5 shimmer in the upper register with chorus and analog delay.

At 0:45, a vocoder-processed lead melody enters (talk-box style), singing a haunting theme drenched in plate reverb and tape echo—evoking neon-lit cityscapes and digital isolation. Subtle glitch percussion (chopped vocal samples, vinyl scratches) adds textural complexity as the arrangement builds.

Mid-section (1:30) intensifies: the bass drops an octave to sub-bass frequencies, while layered pad textures (Juno-106 strings with ensemble effect) create harmonic density. A distorted lead guitar (Stratocaster through a tube screamer into a Roland JC-120) cuts through with sustained power chords, creating tension against the electronic elements. Police radio static and distant sirens fade in and out, underlining the cyberpunk narrative.

Climax (2:15) modulates to Ab major as warm analog strings (Solina String Ensemble) blossom beneath a soaring lead synthesizer (Minimoog Model D) that climbs two octaves in a triumphant melody. The drum programming opens up with live-sounding fills, and all elements reach maximum intensity before gradually stripping back to the original DX7 piano, now accompanied by soft digital wind sounds and the distant hum of a sleeping city—perfectly supporting a lone hacker's journey through digital landscapes toward an uncertain but hopeful dawn.
`;

    const analysisBreakdown = {
      technicalElements: [
        'Specific key and BPM (F minor, ≈115 BPM)',
        'Genre fusion (synthwave / cyberpunk / electronic-noir)',
        'Exact instrument models (Yamaha DX7, Roland TR-808, Moog Sub 37)',
        'Technical production details (side-chain compression, gated reverb)',
        'Specific effects (plate reverb, tape echo, chorus, analog delay)'
      ],
      poeticElements: [
        'Environmental scene-setting (digital rain, neon-lit cityscapes)',
        'Emotional narrative (melancholic, haunting, digital isolation)',
        'Visual metaphors (cyberpunk narrative, lone hacker journey)',
        'Temporal structure with timestamps',
        'Character arc (journey toward hopeful dawn)'
      ],
      adaptableToAnyGenre: [
        'The structure works for ANY genre (just change instruments/effects)',
        'Poetic language can describe any musical style',
        'Technical precision applies to all genres',
        'Temporal markers work for any composition',
        'Narrative connection adapts to any video content'
      ]
    };

    res.json({
      success: true,
      message: 'Example ultra-detailed analysis',
      exampleAnalysis: exampleAnalysis,
      analysisBreakdown: analysisBreakdown,
      adaptabilityNotes: [
        'This example shows synthwave/cyberpunk style',
        'The same detailed approach works for ANY genre',
        'Just change: instruments, effects, cultural context, and imagery',
        'Always maintain: technical precision + poetic language + temporal structure'
      ]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get example analysis',
      details: error.message
    });
  }
});
// 🚨 NEW: Analyze uploaded video with Gemini for music generation

const { generateMusicWithMusicGPT } = require('./musicgpt-utils'); // Make sure this function exists

app.post('/api/analyze-video-for-music', async (req, res) => {
  try {
    const { 
      gcsUrl, 
      publicUrl, 
      customPrompt, 
      analysisType = 'full', 
      genre = null, 
      detailLevel = 'detailed' 
    } = req.body;

    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL or public URL provided'
      });
    }

    const videoUrl = publicUrl || gcsUrl;

    console.log('🌐 Gemini video analysis starting...');
    const options = { customPrompt, genre, analysisType, detailLevel };
    const analysisResult = await analyzeVideoFromGCS(videoUrl, options);

    if (!analysisResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Gemini analysis failed',
        details: analysisResult
      });
    }

    console.log('✅ Gemini analysis complete. Starting MusicGPT generation...');

    const musicResult = await generateMusicWithMusicGPT({
      prompt: analysisResult.analysis,
      genre: analysisResult.genre || genre || 'cinematic',
      videoUrl
    });

    if (!musicResult.success) {
      return res.status(500).json({
        success: false,
        error: 'MusicGPT generation failed',
        analysis: analysisResult.analysis
      });
    }

    console.log('🎵 Music generated by MusicGPT!');
    console.log('🔗 Music URL:', musicResult.audioUrl);

    res.json({
      success: true,
      message: 'Gemini + MusicGPT pipeline complete!',
      analysis: analysisResult.analysis,
      processingTime: analysisResult.processingTime,
      music: {
        audioUrl: musicResult.audioUrl,
        duration: musicResult.duration,
        trackId: musicResult.trackId || null
      },
      videoUrl
    });

  } catch (err) {
    console.error('❌ Error in /api/analyze-video-for-music:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Unknown error during Gemini + MusicGPT flow'
    });
  }
});


// ✅ NEW: Make GCS file public endpoint (if needed)
app.post('/api/make-gcs-public', async (req, res) => {
  try {
    const { gcsUrl, fileName } = req.body;
    
    if (!gcsUrl && !fileName) {
      return res.status(400).json({
        success: false,
        error: 'Either gcsUrl or fileName must be provided'
      });
    }

    console.log('🌍 Making GCS file public...');
    
    const { makeFilePublic, extractFileNameFromUrl } = require('./gcs-utils');
    
    const fileNameToUse = fileName || extractFileNameFromUrl(gcsUrl);
    const publicUrl = await makeFilePublic(fileNameToUse);
    
    console.log('✅ File made public:', fileNameToUse);
    
    res.json({
      success: true,
      publicUrl: publicUrl,
      fileName: fileNameToUse,
      message: 'File is now publicly accessible'
    });

  } catch (error) {
    console.error('❌ Error making file public:', error);
    
    // Check if it's a permissions error
    if (error.message.includes('Permission')) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to make file public',
        details: 'The service account may not have Storage Admin permissions',
        suggestion: 'Add Storage Admin or Storage Legacy Bucket Writer role to the service account'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to make file public',
        details: error.message
      });
    }
  }
});

// 🚨 NEW: Analyze video from GCS URL with Gemini
// ✅ REPLACE your existing /api/analyze-gcs-video-for-music endpoint with this:
// REPLACE your existing /api/analyze-gcs-video-for-music endpoint in index.js with this FIXED version:
// ===============================================
// COMPLETE GEMINI + MUSICGPT INTEGRATION
// ===============================================

// 1. UPDATED BACKEND ENDPOINT (index.js)
// Replace your existing /api/analyze-gcs-video-for-music endpoint with this enhanced version:

// ✅ REPLACE your existing /api/analyze-gcs-video-for-music-with-generation endpoint with this enhanced version
// ===============================================
// WEBHOOK MONITORING UTILITY FUNCTIONS
// Add these functions to your index.js file
// ===============================================

/**
 * Fetch webhook.site data and parse MusicGPT responses
 * @param {string} webhookToken - The webhook.site token
 * @param {number} maxRetries - Maximum number of polling attempts
 * @param {number} pollInterval - Interval between polls in milliseconds
 * @param {number} minRequests - Minimum number of POST requests to wait for (default: 3)
 * @returns {Promise<Object>} - The webhook data or null if not found
 */
// 🚨 REPLACE your existing monitorWebhookForMusicGPT function in index.js with this FIXED version:

// ✅ REPLACE your existing monitorWebhookForMusicGPT function with this enhanced version
// This version will display final timing recommendations at the end

async function monitorWebhookForMusicGPT(webhookToken, maxRetries = 30, pollInterval = 10000, minRequests = 3) {
  console.log('📡 ===============================================');
  console.log('📡 STARTING ENHANCED WEBHOOK MONITORING FOR MUSICGPT');
  console.log('📡 ===============================================');
  console.log('🔗 Webhook Token:', webhookToken);
  console.log('🔄 Max retries:', maxRetries);
  console.log('⏰ Poll interval:', pollInterval / 1000, 'seconds');
  console.log('📊 Waiting for', minRequests, 'NEW POST requests');
  
  const webhookApiUrl = `https://webhook.site/token/${webhookToken}/requests`;
  let seenRequestUuids = new Set();
  let newMusicGPTRequests = [];
  
  // Get baseline requests to mark as seen
  console.log('\n🔍 Getting baseline requests...');
  try {
    const baselineResponse = await axios.get(webhookApiUrl, {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ClipTune-Webhook-Monitor/1.0'
      }
    });
    
    if (baselineResponse.data && baselineResponse.data.data) {
      baselineResponse.data.data.forEach(request => {
        seenRequestUuids.add(request.uuid);
      });
      console.log('✅ Marked', seenRequestUuids.size, 'existing requests as seen');
    }
  } catch (error) {
    console.log('⚠️ Could not get baseline requests:', error.message);
  }
  
  console.log('\n📡 Starting monitoring for NEW requests...');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`\n🔍 Poll ${attempt}/${maxRetries} - Checking for NEW requests...`);
      
      const response = await axios.get(webhookApiUrl, {
        timeout: 15000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ClipTune-Webhook-Monitor/1.0'
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
          console.log(`🆕 Found ${newPostRequests.length} NEW POST request(s)!`);
          
          // Process each NEW request
          for (const request of newPostRequests) {
            try {
              const content = JSON.parse(request.content);
              
              // Enhanced MusicGPT response detection
              const isMusicGPTResponse = content.conversion_path || 
                                        content.audio_url || 
                                        content.task_id || 
                                        content.conversion_id ||
                                        content.success !== undefined ||
                                        content.conversion_duration ||
                                        content.title ||
                                        content.lyrics !== undefined;
              
              if (isMusicGPTResponse) {
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
                console.log('📅 Time:', request.created_at);
                console.log('🔗 UUID:', request.uuid);
                console.log('📊 Size:', request.size, 'bytes');
                
                // Enhanced content logging
                console.log('\n📄 REQUEST CONTENT:');
                console.log('='.repeat(60));
                console.log(JSON.stringify(content, null, 2));
                console.log('='.repeat(60));
                
                // Extract and log MP3 URLs immediately
                console.log('\n🎵 AUDIO URL EXTRACTION:');
                const mp3Url = content.conversion_path || content.audio_url;
                const wavUrl = content.conversion_path_wav;
                const duration = content.conversion_duration;
                const title = content.title;
                
                if (mp3Url) {
                  console.log('🎵 ✅ MP3 URL FOUND:', mp3Url);
                } else {
                  console.log('🎵 ❌ NO MP3 URL in this request');
                }
                
                if (wavUrl) {
                  console.log('🎵 ✅ WAV URL FOUND:', wavUrl);
                }
                
                if (duration) {
                  console.log('⏱️ Duration:', duration, 'seconds');
                }
                
                if (title) {
                  console.log('🎼 Title:', title);
                }
                
                console.log(`⏳ Progress: ${newMusicGPTRequests.length}/${minRequests} NEW requests`);
                
                // Check if we have enough requests
                if (newMusicGPTRequests.length >= minRequests) {
                  console.log(`\n🎯 ===============================================`);
                  console.log(`🎯 COLLECTED ${minRequests} NEW REQUESTS!`);
                  console.log(`🎯 ===============================================`);
                  
                  // Find the BEST request with MP3 URL
                  const requestWithMP3 = newMusicGPTRequests.find(req => 
                    req.content.conversion_path || req.content.audio_url
                  );
                  
                  const finalRequest = requestWithMP3 || newMusicGPTRequests[newMusicGPTRequests.length - 1];
                  
                  console.log('\n📋 FINAL REQUEST SELECTION:');
                  console.log('📋 ===============================================');
                  console.log('🎯 Selected request UUID:', finalRequest.requestInfo.uuid);
                  console.log('🎵 Has MP3 URL:', !!(finalRequest.content.conversion_path || finalRequest.content.audio_url));
                  console.log('📅 Timestamp:', finalRequest.requestInfo.timestamp);
                  
                  if (finalRequest.content.conversion_path) {
                    console.log('🔗 MP3 URL:', finalRequest.content.conversion_path);
                  }
                  if (finalRequest.content.conversion_path_wav) {
                    console.log('🔗 WAV URL:', finalRequest.content.conversion_path_wav);
                  }
                  
                  console.log('📋 ===============================================');
                  
                  // ✅ NEW: Extract MP3 files and create timing recommendations
                  const mp3Files = extractMP3FilesFromRequests(newMusicGPTRequests);
                  
                  return {
                    success: true,
                    webhookData: finalRequest.content,
                    requestInfo: finalRequest.requestInfo,
                    attempt: attempt,
                    totalPolls: attempt,
                    allRequests: newMusicGPTRequests,
                    totalRequestsFound: newMusicGPTRequests.length,
                    onlyNewRequests: true,
                    mp3Files: mp3Files
                  };
                }
              } else {
                console.log('⚠️ Non-MusicGPT request detected, skipping');
              }
            } catch (parseError) {
              console.log('⚠️ Could not parse request content:', parseError.message);
            }
          }
        } else {
          console.log('📭 No NEW requests found');
        }
      } else {
        console.log('📭 No requests at all');
      }
      
      if (attempt < maxRetries) {
        console.log(`⏳ Waiting ${pollInterval / 1000}s for next check... (${newMusicGPTRequests.length}/${minRequests})`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
    } catch (error) {
      console.error(`❌ Webhook polling error (attempt ${attempt}):`, error.message);
      
      if (attempt < maxRetries) {
        console.log(`🔄 Retrying in ${pollInterval / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }
  
  console.log('\n⏰ ===============================================');
  console.log('⏰ WEBHOOK MONITORING TIMEOUT');
  console.log('⏰ ===============================================');
  console.log(`❌ Only collected ${newMusicGPTRequests.length}/${minRequests} requests`);
  
  // ✅ ENHANCED: Even on timeout, show what we collected
  if (newMusicGPTRequests.length > 0) {
    const mp3Files = extractMP3FilesFromRequests(newMusicGPTRequests);
    console.log(`🎵 Partial collection: ${mp3Files.length} MP3 files found`);
    
    if (mp3Files.length > 0) {
      console.log('\n🎵 PARTIAL MP3 COLLECTION:');
      mp3Files.forEach((mp3, index) => {
        console.log(`${index + 1}. "${mp3.title}" - ${mp3.url}`);
      });
    }
  }
  
  return {
    success: false,
    error: 'Webhook monitoring timeout',
    totalPolls: maxRetries,
    partialRequests: newMusicGPTRequests,
    mp3Files: extractMP3FilesFromRequests(newMusicGPTRequests)
  };
}

// ✅ ENHANCED: Update your extractMP3FilesFromRequests function to include more metadata
function extractMP3FilesFromRequests(requests) {
  const mp3Files = [];
  
  console.log('\n🎵 ===============================================');
  console.log('🎵 EXTRACTING MP3 FILES FROM WEBHOOK REQUESTS');
  console.log('🎵 ===============================================');
  
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
        // ✅ NEW: Add timing metadata for full video coverage
        suggestedStartTime: 0,
        suggestedEndTime: null, // Will be set to video duration
        placementType: 'FULL_VIDEO_BACKGROUND'
      };
      
      mp3Files.push(mp3File);
      
      console.log(`🎵 Extracted MP3 #${index + 1}:`);
      console.log(`   🎼 Title: "${mp3File.title}"`);
      console.log(`   🔗 URL: ${mp3File.url}`);
      console.log(`   ⏱️ Duration: ${mp3File.mp3Duration || 'Unknown'} seconds`);
      console.log(`   📅 Generated: ${mp3File.timestamp}`);
      console.log(`   🎯 Suggested Placement: Full video background (0s to end)`);
      console.log('   ---');
    }
  });
  
  console.log(`📊 Total MP3 files extracted: ${mp3Files.length}`);
  console.log('🎵 ===============================================\n');
  
  return mp3Files;
}

// ✅ ADD this function to your main endpoint's success section
// Insert this right before your final res.json() response:

function displayWebhookTimingResults(musicResult, videoDurationSeconds) {
  if (!musicResult || !musicResult.allMP3Files) {
    console.log('⚠️ No music result or MP3 files to display timing for');
    return;
  }

  console.log('\n🎼 ===============================================');
  console.log('🎼 FINAL WEBHOOK TIMING RECOMMENDATIONS');
  console.log('🎼 ===============================================');
  console.log(`🎬 Video Duration: ${videoDurationSeconds} seconds`);
  console.log(`🎵 Total Tracks Generated: ${musicResult.allMP3Files.length}`);
  console.log('📋 All tracks will cover the COMPLETE video duration');
  
  console.log('\n📊 TRACK TIMING DETAILS:');
  console.log('📊 ===============================================');

  musicResult.allMP3Files.forEach((track, index) => {
    const trackNumber = index + 1;
    const startTime = 0;
    const endTime = videoDurationSeconds;
    
    console.log(`\n🎵 TRACK ${trackNumber}: "${track.title}"`);
    console.log('🎵 ===============================================');
    console.log(`📍 START TIME: ${startTime} seconds`);
    console.log(`🏁 END TIME: ${endTime} seconds`);
    console.log(`⏱️ DURATION: ${endTime - startTime} seconds (FULL VIDEO)`);
    console.log(`🎼 SONG NAME: "${track.title}"`);
    console.log(`🔗 MP3 URL: ${track.url}`);
    console.log(`🎵 ORIGINAL MP3 LENGTH: ${track.mp3Duration || 'Unknown'} seconds`);
    console.log(`📅 GENERATED AT: ${track.timestamp}`);
    console.log(`🎯 PLACEMENT: Full video background music`);
    console.log(`✅ COVERAGE: Complete ${videoDurationSeconds}s video duration`);
    console.log('🎵 ===============================================');
  });

  console.log('\n📋 QUICK REFERENCE - COPY THIS:');
  console.log('📋 ===============================================');
  musicResult.allMP3Files.forEach((track, index) => {
    console.log(`Track ${index + 1}: "${track.title}" | 0s-${videoDurationSeconds}s | ${track.url}`);
  });
  console.log('📋 ===============================================');
  
  console.log('\n🎼 ===============================================');
  console.log('🎼 END OF WEBHOOK TIMING RECOMMENDATIONS');
  console.log('🎼 ===============================================\n');
}

// ✅ IN YOUR MAIN ENDPOINT: Add this right before res.json():
/*
    // Just before your res.json() call, add:
    
    // Display webhook timing results if available
    if (musicResult?.status === 'completed_via_webhook' && musicResult.allMP3Files) {
      displayWebhookTimingResults(musicResult, videoDurationSeconds);
    }
    
    // Then your existing res.json()...
*/

// 🚨 NEW: Extract MP3 files from webhook requests
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
      
      console.log(`🎵 Extracted MP3 #${index + 1}: ${content.title || 'Untitled'}`);
      console.log(`   URL: ${mp3Url}`);
      console.log(`   Duration: ${content.conversion_duration || 'Unknown'}s`);
    }
  });
  
  console.log(`📊 Total MP3 files extracted: ${mp3Files.length}`);
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
// 🚨 REPLACE your existing extractTimingFromAnalysis function in index.js with this FIXED version:

// ✅ CRITICAL FIX: Replace your existing extractTimingFromAnalysis function in index.js with this:

// ✅ FIXED VERSION - Replace the extractTimingFromAnalysis function in your index.js
// ✅ REPLACE your extractTimingFromAnalysis function with this enhanced version
// This version extracts the ACTUAL start/end times from Gemini's analysis




// ✅ IN YOUR MAIN ENDPOINT: Replace the existing timing display with this simple version
// Find this section in your /api/analyze-gcs-video-for-music-with-generation endpoint:

/*
    // Display final timing recommendations summary
    if (musicResult?.geminiTimingRecommendations && musicResult.geminiTimingRecommendations.length > 0) {
      displayFinalTimingSummary(musicResult.geminiTimingRecommendations, videoDurationSeconds);
    } else if (musicResult?.allMP3Files && musicResult.allMP3Files.length > 0) {
      // ... existing code ...
    }
*/

// ✅ REPLACE it with this simpler version:

    // Show ONLY the final Gemini timing at the very end
    
// ✅ ADD this function to display final timing summary


// ✅ ADD this function to display webhook timing results
function displayWebhookTimingResults(musicResult, videoDurationSeconds) {
  if (!musicResult || !musicResult.allMP3Files) {
    console.log('⚠️ No music result or MP3 files to display timing for');
    return;
  }

  console.log('\n🎼 ===============================================');
  console.log('🎼 FINAL WEBHOOK TIMING RECOMMENDATIONS');
  console.log('🎼 ===============================================');
  console.log(`🎬 Video Duration: ${videoDurationSeconds} seconds`);
  console.log(`🎵 Total Tracks Generated: ${musicResult.allMP3Files.length}`);
  console.log('📋 All tracks will cover the COMPLETE video duration');
  
  console.log('\n📊 TRACK TIMING DETAILS:');
  console.log('📊 ===============================================');

  musicResult.allMP3Files.forEach((track, index) => {
    const trackNumber = index + 1;
    const startTime = 0;
    const endTime = videoDurationSeconds;
    
    console.log(`\n🎵 TRACK ${trackNumber}: "${track.title}"`);
    console.log('🎵 ===============================================');
    console.log(`📍 START TIME: ${startTime} seconds`);
    console.log(`🏁 END TIME: ${endTime} seconds`);
    console.log(`⏱️ DURATION: ${endTime - startTime} seconds (FULL VIDEO)`);
    console.log(`🎼 SONG NAME: "${track.title}"`);
    console.log(`🔗 MP3 URL: ${track.url}`);
    console.log(`🎵 ORIGINAL MP3 LENGTH: ${track.mp3Duration || 'Unknown'} seconds`);
    console.log(`📅 GENERATED AT: ${track.timestamp}`);
    console.log(`🎯 PLACEMENT: Full video background music`);
    console.log(`✅ COVERAGE: Complete ${videoDurationSeconds}s video duration`);
    console.log('🎵 ===============================================');
  });

  console.log('\n📋 QUICK REFERENCE - COPY THIS:');
  console.log('📋 ===============================================');
  musicResult.allMP3Files.forEach((track, index) => {
    console.log(`Track ${index + 1}: "${track.title}" | 0s-${videoDurationSeconds}s | ${track.url}`);
  });
  console.log('📋 ===============================================');
  
  console.log('\n🎼 ===============================================');
  console.log('🎼 END OF WEBHOOK TIMING RECOMMENDATIONS');
  console.log('🎼 ===============================================\n');
}
// ===============================================
// ENHANCED ENDPOINT - REPLACE YOUR EXISTING ONE
// ===============================================
// Add this endpoint to your index.js file

// 🎬 NEW: Analyze video for optimal music placement segments
app.post('/api/analyze-video-music-segments', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { customPrompt = '' } = req.body;

    console.log('🎬 ===============================================');
    console.log('🎬 VIDEO MUSIC SEGMENTATION ANALYSIS REQUEST');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('📝 Custom prompt:', customPrompt || 'None provided');

    // Import the music segmentation function
    const { analyzeVideoForMusicSegments } = require('./gemini-utils');

    // Analyze video for music segments
    const segmentationResult = await analyzeVideoForMusicSegments(
      req.file.buffer, 
      req.file.mimetype, 
      { customPrompt }
    );

    if (segmentationResult.success) {
      console.log('\n🎉 ===============================================');
      console.log('🎉 MUSIC SEGMENTATION ANALYSIS COMPLETED');
      console.log('🎉 ===============================================');
      console.log('📊 Total music segments found:', segmentationResult.totalSegments);
      console.log('⏱️ Processing time:', segmentationResult.processingTime);
      
      // Log segment summary
      if (segmentationResult.musicSegments.length > 0) {
        console.log('\n📋 SEGMENT SUMMARY:');
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
      console.error('❌ Music segmentation analysis failed:', segmentationResult.error);
      
      res.status(500).json({
        success: false,
        error: segmentationResult.error,
        details: segmentationResult.details,
        rawGeminiResponse: segmentationResult.rawResponse
      });
    }

  } catch (error) {
    console.error('❌ Error in music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform video music segmentation analysis',
      details: error.message
    });
  }
});

// 🌐 NEW: Analyze GCS video for music segments
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

    console.log('🌐 ===============================================');
    console.log('🌐 GCS VIDEO MUSIC SEGMENTATION ANALYSIS REQUEST');
    console.log('🌐 ===============================================');
    console.log('🔗 Video URL:', videoUrl);
    console.log('📝 Custom prompt:', customPrompt || 'None provided');

    // Import the GCS music segmentation function
    const { analyzeGCSVideoForMusicSegments } = require('./gemini-utils');

    // Analyze GCS video for music segments
    const segmentationResult = await analyzeGCSVideoForMusicSegments(videoUrl, { customPrompt });

    if (segmentationResult.success) {
      console.log('\n🎉 ===============================================');
      console.log('🎉 GCS MUSIC SEGMENTATION ANALYSIS COMPLETED');
      console.log('🎉 ===============================================');
      console.log('📊 Total music segments found:', segmentationResult.totalSegments);
      console.log('⏱️ Processing time:', segmentationResult.processingTime);
      console.log('📁 Source file:', segmentationResult.sourceFile);

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
      console.error('❌ GCS music segmentation analysis failed:', segmentationResult.error);
      
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
    console.error('❌ Error in GCS music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform GCS video music segmentation analysis',
      details: error.message
    });
  }
});

// 🧪 NEW: Test music segmentation with sample video
app.post('/api/test-music-segmentation', async (req, res) => {
  try {
    const { testPrompt = '' } = req.body;

    console.log('🧪 ===============================================');
    console.log('🧪 TESTING MUSIC SEGMENTATION FUNCTIONALITY');
    console.log('🧪 ===============================================');

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
    console.error('❌ Error in test music segmentation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Test endpoint error',
      details: error.message
    });
  }
});
// Find and REPLACE your existing /api/analyze-gcs-video-for-music-with-generation endpoint with this:
// REPLACE your existing /api/analyze-gcs-video-for-music-with-generation endpoint with this enhanced version
// ✅ CORRECT ORDER: Dual Analysis → Main Music + Webhook → Segmentation → Segment Music → Final Analysis

// ✅ COMPLETE /api/analyze-gcs-video-for-music-with-generation ENDPOINT
// Replace your existing endpoint with this complete version

app.post('/api/analyze-gcs-video-for-music-with-generation', async (req, res) => {
  try {
    const { 
      gcsUrl, 
      publicUrl, 
      customPrompt = '', 
      analysisType = 'full',
      genre = null,
      detailLevel = 'detailed',
      generateMusic = true,
      enableWebhookMonitoring = true,  
      maxPollMinutes = 5               
    } = req.body;

    if (!gcsUrl && !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL or public URL provided'
      });
    }

    const videoUrl = publicUrl || gcsUrl;

    console.log('🎬 ===============================================');
    console.log('🎬 ENHANCED GEMINI → MUSICGPT WITH WEBHOOK MONITORING');
    console.log('🎬 ===============================================');
    console.log('📁 Video URL:', videoUrl);
    console.log('🎯 Generate Music:', generateMusic);
    console.log('📡 Webhook Monitoring:', enableWebhookMonitoring);
    console.log('⏰ Max Poll Time:', maxPollMinutes, 'minutes');

    // STEP 1: Download and analyze video with Gemini for dual outputs
    console.log('\n1️⃣ ===============================================');
    console.log('1️⃣ ANALYZING VIDEO FOR DUAL 280-CHAR OUTPUTS');
    console.log('1️⃣ ===============================================');

    const { analyzeVideoForDualMusicOutputs } = require('./gemini-utils');
    const { extractFileNameFromUrl, getSignedDownloadUrl } = require('./gcs-utils');
    
    // Download video buffer
    const fileName = extractFileNameFromUrl(videoUrl);
    console.log('📁 Downloading video:', fileName);
    
    let videoBuffer;
    let videoDurationSeconds = 0;
    
    if (videoUrl.includes('storage.googleapis.com') && videoUrl.includes('X-Goog-Algorithm')) {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      videoBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      const signedUrl = await getSignedDownloadUrl(fileName, 1);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      videoBuffer = Buffer.from(await response.arrayBuffer());
    }

    console.log('📊 Video downloaded:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    
    // Get video duration
    try {
      const tempVideoPath = path.join(__dirname, 'temp_videos', `temp_analysis_${Date.now()}.mp4`);
      await fsPromises.writeFile(tempVideoPath, videoBuffer);
      
      videoDurationSeconds = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempVideoPath, (err, metadata) => {
          if (err) {
            console.warn('⚠️ Could not get video duration with ffprobe:', err.message);
            reject(err);
          } else {
            const duration = metadata.format.duration;
            console.log('⏱️ Video duration detected:', duration, 'seconds');
            resolve(Math.round(duration * 100) / 100);
          }
        });
      }).catch(async (error) => {
        console.warn('⚠️ FFprobe failed, trying alternative method:', error.message);
        
        try {
          const { getVideoDurationInSeconds } = require('get-video-duration');
          const duration = await getVideoDurationInSeconds(tempVideoPath);
          console.log('⏱️ Video duration detected (alternative method):', duration, 'seconds');
          return Math.round(duration * 100) / 100;
        } catch (altError) {
          console.warn('⚠️ Alternative duration detection failed:', altError.message);
          return 120; // Default to 2 minutes if all methods fail
        }
      });
      
      await fsPromises.unlink(tempVideoPath).catch(() => {});
      
    } catch (durationError) {
      console.error('❌ Error detecting video duration:', durationError.message);
      videoDurationSeconds = 120; // Default fallback to 2 minutes
    }
    
    console.log('📏 Final video duration:', videoDurationSeconds, 'seconds');

    // Analyze video for dual outputs
    const dualAnalysisResult = await analyzeVideoForDualMusicOutputs(videoBuffer, 'video/mp4', {
      customPrompt: customPrompt + `
      
FOCUS ON MUSICAL TERMINOLOGY:
Include specific terms like: BPM, key signatures, time signatures, dynamics (pp, ff), articulations (legato, staccato), intervals (octaves, 5ths), scales (major, minor, dorian), chord types (maj7, min9), orchestration details, playing techniques (pizzicato, tremolo), tempo markings (andante, allegro), and instrument specifics.

Generate TWO separate 280-character outputs with maximum musical detail.`
    });

    if (!dualAnalysisResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Dual output analysis failed',
        details: dualAnalysisResult.error
      });
    }

    console.log('✅ Dual output analysis completed successfully');
    console.log('📄 Raw analysis length:', dualAnalysisResult.rawAnalysis.length, 'characters');
    
    console.log('\n📝 EXTRACTED DUAL OUTPUTS:');
    console.log('='.repeat(80));
    console.log('🎵 PROMPT (', dualAnalysisResult.prompt.length, 'chars):');
    console.log(dualAnalysisResult.prompt);
    console.log('-'.repeat(40));
    console.log('🎭 MUSIC_STYLE (', dualAnalysisResult.music_style.length, 'chars):');
    console.log(dualAnalysisResult.music_style);
    console.log('='.repeat(80));

    let musicResult = null;

    if (generateMusic) {
      // STEP 2: Send dual outputs to MusicGPT with webhook monitoring
      console.log('\n2️⃣ ===============================================');
      console.log('2️⃣ SENDING TO MUSICGPT WITH WEBHOOK MONITORING');
      console.log('2️⃣ ===============================================');

      try {
        const webhookUrl = "https://webhook.site/f2c35c82-ceef-4c9c-8b38-94ea6d8030ca";
        const webhookToken = extractWebhookToken(webhookUrl);
        
        console.log('📡 Webhook URL:', webhookUrl);
        console.log('🔑 Webhook Token:', webhookToken);

        const musicgptPayload = {
          prompt: dualAnalysisResult.prompt,
          music_style: dualAnalysisResult.music_style,
          make_instrumental: true,
          vocal_only: false,
          webhook_url: webhookUrl
        };

        console.log('📤 MusicGPT Payload:');
        console.log('🎵 Prompt:', dualAnalysisResult.prompt);
        console.log('🎭 Music Style:', dualAnalysisResult.music_style);
        console.log('🎼 Make Instrumental:', true);
        console.log('📡 Webhook URL:', webhookUrl);

        const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

        console.log('📤 Calling MusicGPT API...');
        
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

        console.log('✅ MusicGPT API Response:');
        console.log('📊 Status:', musicgptResponse.status);
        console.log('📄 Response:', JSON.stringify(musicgptResponse.data, null, 2));

        const musicData = musicgptResponse.data;

        if (musicData.audio_url) {
          console.log('\n🎉 MUSIC GENERATED IMMEDIATELY!');
          console.log('🔗 Audio URL:', musicData.audio_url);
          
          musicResult = {
            success: true,
            status: 'completed_immediately',
            music: musicData,
            audio_url: musicData.audio_url,
            processingTime: musicgptProcessingTime + 's'
          };
          
        } else if (musicData.task_id || musicData.conversion_id || musicData.conversion_id_1) {
          const taskId = musicData.task_id || musicData.conversion_id_1 || musicData.conversion_id;
          
          console.log('🔄 MusicGPT generation started - beginning webhook monitoring...');
          console.log('🆔 Task ID:', taskId);
          console.log('⏰ ETA:', musicData.eta || 120, 'seconds');
          
          if (enableWebhookMonitoring && webhookToken) {
            console.log('\n📡 ===============================================');
            console.log('📡 STARTING REAL-TIME WEBHOOK MONITORING');
            console.log('📡 ===============================================');
            
            const maxRetries = Math.floor((maxPollMinutes * 60) / 10);
            const minRequestsToWaitFor = 3;
            const webhookResult = await monitorWebhookForMusicGPT(webhookToken, maxRetries, 10000, minRequestsToWaitFor);
            
            if (webhookResult.success) {
              console.log('\n🎉 ===============================================');
              console.log('🎉 WEBHOOK MONITORING SUCCESS!');
              console.log('🎉 ===============================================');
              
              const webhookData = webhookResult.webhookData;
              const allRequests = webhookResult.allRequests;
              
              console.log('\n🎵 ===============================================');
              console.log('🎵 EXTRACTING MP3 FILES FROM WEBHOOK DATA');
              console.log('🎵 ===============================================');
              
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
                  console.log(`🎵 MP3 #${index + 1}: ${request.content.conversion_path}`);
                  console.log(`   Title: ${request.content.title || 'Untitled'}`);
                  console.log(`   MP3 Duration: ${request.content.conversion_duration || 'Unknown'}s`);
                  console.log(`   Video Duration: ${videoDurationSeconds}s`);
                }
              });
              
              console.log(`📊 Total MP3 files found: ${mp3Files.length}`);
              
              let timingAnalysis = null;
              if (mp3Files.length >= 2) {
                console.log('\n🧠 ===============================================');
                console.log('🧠 ANALYZING VIDEO + MP3S WITH GEMINI FOR OPTIMAL TIMING');
                console.log('🧠 ===============================================');
                
                try {
                  console.log('📥 Downloading MP3 files for Gemini analysis...');
                  
                  const mp3Buffers = [];
                  for (const mp3File of mp3Files) {
                    try {
                      console.log(`📥 Downloading: ${mp3File.title}`);
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
                      
                      console.log(`✅ Downloaded ${mp3File.title}: ${(mp3Response.data.byteLength / 1024 / 1024).toFixed(2)} MB`);
                      
                    } catch (mp3Error) {
                      console.error(`❌ Failed to download ${mp3File.title}:`, mp3Error.message);
                    }
                  }
                  
                  console.log(`📊 Successfully downloaded ${mp3Buffers.length}/${mp3Files.length} MP3 files`);
                  
                  const { analyzeVideoWithAudioFiles } = require('./gemini-utils');
                  
                  timingAnalysis = await analyzeVideoWithAudioFiles(videoBuffer, 'video/mp4', mp3Buffers, {
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
6. Volume recommendation (0-100%): Based on audio dynamics and video content
7. Fade recommendations: Based on musical structure and video transitions

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
  console.log('✅ Gemini timing analysis completed successfully');
  console.log('📄 Analysis length:', timingAnalysis.analysis.length, 'characters');
  
  console.log('\n🎯 ===============================================');
  console.log('🎯 GEMINI TIMING ANALYSIS RESULTS');
  console.log('🎯 ===============================================');
  console.log(timingAnalysis.analysis);
  console.log('🎯 ===============================================');
  
  // 🚨 NEW: EXTRACT AND DISPLAY START/END TIMES
  console.log('\n🎵 EXTRACTING TIMING FROM GEMINI ANALYSIS...');
  
  const geminiTimingRecommendations = extractTimingFromGeminiAnalysis(
    timingAnalysis.analysis, 
    mp3Files
  );
  
  // Add to your music result for the API response
  musicResult.geminiTimingRecommendations = geminiTimingRecommendations;
  
  // 🎯 DISPLAY EXTRACTED TIMING IN TERMINAL
  displayGeminiTimingResults(geminiTimingRecommendations);
  
} else {
  console.error('❌ Gemini timing analysis failed:', timingAnalysis.error);
}
                  
                } catch (timingError) {
                  console.error('❌ Error in Gemini timing analysis:', timingError.message);
                  timingAnalysis = {
                    success: false,
                    error: timingError.message
                  };
                }
              } else {
                console.log('⚠️ Not enough MP3 files for timing analysis (need at least 2)');
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
                timingAnalysis: timingAnalysis,
       
              };
              
            } else {
              console.log('\n⏰ ===============================================');
              console.log('⏰ WEBHOOK MONITORING TIMEOUT');
              console.log('⏰ ===============================================');
              
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
        console.error('❌ Error in MusicGPT generation:', musicError);
        
        musicResult = {
          success: false,
          status: 'api_error',
          error: musicError.message,
          details: musicError.response?.data || null
        };
      }
    }

    // Final logging and response preparation
    console.log('\n🎊 ===============================================');
    console.log('🎊 ENHANCED WORKFLOW WITH WEBHOOK MONITORING COMPLETE');
    console.log('🎊 ===============================================');
    console.log('✅ Gemini Analysis: COMPLETED');
    console.log('🎵 Music Generation:', musicResult?.status?.toUpperCase() || 'UNKNOWN');
    console.log('📡 Webhook Monitoring:', enableWebhookMonitoring ? 'ENABLED' : 'DISABLED');
    
    if (musicResult?.audio_url) {
      console.log('🔗 FINAL AUDIO URL:', musicResult.audio_url);
    }
    if (musicResult?.audio_url_wav) {
      console.log('🔗 FINAL WAV URL:', musicResult.audio_url_wav);
    }
    if (musicResult?.webhookInfo) {
      console.log('📡 Webhook Attempts:', musicResult.webhookInfo.monitoringAttempts);
      console.log('📊 Total Requests Found:', musicResult.webhookInfo.totalRequestsFound);
    }
    if (musicResult?.allMP3Files) {
      console.log('🎵 MP3 Files Collected:', musicResult.allMP3Files.length);
    }

    // ✅ DISPLAY GEMINI'S ACTUAL TIMING RECOMMENDATIONS AT THE END
  // In your /api/analyze-gcs-video-for-music-with-generation endpoint
// Replace the complex timing display with this:


    console.log('\n🎯 ===============================================');

  } catch (error) {
    console.error('❌ Error in enhanced workflow with webhook monitoring:', error);
    res.status(500).json({
      success: false,
      error: 'Enhanced workflow failed',
      details: error.message
    });
  }
});
// ===============================================
// BONUS: Standalone webhook monitoring endpoint
// ===============================================
// ✅ STEP 1: Add this function to your index.js file (before your endpoints)

function extractTimingFromGeminiAnalysis(analysisText, mp3Files) {
  console.log('\n🎯 ===============================================');
  console.log('🎯 EXTRACTING START AND END TIMES FROM GEMINI');
  console.log('🎯 ===============================================');
  
  if (!analysisText || !mp3Files || mp3Files.length === 0) {
    console.log('❌ No analysis text or MP3 files provided');
    return [];
  }
  
  console.log(`📊 Analyzing text for ${mp3Files.length} MP3 files`);
  console.log(`📄 Analysis length: ${analysisText.length} characters`);
  
  // ✅ WORKING REGEX PATTERN - Extracts start/end time pairs
  const startEndPattern = /\*\s*\*\*Start time:\*\*\s*(\d+(?:\.\d+)?)\s*seconds?[\s\S]*?\*\s*\*\*End time:\*\*\s*(\d+(?:\.\d+)?)\s*seconds?/gi;
  
  let trackMatches = [];
  let match;
  let trackNum = 1;
  
  console.log('\n🔍 Searching for start/end time patterns...');
  
  while ((match = startEndPattern.exec(analysisText)) !== null) {
    const startTime = parseFloat(match[1]);
    const endTime = parseFloat(match[2]);
    
    trackMatches.push({
      trackNumber: trackNum,
      start: startTime,
      end: endTime,
      duration: endTime - startTime,
      source: 'gemini_analysis'
    });
    
    console.log(`✅ Found Track ${trackNum} timing: ${startTime}s - ${endTime}s (${(endTime - startTime).toFixed(2)}s)`);
    trackNum++;
  }
  
  // Map to MP3 files and create recommendations
  const timingRecommendations = [];
  
  mp3Files.forEach((mp3File, index) => {
    const trackNumber = index + 1;
    const timing = trackMatches[index];
    
    if (timing) {
      const recommendation = {
        trackNumber: trackNumber,
        title: mp3File.title || `Track ${trackNumber}`,
        url: mp3File.url,
        originalDuration: mp3File.mp3Duration || 'Unknown',
        
        // 🎯 EXTRACTED TIMING FROM GEMINI
        recommendedStart: timing.start,
        recommendedEnd: timing.end,
        recommendedDuration: timing.duration,
        
        timingSource: 'gemini_extracted',
        extractedSuccessfully: true
      };
      
      timingRecommendations.push(recommendation);
      
    } else {
      // Fallback for tracks without extracted timing
      const fallback = {
        trackNumber: trackNumber,
        title: mp3File.title || `Track ${trackNumber}`,
        url: mp3File.url,
        originalDuration: mp3File.mp3Duration || 'Unknown',
        
        recommendedStart: 0,
        recommendedEnd: mp3File.mp3Duration || 120,
        recommendedDuration: mp3File.mp3Duration || 120,
        
        timingSource: 'fallback',
        extractedSuccessfully: false
      };
      
      timingRecommendations.push(fallback);
      console.log(`❌ No timing found for Track ${trackNumber} - using fallback`);
    }
  });
  
  return timingRecommendations;
}

function displayGeminiTimingResults(timingRecommendations) {
  console.log('\n🎵 ===============================================');
  console.log('🎵 GEMINI TIMING EXTRACTION RESULTS');
  console.log('🎵 ===============================================');
  
  if (!timingRecommendations || timingRecommendations.length === 0) {
    console.log('❌ No timing recommendations available');
    return;
  }
  
  timingRecommendations.forEach((rec) => {
    console.log(`\n🎼 TRACK ${rec.trackNumber}: "${rec.title}"`);
    console.log('🎼 ===============================================');
    console.log(`⏰ START TIME: ${rec.recommendedStart} seconds`);
    console.log(`⏰ END TIME: ${rec.recommendedEnd} seconds`);  
    console.log(`⏱️ RECOMMENDED DURATION: ${rec.recommendedDuration.toFixed(2)} seconds`);
    console.log(`🎵 ORIGINAL MP3 LENGTH: ${rec.originalDuration} seconds`);
    console.log(`🔗 AUDIO URL: ${rec.url}`);
    console.log(`✅ EXTRACTION STATUS: ${rec.extractedSuccessfully ? 'SUCCESS' : 'FALLBACK USED'}`);
    console.log('🎼 ===============================================');
  });
  
  console.log('\n📋 QUICK COPY REFERENCE:');
  console.log('📋 ===============================================');
  timingRecommendations.forEach((rec) => {
    console.log(`Track ${rec.trackNumber}: "${rec.title}" | ${rec.recommendedStart}s-${rec.recommendedEnd}s | ${rec.url}`);
  });
  console.log('📋 ===============================================\n');
}

app.post('/api/monitor-webhook', async (req, res) => {
  try {
    const { 
      webhookUrl = "f2c35c82-ceef-4c9c-8b38-94ea6d8030ca",
      maxPollMinutes = 3,
      pollIntervalSeconds = 10,
      minRequests = 3  // ✅ NEW: Configurable minimum requests to wait for
    } = req.body;

    console.log('📡 Starting standalone webhook monitoring...');
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
      monitoringInfo: {
        totalAttempts: result.totalPolls,
        maxPollMinutes: maxPollMinutes,
        pollIntervalSeconds: pollIntervalSeconds,
        minRequests: minRequests,
        totalRequestsFound: result.totalRequestsFound || 0,
        webhookToken: webhookToken,
        webhookUrl: webhookUrl
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
// ✅ BONUS: Add standalone task checker endpoint
app.post('/api/check-musicgpt-task', async (req, res) => {
  try {
    const { taskId } = req.body;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'No task ID provided'
      });
    }

    console.log('🔍 Checking MusicGPT task:', taskId);

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
    
    console.log('📊 Task status:', taskData.status);
    if (taskData.audio_url) {
      console.log('🎵 Audio URL:', taskData.audio_url);
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
        '🎉 Music is ready!' : 
        `⏳ Status: ${taskData.status || 'processing'}`
    });

  } catch (error) {
    console.error('❌ Error checking MusicGPT task:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to check task status',
      details: error.message
    });
  }
});

// 2. HELPER FUNCTION TO OPTIMIZE GEMINI OUTPUT FOR MUSICGPT
function optimizeGeminiAnalysisForMusicGPT(geminiAnalysis) {
  console.log('🔧 Optimizing Gemini analysis for MusicGPT...');
  
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

  console.log('✅ Analysis optimized for MusicGPT');
  console.log('📏 Original length:', geminiAnalysis.length, 'chars');
  console.log('📏 Optimized length:', optimizedPrompt.length, 'chars');
  console.log('🎵 Musical sentences found:', musicalSentences.length);

  return optimizedPrompt;
}
// ✅ ENHANCED: Add this new endpoint for immediate analysis after upload
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

    console.log('🎬 ===============================================');
    console.log('🎬 UPLOAD + IMMEDIATE GCS ANALYSIS WORKFLOW');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('⏰ Wait for availability:', waitForAvailability);

    // Step 1: Upload to GCS
    console.log('\n1️⃣ Uploading to Google Cloud Storage...');
    
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
    
    console.log('✅ Upload completed in', uploadTime, 'seconds');
    console.log('🔗 GCS URI:', uploadData.gcs_uri);
    console.log('🌐 Signed URL:', uploadData.public_url);

    // Step 2: Wait for file availability (if requested)
    if (waitForAvailability) {
      console.log('\n⏳ Waiting for file to be fully available...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
    }

    // Step 3: Analyze with retry logic
    console.log('\n2️⃣ Starting Gemini analysis with retry logic...');
    
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
        console.log(`🔄 Analysis attempt ${attempt}/${maxRetries}...`);
        
        if (attempt > 1) {
          const delay = 2000 * attempt; // Increasing delay
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        analysisResult = await analyzeVideoFromGCS(uploadData.public_url, options);
        
        if (analysisResult.success) {
          console.log(`✅ Analysis successful on attempt ${attempt}`);
          break;
        } else {
          lastError = analysisResult;
          console.log(`❌ Attempt ${attempt} failed:`, analysisResult.error);
        }
        
      } catch (error) {
        lastError = { 
          success: false, 
          error: error.message, 
          attempt: attempt 
        };
        console.log(`❌ Attempt ${attempt} threw error:`, error.message);
      }
    }

    // Return results
    if (analysisResult && analysisResult.success) {
      console.log('\n✅ ===============================================');
      console.log('✅ UPLOAD + ANALYSIS WORKFLOW COMPLETED');
      console.log('✅ ===============================================');
      console.log('⏱️ Total time: Upload (' + uploadTime + 's) + Analysis (' + analysisResult.processingTime + ')');
      
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
      console.error('\n❌ ===============================================');
      console.error('❌ ANALYSIS FAILED AFTER SUCCESSFUL UPLOAD');
      console.error('❌ ===============================================');
      
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
    console.error('❌ Error in upload + analysis workflow:', error);
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
    console.log('🎵 ===============================================');
    console.log('🎵 GENERATING MUSIC FROM GEMINI ANALYSIS');
    console.log('🎵 ===============================================');
    console.log('📝 Gemini analysis length:', geminiAnalysis.length, 'characters');
    console.log('📝 Analysis preview:', geminiAnalysis.substring(0, 200) + '...');

    const MUSICGPT_API_KEY = 'h4pNTSEuPxiKPKJX3UhYDZompmM5KfVhBSDAy0EHiZ09l13xQcWhxtI2aZf5N66E48yPm2D6fzMMDD96U5uAtA';

    // Use the FULL Gemini analysis as the music_style
    const payload = {
      music_style: geminiAnalysis, // Direct Gemini text here
      webhook_url: "https://httpbin.org/post" // Dummy webhook URL
    };

    console.log('📤 Sending Gemini analysis to MusicGPT...');
    console.log('🔗 API URL: https://api.musicgpt.com/api/public/v1/MusicAI');
    
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

    console.log('✅ ===============================================');
    console.log('✅ MUSICGPT RESPONSE RECEIVED');
    console.log('✅ ===============================================');
    console.log('⏱️ Processing time:', processingTime, 'seconds');
    console.log('📊 Status:', response.status);
    console.log('📄 Full response:', JSON.stringify(response.data, null, 2));

    const musicData = response.data;

    // Check what we got back
    if (musicData.audio_url) {
      console.log('\n🎶 ===============================================');
      console.log('🎶 MUSIC GENERATED SUCCESSFULLY!');
      console.log('🎶 ===============================================');
      console.log('🔗 AUDIO URL:', musicData.audio_url);
      console.log('🎵 Title:', musicData.title || 'Generated from Gemini Analysis');
      console.log('📝 Lyrics:', musicData.lyrics || 'Instrumental');
      console.log('💰 Cost:', musicData.conversion_cost || 'Unknown');
      console.log('🎶 ===============================================');
    } else if (musicData.task_id || musicData.conversion_id) {
      const taskId = musicData.task_id || musicData.conversion_id;
      console.log('\n🔄 ===============================================');
      console.log('🔄 MUSIC GENERATION STARTED');
      console.log('🔄 ===============================================');
      console.log('🆔 Task ID:', taskId);
      console.log('⏳ Generation in progress...');
      console.log('💡 You can poll for results using the task ID');
      console.log('🔄 ===============================================');
    }

    return {
      success: true,
      music: musicData,
      processingTime: processingTime + 's',
      geminiAnalysisUsed: geminiAnalysis.substring(0, 100) + '...'
    };

  } catch (error) {
    console.error('❌ ===============================================');
    console.error('❌ MUSICGPT AI GENERATION ERROR');
    console.error('❌ ===============================================');
    console.error('💥 Error message:', error.message);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📊 Response data:', JSON.stringify(error.response.data, null, 2));
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

    console.log('🎬 ===============================================');
    console.log('🎬 COMPLETE GEMINI → MUSICGPT WORKFLOW');
    console.log('🎬 ===============================================');
    console.log('📁 Video URL:', videoUrl);

    // STEP 1: Get Gemini analysis
    console.log('\n1️⃣ ===============================================');
    console.log('1️⃣ ANALYZING VIDEO WITH GEMINI');
    console.log('1️⃣ ===============================================');

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
    console.log('\n📝 ===============================================');
    console.log('📝 COMPLETE GEMINI ANALYSIS OUTPUT');
    console.log('📝 ===============================================');
    console.log(geminiResult.analysis);
    console.log('📝 ===============================================\n');

    // STEP 2: Send Gemini analysis directly to MusicGPT
    console.log('2️⃣ ===============================================');
    console.log('2️⃣ SENDING GEMINI TEXT TO MUSICGPT');
    console.log('2️⃣ ===============================================');

    const musicResult = await generateMusicFromGeminiText(geminiResult.analysis, {});

    // STEP 3: Final results
    console.log('\n🎉 ===============================================');
    console.log('🎉 WORKFLOW COMPLETED!');
    console.log('🎉 ===============================================');
    
    if (musicResult.success) {
      if (musicResult.music.audio_url) {
        console.log('✅ Gemini analysis: Complete');
        console.log('✅ Music generation: Complete');
        console.log('🔗 Final music URL:', musicResult.music.audio_url);
      } else if (musicResult.music.task_id || musicResult.music.conversion_id) {
        console.log('✅ Gemini analysis: Complete');
        console.log('🔄 Music generation: In progress');
        console.log('🆔 Track with task ID:', musicResult.music.task_id || musicResult.music.conversion_id);
      }
    } else {
      console.log('✅ Gemini analysis: Complete');
      console.log('❌ Music generation: Failed');
      console.log('💥 Error:', musicResult.error);
    }
    console.log('🎉 ===============================================\n');

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
    console.error('❌ Complete workflow error:', error);
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
  console.log('🔧 Optimizing Gemini analysis for MusicGPT...');
  
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

  console.log('✅ Text optimized for MusicGPT');
  console.log('📏 Original length:', geminiAnalysis.length, 'chars');
  console.log('📏 Optimized length:', optimizedPrompt.length, 'chars');
  console.log('🎵 Musical sentences found:', musicalSentences.length);

  return optimizedPrompt;
}

// ===============================================
// NEW API ENDPOINTS FOR GEMINI + MUSICGPT WORKFLOW
// ===============================================

// 🚨 NEW: Complete workflow - Analyze video with Gemini → Generate music with MusicGPT
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

    console.log('🎬 ===============================================');
    console.log('🎬 COMPLETE GEMINI + MUSICGPT WORKFLOW');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('🎭 Genre focus:', genre || 'Adaptive');
    console.log('🎵 Music duration:', musicDuration, 'seconds');
    console.log('🎨 Music style:', musicStyle);

    // STEP 1: Analyze video with Gemini
    console.log('\n1️⃣ ===============================================');
    console.log('1️⃣ ANALYZING VIDEO WITH GEMINI AI');
    console.log('1️⃣ ===============================================');

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

    console.log('✅ Gemini analysis completed');
    console.log('📄 Analysis length:', geminiResult.analysis.length, 'characters');

    // STEP 2: Optimize text for MusicGPT
    console.log('\n2️⃣ ===============================================');
    console.log('2️⃣ OPTIMIZING TEXT FOR MUSICGPT AI');
    console.log('2️⃣ ===============================================');

    const optimizedPrompt = optimizeTextForMusicGeneration(geminiResult.analysis);

    // STEP 3: Generate music with MusicGPT
    console.log('\n3️⃣ ===============================================');
    console.log('3️⃣ GENERATING MUSIC WITH MUSICGPT AI');
    console.log('3️⃣ ===============================================');

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

    console.log('\n🎉 ===============================================');
    console.log('🎉 COMPLETE WORKFLOW SUCCESSFUL');
    console.log('🎉 ===============================================');
    console.log('✅ Gemini analysis: ✅');
    console.log('✅ Text optimization: ✅');
    console.log('✅ MusicGPT generation: ✅');

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
    console.error('❌ Error in complete Gemini + MusicGPT workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Complete workflow failed',
      details: error.message
    });
  }
});

// 🚨 NEW: Generate music from existing Gemini analysis text
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

    console.log('📝 ===============================================');
    console.log('📝 CONVERTING TEXT TO MUSIC WITH MUSICGPT AI');
    console.log('📝 ===============================================');
    console.log('📄 Text length:', textDescription.length, 'characters');
    console.log('🎵 Duration:', duration, 'seconds');
    console.log('🎨 Style:', style);

    // Optimize text if requested
    let finalPrompt = textDescription;
    if (optimizeText) {
      console.log('🔧 Optimizing text for music generation...');
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
      console.log('✅ Text-to-music conversion completed successfully');
      
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
    console.error('❌ Error in text-to-music conversion:', error);
    res.status(500).json({
      success: false,
      error: 'Text-to-music conversion failed',
      details: error.message
    });
  }
});

// 🚨 NEW: Test MusicGPT API connection
app.post('/api/test-musicgpt', async (req, res) => {
  try {
    console.log('🧪 Testing MusicGPT AI API connection...');
    
    if (!MUSICGPT_API_KEY) {
      throw new Error('MUSICGPT_API_KEY not found in environment variables');
    }

    const testPrompt = "Create a short upbeat electronic music piece with synthesizers and drums, 120 BPM, in C major.";
    
    console.log('📤 Sending test prompt to MusicGPT AI...');
    
    const testResult = await generateMusicFromText(testPrompt, {
      duration: 10, // Short test duration
      style: 'electronic',
      tempo: 'fast',
      quality: 'medium'
    });

    if (testResult.success) {
      console.log('✅ MusicGPT AI test successful!');
      
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
    console.error('❌ MusicGPT AI test failed:', error);
    
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

// 🚨 NEW: Batch process segments - Analyze with Gemini → Generate music for each
app.post('/api/process-segments-with-musicgpt', async (req, res) => {
  try {
    const { segments, videoFile, batchOptions = {} } = req.body;

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({
        success: false,
        error: 'No segments array provided'
      });
    }

    console.log('🔄 ===============================================');
    console.log('🔄 BATCH PROCESSING SEGMENTS WITH MUSICGPT');
    console.log('🔄 ===============================================');
    console.log('📊 Total segments to process:', segments.length);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      console.log(`\n🔄 Processing segment ${i + 1}/${segments.length}...`);
      console.log(`⏰ Segment: ${segment.start_time}s - ${segment.end_time}s`);

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
          console.log(`✅ Segment ${i + 1} processed successfully`);
          
          results.push({
            segmentIndex: i,
            segment: segment,
            music: musicResult.music,
            prompt: musicPrompt,
            success: true
          });
        } else {
          errorCount++;
          console.log(`❌ Segment ${i + 1} failed:`, musicResult.error);
          
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
        console.error(`❌ Error processing segment ${i + 1}:`, error.message);
        
        results.push({
          segmentIndex: i,
          segment: segment,
          error: error.message,
          success: false
        });
      }
    }

    console.log('\n🎉 ===============================================');
    console.log('🎉 BATCH PROCESSING COMPLETED');
    console.log('🎉 ===============================================');
    console.log('✅ Successful segments:', successCount);
    console.log('❌ Failed segments:', errorCount);
    console.log('📊 Success rate:', Math.round((successCount / segments.length) * 100) + '%');

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
    console.error('❌ Error in batch segment processing:', error);
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
// ✅ ADD: Test endpoint to verify GCS file accessibility
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
    
    console.log('🧪 Testing GCS file access:', testUrl);
    
    // Test HTTP access
    const axios = require('axios');
    try {
      const response = await axios.head(testUrl, { timeout: 10000 });
      
      console.log('✅ File is accessible:');
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
      console.error('❌ File not accessible:', httpError.message);
      
      res.status(httpError.response?.status || 500).json({
        success: false,
        accessible: false,
        error: httpError.message,
        status: httpError.response?.status,
        message: 'File is not accessible - check URL and permissions'
      });
    }

  } catch (error) {
    console.error('❌ Error testing file access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test file access',
      details: error.message
    });
  }
});

// ✅ ADD: Helper function for error suggestions (if not already present)
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
// 🚨 NEW: Combined upload + analysis workflow
app.post('/api/upload-and-analyze-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    const { customPrompt, analysisType = 'full', skipUpload = false } = req.body;

    console.log('🎬 ===============================================');
    console.log('🎬 COMBINED UPLOAD + GEMINI ANALYSIS WORKFLOW');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('🎯 Custom prompt:', customPrompt || 'None');
    console.log('📋 Analysis type:', analysisType);
    console.log('⬆️ Skip GCS upload:', skipUpload);

    let uploadResult = null;

    // Step 1: Upload to GCS (unless skipped)
    if (!skipUpload) {
      console.log('\n1️⃣ Uploading to Google Cloud Storage...');
      
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

      console.log('✅ Upload completed - GCS URI:', uploadResult.gcs_uri);
    }

    // Step 2: Analyze with Gemini
    console.log('\n2️⃣ Analyzing with Gemini AI...');
    
    let analysisResult;
    if (analysisType === 'segments') {
      analysisResult = await analyzeVideoSegments(req.file.buffer, req.file.mimetype, customPrompt);
    } else {
      analysisResult = await analyzeVideoForMusic(req.file.buffer, req.file.mimetype, customPrompt);
    }

    if (analysisResult.success) {
      console.log('✅ ===============================================');
      console.log('✅ COMBINED WORKFLOW COMPLETED SUCCESSFULLY');
      console.log('✅ ===============================================');

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
      console.error('❌ Analysis failed:', analysisResult.error);
      res.status(500).json({
        success: false,
        error: `Upload ${uploadResult ? 'succeeded' : 'skipped'} but analysis failed: ${analysisResult.error}`,
        details: analysisResult.details,
        upload: uploadResult
      });
    }

  } catch (error) {
    console.error('❌ Error in combined upload + analysis workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed in combined upload and analysis workflow',
      details: error.message
    });
  }
});

// 🚨 NEW: Test Gemini API connection
app.post('/api/test-gemini', async (req, res) => {
  try {
    console.log('🧪 Testing Gemini API connection...');
    
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const testPrompt = "Hello! Please respond with a brief test message to confirm the API is working.";
    
    console.log('📤 Sending test prompt to Gemini...');
    const result = await model.generateContent(testPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Gemini API test successful!');
    console.log('📥 Response:', text.substring(0, 100) + '...');

    res.json({
      success: true,
      message: 'Gemini API is working correctly!',
      testResponse: text,
      apiKeyConfigured: true
    });

  } catch (error) {
    console.error('❌ Gemini API test failed:', error);
    
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
    console.log('💳 Adding payment method for user:', email);
    
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

    console.log('✅ Payment method added successfully');
    
    res.json({ 
      message: 'Payment method added successfully',
      paymentMethodId
    });

  } catch (error) {
    console.error('❌ Error adding payment method:', error);
    res.status(500).json({ 
      message: 'Failed to add payment method',
      details: error.message
    });
  }
});
// Add this import at the top of your index.js
const { generateUploadUrl, uploadBuffer } = require('./gcs-utils');

// ADD THESE NEW ROUTES BEFORE YOUR EXISTING ROUTES

// 🚨 NEW: Generate upload ticket for GCS
app.post('/api/upload-ticket', async (req, res) => {
  try {
    console.log('🎫 Generating GCS upload ticket with proper authentication...');
    
    const { generateUploadUrl } = require('./gcs-utils');
    const uploadData = await generateUploadUrl();
    
    console.log('✅ Upload ticket generated with signed URLs:', {
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
    console.error('❌ Error generating upload ticket:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload ticket',
      details: error.message 
    });
  }
});

// ✅ NEW: Test GCS access endpoint
app.post('/api/test-gcs-access', async (req, res) => {
  try {
    const { gcsUrl } = req.body;
    
    if (!gcsUrl) {
      return res.status(400).json({
        success: false,
        error: 'No GCS URL provided'
      });
    }

    console.log('🧪 Testing GCS access for URL:', gcsUrl);
    
    const { testGCSAccess } = require('./gemini-utils');
    const testResult = await testGCSAccess(gcsUrl);
    
    if (testResult.success) {
      console.log('✅ GCS access test passed');
      res.json({
        success: true,
        message: 'GCS access working correctly',
        details: testResult
      });
    } else {
      console.error('❌ GCS access test failed:', testResult.error);
      res.status(400).json({
        success: false,
        error: testResult.error,
        details: testResult.details,
        httpStatus: testResult.httpStatus
      });
    }

  } catch (error) {
    console.error('❌ Error testing GCS access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test GCS access',
      details: error.message
    });
  }
});

// ✅ NEW: Get signed URL for existing GCS file
app.post('/api/get-signed-url', async (req, res) => {
  try {
    const { gcsUrl, fileName, expiryHours = 24 } = req.body;
    
    if (!gcsUrl && !fileName) {
      return res.status(400).json({
        success: false,
        error: 'Either gcsUrl or fileName must be provided'
      });
    }

    console.log('🔐 Generating signed URL...');
    
    const { getSignedDownloadUrl, extractFileNameFromUrl } = require('./gcs-utils');
    
    const fileNameToUse = fileName || extractFileNameFromUrl(gcsUrl);
    const signedUrl = await getSignedDownloadUrl(fileNameToUse, expiryHours);
    
    console.log('✅ Signed URL generated for:', fileNameToUse);
    
    res.json({
      success: true,
      signedUrl: signedUrl,
      fileName: fileNameToUse,
      expiryHours: expiryHours,
      message: 'Signed URL generated successfully'
    });

  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate signed URL',
      details: error.message
    });
  }
});

// 🚨 NEW: Upload video directly to GCS using ticket system
app.post('/api/upload-video-to-gcs', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    console.log('🎬 ===============================================');
    console.log('🎬 UPLOADING VIDEO TO GOOGLE CLOUD STORAGE');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('🎥 Content type:', req.file.mimetype);

    // Step 1: Generate upload ticket
    console.log('\n1️⃣ Generating upload ticket...');
    const uploadData = await generateUploadUrl(`videos/${Date.now()}_${req.file.originalname}`);
    
    console.log('✅ Upload ticket generated');
    console.log('🔗 GCS URI:', uploadData.gcs_uri);

    // Step 2: Upload directly to GCS using the signed URL
    console.log('\n2️⃣ Uploading to Google Cloud Storage...');
    const uploadStartTime = Date.now();
    
    const axios = require('axios');
    await axios.put(uploadData.put_url, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': req.file.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    
    console.log('\n✅ ===============================================');
    console.log('✅ VIDEO UPLOADED TO GCS SUCCESSFULLY!');
    console.log('✅ ===============================================');
    console.log('⏱️ Upload time:', uploadTime, 'seconds');
    console.log('🔗 GCS URI:', uploadData.gcs_uri);
    console.log('🌐 Public URL:', uploadData.public_url);
    console.log('📁 File name:', uploadData.file_name);

    res.json({
      success: true,
      message: 'Video uploaded to Google Cloud Storage successfully!',
      gcs_uri: uploadData.gcs_uri,
      public_url: uploadData.public_url,
      file_name: uploadData.file_name,
      upload_time: uploadTime + 's',
      file_size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB'
    });

  } catch (error) {
    console.error('❌ ===============================================');
    console.error('❌ VIDEO UPLOAD TO GCS FAILED');
    console.error('❌ ===============================================');
    console.error('💥 Error message:', error.message);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📊 Response data:', error.response.data);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload video to Google Cloud Storage',
      details: error.message
    });
  }
});

// 🚨 NEW: Alternative direct buffer upload (if needed)
app.post('/api/upload-video-direct', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file uploaded' 
      });
    }

    console.log('🎬 Direct upload to GCS...');
    console.log('📁 File:', req.file.originalname);
    console.log('📊 Size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');

    const fileName = `videos/${Date.now()}_${req.file.originalname}`;
    const uploadResult = await uploadBuffer(req.file.buffer, fileName, req.file.mimetype);

    console.log('✅ Direct upload successful!');
    console.log('🔗 GCS URI:', uploadResult.gcs_uri);

    res.json({
      success: true,
      message: 'Video uploaded directly to GCS successfully!',
      ...uploadResult
    });

  } catch (error) {
    console.error('❌ Direct upload error:', error);
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

    console.log('📤 Proxying file upload to GCS...');
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

    console.log('✅ Upload successful, status:', uploadResponse.status);

    res.json({
      success: true,
      message: 'File uploaded successfully via proxy',
      status_code: uploadResponse.status
    });

  } catch (error) {
    console.error('❌ Upload proxy error:', error.message);
    
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
  
  // ✅ ADJUST: Reduce music volume to preserve original video audio
  const adjustedMusicVolume = Math.min(volume * 0.8, 0.7); // Cap music volume
  
  console.log(`   🎚️ Music volume: ${Math.round(volume * 100)}% → ${Math.round(adjustedMusicVolume * 100)}% (preserving original audio)`);
  
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
  
  console.log(`   🎭 Fade algorithm: ${fadeAlgorithm} → FFmpeg curve: ${fadeCurve}`);
  
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
    console.log(`   🔊 Applied ${fadeAlgorithm} fade-in: ${fadeInDuration}s starting at ${fadeInStart}s`);
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
    console.log(`   🔉 Applied ${fadeAlgorithm} fade-out: ${fadeOutDuration}s starting at ${fadeOutStart}s`);
  }
  
  // Step 3: Apply final volume (adjusted to preserve original audio)
  const volumeLabel = `[vol_${arrayIndex}]`;
  filters.push(`${currentLabel}volume=${adjustedMusicVolume}${volumeLabel}`);
  
  console.log(`   🎚️ Applied final volume: ${Math.round(adjustedMusicVolume * 100)}%`);
  
  return { filters, finalLabel: volumeLabel, algorithm: fadeAlgorithm, curve: fadeCurve };
};


const getEffectiveVolume = (musicInfo, segment) => {
  // ✅ PRIORITY 1: Use custom volume if explicitly set (even if 0)
  if (musicInfo.customVolume !== undefined && musicInfo.customVolume !== null) {
    console.log(`   Using CUSTOM volume: ${musicInfo.customVolume} (was set by user)`);
    return parseFloat(musicInfo.customVolume);
  }
  
  // ✅ PRIORITY 2: Use effectiveVolume if available (from state)
  if (musicInfo.effectiveVolume !== undefined && musicInfo.effectiveVolume !== null) {
    console.log(`   Using EFFECTIVE volume: ${musicInfo.effectiveVolume}`);
    return parseFloat(musicInfo.effectiveVolume);
  }
  
  // ✅ PRIORITY 3: Use AI suggested volume from segment
  if (segment && segment.volume !== undefined && segment.volume !== null) {
    console.log(`   Using AI suggested volume: ${segment.volume}`);
    return parseFloat(segment.volume);
  }
  
  // ✅ PRIORITY 4: Default volume
  console.log(`   Using DEFAULT volume: 0.3`);
  return 0.3;
};

// ✅ STEP 1: Make sure this function exists in your index.js 
// Find your existing buildAudioFilterWithFades function and REPLACE it with this fixed version:


// ✅ STEP 2: Fix the progressive video endpoint audio mixing
// In your /api/update-progressive-video endpoint, REPLACE the single segment processing with:


// ✅ STEP 3: Also fix the complete video endpoint
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
      console.log(`   🌊 Applied custom sigmoid fade-in: ${fadeInDuration}s`);
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
      console.log(`   🌊 Applied custom sigmoid fade-out: ${fadeOutDuration}s`);
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

    console.log('🎬 ===============================================');
    console.log('🎬 STARTING CLIPTUNE ANALYSIS WITH ENHANCED DEBUG');
    console.log('🎬 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('📊 File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('🎯 Extra prompt:', extra_prompt || 'None provided');
    console.log('⏱️ Video duration (total_seconds):', total_seconds || 'Not provided');
    console.log('⏰ Started at:', new Date().toLocaleTimeString());

    // Step 1: Get upload ticket from ClipTune
    console.log('\n1️⃣ ===============================================');
    console.log('1️⃣ REQUESTING UPLOAD TICKET FROM CLIPTUNE');
    console.log('1️⃣ ===============================================');
    console.log('🌐 API URL:', `${CLIPTUNE_API}/upload-ticket`);
    
    const ticketResponse = await axios.post(`${CLIPTUNE_API}/upload-ticket`);
    const { put_url, gcs_uri } = ticketResponse.data;
    
    console.log('✅ Upload ticket received successfully');
    console.log('🔗 GCS URI:', gcs_uri);

    // Step 2: Upload video to GCS
    console.log('\n2️⃣ ===============================================');
    console.log('2️⃣ UPLOADING VIDEO TO GOOGLE CLOUD STORAGE');
    console.log('2️⃣ ===============================================');
    console.log('☁️ Uploading to GCS...');
    console.log('📊 Upload size:', req.file.size, 'bytes');
    console.log('🎥 Content type:', req.file.mimetype || 'video/mp4');
    
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
    console.log('✅ Video uploaded to GCS successfully');
    console.log('⏱️ Upload time:', uploadTime, 'seconds');

    // Step 3: Call video-segments endpoint for ANALYSIS
    console.log('\n3️⃣ ===============================================');
    console.log('3️⃣ ANALYZING VIDEO WITH CLIPTUNE AI');
    console.log('3️⃣ ===============================================');
    console.log('🤖 Starting AI analysis...');
    console.log('🎯 Processing instructions:', extra_prompt || 'Default processing');
    console.log('⏱️ Video duration to send:', total_seconds || 'Will be calculated by ClipTune');
    
    const formData = new URLSearchParams();
    formData.append('video_url', gcs_uri);
    if (extra_prompt) {
      formData.append('extra_prompt', extra_prompt);
    }
    // 🚨 ADD: Include total_seconds if provided (as integer)
    if (total_seconds) {
      const durationInt = parseInt(total_seconds);
      formData.append('total_seconds', durationInt);
      console.log('📊 Including video duration:', durationInt, 'seconds (as integer)');
    }

    console.log('📋 Form data prepared:');
    console.log('   - video_url:', gcs_uri);
    console.log('   - extra_prompt:', extra_prompt || 'Not provided');
    console.log('   - total_seconds:', total_seconds || 'Not provided');
    
    const processingStartTime = Date.now();
    console.log('⏰ AI analysis started at:', new Date().toLocaleTimeString());
    console.log('⏳ This may take several minutes...');

  const segmentsResponse = await axios.post(`${CLIPTUNE_API}/video-segments`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 1000 * 60 * 10, // 10 minutes timeout
    });

    const processingTime = ((Date.now() - processingStartTime) / 1000).toFixed(2);
    
    console.log('\n✅ ===============================================');
    console.log('✅ CLIPTUNE AI ANALYSIS COMPLETED');
    console.log('✅ ===============================================');
    console.log('⏱️ Processing time:', processingTime, 'seconds');
    console.log('📊 Response status:', segmentsResponse.status);
    
    // 🚨 ENHANCED DEBUG: Show COMPLETE RAW RESPONSE
    console.log('\n🔍 ===============================================');
    console.log('🔍 COMPLETE RAW CLIPTUNE AI RESPONSE DEBUG');
    console.log('🔍 ===============================================');
    
    // Log the full response object structure
    console.log('📋 Response Object Keys:', Object.keys(segmentsResponse.data));
    console.log('📋 Response Headers:', JSON.stringify(segmentsResponse.headers, null, 2));
    console.log('📋 Response Status:', segmentsResponse.status);
    console.log('📋 Response Status Text:', segmentsResponse.statusText);
    
    // Log the complete response data in pretty format
    console.log('\n📄 COMPLETE RESPONSE DATA:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(segmentsResponse.data, null, 2));
    console.log('='.repeat(80));
    
    // Analyze the response structure
    if (segmentsResponse.data) {
      console.log('\n🔬 RESPONSE STRUCTURE ANALYSIS:');
      console.log('🔬 ===============================================');
      
      const responseKeys = Object.keys(segmentsResponse.data);
      console.log('📊 Top-level keys in response:', responseKeys);
      
      responseKeys.forEach(key => {
        const value = segmentsResponse.data[key];
        console.log(`   - ${key}: ${typeof value} (${Array.isArray(value) ? `array of ${value.length} items` : typeof value})`);
      });
      
      // Check for segments specifically
      if (segmentsResponse.data.segments) {
        console.log('\n🎯 SEGMENTS ARRAY FOUND:');
        console.log('🎯 ===============================================');
        console.log('📊 Number of segments:', segmentsResponse.data.segments.length);
        console.log('📊 Segments type:', typeof segmentsResponse.data.segments);
        console.log('📊 Is array:', Array.isArray(segmentsResponse.data.segments));
        
        // Show first segment structure
        if (segmentsResponse.data.segments.length > 0) {
          console.log('\n📋 FIRST SEGMENT STRUCTURE SAMPLE:');
          console.log('-'.repeat(60));
          const firstSegment = segmentsResponse.data.segments[0];
          console.log('First segment keys:', Object.keys(firstSegment));
          console.log('First segment data:');
          console.log(JSON.stringify(firstSegment, null, 2));
          console.log('-'.repeat(60));
        }
        
        // Show all segments overview
        console.log('\n📊 ALL SEGMENTS OVERVIEW:');
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
        console.log('\n❌ NO SEGMENTS FOUND IN RESPONSE');
        console.log('❌ Available keys:', responseKeys);
      }
      
      // Check for other important fields
      console.log('\n🔍 OTHER RESPONSE FIELDS:');
      console.log('🔍 ===============================================');
      
      const importantFields = ['success', 'message', 'error', 'data', 'result', 'status'];
      importantFields.forEach(field => {
        if (segmentsResponse.data.hasOwnProperty(field)) {
          console.log(`✅ Found ${field}:`, typeof segmentsResponse.data[field]);
          if (typeof segmentsResponse.data[field] === 'string' && segmentsResponse.data[field].length < 200) {
            console.log(`   Value: ${segmentsResponse.data[field]}`);
          } else if (typeof segmentsResponse.data[field] === 'object') {
            console.log(`   Keys: ${Object.keys(segmentsResponse.data[field] || {}).join(', ')}`);
          }
        } else {
          console.log(`❌ Missing ${field}`);
        }
      });
    }

    // 🚨 FIXED: Apply field mapping after logging raw response
    let mappedSegments = [];
    if (segmentsResponse.data && segmentsResponse.data.segments) {
      console.log('\n🔄 ===============================================');
      console.log('🔄 APPLYING FIELD MAPPING TO RAW SEGMENTS');
      console.log('🔄 ===============================================');
      
      console.log('📊 Raw segments before mapping:', segmentsResponse.data.segments.length);
      
      // Map ClipTune response to expected field names
      mappedSegments = mapClipTuneResponse(segmentsResponse.data.segments);
      
      console.log('📊 Mapped segments after mapping:', mappedSegments.length);
      
      console.log('\n📋 MAPPED SEGMENTS STRUCTURE:');
      console.log('📋 ===============================================');
      
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
      console.log('\n❌ ===============================================');
      console.log('❌ NO SEGMENTS FOUND TO MAP');
      console.log('❌ ===============================================');
      console.log('🔍 Response data type:', typeof segmentsResponse.data);
      console.log('🔍 Response data keys:', segmentsResponse.data ? Object.keys(segmentsResponse.data) : 'N/A');
    }

    console.log('\n🎉 ===============================================');
    console.log('🎉 CLIPTUNE ANALYSIS DEBUG COMPLETED');
    console.log('🎉 ===============================================');
    console.log('✅ Sending response to client...');
    console.log('📊 Final mapped segments count:', mappedSegments.length);
    console.log('⏱️ Video duration was sent as:', total_seconds || 'Not provided');

    // 🚨 FIXED: Return mapped segments instead of original
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
    console.log('\n❌ ===============================================');
    console.log('❌ CLIPTUNE ANALYSIS ERROR');
    console.log('❌ ===============================================');
    console.error('💥 Error message:', error.message);
    console.error('💥 Error stack:', error.stack);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📊 HTTP Status Text:', error.response.statusText);
      console.error('📊 Response Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('💾 Full Response Data:');
      console.error('='.repeat(80));
      console.error(JSON.stringify(error.response.data, null, 2));
      console.error('='.repeat(80));
    }

    if (error.config) {
      console.error('🔧 Request Config:');
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
    console.log('💳 Fetching payment methods for:', email);
    
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
        console.warn('⚠️ Could not fetch from Stripe:', stripeError.message);
      }
    }

    res.json({
      success: true,
      paymentInfo,
      stripeCards: stripeCards.length,
      hasPaymentMethod: paymentInfo.hasPaymentMethod || stripeCards.length > 0
    });

  } catch (error) {
    console.error('❌ Error fetching payment methods:', error);
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
    console.log('💳 Adding payment method for:', email);
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

    console.log('✅ Payment method added successfully');
    
    res.json({ 
      success: true,
      message: 'Payment method added successfully',
      card: newCard,
      paymentMethodId
    });

  } catch (error) {
    console.error('❌ Error adding payment method:', error);
    
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
    console.log('🗑️ Removing payment method for:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Detach from Stripe
    if (user.stripeCustomerId && paymentMethodId) {
      try {
        await stripeInstance.paymentMethods.detach(paymentMethodId);
      } catch (stripeError) {
        console.warn('⚠️ Stripe detach failed:', stripeError.message);
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

    console.log('✅ Payment method removed successfully');
    
    res.json({ 
      success: true,
      message: 'Payment method removed successfully'
    });

  } catch (error) {
    console.error('❌ Error removing payment method:', error);
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
    console.log('📮 Updating billing address for:', email);
    
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

    console.log('✅ Billing address updated successfully');
    
    res.json({ 
      success: true,
      message: 'Billing address updated successfully',
      billingAddress: user.paymentInfo.billingAddress
    });

  } catch (error) {
    console.error('❌ Error updating billing address:', error);
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
    console.log('⭐ Setting default payment method for:', email);
    
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

    console.log('✅ Default payment method updated');
    
    res.json({ 
      success: true,
      message: 'Default payment method updated successfully'
    });

  } catch (error) {
    console.error('❌ Error setting default payment method:', error);
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
    
    // 🚨 NEW: Parse trimmed video info if provided
    const parsedTrimInfo = trimInfo ? JSON.parse(trimInfo) : null;
    const isTrimmedVideo = !!parsedTrimInfo;
    
    console.log('🎬 ===============================================');
    console.log('🎬 PROGRESSIVE VIDEO UPDATE - TRIMMED VIDEO SUPPORT');
    console.log('🎬 ===============================================');
    console.log(`📊 Total segments: ${parsedSegments.length}`);
    console.log(`🆕 New segment with music: ${newSegmentIdx + 1}`);
    console.log(`🎵 Total segments with music: ${Object.keys(parsedMusicData).length}`);
    console.log(`✂️ Is trimmed video: ${isTrimmedVideo ? 'YES' : 'NO'}`);
    
    if (isTrimmedVideo) {
      console.log(`✂️ Trimmed video info:`, {
        originalStart: parsedTrimInfo.original_start + 's',
        originalEnd: parsedTrimInfo.original_end + 's',
        trimmedDuration: parsedTrimInfo.trimmed_duration + 's'
      });
    }
    
    // Show which segments currently have music
    const segmentsWithMusic = Object.keys(parsedMusicData).map(k => parseInt(k) + 1);
    console.log(`🎵 Segments with music: [${segmentsWithMusic.join(', ')}]`);
    
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
        
        // 🚨 NEW: Handle timing for both trimmed and full video
        let segmentStartTime, segmentEndTime, timingSource;

        if (musicInfo.actualMusicTiming) {
          // Use the exact timing stored when music was generated
          segmentStartTime = parseFloat(musicInfo.actualMusicTiming.start);
          segmentEndTime = parseFloat(musicInfo.actualMusicTiming.end);
          timingSource = musicInfo.actualMusicTiming.wasAdjusted ? 'ADJUSTED_TIMING' : 'ORIGINAL_TIMING';
          
          // Log trimmed video specific info
          if (musicInfo.actualMusicTiming.isTrimmedVideo) {
            console.log(`🎵 Segment ${segmentIndex + 1} (TRIMMED VIDEO):`);
            console.log(`   Absolute placement: ${segmentStartTime}s - ${segmentEndTime}s`);
            console.log(`   Relative to trimmed: ${musicInfo.actualMusicTiming.trimmedVideoInfo.relativeStart}s - ${musicInfo.actualMusicTiming.trimmedVideoInfo.relativeEnd}s`);
          } else {
            console.log(`🎵 Segment ${segmentIndex + 1} (FULL VIDEO):`);
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
        console.log(`   ${segmentIndex === newSegmentIdx ? '🆕 NEW!' : '✅ Existing'}`);
        
        if (volume > 0) {
          try {
            console.log(`📥 Downloading audio for segment ${segmentIndex + 1}...`);
            
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
            
            console.log(`✅ Audio ready for segment ${segmentIndex + 1}`);
            
          } catch (error) {
            console.error(`❌ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
          }
        } else {
          console.log(`🔇 Segment ${segmentIndex + 1} is muted - skipping`);
        }
      }
    }
    
    // Sort segments by start time for proper layering
    activeAudioSegments.sort((a, b) => parseFloat(a.segment.start_time) - parseFloat(b.segment.start_time));
    
    console.log('\n🎵 FINAL PROGRESSIVE VIDEO COMPOSITION:');
    console.log('🎵 ===============================================');
    activeAudioSegments.forEach(({ index, segment, musicInfo, isNew }) => {
      const trimmedIndicator = segment.music_placement_timing?.isTrimmedVideo ? ' (Trimmed)' : ' (Full)';
      console.log(`${isNew ? '🆕' : '✅'} Segment ${index + 1}: ${segment.start_time}s-${segment.end_time}s (${Math.round(musicInfo.effectiveVolume * 100)}%)${trimmedIndicator}`);
    });
    console.log('🎵 ===============================================\n');
    
    const outputPath = path.join(tempDir, `progressive_video_${Date.now()}.mp4`);
    
    // Handle case where no active segments
    if (activeAudioSegments.length === 0) {
      console.log('🔇 No active music segments - restoring original video with FULL VOLUME');
      
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
            console.log('✅ Original video restored with FULL VOLUME (no music segments)');
            resolve();
          })
          .on('error', reject)
          .run();
      });
      
      const stats = await fsPromises.stat(outputPath);
      const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
      
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
      console.log(`🎵 Creating progressive video with ${activeAudioSegments.length} music segments...`);
      
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
          
          console.log(`🎵 Progressive single segment: ${index + 1}`);
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
          
          console.log(`🎵 Progressive multiple segments: ${activeAudioSegments.length}`);
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
            console.log('🎬 Progressive video FFmpeg command:', commandLine.substring(0, 200) + '...');
          })
          .on('end', () => {
            console.log('✅ Progressive video update completed');
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ Progressive video error:', err.message);
            reject(err);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`🔄 Progressive update: ${Math.round(progress.percent)}% done`);
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

    console.log('✅ Progressive video ready:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
    
    console.log('\n🎉 ===============================================');
    console.log('🎉 PROGRESSIVE VIDEO UPDATE SUCCESSFUL');
    console.log('🎉 ===============================================');
    console.log('🔗 Updated Video URL:', combinedUrl);
    console.log(`🆕 Added segment ${newSegmentIdx + 1} to the progressive video`);
    console.log(`🎵 Total active segments: ${activeAudioSegments.length}`);
    console.log(`✂️ Video type: ${isTrimmedVideo ? 'Trimmed' : 'Full'} video`);
    
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
    console.error('❌ Error in progressive video update:', error);
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
          console.warn(`⚠️ Could not delete ${file}:`, e.message);
        }
      }
    }
  }
});
app.post('/api/save-complete-video', async (req, res) => {
  const { userId, title, videoUrl, duration, segmentCount, description, processedSegments } = req.body;

  try {
    console.log('📚 Saving complete video to library:', {
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
    
    console.log('✅ Complete video saved to library successfully:', newCompleteVideo._id);
    
    res.status(201).json({ 
      message: 'Complete video saved to library successfully!', 
      video: newCompleteVideo,
      isDuplicate: false
    });

  } catch (err) {
    console.error('❌ Error saving complete video to library:', err);
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
    console.log('📚 Fetching complete videos from library for user:', userId);
    
    const completeVideos = await CompleteVideo.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to 50 most recent videos
    
    console.log(`✅ Found ${completeVideos.length} complete videos in library`);
    
    res.status(200).json(completeVideos);
    
  } catch (err) {
    console.error("❌ Error fetching complete videos from library:", err);
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
    console.log('🗑️ Deleting complete video from library:', { userId, videoId });
    
    const deletedVideo = await CompleteVideo.findOneAndDelete({ 
      _id: videoId, 
      userId: userId // Ensure user can only delete their own videos
    });
    
    if (!deletedVideo) {
      return res.status(404).json({ 
        error: 'Complete video not found or not authorized to delete' 
      });
    }
    
    console.log('✅ Complete video deleted from library successfully');
    
    res.status(200).json({ 
      message: 'Complete video deleted from library successfully',
      deletedVideo: deletedVideo
    });
    
  } catch (err) {
    console.error("❌ Error deleting complete video from library:", err);
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
    console.error('❌ Error fetching recent complete videos:', err);
    res.status(500).json({ 
      error: 'Failed to fetch recent complete videos',
      details: err.message 
    });
  }
});
// Video Processing Endpoint
app.post('/api/process-video', multer({ storage: multer.memoryStorage() }).single('video'), async (req, res) => {
  let trimmedPath, originalPath;
  try {
    if (!req.file) return res.status(400).json({ error: "No video uploaded." });

    originalPath = path.join(tempDir, `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);

    const start = parseInt(req.body.video_start);
    const end = parseInt(req.body.video_end);
    const clipDuration = end - start;
    if (clipDuration <= 0) throw new Error("Invalid time range");

    trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(start)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    await fsPromises.unlink(originalPath);

    const { data: ticket } = await axios.post(`${CLIPTUNE_API}/upload-ticket`);
    await axios.put(ticket.put_url, fs.createReadStream(trimmedPath), {
      headers: { 'Content-Type': req.file.mimetype || 'video/mp4' },
      maxBodyLength: Infinity,
    });

    const payload = new URLSearchParams({
      instrumental: req.body.instrumental,
      song_title: req.body.song_title || 'clip_gen',
      video_duration: String(Math.round(await getVideoDurationInSeconds(trimmedPath))),
      video_url: ticket.gcs_uri,
      youtube_urls: req.body.youtubeUrls,
      extra_description: req.body.extra_description,
      lyrics: req.body.lyrics
    });
    const genResponse = await axios.post(`${CLIPTUNE_API}/generate`, payload, {
      timeout: 1000 * 60 * 10
    });
    res.status(200).json(genResponse.data);
  } catch (err) {
    console.error('Generation error:', err.message || err);
    res.status(500).json({ error: 'Music generation failed', details: err.message });
  } finally {
    if (trimmedPath) {
      try {
        await fsPromises.unlink(trimmedPath);
      } catch {}
    }
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
      extra_description, 
      instrumental, 
      song_title,
      track_name // 🚨 NEW: Extract track name from request
    } = req.body;

    console.log('🎵 ===============================================');
    console.log('🎵 GENERATING MUSIC FOR INDIVIDUAL SEGMENT WITH TRACK NAME');
    console.log('🎵 ===============================================');
    console.log('📁 Video file:', req.file.originalname);
    console.log('⏰ Segment:', `${video_start}s - ${video_end}s`);
    console.log('🎯 Music description:', extra_description || 'None provided');
    console.log('🎵 Song title:', song_title || 'segment_music');
    console.log('🎶 Track name:', track_name || 'Unnamed Track'); // 🚨 NEW: Log track name

    // Save original video temporarily
    originalPath = path.join(tempDir, `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);

    // Extract segment timing
    const start = parseInt(video_start);
    const end = parseInt(video_end);
    const clipDuration = end - start;
    
    if (clipDuration <= 0) {
      throw new Error("Invalid time range");
    }

    console.log('✂️ Trimming video segment...');
    console.log(`   Duration: ${clipDuration} seconds`);

    // Trim video to segment
    trimmedPath = path.join(tempDir, `trimmed_segment_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(start)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', () => {
          console.log('✅ Video segment trimmed successfully');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    // Clean up original file
    await fsPromises.unlink(originalPath);
    originalPath = null;

    console.log('☁️ Uploading segment to ClipTune...');

    // Get upload ticket for segment
    const { data: ticket } = await axios.post(`${CLIPTUNE_API}/upload-ticket`);
    
    // Upload trimmed segment
    await axios.put(ticket.put_url, fs.createReadStream(trimmedPath), {
      headers: { 
        'Content-Type': req.file.mimetype || 'video/mp4' 
      },
      maxBodyLength: Infinity,
    });

    console.log('✅ Segment uploaded to ClipTune');
    console.log(`🎵 Generating music for track: "${track_name || 'Unnamed Track'}"`);

    // Prepare music generation payload
    const payload = new URLSearchParams({
      instrumental: instrumental || 'true',
      song_title: song_title || `${track_name || 'segment'}_${Date.now()}`, // 🚨 NEW: Use track name in song title
      video_duration: String(Math.round(await getVideoDurationInSeconds(trimmedPath))),
      video_url: ticket.gcs_uri,
      youtube_urls: youtubeUrls || '[]',
      extra_description: extra_description || 'Background music for video segment',
      lyrics: lyrics || ''
    });

    console.log('📤 Sending music generation request...');
    console.log('   Track name:', track_name || 'Unnamed Track');

    // Generate music
    const genResponse = await axios.post(`${CLIPTUNE_API}/generate`, payload, {
      timeout: 1000 * 60 * 10, // 10 minutes timeout
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ Music generation completed!');
    console.log('📊 Response status:', genResponse.status);
    
    // Log the generated music info
    if (genResponse.data) {
      const audioUrl = genResponse.data.url || genResponse.data.audio_url || 
                      (genResponse.data.tracks && genResponse.data.tracks[0]?.url);
      
      if (audioUrl) {
        console.log('🎶 Generated music URL for "' + (track_name || 'Unnamed Track') + '":', audioUrl);
      }
    }

    console.log('\n🎉 ===============================================');
    console.log('🎉 SEGMENT MUSIC GENERATION COMPLETED');
    console.log('🎉 Track: "' + (track_name || 'Unnamed Track') + '"');
    console.log('🎉 ===============================================');

    // 🚨 NEW: Include track name in response
    res.status(200).json({
      success: true,
      ...genResponse.data,
      track_name: track_name, // Include track name in response
      segment_info: {
        start: start,
        end: end,
        duration: clipDuration,
        track_name: track_name // Include in segment info too
      }
    });

  } catch (err) {
    console.error('❌ ===============================================');
    console.error('❌ SEGMENT MUSIC GENERATION ERROR');
    console.error('❌ ===============================================');
    console.error('💥 Error message:', err.message || err);
    
    if (err.response) {
      console.error('📊 HTTP Status:', err.response.status);
      console.error('💾 Response data:', JSON.stringify(err.response.data, null, 2));
    }

    res.status(500).json({ 
      success: false,
      error: 'Segment music generation failed', 
      details: err.message 
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [trimmedPath, originalPath].filter(Boolean);
    for (const file of filesToClean) {
      try {
        await fsPromises.unlink(file);
        console.log('🗑️ Cleaned up:', file);
      } catch (e) {
        console.warn(`⚠️ Could not delete temporary file ${file}:`, e.message);
      }
    }
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
    
    console.log('🎬 ===============================================');
    console.log('🎬 CREATING COMPLETE VIDEO FROM GENERATED SEGMENTS');
    console.log('🎬 ===============================================');
    console.log(`📊 Total segments: ${parsedSegments.length}`);
    
    // Debug: Log the raw music data to see what timing we have
    console.log('🔍 RAW MUSIC DATA DEBUG:');
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
    console.log(`🎵 Segments with music: ${segmentsWithMusic}/${parsedSegments.length}`);
    
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
    
    for (const segmentIndexStr of Object.keys(parsedMusicData)) {
      const segmentIndex = parseInt(segmentIndexStr);
      const musicInfo = parsedMusicData[segmentIndexStr];
      const originalSegment = parsedSegments[segmentIndex];
      
      if (musicInfo && musicInfo.audioUrl && originalSegment) {
        const volume = getEffectiveVolume(musicInfo, originalSegment);
        
        // 🚨 CRITICAL FIX: Use the EXACT timing the music was generated for
        let segmentStartTime, segmentEndTime, timingSource;

        if (musicInfo.actualMusicTiming) {
          // PRIORITY 1: Use the exact timing stored when music was generated
          segmentStartTime = parseFloat(musicInfo.actualMusicTiming.start);
          segmentEndTime = parseFloat(musicInfo.actualMusicTiming.end);
          timingSource = musicInfo.actualMusicTiming.wasAdjusted ? 'ADJUSTED_TIMING' : 'ORIGINAL_TIMING';
          console.log(`🎵 Using EXACT music generation timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s (${timingSource})`);
        } else if (musicInfo.segmentStart !== undefined && musicInfo.segmentEnd !== undefined) {
          // PRIORITY 2: Fallback to stored segment timing from music generation
          segmentStartTime = parseFloat(musicInfo.segmentStart);
          segmentEndTime = parseFloat(musicInfo.segmentEnd);
          timingSource = 'MUSIC_DATA_FALLBACK';
          console.log(`🎵 Using music data timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s`);
        } else {
          // PRIORITY 3: Final fallback to original segment timing (should not happen with adjusted timing)
          segmentStartTime = parseFloat(originalSegment.start_time || 0);
          segmentEndTime = parseFloat(originalSegment.end_time || segmentStartTime + 30);
          timingSource = 'FALLBACK_ORIGINAL';
          console.log(`🎵 WARNING: Using fallback original timing for segment ${segmentIndex + 1}: ${segmentStartTime}s - ${segmentEndTime}s`);
        }

        // 🚨 ENHANCED DEBUG LOGGING
        console.log(`🔍 TIMING DEBUG for Segment ${segmentIndex + 1}:`);
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
            console.log(`📥 Downloading audio for segment ${segmentIndex + 1} (${Math.round(volume * 100)}%):`, musicInfo.audioUrl);
            
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
                // 🚨 CRITICAL: Use the EXACT timing the music was generated for
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
            
            console.log(`✅ Audio downloaded for segment ${segmentIndex + 1} - WILL BE PLACED AT ${segmentStartTime}s-${segmentEndTime}s with ${Math.round(volume * 100)}% volume`);
            
          } catch (error) {
            console.error(`❌ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
          }
        } else {
          console.log(`🔇 Segment ${segmentIndex + 1} is muted (0%) - skipping audio download`);
        }
      }
    }
    
    // 🚨 CRITICAL DEBUG: Show exactly where each audio will be placed
    console.log('\n🔍 FINAL AUDIO PLACEMENT VERIFICATION:');
    console.log('🔍 ===============================================');
    activeAudioSegments.forEach(({ index, segment, musicInfo }) => {
      console.log(`Segment ${index + 1}:`);
      console.log(`  🎵 Music will be placed at: ${segment.start_time}s - ${segment.end_time}s`);
      console.log(`  📊 Original ClipTune timing: ${segment.music_placement_timing?.originalClipTuneStart}s - ${segment.music_placement_timing?.originalClipTuneEnd}s`);
      console.log(`  ✂️ Was timing adjusted: ${segment.music_placement_timing?.wasAdjusted ? 'YES' : 'NO'}`);
      console.log(`  📈 Volume: ${Math.round(musicInfo.effectiveVolume * 100)}%`);
      console.log(`  🔧 Timing source: ${segment.music_placement_timing?.timingSource || 'UNKNOWN'}`);
      console.log(`  ---`);
    });
    console.log('🔍 ===============================================\n');
    
    const outputPath = path.join(tempDir, `complete_video_${Date.now()}.mp4`);
    
   if (activeAudioSegments.length === 0) {
  console.log('🔇 No active segments - restoring original video with FULL VOLUME');
  
  await new Promise((resolve, reject) => {
    ffmpeg(videoFilePath)
      .outputOptions([
        '-c:v copy',           // Copy video without re-encoding
        '-c:a aac',            // Re-encode audio to ensure consistency
        '-b:a 192k',           // High quality audio
        '-ar 44100',           // Standard sample rate
        '-ac 2',               // Stereo
        '-af volume=1.0'       // ✅ EXPLICIT: Restore to 100% volume
      ])
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Progressive video: Original volume fully restored');
        resolve();
      })
      .on('error', reject)
      .run();
  });
    } else {
      console.log(`🎵 Processing ${activeAudioSegments.length} active audio segments with exact timing placement...`);
      
      // Process active audio segments with exact timing
      await new Promise((resolve, reject) => {
        let command = ffmpeg(videoFilePath);
        
        // Add only active audio inputs
        activeAudioSegments.forEach(({ path }) => {
          command = command.input(path);
        });
        // ✅ REPLACE your audio mixing logic in /api/create-complete-video endpoint
// This ensures BOTH original video audio AND music play simultaneously

if (activeAudioSegments.length === 1) {
  // Single active audio segment - PROPER MIXING
  const { index, musicInfo, segment } = activeAudioSegments[0];
  const segmentStart = parseFloat(segment.start_time);
  const musicVolume = musicInfo.effectiveVolume;
  
  // ✅ KEEP original video audio at reasonable volume (don't reduce too much)
  const originalVideoVolume = 0.8; // Keep original video prominent but not overwhelming
  
  console.log(`🎵 Single active segment mixing: ${index + 1}`);
  console.log(`   Music volume: ${Math.round(musicVolume * 100)}%`);
  console.log(`   Original video audio: ${Math.round(originalVideoVolume * 100)}% (PRESERVED)`);
  console.log(`   Placement: ${segmentStart}s - ${segment.end_time}s`);
  
  const { filters, finalLabel } = buildAudioFilterWithFades(1, musicVolume, segment, segmentStart, 0);
  
  if (segmentStart > 0) {
    // ✅ PROPER MIXING: Both original audio + delayed music
    const silenceFilter = `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence]`;
    const concatFilter = `[silence]${finalLabel}concat=n=2:v=0:a=1[delayed_music]`;
    
    // ✅ CRITICAL: MIX original video audio WITH music (not replace)
    const mixFilter = `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
    
    command = command.complexFilter([
      silenceFilter,
      ...filters,
      concatFilter,
      mixFilter  // ✅ This mixes BOTH audio streams
    ]);
  } else {
    // ✅ DIRECT MIXING: Original audio + music from start
    const mixFilter = `[0:a]${finalLabel}amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
    
    command = command.complexFilter([
      ...filters,
      mixFilter  // ✅ This mixes BOTH audio streams
    ]);
  }
} else {
  // Multiple active audio segments - PROPER MULTI-STREAM MIXING
  const filterParts = [];
  const mixInputs = ['[0:a]']; // ✅ ALWAYS include original video audio
  
  console.log(`🎵 Multiple segments mixing: ${activeAudioSegments.length}`);
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
  
  // ✅ CRITICAL: Mix original video audio + ALL music segments together
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
            console.log('🎬 FFmpeg command:', commandLine);
          })
          .on('end', () => {
            console.log('✅ Complete video processing with EXACT timing placement finished');
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ FFmpeg error:', err.message);
            
            // Fallback: copy original video
            console.log('🔄 Fallback: copying original video...');
            ffmpeg(videoFilePath)
              .output(outputPath)
              .on('end', () => {
                console.log('✅ Fallback completed - original video');
                resolve();
              })
              .on('error', reject)
              .run();
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log('🔄 Progress: ' + Math.round(progress.percent) + '% done');
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

    console.log('✅ Complete video created with EXACT timing placement:', outputPath, 'Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    // Return the URL for the complete video
    const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
    
    console.log('\n🎉 ===============================================');
    console.log('🎉 COMPLETE VIDEO WITH EXACT MUSIC TIMING READY');
    console.log('🎉 ===============================================');
    console.log('🔗 Video URL:', combinedUrl);
    
    // Enhanced response with timing details
    res.json({ 
      success: true, 
      combinedUrl,
      activeSegments: activeAudioSegments.length,
      totalSegments: parsedSegments.length,
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
    console.error('❌ Error creating complete video from segments:', error);
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
          console.log('🗑️ Cleaned up:', file);
        } catch (e) {
          console.warn(`⚠️ Could not delete temporary file ${file}:`, e.message);
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

    const trimmedUrl = `http://localhost:${PORT}/trimmed/${outputFileName}`;
    res.json({ trimmedUrl });
  } catch (err) {
    console.error('Error trimming audio:', err);
    res.status(500).json({ error: 'Failed to trim audio', details: err.message });
  }
});

// ✅ UPDATE your existing /api/create-complete-video endpoint in index.js
// Replace the existing endpoint with this enhanced version that handles removed segments
// ✅ BONUS: Add a dedicated endpoint for volume restoration testing
app.post('/api/restore-original-volume', upload.single('video'), async (req, res) => {
  let videoFilePath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    console.log('🔊 ===============================================');
    console.log('🔊 RESTORING ORIGINAL VIDEO VOLUME');
    console.log('🔊 ===============================================');

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
          console.log('🔊 Restoring volume:', commandLine);
        })
        .on('end', () => {
          console.log('✅ Original volume fully restored');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    const stats = await fsPromises.stat(outputPath);
    const restoredUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;

    console.log('🔊 Volume restoration completed');
    console.log('🔗 Restored video URL:', restoredUrl);

    res.json({ 
      success: true, 
      restoredUrl,
      message: 'Original video volume fully restored',
      fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`
    });

  } catch (error) {
    console.error('❌ Error restoring original volume:', error);
    res.status(500).json({ 
      error: 'Failed to restore original volume', 
      details: error.message 
    });
  } finally {
    if (videoFilePath) {
      try {
        await fsPromises.unlink(videoFilePath);
      } catch (e) {
        console.warn(`⚠️ Could not delete ${videoFilePath}:`, e.message);
      }
    }
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
    
    console.log('🎬 ===============================================');
    console.log('🎬 CREATING COMPLETE VIDEO WITH REMOVE/RESTORE SUPPORT');
    console.log('🎬 ===============================================');
    console.log(`📊 Total segments: ${parsedSegments.length}`);
    console.log(`🎵 Music data provided for: ${Object.keys(parsedMusicData).length} segments`);
    console.log(`🔧 Allow empty music: ${allowEmptyMusic === 'true' ? 'YES' : 'NO'}`);
    
    // Save uploaded video
    videoFilePath = path.join(tempDir, `complete_video_source_${Date.now()}.mp4`);
    await fsPromises.writeFile(videoFilePath, req.file.buffer);
    
    // ✅ ENHANCED: Filter out removed segments and process only active ones
    const activeAudioSegments = [];
    let removedSegmentCount = 0;
    
    for (const segmentIndexStr of Object.keys(parsedMusicData)) {
      const segmentIndex = parseInt(segmentIndexStr);
      const musicInfo = parsedMusicData[segmentIndexStr];
      const originalSegment = parsedSegments[segmentIndex];
      
      if (!musicInfo || !originalSegment) {
        console.warn(`⚠️ Segment ${segmentIndex + 1}: Missing music info or segment data`);
        continue;
      }
      
      // ✅ CHECK FOR REMOVED STATUS
      if (musicInfo.removed === true || musicInfo.isRemovedFromVideo === true) {
        removedSegmentCount++;
        console.log(`🚫 Segment ${segmentIndex + 1}: SKIPPED (marked as removed)`);
        continue;
      }
      
      if (!musicInfo.audioUrl) {
        console.warn(`⚠️ Segment ${segmentIndex + 1}: Missing audio URL`);
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

      console.log(`✅ Segment ${segmentIndex + 1}: ACTIVE`);
      console.log(`   Placement: ${segmentStartTime}s - ${segmentEndTime}s`);
      console.log(`   Volume: ${Math.round(volume * 100)}%`);
      console.log(`   Timing source: ${timingSource}`);
      console.log(`   Audio URL: ${musicInfo.audioUrl.substring(0, 50)}...`);
      
      // ✅ ONLY PROCESS IF VOLUME > 0
      if (volume > 0) {
        try {
          console.log(`📥 Downloading audio for segment ${segmentIndex + 1}...`);
          
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
          console.log(`✅ Audio ready for segment ${segmentIndex + 1}`);
          
        } catch (error) {
          console.error(`❌ Failed to download audio for segment ${segmentIndex + 1}:`, error.message);
        }
      } else {
        console.log(`🔇 Segment ${segmentIndex + 1} is muted (0%) - skipping audio download`);
      }
    }
    
    const outputPath = path.join(tempDir, `complete_video_${Date.now()}.mp4`);
    
    console.log('\n📊 PROCESSING SUMMARY:');
    console.log('📊 ===============================================');
    console.log(`🎵 Active segments with music: ${activeAudioSegments.length}`);
    console.log(`🚫 Removed segments: ${removedSegmentCount}`);
    console.log(`📊 Total segments: ${parsedSegments.length}`);
    console.log('📊 ===============================================\n');
    
    // ✅ HANDLE CASE WHERE NO ACTIVE SEGMENTS (ALL REMOVED OR MUTED)
    if (activeAudioSegments.length === 0) {
      if (allowEmptyMusic === 'true') {
        console.log('🔇 No active music segments - restoring original video with FULL VOLUME');
        
        await new Promise((resolve, reject) => {
          ffmpeg(videoFilePath)
            // ✅ CRITICAL: Use original audio at full volume (no mixing)
            .outputOptions([
              '-c:v copy',           // Copy video without re-encoding
              '-c:a aac',            // Re-encode audio to ensure consistency
              '-b:a 192k',           // High quality audio
              '-ar 44100',           // Standard sample rate
              '-ac 2',               // Stereo
              '-af volume=1.0'       // ✅ EXPLICIT: Set audio to 100% volume
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('✅ Original video restored with FULL VOLUME (no music segments)');
              resolve();
            })
            .on('error', reject)
            .run();
        });
        
        // Verify output
        const stats = await fsPromises.stat(outputPath);
        const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
        
        console.log('\n🎉 ===============================================');
        console.log('🎉 ORIGINAL VIDEO VOLUME FULLY RESTORED');
        console.log('🎉 ===============================================');
        console.log('🔗 Video URL:', combinedUrl);
        console.log('🔊 Original audio: 100% volume (no music mixing)');
        console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
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
    
    // ✅ PROCESS VIDEO WITH ACTIVE MUSIC SEGMENTS
    console.log(`🎵 Creating video with ${activeAudioSegments.length} active music segments...`);
    
    // Sort segments by start time for proper layering
    activeAudioSegments.sort((a, b) => parseFloat(a.segment.start_time) - parseFloat(b.segment.start_time));
    
    console.log('🎵 FINAL AUDIO COMPOSITION:');
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
        
        console.log(`🎵 Single active segment mixing: ${index + 1}`);
        console.log(`   Music volume: ${Math.round(musicVolume * 100)}%`);
        console.log(`   Original video audio: PRESERVED`);
        console.log(`   Placement: ${segmentStart}s - ${segment.end_time}s`);
        
        const { filters, finalLabel } = buildAudioFilterWithFades(1, musicVolume, segment, segmentStart, 0);
        
        if (segmentStart > 0) {
          // ✅ PROPER MIXING: Both original audio + delayed music
          const silenceFilter = `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${segmentStart}[silence]`;
          const concatFilter = `[silence]${finalLabel}concat=n=2:v=0:a=1[delayed_music]`;
          
          // ✅ CRITICAL: MIX original video audio WITH music (not replace)
          const mixFilter = `[0:a][delayed_music]amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
          
          command = command.complexFilter([
            silenceFilter,
            ...filters,
            concatFilter,
            mixFilter  // ✅ This mixes BOTH audio streams
          ]);
        } else {
          // ✅ DIRECT MIXING: Original audio + music from start
          const mixFilter = `[0:a]${finalLabel}amix=inputs=2:duration=first:dropout_transition=0[final_audio]`;
          
          command = command.complexFilter([
            ...filters,
            mixFilter  // ✅ This mixes BOTH audio streams
          ]);
        }
      } else {
        // Multiple active audio segments - FIXED MIXING
        const filterParts = [];
        const mixInputs = ['[0:a]']; // Always include original video audio
        
        console.log(`🎵 Multiple active segments processing: ${activeAudioSegments.length}`);
        console.log(`   Original video audio: PRESERVED at full volume`);
        
        activeAudioSegments.forEach(({ index, musicInfo, segment }, arrayIndex) => {
          const segmentStart = parseFloat(segment.start_time);
          const musicVolume = musicInfo.effectiveVolume;
          const audioInputIndex = arrayIndex + 1;
          
          console.log(`   ${arrayIndex + 1}. Segment ${index + 1}: ${segmentStart}s (${Math.round(musicVolume * 100)}%)`);
          
          // ✅ FIXED: Proper function call with correct parameters
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
        
        // ✅ SIMPLIFIED: Mix all inputs without complex weights
        const inputCount = mixInputs.length;
        filterParts.push(`${mixInputs.join('')}amix=inputs=${inputCount}:duration=first:dropout_transition=0[final_audio]`);
        
        console.log(`🎵 FFmpeg filter: Mixing ${inputCount} audio streams (1 original + ${activeAudioSegments.length} music)`);
        
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
          console.log('🎬 FFmpeg command:', commandLine);
          
          // ✅ DEBUG: Log the complex filter being used
          const filterMatch = commandLine.match(/-filter_complex\s+"([^"]+)"/);
          if (filterMatch) {
            console.log('🔍 Complex filter being used:');
            console.log(filterMatch[1]);
          }
        })
        .on('end', () => {
          console.log('✅ Complete video with active segments finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err.message);
          
          // ✅ ENHANCED: Better error logging
          if (err.message.includes('Invalid stream specifier')) {
            console.error('🚨 Stream specifier error - likely too many audio inputs or invalid filter syntax');
          }
          if (err.message.includes('filter_complex')) {
            console.error('🚨 Complex filter error - check filter syntax');
          }
          
          console.log('🔄 Attempting fallback: copy original video...');
          
          // ✅ FALLBACK: Copy original video if mixing fails
          ffmpeg(videoFilePath)
            .output(outputPath)
            .on('end', () => {
              console.log('✅ Fallback completed - original video without music');
              resolve();
            })
            .on('error', (fallbackErr) => {
              console.error('❌ Fallback also failed:', fallbackErr.message);
              reject(fallbackErr);
            })
            .run();
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🔄 Progress: ${Math.round(progress.percent)}% done`);
          }
        })
        .run();
    });

    // Verify output file
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Output file is empty');
    }

    const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
    
    console.log('\n🎉 ===============================================');
    console.log('🎉 COMPLETE VIDEO WITH REMOVE/RESTORE READY');
    console.log('🎉 ===============================================');
    console.log('🔗 Video URL:', combinedUrl);
    console.log(`🎵 Active segments: ${activeAudioSegments.length}`);
    console.log(`🚫 Removed segments: ${removedSegmentCount}`);
    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
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
    console.error('❌ Error creating complete video with remove/restore:', error);
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
          console.warn(`⚠️ Could not delete ${file}:`, e.message);
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

    console.log('🎵 Audio mixing parameters:');
    console.log('   - Video duration:', videoDurationNum, 'seconds');
    console.log('   - Video start time:', videoStartNum, 'seconds');
    console.log('   - Music duration:', musicDurationNum, 'seconds');
    console.log('   - Music volume:', Math.round(musicVolumeNum * 100) + '%');
    console.log('   - Audio start:', audioStartNum, 'seconds');

    // ✅ FIXED: Simplified audio stream detection (no ffprobe needed)
    const hasAudioStream = true; // Assume video has audio by default

    console.log('Assuming video has audio stream (simplified approach)');

    // ✅ FIXED: Better audio mixing logic with proper delay and volume
    await new Promise((resolve, reject) => {
      let command = ffmpeg(videoFilePath)
        .input(audioFilePath);

      console.log('🎵 Processing video with audio mixing');
      
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
          console.log('🎬 FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log('✅ Video processing completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err.message);
          reject(err);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log('🔄 Processing: ' + Math.round(progress.percent) + '% done');
          }
        })
        .run();
    });

    // Verify output file
    const stats = await fsPromises.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Output file is empty');
    }

    console.log('✅ Combined video created:', outputPath, 'Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

    // Return the URL for the combined video
    const combinedUrl = `http://localhost:${PORT}/trimmed/${path.basename(outputPath)}`;
    res.json({ combinedUrl });

  } catch (err) {
    console.error('❌ Error combining video and audio:', err);
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
          console.log('🗑️ Cleaned up:', file);
        } catch (e) {
          console.warn(`⚠️ Could not delete temporary file ${file}:`, e.message);
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
    trackName, // 🚨 NEW: Accept track name
    segmentIndex,
    originalFileName
  } = req.body;
  
  try {
    console.log('💾 Saving recent track with name:', trackName || 'Unnamed Track');
    
    // Find if a track with the same audioUrl and userId already exists
    const existingTrack = await Track.findOne({ userId, audioUrl });

    if (existingTrack) {
      // Update existing track with new track name and timestamp
      existingTrack.generatedAt = Date.now();
      existingTrack.trackName = trackName || existingTrack.trackName || 'Unnamed Track';
      existingTrack.title = trackName || existingTrack.title || 'Unnamed Track'; // Keep title in sync
      await existingTrack.save();
      console.log(`✅ Track "${trackName}" updated for user ${userId}`);
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
        trackName: trackName || 'Unnamed Track', // 🚨 NEW: Store track name
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
      console.log(`✅ New track "${trackName}" saved for user ${userId}`);
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
    trackName, // 🚨 NEW: Accept track name (could be same as title)
    segmentIndex,
    originalFileName
  } = req.body;
  
  try {
    console.log('💾 Saving track to library with name:', trackName || title || 'Unnamed Track');
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const finalTrackName = trackName || title || 'Unnamed Track';

    const newTrack = new Track({
      userId,
      title: finalTrackName,
      trackName: finalTrackName, // 🚨 NEW: Store track name
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
    console.log(`✅ Track "${finalTrackName}" saved to library`);
    
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
// ADD this new endpoint to your index.js backend file
// This endpoint trims the video first, then sends only the trimmed portion to ClipTune

app.post('/api/cliptune-upload-trimmed', upload.single('video'), async (req, res) => {
  let originalPath, trimmedPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video uploaded' });
    }

    const { extra_prompt, video_start, video_end, total_seconds } = req.body;

    console.log('🎬 ===============================================');
    console.log('🎬 STARTING CLIPTUNE ANALYSIS WITH TRIMMED VIDEO');
    console.log('🎬 ===============================================');
    console.log('📁 Original video file:', req.file.originalname);
    console.log('📊 Original file size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('✂️ Trim start:', video_start + 's');
    console.log('✂️ Trim end:', video_end + 's');
    console.log('⏱️ Trimmed duration:', total_seconds + 's');
    console.log('🎯 Extra prompt:', extra_prompt || 'None provided');

    // Save original video temporarily
    originalPath = path.join(tempDir, `original_${Date.now()}.mp4`);
    await fsPromises.writeFile(originalPath, req.file.buffer);

    // Extract trim parameters
    const start = parseFloat(video_start);
    const end = parseFloat(video_end);
    const clipDuration = end - start;
    
    if (clipDuration <= 0) {
      throw new Error("Invalid time range for trimming");
    }

    console.log('\n✂️ ===============================================');
    console.log('✂️ TRIMMING VIDEO TO SELECTED SECTION');
    console.log('✂️ ===============================================');
    console.log('⏰ Start time:', start + 's');
    console.log('⏰ End time:', end + 's');
    console.log('⏱️ Duration:', clipDuration + 's');

    // Trim video to selected section
    trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(start)
        .setDuration(clipDuration)
        .output(trimmedPath)
        .on('end', () => {
          console.log('✅ Video trimmed successfully');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    // Clean up original file (we only need the trimmed version)
    await fsPromises.unlink(originalPath);
    originalPath = null;

    // Get file size of trimmed video
    const trimmedStats = await fsPromises.stat(trimmedPath);
    console.log('📊 Trimmed file size:', (trimmedStats.size / 1024 / 1024).toFixed(2), 'MB');

    console.log('\n1️⃣ ===============================================');
    console.log('1️⃣ REQUESTING UPLOAD TICKET FROM CLIPTUNE');
    console.log('1️⃣ ===============================================');
    
    // Step 1: Get upload ticket from ClipTune
    const ticketResponse = await axios.post(`${CLIPTUNE_API}/upload-ticket`);
    const { put_url, gcs_uri } = ticketResponse.data;
    
    console.log('✅ Upload ticket received successfully');
    console.log('🔗 GCS URI:', gcs_uri);

    console.log('\n2️⃣ ===============================================');
    console.log('2️⃣ UPLOADING TRIMMED VIDEO TO GOOGLE CLOUD STORAGE');
    console.log('2️⃣ ===============================================');
    
    // Step 2: Upload TRIMMED video to GCS
    const uploadStartTime = Date.now();
    
    await axios.put(put_url, fs.createReadStream(trimmedPath), {
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': trimmedStats.size
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    console.log('✅ TRIMMED video uploaded to GCS successfully');
    console.log('⏱️ Upload time:', uploadTime, 'seconds');

    console.log('\n3️⃣ ===============================================');
    console.log('3️⃣ ANALYZING TRIMMED VIDEO WITH CLIPTUNE AI');
    console.log('3️⃣ ===============================================');
    
    // Step 3: Call video-segments endpoint with TRIMMED video
    const formData = new URLSearchParams();
    formData.append('video_url', gcs_uri);
    if (extra_prompt) {
      formData.append('extra_prompt', extra_prompt);
    }
    // Send the trimmed duration as total_seconds
    if (total_seconds) {
      const durationInt = parseInt(total_seconds);
      formData.append('total_seconds', durationInt);
      console.log('📊 Sending trimmed duration to ClipTune:', durationInt, 'seconds');
    }

    console.log('📋 Analysis parameters:');
    console.log('   - video_url:', gcs_uri);
    console.log('   - extra_prompt:', extra_prompt || 'Not provided');
    console.log('   - total_seconds:', total_seconds || 'Not provided');
    console.log('   - analyzing:', 'TRIMMED VIDEO ONLY');
    
    const processingStartTime = Date.now();
    console.log('⏰ AI analysis started at:', new Date().toLocaleTimeString());
    console.log('⏳ Analyzing trimmed video section...');

    const segmentsResponse = await axios.post(`${CLIPTUNE_API}/video-segments`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 1000 * 60 * 10, // 10 minutes timeout
    });

    const processingTime = ((Date.now() - processingStartTime) / 1000).toFixed(2);
    
    console.log('\n✅ ===============================================');
    console.log('✅ CLIPTUNE AI ANALYSIS OF TRIMMED VIDEO COMPLETED');
    console.log('✅ ===============================================');
    console.log('⏱️ Processing time:', processingTime, 'seconds');
    console.log('📊 Response status:', segmentsResponse.status);

    // Apply field mapping to the response
    let mappedSegments = [];
    if (segmentsResponse.data && segmentsResponse.data.segments) {
      console.log('\n🔄 ===============================================');
      console.log('🔄 MAPPING SEGMENT FIELDS FOR TRIMMED VIDEO');
      console.log('🔄 ===============================================');
      
      console.log('📊 Raw segments received:', segmentsResponse.data.segments.length);
      
      // Map ClipTune response to expected field names
      mappedSegments = mapClipTuneResponse(segmentsResponse.data.segments);
      
      console.log('📊 Mapped segments:', mappedSegments.length);
      
      // Log segment details (these are now relative to the TRIMMED video)
      mappedSegments.forEach((segment, index) => {
        console.log(`Trimmed Video Segment ${index + 1}:`);
        console.log(`   - Start: ${segment.start_time || 'Unknown'}s (relative to trimmed video)`);
        console.log(`   - End: ${segment.end_time || 'Unknown'}s (relative to trimmed video)`);
        console.log(`   - Music Summary: ${segment.music_summary || 'No summary'}`);
        console.log(`   - AI Volume: ${segment.volume || 'Not specified'}`);
        console.log(`   - Fade Algorithm: ${segment.fade_algorithm || 'Not specified'}`);
        console.log('   ---');
      });
    }

    console.log('\n🎉 ===============================================');
    console.log('🎉 TRIMMED VIDEO ANALYSIS COMPLETED SUCCESSFULLY');
    console.log('🎉 ===============================================');
    console.log('✅ Sending response to client...');
    console.log('📊 Final segments count:', mappedSegments.length);
    console.log('✂️ All segments are relative to the TRIMMED video section');
    console.log('⏱️ Original trim: ' + start + 's - ' + end + 's');

    // Return mapped segments (relative to trimmed video)
    res.json({
      success: true,
      result: {
        ...segmentsResponse.data,
        segments: mappedSegments  // Segments relative to trimmed video
      },
      trim_info: {
        original_start: start,
        original_end: end,
        trimmed_duration: clipDuration,
        segments_relative_to: 'trimmed_video'
      },
      debug: {
        rawResponseKeys: Object.keys(segmentsResponse.data),
        originalSegmentsCount: segmentsResponse.data.segments ? segmentsResponse.data.segments.length : 0,
        mappedSegmentsCount: mappedSegments.length,
        processingTime: processingTime + 's',
        trimmedDurationSent: total_seconds || 'Not provided',
        originalTrimStart: start,
        originalTrimEnd: end
      },
      message: 'Trimmed video analyzed successfully. All segments are relative to the trimmed portion.'
    });

  } catch (error) {
    console.log('\n❌ ===============================================');
    console.log('❌ TRIMMED VIDEO CLIPTUNE ANALYSIS ERROR');
    console.log('❌ ===============================================');
    console.error('💥 Error message:', error.message);
    console.error('💥 Error stack:', error.stack);
    
    if (error.response) {
      console.error('📊 HTTP Status:', error.response.status);
      console.error('📊 Response Data:', JSON.stringify(error.response.data, null, 2));
    }

    res.status(500).json({
      success: false,
      error: 'Trimmed video ClipTune analysis failed',
      details: error.message,
      debugInfo: {
        hasResponse: !!error.response,
        responseStatus: error.response?.status,
        responseData: error.response?.data
      }
    });
  } finally {
    // Clean up temporary files
    const filesToClean = [originalPath, trimmedPath].filter(Boolean);
    for (const file of filesToClean) {
      try {
        await fsPromises.unlink(file);
        console.log('🗑️ Cleaned up:', file);
      } catch (e) {
        console.warn(`⚠️ Could not delete temporary file ${file}:`, e.message);
      }
    }
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
  