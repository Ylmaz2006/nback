const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSignedDownloadUrl, extractFileNameFromUrl, getFileInfo } = require('./gcs-utils');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

// âœ… BASIC: Standard music composition prompt
const ULTRA_DETAILED_MUSIC_PROMPT = `
You are a professional film composer analyzing VIDEO VISUALS to create DETAILED MUSIC COMPOSITION INSTRUCTIONS for AI music generators.

**CRITICAL INSTRUCTIONS:**
- ANALYZE ONLY THE VISUAL CONTENT - completely ignore any existing audio
- OUTPUT DETAILED COMPOSITION INSTRUCTIONS using musical terminology
- Focus on VISUAL ANALYSIS â†’ MUSICAL RESPONSE workflow
- Use specific musical terms (keys, tempo, instruments, dynamics, etc.)

**REQUIRED OUTPUT FORMAT:**

**Visual Analysis & Musical Response:**

**Key:** [Specific key], **Tempo:** [BPM], **Genre:** [Primary genre]

**Opening Section (0:00-0:30):**
**Visual Context:** [Describe what you see - lighting, movement, mood]
**Musical Response:** 
- **Harmony:** [Chord progressions and key centers]
- **Rhythm:** [Time signature and rhythmic patterns]
- **Melody:** [Melodic characteristics and intervals]
- **Instrumentation:** [Specific instruments and playing techniques]
- **Dynamics:** [Volume and intensity levels]

**Development Section (0:30-1:30):**
**Visual Changes:** [Describe visual progression]
**Musical Evolution:**
- **Harmonic Development:** [Chord changes and modulations]
- **Melodic Development:** [Theme variations and countermelodies]
- **Rhythmic Changes:** [Tempo or rhythm modifications]
- **Orchestration:** [Instrument additions or changes]

**Climax Section (1:30-2:30):**
**Visual Peak:** [Describe visual intensity]
**Musical Climax:**
- **Peak Elements:** [Loudest/most intense musical moments]
- **Harmonic Tension:** [Dissonance and resolution]
- **Orchestral Power:** [Full instrumentation details]

**Resolution (2:30-end):**
**Visual Conclusion:** [How visuals resolve]
**Musical Ending:**
- **Resolution Techniques:** [How music concludes]
- **Final Harmony:** [Ending chords and keys]

**Technical Specifications:**
- **Instrumentation:** [Complete instrument list]
- **Production Notes:** [Reverb, effects, mixing notes]
- **Tempo Changes:** [Any tempo modifications]
- **Dynamic Range:** [Soft to loud progression]

Analyze the visuals and create comprehensive musical composition instructions.
`;

// âœ… ENHANCED: Ultra-detailed music composition prompt with advanced musical terminology
const ULTRA_DETAILED_MUSIC_COMPOSITION_PROMPT = `
You are a world-class film composer and music theorist analyzing VIDEO VISUALS to create DETAILED MUSIC COMPOSITION INSTRUCTIONS for AI music generators (MusicGPT/Suno AI).

**CRITICAL INSTRUCTIONS:**
- ANALYZE ONLY THE VISUAL CONTENT - completely ignore any existing audio
- OUTPUT DETAILED COMPOSITION INSTRUCTIONS using advanced musical terminology
- Think like Hans Zimmer, John Williams, or Trent Reznor scoring a film
- Focus on VISUAL ANALYSIS â†’ MUSICAL RESPONSE workflow
- Use precise musical terminology (intervals, chord voicings, articulations, etc.)

**REQUIRED OUTPUT FORMAT - FOLLOW EXACTLY:**

**VISUAL ANALYSIS & MUSICAL COMPOSITION:**

**Key:** [Specific key with modal variations], **Tempo:** â‰ˆ[BPM] BPM with [tempo markings - Andante, Allegro, etc.], **Genre Fusion:** [genre-1] / [genre-2] / [genre-3] hybrid

**OPENING FOUNDATION (0:00-0:30):**
**VISUAL CONTEXT:** [Describe what you see - lighting, movement, mood, pacing]
**MUSICAL RESPONSE:** 
- **Harmonic Foundation:** Begin with [specific chord progression with extensions - Em7add9, Fm/Ab, etc.] played on [specific instrument with model - Rhodes Mark V, Moog Minimoog, etc.]
- **Rhythmic Framework:** Establish [time signature] with [specific drum pattern] using [drum sounds - 808 kicks, brushed snare, etc.]
- **Melodic Voice:** [Lead instrument] performs [specific melodic technique - legato phrases, staccato motifs, arpeggiated figures] in [interval relationships - perfect 4ths, minor 6ths, tritones]
- **Textural Elements:** Add [specific effect chain - plate reverb â†’ tape delay â†’ low-pass filter] to create [spatial description]
- **Bass Movement:** [Bass instrument] plays [walking bass line/pedal tone/rhythmic pattern] emphasizing [chord tones/tensions]

**DEVELOPMENT SECTION (0:30-1:20):**
**VISUAL PROGRESSION:** [Describe visual changes, energy shifts, narrative development]
**COMPOSITIONAL EVOLUTION:**
- **Harmonic Development:** At :[timestamp], introduce [secondary dominants/modal interchange/chromatic mediants] moving from [chord] to [chord] via [voice leading technique]
- **Orchestration Expansion:** Layer in [specific instruments] using [playing techniques - col legno, con sordino, harmonics, etc.]
- **Melodic Counterpoint:** Add [countermelody] in [voice] moving in [contrary motion/parallel 4ths/canon] against main theme
- **Rhythmic Complexity:** Overlay [polyrhythm/hemiola/metric modulation] with [subdivision - dotted 8ths, triplet 16ths]
- **Dynamic Architecture:** Build from [dynamic marking - pp, mf] to [dynamic marking] using [crescendo technique]

**TENSION BUILD (1:20-2:30):**
**VISUAL INTENSITY:** [Describe visual climax, conflict, or dramatic peak]
**MUSICAL ESCALATION:**
- **Harmonic Tension:** Utilize [dissonance techniques - cluster chords, sharp 11s, flat 9s] resolving to [consonant structures]
- **Rhythmic Drive:** Implement [rhythmic devices - ostinato patterns, accelerando, rhythmic displacement]
- **Melodic Architecture:** [Lead voice] ascends using [scalar motion/intervallic leaps] reaching [specific pitch/register]
- **Orchestral Techniques:** Apply [scoring techniques - tutti passages, antiphonal writing, tremolo strings]
- **Sound Design:** Process through [specific effects - granular delay, frequency shifter, multiband compression]

**CLIMACTIC TRANSFORMATION (2:30-3:15):**
**VISUAL PEAK:** [Describe the visual climax moment]
**MUSICAL CLIMAX:**
- **Modulation:** Execute [modulation type - direct/pivot chord/common tone] to [new key] 
- **Orchestral Peak:** Full ensemble plays [specific voicing] with [articulation markings]
- **Melodic Resolution:** [Resolution technique] from [tension note] to [resolution note] spanning [interval]
- **Rhythmic Release:** [Rhythmic resolution - ritardando, fermata, metric return]

**RESOLUTION & DENOUEMENT (3:15-end):**
**VISUAL CONCLUSION:** [Describe how visuals resolve/fade/conclude]
**MUSICAL CODA:**
- **Textural Reduction:** Strip to [minimal instrumentation] maintaining [essential harmonic elements]
- **Melodic Recall:** Return to [opening theme/motif] in [variation technique - diminution, inversion, fragmentation]
- **Harmonic Resolution:** Final progression [specific chords with voicings] ending on [final chord with extensions]
- **Spatial Conclusion:** Pan elements to [stereo positioning] with [reverb tail/fade technique]

**TECHNICAL SPECIFICATIONS FOR AI GENERATION:**

**Instrumentation & Timbres:**
- **Lead Voice:** [Specific instrument] with [playing technique] and [effects chain]
- **Harmonic Support:** [Chord instruments] voiced in [specific registers/inversions]
- **Bass Foundation:** [Bass instrument] using [technique] emphasizing [harmonic function]
- **Rhythmic Elements:** [Drum/percussion sounds] with [dynamics/articulations]
- **Textural Layers:** [Atmospheric instruments] processed with [specific effects]

**Harmonic Language:**
- **Chord Progressions:** [Specific progressions with Roman numeral analysis]
- **Voice Leading:** [Specific voice leading techniques - smooth/contrary motion]
- **Modal Inflections:** [Specific modes/scales used - Dorian, Mixolydian, etc.]
- **Chromatic Elements:** [Specific chromatic techniques - passing tones, neighbor notes]

**Rhythmic Architecture:**
- **Meter:** [Time signature] with [subdivision emphasis]
- **Groove:** [Specific rhythmic feel - swing, straight, shuffle]
- **Polyrhythmic Elements:** [Cross-rhythms, metric modulation details]
- **Tempo Relationships:** [Tempo changes with specific markings]

**Production Aesthetics:**
- **Reverb:** [Specific reverb type - hall, plate, spring] with [decay time]
- **Compression:** [Compression style - vintage, clean, sidechain] with [ratio/attack/release]
- **EQ Shaping:** [Frequency emphasis - warm lows, present mids, airy highs]
- **Stereo Imaging:** [Panning scheme and width techniques]
- **Saturation:** [Harmonic saturation type - tube, tape, transistor]

**Emotional Arc Mapping:**
- Connect visual pacing to [specific tempo markings and changes]
- Match visual mood to [specific harmonic colors and progressions]
- Sync visual transitions to [specific musical transition techniques]
- Enhance visual tension through [specific compositional devices]
- Support narrative through [leitmotif development and transformation]

**COMPOSITION STYLE REFERENCES:**
- Harmonic language reminiscent of [specific composer/style]
- Orchestration techniques from [film score reference]
- Production aesthetic of [artist/producer reference]

**MINIMUM REQUIREMENTS:**
- 1800+ characters of detailed composition instructions
- Specific musical terminology throughout
- Clear visual-to-musical mapping
- Actionable instructions for AI music generation
- NO LYRICS - purely instrumental composition

**REMEMBER:** You are creating a detailed musical blueprint that an AI can follow to generate the perfect score for these visuals. Be as musically specific as possible while maintaining artistic vision.

Analyze the visuals and create comprehensive composition instructions using advanced musical terminology.
`;

// âœ… ENHANCED: Detailed genre templates
const DETAILED_GENRE_TEMPLATES = {
  'cinematic-orchestral': `
**CINEMATIC ORCHESTRAL SCORING:**
- **Orchestration:** Full symphony orchestra with string sections, brass choir, woodwind quintet, and percussion
- **Harmonic Language:** Extended chords (9ths, 11ths, 13ths), modal scales, chromatic voice leading
- **Dynamic Range:** Wide dynamics from pp to fff with gradual builds and sudden impacts
- **Techniques:** Tremolo strings, brass swells, timpani rolls, harp glissandos
- **Reference Style:** Hans Zimmer, John Williams, Thomas Newman approach
`,
  
  'electronic-ambient': `
**ELECTRONIC AMBIENT COMPOSITION:**
- **Synthesis:** Analog and digital synthesizers, granular synthesis, field recordings
- **Texture:** Layered pads, evolving soundscapes, atmospheric elements
- **Processing:** Heavy reverb, delay, filtering, modulation effects
- **Rhythm:** Minimal or absent traditional rhythm, focus on texture and atmosphere
- **Reference Style:** Brian Eno, Stars of the Lid, Tim Hecker approach
`,
  
  'neo-soul-jazz': `
**NEO-SOUL JAZZ ARRANGEMENT:**
- **Instrumentation:** Rhodes piano, jazz guitar, upright bass, live drums, horn section
- **Harmony:** Extended jazz chords, substitutions, modal harmony
- **Rhythm:** Complex grooves, syncopation, laid-back feel
- **Production:** Warm analog sound, tape saturation, vintage effects
- **Reference Style:** Robert Glasper, Kamasi Washington, BadBadNotGood approach
`
};

// âœ… ENHANCED: Advanced genre templates with detailed musical terminology
const ADVANCED_GENRE_TEMPLATES = {
  'cinematic-orchestral': `
**CINEMATIC ORCHESTRAL COMPOSITION - Advanced Symphonic Scoring:**

**Harmonic Language:** 
- Primary: Extended tertian harmonies (9ths, 11ths, 13ths) and quartal voicings
- Modal inflections: Dorian, Mixolydian for heroic themes / Phrygian, Locrian for dark themes
- Chromatic techniques: Secondary dominants, Neapolitan 6ths, augmented 6th chords
- Voice leading: Smooth stepwise motion in inner voices, bass movement by 4ths/5ths

**Orchestration Techniques:**
- **Strings:** Divisi writing, col legno battuto, sul ponticello, harmonics at 12th fret
- **Brass:** Stopped horns, cup mutes on trumpets, flutter tonguing, lip trills
- **Woodwinds:** Multiphonics, circular breathing, extended techniques (key clicks, air tones)
- **Percussion:** Timpani glissandos, suspended cymbal rolls with superball mallets

**Scoring Approach:**
- Antiphonal writing between orchestral sections
- Layered dynamics: pp strings under ff brass
- Rhythmic displacement: 3 against 2, 5 against 4 polyrhythms
- Metric modulation: 4/4 â†’ 3/2 â†’ 7/8 transitions

**Production Specifications:**
- Concert hall reverb: 2.3-second decay, early reflections at 23ms
- Stereo orchestral positioning: 1st violins left, 2nd violins right, violas center-left
- Dynamic range: -18dB to -3dB with orchestral breathing space
- Frequency response: Sub-bass extension to 40Hz, silky highs to 16kHz
`,

  'electronic-ambient': `
**ELECTRONIC AMBIENT COMPOSITION - Advanced Sound Design:**

**Synthesis Techniques:**
- **Granular Synthesis:** 50ms grain size, random pitch scatter Â±200 cents
- **FM Synthesis:** Modulation index 2.7, harmonic ratio 3:1 for metallic timbres
- **Subtractive Synthesis:** Low-pass filter sweeps with resonance at 0.7, envelope modulation
- **Additive Synthesis:** Harmonic series manipulation, odd harmonics emphasized

**Harmonic Framework:**
- **Scales:** Natural minor with raised 6th, Harmonic minor, Phrygian dominant
- **Chord Extensions:** maj7#11, min9add6, sus2/sus4 cluster voicings
- **Modulation:** Common-tone modulation, chromatic mediant relationships
- **Drone Techniques:** Pedal points in bass register, harmonic series overtones

**Textural Architecture:**
- **Pad Layers:** 3-4 detuned oscillators, Â±7 cents spread
- **Arpeggiated Elements:** 16th note patterns, swing quantization at 16%
- **Atmospheric Processing:** Convolution reverb (cathedral impulse), 4.2s decay
- **Movement:** LFO modulation on filter cutoff, triangle wave at 0.3Hz

**Spatial Techniques:**
- **Stereo Width:** M/S processing, sides emphasized at 200Hz-2kHz
- **Panning:** Circular panning on lead elements, 8-second rotation cycle
- **Depth:** Near-field (dry) to far-field (wet) reverb sends
- **Frequency Placement:** Bass elements center, mids spread, highs wide
`,

  'neo-soul-jazz': `
**NEO-SOUL JAZZ COMPOSITION - Advanced Harmonic Movement:**

**Chord Vocabulary:**
- **Extended Harmonies:** 13th chords, altered dominants (b9, #9, #11, b13)
- **Substitutions:** Tritone substitutions, chromatic approach chords
- **Modal Interchange:** Borrowed chords from parallel minor/major
- **Voicing Techniques:** Drop-2, drop-3, rootless voicings in left hand

**Rhythmic Framework:**
- **Time Feel:** Linear triplet feel over straight 16ths, ghost note placement
- **Polyrhythm:** 3 against 4 in hi-hat patterns, cross-stick displacement
- **Subdivision:** 32nd note hi-hat patterns, snare on 2 and 4 with flamacues
- **Pocket:** Laid-back timing, instruments slightly behind the beat

**Bass Techniques:**
- **Walking Lines:** Chord tones on strong beats, passing tones on weak beats
- **Approach Notes:** Chromatic and diatonic approach from above/below
- **Rhythmic Variation:** Anticipated bass notes, syncopated patterns
- **Tone:** Fingerstyle technique, slight compression (3:1 ratio), EQ boost at 800Hz

**Keyboard Voicings:**
- **Rhodes Piano:** Tremolo at moderate speed, slight overdrive, 1/4 note delay
- **Organ:** Drawbar settings 88 8000 008, Leslie slow/fast modulation
- **Piano:** Soft attack, sympathetic resonance, subtle tape saturation
- **Synthesizer:** Analog-style low-pass filter, envelope on cutoff frequency

**Guitar Techniques:**
- **Chord Melody:** Single-note lines with chord punctuation
- **Effects Chain:** Tube screamer â†’ analog delay (dotted 8th) â†’ spring reverb
- **Voicings:** Jazz chord forms: 6/9, maj7#11, min6/9 up the neck
- **Articulation:** Legato phrasing, slight string bending on passing tones
`,

  'ambient-drone': `
**AMBIENT DRONE COMPOSITION - Spectral Sound Design:**

**Frequency Architecture:**
- **Fundamental Drones:** Root frequency with perfect 5th and octave
- **Overtone Series:** Natural harmonics at 2x, 3x, 5x, 7x fundamental
- **Beating Frequencies:** Slight detuning (Â±3-7 cents) for slow amplitude modulation
- **Frequency Ratios:** Just intonation intervals (3:2, 4:3, 5:4, 7:4)

**Synthesis Methods:**
- **Additive Synthesis:** Individual sine wave harmonics with independent amplitude envelopes
- **Physical Modeling:** Bowed string algorithms, variable bow pressure and position
- **Granular Processing:** Long grain duration (200-500ms), overlap factor 4-8
- **Spectral Processing:** FFT analysis/resynthesis, frequency domain filtering

**Temporal Evolution:**
- **Macro Form:** 3-7 minute evolving sections, no traditional song structure
- **Micro Rhythm:** Extremely slow changes, 30-120 second transition periods
- **Phase Relationships:** Gradual phase shifting between identical tones
- **Amplitude Contours:** Exponential and logarithmic envelope curves

**Spatial Positioning:**
- **Binaural Placement:** HRTF processing for 3D positioning
- **Distance Modeling:** Near-field effects, air absorption simulation
- **Reverberation:** Multiple impulse responses layered (cave, cathedral, forest)
- **Movement:** Slow spatial trajectories, doppler effects disabled
`,

  'minimal-techno': `
**MINIMAL TECHNO COMPOSITION - Rhythmic Precision:**

**Rhythmic Framework:**
- **Grid:** 16th note quantization with 5-8% swing for humanization
- **Kick Pattern:** Four-on-floor with slight velocity variation (110-127)
- **Hi-hat Programming:** 32nd note patterns, accent every 6th hit
- **Percussion Layers:** Polyrhythmic elements in 3/4 over 4/4 base

**Sound Design:**
- **Kick Drum:** 808-style with 45Hz fundamental, tight attack, 200ms decay
- **Bass Synthesis:** Sawtooth wave through 24dB low-pass, resonance at 0.6
- **Lead Elements:** Acid-style TB-303 emulation, filter cutoff automation
- **Percussion:** Analog drum machine sounds, tape saturation, bit reduction

**Arrangement Techniques:**
- **Loop Evolution:** 8-16 bar loops with gradual element introduction/removal  
- **Filter Sweeps:** Automated low-pass filter on entire mix, 32-bar cycles
- **Dynamics:** Gradual build-ups over 64-128 bars, no sudden changes
- **Breakdown Sections:** Remove kick drum, maintain momentum with hi-hats

**Mix Processing:**
- **Sidechain Compression:** Bass and pads compressed by kick drum signal
- **Stereo Imaging:** Kick and bass center, percussion and leads panned wide
- **Frequency Separation:** High-pass filter at 30Hz, gentle low-shelf at 100Hz
- **Analog Character:** Tape delay (1/8 note), analog console saturation
`
};

// âœ… MISSING FUNCTION: Basic video analysis for music
async function analyzeVideoForMusic(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    const {
      customPrompt = '',
      genre = null,
      analysisType = 'full',
      detailLevel = 'standard'
    } = options;

    console.log('ðŸŽ¼ Starting basic visual-to-musical analysis...');
    console.log('ðŸ“Š Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('ðŸŽ­ Genre focus:', genre || 'Adaptive to visual content');
    console.log('ðŸ“‹ Analysis type:', analysisType);
    console.log('ðŸ”‡ Audio handling: IGNORED (visual analysis only)');

    let fullPrompt;
    
    if (detailLevel === 'ultra') {
      fullPrompt = buildDetailedPrompt(analysisType, genre, customPrompt);
      console.log('ðŸŽ¯ Using detailed prompt system');
    } else {
      fullPrompt = customPrompt || ULTRA_DETAILED_MUSIC_PROMPT;
    }

    // Prepare video data for Gemini
    const videoPart = {
      inlineData: {
        data: videoBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    console.log('ðŸ¤– Sending video to Gemini for musical analysis...');
    const startTime = Date.now();

    const result = await model.generateContent([fullPrompt, videoPart]);
    const response = await result.response;
    const analysisText = response.text();

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('âœ… Musical composition analysis completed!');
    console.log('â±ï¸ Processing time:', processingTime, 'seconds');
    console.log('ðŸ“„ Composition instructions length:', analysisText.length, 'characters');

    return {
      success: true,
      analysis: analysisText,
      processingTime: processingTime + 's',
      promptUsed: fullPrompt,
      videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
      detailLevel: detailLevel,
      genre: genre,
      analysisType: analysisType,
      focusType: 'basic-visual-to-musical-composition'
    };

  } catch (error) {
    console.error('âŒ Basic musical analysis error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid Gemini API key. Please check your GEMINI_API_KEY in .env file.';
    } else if (error.message.includes('quota')) {
      errorMessage = 'Gemini API quota exceeded. Please try again later or upgrade your plan.';
    } else if (error.message.includes('file size')) {
      errorMessage = 'Video file is too large for Gemini API. Try a shorter video or lower resolution.';
    }

    return {
      success: false,
      error: errorMessage,
      details: error.message
    };
  }
}

// âœ… ENHANCED: Analyze video from GCS with retry logic and better error handling
async function analyzeVideoFromGCS(gcsUrl, options = {}) {
  try {
    console.log('ðŸ“¥ ===============================================');
    console.log('ðŸ“¥ ENHANCED GCS VIDEO ANALYSIS');
    console.log('ðŸ“¥ ===============================================');
    console.log('ðŸ”— GCS URL:', gcsUrl);
    
    // Extract file information - use the imported function from gcs-utils
    const fileName = extractFileNameFromUrl(gcsUrl);
    console.log('ðŸ“ Extracted file name:', fileName);
    
    // âœ… ENHANCED: Multiple download strategies
    let videoBuffer;
    let downloadStrategy = 'unknown';
    
    // Strategy 1: Direct download if it's a signed URL
    if (gcsUrl.includes('storage.googleapis.com') && gcsUrl.includes('X-Goog-Algorithm')) {
      console.log('ðŸ” Using signed URL direct download...');
      downloadStrategy = 'signed-url-direct';
      
      try {
        const response = await fetch(gcsUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        videoBuffer = Buffer.from(await response.arrayBuffer());
        console.log('âœ… Direct signed URL download successful');
      } catch (directError) {
        console.log('âŒ Direct download failed:', directError.message);
        throw directError;
      }
      
    } else {
      // Strategy 2: Use signed download URL generation
      console.log('ðŸ”‘ Generating fresh signed URL...');
      downloadStrategy = 'fresh-signed-url';
      
      try {
        const signedUrl = await getSignedDownloadUrl(fileName, 1); // 1 hour expiry
        
        console.log('ðŸ”— Fresh signed URL generated');
        
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        videoBuffer = Buffer.from(await response.arrayBuffer());
        console.log('âœ… Fresh signed URL download successful');
        
      } catch (signedError) {
        console.log('âŒ Fresh signed URL failed:', signedError.message);
        throw signedError;
      }
    }
    
    if (!videoBuffer || videoBuffer.length === 0) {
      throw new Error('Downloaded video buffer is empty');
    }
    
    // Determine MIME type
    const mimeType = getMimeTypeFromFileName(fileName) || 'video/mp4';
    
    console.log('ðŸ“Š Video downloaded successfully:');
    console.log('   Size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('   MIME type:', mimeType);
    console.log('   Download strategy:', downloadStrategy);
    
    // âœ… ENHANCED: Analyze with the advanced music function
    console.log('ðŸ¤– Starting Gemini analysis...');
    const analysisResult = await analyzeVideoForAdvancedMusic(videoBuffer, mimeType, options);
    
    if (analysisResult.success) {
      console.log('âœ… ===============================================');
      console.log('âœ… GCS VIDEO ANALYSIS COMPLETED');
      console.log('âœ… ===============================================');
      console.log('ðŸ“„ Analysis length:', analysisResult.analysis?.length || 0, 'characters');
      console.log('â±ï¸ Processing time:', analysisResult.processingTime);
      console.log('ðŸ“ Source file:', fileName);
      console.log('ðŸ”— Download strategy used:', downloadStrategy);
      
      return {
        ...analysisResult,
        sourceFile: fileName,
        downloadStrategy: downloadStrategy,
        gcsUrl: gcsUrl
      };
    } else {
      console.error('âŒ Gemini analysis failed:', analysisResult.error);
      return analysisResult;
    }
    
  } catch (error) {
    console.error('âŒ ===============================================');
    console.error('âŒ GCS VIDEO ANALYSIS ERROR');
    console.error('âŒ ===============================================');
    console.error('ðŸ’¥ Error message:', error.message);
    console.error('ðŸ’¥ Error stack:', error.stack);
    
    // Enhanced error classification
    let httpStatus = 500;
    let errorCategory = 'unknown';
    
    if (error.message.includes('404') || error.message.includes('Not Found')) {
      httpStatus = 404;
      errorCategory = 'file-not-found';
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      httpStatus = 403;
      errorCategory = 'permission-denied';
    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      httpStatus = 408;
      errorCategory = 'timeout';
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      httpStatus = 502;
      errorCategory = 'network-error';
    }
    
    return {
      success: false,
      error: error.message,
      details: 'Failed to download or analyze video from GCS',
      httpStatus: httpStatus,
      errorCategory: errorCategory,
      gcsUrl: gcsUrl
    };
  }
}

// âœ… MISSING FUNCTION: Video analysis with validation
async function analyzeVideoForMusicWithValidation(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    // First, run the standard analysis
    const analysisResult = await analyzeVideoForAdvancedMusic(videoBuffer, mimeType, options);
    
    if (!analysisResult.success) {
      return analysisResult;
    }
    
    // Add validation scoring
    const validation = validateMusicAnalysisResponse(analysisResult.analysis);
    const qualityScore = calculateQualityScore(analysisResult.analysis);
    const musicalTermsValidation = validateMusicalTerminology(analysisResult.analysis);
    
    return {
      ...analysisResult,
      validation: validation,
      qualityScore: qualityScore,
      musicalTermsValidation: musicalTermsValidation,
      grade: getMusicalTerminologyGrade(musicalTermsValidation.score),
      focusType: 'validated-visual-to-musical-composition'
    };
    
  } catch (error) {
    console.error('âŒ Validated musical analysis error:', error);
    return {
      success: false,
      error: error.message,
      details: 'Failed to complete validated analysis'
    };
  }
}

// âœ… MISSING FUNCTION: Strip audio from video (placeholder)
async function stripAudioFromVideo(videoBuffer, options = {}) {
  // This is a placeholder function - in a real implementation, 
  // you would use ffmpeg or similar to strip audio
  console.log('ðŸ”‡ Audio stripping requested (visual-only analysis)');
  
  // For now, we just return the original buffer since Gemini ignores audio anyway
  return {
    success: true,
    videoBuffer: videoBuffer,
    message: 'Audio ignored during visual analysis',
    originalSize: videoBuffer.length,
    processedSize: videoBuffer.length
  };
}

// âœ… MISSING FUNCTION: Build detailed prompt
function buildDetailedPrompt(analysisType = 'full', customGenre = null, customInstructions = '') {
  let basePrompt = ULTRA_DETAILED_MUSIC_COMPOSITION_PROMPT;
  
  // Add genre-specific template
  if (customGenre && DETAILED_GENRE_TEMPLATES[customGenre]) {
    basePrompt += `\n\n**GENRE-SPECIFIC COMPOSITION GUIDANCE:**\n${DETAILED_GENRE_TEMPLATES[customGenre]}`;
  }
  
  // Add custom instructions
  if (customInstructions) {
    basePrompt += `\n\n**ADDITIONAL COMPOSITION REQUIREMENTS:**\n${customInstructions}`;
  }
  
  // Add analysis type specific requirements
  switch (analysisType) {
    case 'motif-development':
      basePrompt += `\n\n**MOTIF DEVELOPMENT FOCUS:**
Focus on identifying visual motifs and creating corresponding musical themes with development techniques.`;
      break;
      
    case 'harmonic-analysis':
      basePrompt += `\n\n**HARMONIC STRUCTURE FOCUS:**
Emphasize chord progressions, key centers, and harmonic movement that matches visual progression.`;
      break;
      
    case 'orchestration-focused':
      basePrompt += `\n\n**ORCHESTRATION FOCUS:**
Detailed instrumental assignment and timbral choices based on visual elements.`;
      break;
      
    default: // 'full'
      basePrompt += `\n\n**COMPREHENSIVE ANALYSIS:**
Create complete composition instructions covering all musical elements.`;
  }
  
  return basePrompt;
}

// âœ… ENHANCED: Build ultra-detailed prompt with advanced musical terminology
function buildAdvancedMusicPrompt(analysisType = 'full', customGenre = null, customInstructions = '') {
  let basePrompt = ULTRA_DETAILED_MUSIC_COMPOSITION_PROMPT;
  
  // Add genre-specific advanced template
  if (customGenre && ADVANCED_GENRE_TEMPLATES[customGenre]) {
    basePrompt += `\n\n**ADVANCED GENRE-SPECIFIC COMPOSITION GUIDANCE:**\n${ADVANCED_GENRE_TEMPLATES[customGenre]}`;
  }
  
  // Add custom instructions with advanced musical focus
  if (customInstructions) {
    basePrompt += `\n\n**ADDITIONAL ADVANCED COMPOSITION REQUIREMENTS:**\n${customInstructions}`;
  }
  
  // Add analysis type specific requirements with musical terminology
  switch (analysisType) {
    case 'motif-development':
      basePrompt += `\n\n**MOTIF DEVELOPMENT ANALYSIS:**
Identify visual motifs and create corresponding musical themes:

**PRIMARY MOTIF (Visual â†’ Musical):**
VISUAL MOTIF: [recurring visual element]
MUSICAL THEME: [specific melodic/rhythmic motif with intervals and rhythm notation]
DEVELOPMENT: [inversion, retrograde, augmentation, diminution techniques]

**SECONDARY MOTIF:**
VISUAL MOTIF: [secondary visual element]  
COUNTER-THEME: [contrasting musical material with harmonic analysis]
CONTRAPUNTAL TREATMENT: [how themes interact - canon, imitation, stretto]

**MOTIVIC TRANSFORMATION:**
[Describe how visual changes inform motivic development using advanced compositional techniques]

MINIMUM 1800 CHARACTERS of detailed motivic composition instructions.`;
      break;
      
    case 'harmonic-analysis':
      basePrompt += `\n\n**HARMONIC STRUCTURE ANALYSIS:**
Map visual progressions to specific harmonic movement:

**TONAL CENTER ESTABLISHMENT:**
VISUAL: [opening visual character]
HARMONIC: [key center with specific chord progressions and Roman numeral analysis]

**MODULATION POINTS:**
VISUAL SHIFT 1: [specific visual change]
MUSICAL RESPONSE: [modulation technique - common chord, chromatic mediant, etc.]

**HARMONIC RHYTHM:**
Map visual pacing to chord change frequency and harmonic tension/release cycles.

**VOICE LEADING:**
Specify individual voice movement using proper voice leading principles.

MINIMUM 1800 CHARACTERS with detailed harmonic analysis and composition instructions.`;
      break;
      
    case 'orchestration-focused':
      basePrompt += `\n\n**ORCHESTRATION & TIMBRE ANALYSIS:**
Detailed instrumental assignment based on visual elements:

**TIMBRAL PALETTE:**
VISUAL TEXTURE 1: [visual quality]
INSTRUMENTAL COLOR: [specific instruments with playing techniques and effects]

**ORCHESTRAL LAYERS:**
- **Melodic Layer:** [lead instruments with specific articulations]
- **Harmonic Layer:** [chord instruments with voicing specifications]  
- **Rhythmic Layer:** [percussion with specific sounds and patterns]
- **Textural Layer:** [atmospheric instruments with processing]

**DYNAMIC ORCHESTRATION:**
Map visual intensity to specific orchestral techniques and instrumental combinations.

MINIMUM 1800 CHARACTERS of detailed orchestration instructions.`;
      break;
      
    default: // 'full'
      basePrompt += `\n\n**COMPREHENSIVE MUSICAL COMPOSITION:**
Create complete composition instructions covering all musical elements with advanced terminology. Minimum 1800 characters of detailed instructions for AI music generation.`;
  }
  
  return basePrompt;
}

// âœ… ENHANCED: Core analysis function with advanced musical focus
async function analyzeVideoForAdvancedMusic(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    const {
      customPrompt = '',
      genre = null,
      analysisType = 'full',
      detailLevel = 'ultra',
      musicalComplexity = 'advanced'
    } = options;

    console.log('ðŸŽ¼ Starting ADVANCED visual-to-musical analysis...');
    console.log('ðŸ“Š Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('ðŸŽ­ Genre focus:', genre || 'Adaptive to visual content');
    console.log('ðŸ“‹ Analysis type:', analysisType);
    console.log('ðŸŽ¯ Musical complexity:', musicalComplexity);
    console.log('ðŸ”‡ Audio handling: IGNORED (visual analysis only)');

    let fullPrompt;
    
    if (detailLevel === 'ultra' && musicalComplexity === 'advanced') {
      fullPrompt = buildAdvancedMusicPrompt(analysisType, genre, customPrompt);
      console.log('ðŸŽ¯ Using ADVANCED MUSICAL TERMINOLOGY prompt system');
    } else if (detailLevel === 'ultra') {
      fullPrompt = buildDetailedPrompt(analysisType, genre, customPrompt);
      console.log('ðŸŽ¯ Using standard detailed prompt system');
    } else {
      fullPrompt = customPrompt || ULTRA_DETAILED_MUSIC_COMPOSITION_PROMPT;
    }

    // Prepare video data for Gemini
    const videoPart = {
      inlineData: {
        data: videoBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    console.log('ðŸ¤– Sending video to Gemini for advanced musical analysis...');
    const startTime = Date.now();

    const result = await model.generateContent([fullPrompt, videoPart]);
    const response = await result.response;
    const analysisText = response.text();

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('âœ… Advanced musical composition analysis completed!');
    console.log('â±ï¸ Processing time:', processingTime, 'seconds');
    console.log('ðŸ“„ Composition instructions length:', analysisText.length, 'characters');

    // Validate musical terminology usage
    const musicalTermsValidation = validateMusicalTerminology(analysisText);

    return {
      success: true,
      analysis: analysisText,
      processingTime: processingTime + 's',
      promptUsed: fullPrompt,
      videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
      detailLevel: detailLevel,
      genre: genre,
      analysisType: analysisType,
      musicalComplexity: musicalComplexity,
      focusType: 'advanced-visual-to-musical-composition',
      musicalTermsValidation: musicalTermsValidation
    };

  } catch (error) {
    console.error('âŒ Advanced musical analysis error:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid Gemini API key. Please check your GEMINI_API_KEY in .env file.';
    } else if (error.message.includes('quota')) {
      errorMessage = 'Gemini API quota exceeded. Please try again later or upgrade your plan.';
    } else if (error.message.includes('file size')) {
      errorMessage = 'Video file is too large for Gemini API. Try a shorter video or lower resolution.';
    }

    return {
      success: false,
      error: errorMessage,
      details: error.message
    };
  }
}

// âœ… MISSING FUNCTION: Validate music analysis response
function validateMusicAnalysisResponse(analysis) {
  const validation = {
    score: 0,
    checks: {},
    issues: [],
    strengths: []
  };

  // Check for required sections
  const requiredSections = [
    'Key:', 'Tempo:', 'Genre', 'Visual', 'Musical', 'Instrumentation', 'Harmony'
  ];
  
  requiredSections.forEach(section => {
    const hasSection = analysis.includes(section);
    validation.checks[section] = hasSection;
    if (hasSection) {
      validation.score += 10;
      validation.strengths.push(`Contains ${section} information`);
    } else {
      validation.issues.push(`Missing ${section} section`);
    }
  });

  // Check length
  if (analysis.length > 1500) {
    validation.score += 20;
    validation.strengths.push('Comprehensive length');
  } else {
    validation.issues.push('Analysis too short for detailed composition');
  }

  // Check for musical terminology
  const musicalTerms = [
    'chord', 'progression', 'melody', 'rhythm', 'dynamics', 'articulation',
    'modulation', 'scale', 'interval', 'voice leading', 'orchestration'
  ];
  
  const foundTerms = musicalTerms.filter(term => 
    analysis.toLowerCase().includes(term)
  );
  
  validation.score += foundTerms.length * 5;
  validation.checks.musicalTerminology = foundTerms.length;
  
  if (foundTerms.length >= 6) {
    validation.strengths.push('Rich musical terminology');
  } else {
    validation.issues.push('Limited musical terminology');
  }

  // Overall grade
  validation.grade = validation.score >= 80 ? 'Excellent' :
                   validation.score >= 60 ? 'Good' :
                   validation.score >= 40 ? 'Fair' : 'Poor';

  return validation;
}
// ADD this function to your gemini-utils.js file (right before the module.exports)

// âœ… MISSING FUNCTION: Analyze video with multiple audio files for optimal timing
async function analyzeVideoWithAudioFiles(videoBuffer, videoMimeType, audioBuffers, options = {}) {
  try {
    console.log('ðŸŽ­ ===============================================');
    console.log('ðŸŽ­ GEMINI: ANALYZING VIDEO + MULTIPLE AUDIO FILES');
    console.log('ðŸŽ­ ===============================================');
    console.log('ðŸ“¹ Video size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('ðŸŽµ Audio files:', audioBuffers.length);
    
    audioBuffers.forEach((audio, index) => {
      console.log(`   ${index + 1}. ${audio.title}: ${(audio.buffer.length / 1024 / 1024).toFixed(2)} MB`);
    });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    // Use the custom prompt from options
 // âœ… FIXED: Replace the prompt in your analyzeVideoWithAudioFiles function with this:
// âœ… FIXED: Replace the prompt in your analyzeVideoWithAudioFiles function with this:

const prompt = options.customPrompt || `
FIND THE BEST ${videoDurationSeconds}-SECOND SEGMENT FROM EACH SONG FOR THIS VIDEO

You are analyzing a ${videoDurationSeconds}-second video and multiple full-length audio tracks. Find the optimal ${videoDurationSeconds}-second segment from each song that best matches the video.

**YOUR TASK:**
1. **WATCH THE VIDEO** - Analyze visual content, energy, pacing, mood
2. **LISTEN TO EACH COMPLETE SONG** - Understand the full musical structure  
3. **CHOOSE ANY START POINT** - The segment can start at ANY second within the song (5s, 23s, 47s, etc.) cant start at 0 secon
4. **FIND THE BEST SEGMENT** - Choose the most suitable ${videoDurationSeconds}-second portion

**SEGMENT SELECTION GUIDELINES:**
- **Start time can be ANY second** - 15s, 30s, 45s, whatever works best cant be 0
- **Find musical highlights** - Chorus sections, drops, instrumental peaks, climactic moments
- **Match video energy** - Choose segments that align with visual pacing and mood
- **Ensure smooth flow** - Pick sections that work well as a continuous ${videoDurationSeconds}-second clip
- **Avoid jarring cuts** - Don't cut off mid-phrase or during important transitions

**OUTPUT FORMAT FOR EACH TRACK:**

Track [#]: [Song Title] 
**Recommended Segment:** [Start seconds] to [End seconds] (from original song)
**Duration:** ${videoDurationSeconds} seconds
**Musical Content:** [What happens in this segment - verse, chorus, bridge, solo, etc.]
**Why This Segment:** [Explain why this specific part works best for the video]
**Audio-Visual Match Score:** [1-10 rating]
**Volume Recommendation:** [0-100%]

**EXAMPLES:**

Track 1: "Dynamic Song"
**Recommended Segment:** 23 to 143 seconds (from original song)
**Duration:** 120 seconds
**Musical Content:** Builds from verse into powerful chorus, includes instrumental bridge
**Why This Segment:** Skips slow intro, captures the song's energy peak that matches video intensity
**Audio-Visual Match Score:** 8/10
**Volume Recommendation:** 80%

Track 2: "Ambient Track"  
**Recommended Segment:** 37 to 157 seconds (from original song)
**Duration:** 120 seconds
**Musical Content:** Main melodic theme with atmospheric development
**Why This Segment:** Avoids opening pad buildup, focuses on the richest harmonic content
**Audio-Visual Match Score:** 7/10
**Volume Recommendation:** 65%

Track 3: "Electronic Beat"
**Recommended Segment:** 8 to 128 seconds (from original song)
**Duration:** 120 seconds  
**Musical Content:** Drop section with full rhythm and bass, includes breakdown
**Why This Segment:** Captures the most energetic part that syncs with video movement
**Audio-Visual Match Score:** 9/10
**Volume Recommendation:** 75%

**IMPORTANT:** 
- The start time can be ANYWHERE in the song (not just 0 seconds)
- Choose the segment that best represents the song's strongest musical content
- Match the segment's energy and mood to the video content
- Think like a DJ finding the perfect clip from each track

Analyze each audio track and recommend the optimal segment timing.
`;

// The rest of the function stays the same

// The rest of the function stays the same - just replace the prompt variable

    console.log('ðŸ¤– Sending video + audio files to Gemini...');
    console.log('ðŸ“ Prompt length:', prompt.length, 'characters');

    const startTime = Date.now();

    // Prepare parts for Gemini
    const parts = [
      {
        text: prompt
      },
      {
        inlineData: {
          mimeType: videoMimeType,
          data: videoBuffer.toString('base64')
        }
      }
    ];

    // Add each audio file to the analysis
    audioBuffers.forEach((audioFile, index) => {
      parts.push({
        text: `\nAudio Track ${index + 1}: "${audioFile.title}" (Original Duration: ${audioFile.originalDuration || 'Unknown'}s)`
      });
      
      parts.push({
        inlineData: {
          mimeType: audioFile.mimeType || 'audio/mpeg',
          data: audioFile.buffer.toString('base64')
        }
      });
    });

    console.log('ðŸ“¤ Sending to Gemini with', parts.length, 'parts...');

    // Generate analysis
    const result = await model.generateContent(parts);
    const response = await result.response;
    const analysis = response.text();

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('âœ… ===============================================');
    console.log('âœ… GEMINI VIDEO + AUDIO ANALYSIS COMPLETED');
    console.log('âœ… ===============================================');
    console.log('â±ï¸ Processing time:', processingTime, 'seconds');
    console.log('ðŸ“„ Analysis length:', analysis.length, 'characters');

    return {
      success: true,
      analysis: analysis,
      processingTime: processingTime + 's',
      audioTracksAnalyzed: audioBuffers.length,
      videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
      detailLevel: options.detailLevel || 'detailed'
    };

  } catch (error) {
    console.error('âŒ ===============================================');
    console.error('âŒ GEMINI VIDEO + AUDIO ANALYSIS ERROR');
    console.error('âŒ ===============================================');
    console.error('ðŸ’¥ Error message:', error.message);

    return {
      success: false,
      error: error.message,
      details: {
        videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
        audioCount: audioBuffers.length
      }
    };
  }
}
// Add this function to your gemini-utils.js file

/**
 * Analyze video for optimal music placement segments using cinematic analysis
 * @param {Buffer} videoBuffer - Video file buffer
 * @param {string} mimeType - Video MIME type (default: 'video/mp4')
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis result with music segments
 */
// âœ… UPDATED: Music segmentation prompt with 10 segment maximum
const MUSIC_SEGMENTATION_PROMPT = `
You are a world-class film editor and cinematic music supervisor AI. Your task is to watch the provided video and identify exact segments where music should start and end, based on advanced cinematic and emotional analysis.

ðŸŽ¬ OBJECTIVE
Detect **optimal time intervals** within the video where music should be placed. You must:
- Determine the **start** and **end** time (in seconds) of each music segment
- Explain **why music starts/ends** at that point
- Classify the **emotional intensity** and **type** of music best suited
- **MAXIMUM 10 SEGMENTS ALLOWED** - Focus on the most important musical moments

You are NOT generating music â€” you are marking **when and why** music should be used, based entirely on visual and narrative content.

ðŸŽ¯ SEGMENT LIMITATIONS
- **MAXIMUM: 10 segments per video**
- **MINIMUM: 2 segments per video** (unless video is very short)
- Focus on the **most impactful moments** that need music
- Prioritize **key story beats** over minor transitions
- Combine smaller moments into larger segments when appropriate

ðŸ“ˆ ANALYSIS CRITERIA
Use the following visual and storytelling cues to guide your segmentation (prioritize the most important):

1. **Major Scene Transitions**  
   Cue music at significant cuts between scenes or major time shifts. Purpose: emotional shift, continuity.

2. **High-Energy Sequences (Montages/Action)**  
   Cue rhythmic or upbeat music when visuals have high tempo or kinetic motion.

3. **Emotional Climaxes**  
   Cue dramatic or ambient music when characters show strong emotion, tension, joy, or major story moments.

4. **Important Reveals**  
   Cue distinctive music for major character introductions, plot reveals, or critical information.

5. **Tension Building**  
   Cue suspenseful music during key dramatic moments or before major events.

6. **Story Climaxes or Turning Points**  
   Cue powerful music at narrative peaks, major decisions, or pivotal story moments.

âš ï¸ IMPORTANT SELECTION RULES
- **Quality over Quantity**: Better to have 5-7 well-chosen segments than 10 mediocre ones
- **Minimum 3-second duration** per segment (unless artistically justified)
- **Avoid over-segmentation**: Don't break every small visual change into a new segment
- **Combine related moments**: Group consecutive scenes that need similar music
- **Focus on story impact**: Choose moments that truly enhance the narrative

ðŸŽµ OUTPUT FORMAT
Return ONLY a JSON array of objects with **MAXIMUM 10 segments**. Each object represents one music segment and should include:
- "start": float (start time in seconds, e.g., 13.2)
- "end": float (end time in seconds, e.g., 21.8)
- "reason": string (why this segment needs music, referencing visual/narrative cues)
- "intensity": string (one of: "low", "medium", "high")
- "type": string (one of: "ambient", "dramatic", "rhythmic", "suspenseful", "emotional", "heroic", "action", "romantic", "mysterious")

ðŸ§  OUTPUT INSTRUCTIONS
- **MAXIMUM 10 segments** - strictly enforce this limit
- Use clear cinematic logic for the most important moments only
- Prefer longer segments over many short ones
- Use up to 0.1 second precision for start/end times
- Only output the JSON array. Do NOT explain your reasoning outside the "reason" field
- Focus on segments that will have the biggest impact on the viewing experience

ðŸ“ VIDEO INPUT
Analyze this video and identify the **most important 10 or fewer** segments that need music:
`;

// âœ… UPDATED: analyzeVideoForMusicSegments function with segment limit validation

// UPDATED: Replace your existing analyzeVideoForMusicSegments function with this enhanced version
// REPLACE your existing analyzeVideoForMusicSegments function in gemini-utils.js with this fixed version

async function analyzeVideoForMusicSegments(videoBuffer, mimeType = 'video/mp4', options = {}) {
  // Define timeout constant at the very top to ensure it's always available
  const TIMEOUT_MS = 600000; // 10 minutes (600,000 milliseconds)
  
  try {
    const { 
      customPrompt = '', 
      maxSegments = 10,
      analysisType = 'segments',
      detailLevel = 'detailed',
      showTerminalOutput = true 
    } = options;

    if (showTerminalOutput) {
      console.log('ðŸŽ¬ ===============================================');
      console.log('ðŸŽ¬ VIDEO MUSIC SEGMENTATION ANALYSIS');
      console.log('ðŸŽ¬ ===============================================');
      console.log('ðŸ“Š Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
      console.log('ðŸŽ¯ Analysis type:', analysisType);
      console.log('ðŸ“ Custom prompt:', customPrompt || 'None provided');
      console.log('ðŸ” Detail level:', detailLevel);
      console.log('ðŸ”¢ Max segments:', maxSegments);
      console.log('â° Timeout limit:', (TIMEOUT_MS / 1000 / 60).toFixed(0), 'minutes');
      console.log('ðŸ”‡ Audio handling: VISUAL ANALYSIS ONLY');
    }

    // Initialize Gemini
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const startTime = Date.now();

    // Enhanced prompt that uses maxSegments
// REPLACE the analysisPrompt in your analyzeVideoForMusicSegmentsWithFilesAPI function in gemini-utils.js

// REPLACE the analysisPrompt in your analyzeVideoForMusicSegmentsWithFilesAPI function in gemini-utils.js

// REPLACE the analysisPrompt in your analyzeVideoForMusicSegmentsWithFilesAPI function in gemini-utils.js

// âœ… REPLACE your analysisPrompt in analyzeVideoForMusicSegments with this:


const analysisPrompt = `
You are an expert music supervisor analyzing video content for optimal music placement. 

ANALYSIS TASK: Identify up to ${maxSegments} distinct segments in this video where different types of background music would enhance the viewing experience.
focus on the dialgoues and the visual content
CUSTOM INSTRUCTIONS: ${customPrompt}

â° TIME FORMAT: Use M:SS format (e.g., "4:30", "1:15")

ðŸ“ DETAILED_DESCRIPTION FORMAT:
For each segment, provide exactly 2 lines, each â‰¤280 characters:
1. Prompt â€” concise description of the video segment's emotional tone, vibe, and visual content. No musical terms here.
2. Music Style â€” BPM, key, genre, primary instruments, and progression, including appropriate musical terms for tempo, dynamics, articulation, and mood.

OUTPUT FORMAT (MUST be valid JSON):
{
  "segments": [
    {
      "start_time": "1:30",
      "end_time": "2:15",
      "reason": "Brief explanation for why this segment needs music",
      "intensity": "low|medium|high",
      "type": "ambient|rhythmic|emotional|energetic|dramatic",
      "music_summary": "Description of recommended music style",
      "detailed_description": "Prompt: Family gathering in cozy hotel room discussing wedding plans, warm lighting, intimate conversation, excited gestures, anticipatory mood, life milestone moment.\\nMusic Style: 85 BPM, C major, acoustic folk, fingerpicked guitar and soft strings, gentle intro â†’ warm build â†’ emotional peak â†’ tender outro, legato phrasing, mezzoforte dynamics.",
      "volume": 60,
      "fade_algorithm": "linear",
      "fadein_duration": "2.0",
      "fadeout_duration": "2.0"
    }
  ]
}

DETAILED_DESCRIPTION EXAMPLE FORMATS:

Example 1:
"detailed_description": "Prompt: Scenic drive through lush green countryside, peaceful morning, slow camera movements, family enjoying journey, tranquil atmosphere, natural beauty.\\nMusic Style: 70 BPM, G major, ambient instrumental, soft piano and nature sounds, flowing intro â†’ gentle build â†’ serene sustain â†’ peaceful fade, dolce, pianissimo to mezzo-piano."

Example 2: 
"detailed_description": "Prompt: Arrival at upscale resort, family walking through elegant lobby, excited chatter, impressive architecture, welcoming staff, anticipation building.\\nMusic Style: 95 BPM, F major, contemporary pop, acoustic guitar and light percussion, bright intro â†’ rhythmic build â†’ uplifting chorus â†’ warm resolution, staccato accents, forte dynamics."

Example 3:
"detailed_description": "Prompt: Quiet family discussion about important decisions, thoughtful expressions, comfortable indoor setting, meaningful conversation, contemplative mood.\\nMusic Style: 60 BPM, A minor, neo-classical, solo piano and strings, reflective intro â†’ emotional development â†’ poignant climax â†’ gentle resolution, rubato timing, piano to mezzo-forte."

CRITICAL REQUIREMENTS:
- Each detailed_description has exactly 2 lines separated by \\n
- Line 1 (Prompt): Visual/emotional description, â‰¤280 characters, NO musical terms
- Line 2 (Music Style): Musical specifications, â‰¤280 characters, WITH musical terms
- Use proper JSON escaping (\\n for newlines)
- Maximum ${maxSegments} segments
- M:SS time format
- Valid JSON only

REMEMBER: The detailed_description field must follow the dual-output format with both visual prompt and musical specifications on separate lines.
`;

// âœ… Alternative: If you want to keep M:SS format, use this prompt instead:
const alternativePrompt = `
You are an expert music supervisor analyzing video content for optimal music placement.

ANALYSIS TASK:
Identify up to ${maxSegments} distinct segments in this video where different types of background music would enhance the viewing experience.

â° TIME FORMAT: Use M:SS format where M = minutes, SS = seconds (example: "4:30" = 4 minutes 30 seconds)
- Ensure SS is always 00-59 (never 60 or higher)
- Use quotes around time values: "start_time": "4:30"

CUSTOM INSTRUCTIONS:
${customPrompt}

OUTPUT FORMAT:
{
  "segments": [
    {
      "start_time": "1:30",
      "end_time": "2:15", 
      "reason": "Opening scene requires ambient music",
      "intensity": "low",
      "type": "ambient",
      "music_summary": "Soft ambient background",
      "volume": 60,
      "fade_algorithm": "linear",
      "fadein_duration": "2.0",
      "fadeout_duration": "2.0"
    }
  ]
}

CRITICAL: Ensure SS in M:SS format is 00-59, never 60+. Use proper JSON format.
`;

// The rest of your function stays the same...
// The rest of your function stays the same...

// The rest of your function stays the same...

    if (showTerminalOutput) {
      console.log('ðŸ¤– Sending video to Gemini for music segmentation analysis...');
      console.log('ðŸ“ Prompt length:', analysisPrompt.length, 'characters');
      console.log('ðŸŽ¯ Requesting maximum', maxSegments, 'segments');
      console.log('â° Starting analysis with 10-minute timeout...');
    }

    // Create timeout promise with better error message
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Video analysis timed out after ${TIMEOUT_MS / 1000 / 60} minutes. Please try with a smaller video file.`));
      }, TIMEOUT_MS);
    });

    // Send to Gemini with enhanced error handling and timeout
    let result;
    try {
      console.log('ðŸ”„ Starting Gemini API request with timeout protection...');
      
      result = await Promise.race([
        model.generateContent([
          analysisPrompt,
          {
            inlineData: {
              mimeType: mimeType,
              data: videoBuffer.toString('base64')
            }
          }
        ]),
        timeoutPromise
      ]);

      // Clear timeout if request succeeds
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

    } catch (geminiError) {
      console.error('âŒ Gemini API error details:', {
        message: geminiError.message,
        name: geminiError.name,
        stack: geminiError.stack?.substring(0, 200) + '...'
      });
      
      // Clear timeout on error
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Enhanced error handling for common issues
      const errorMessage = geminiError.message.toLowerCase();
      
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        throw new Error(`Video analysis timed out after ${TIMEOUT_MS / 1000 / 60} minutes. This usually means the video file is too large or complex. Try: 1) Using a smaller video file, 2) Trimming the video to a shorter duration, 3) Reducing video quality/resolution.`);
      } else if (errorMessage.includes('fetch failed') || errorMessage.includes('network')) {
        throw new Error('Network error connecting to Gemini API. Possible causes: 1) Internet connection issues, 2) Firewall blocking the request, 3) Gemini API temporary outage. Please check your connection and try again in a few minutes.');
      } else if (errorMessage.includes('api_key') || errorMessage.includes('unauthorized')) {
        throw new Error('Invalid or missing Gemini API key. Please check your GEMINI_API_KEY environment variable is set correctly.');
      } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
        throw new Error('Gemini API quota exceeded. Please wait before making more requests or check your API usage limits.');
      } else if (errorMessage.includes('too large') || errorMessage.includes('file_too_large')) {
        throw new Error(`Video file is too large for Gemini processing. Current size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB. Try reducing the video size or duration.`);
      } else if (errorMessage.includes('unsupported') || errorMessage.includes('format')) {
        throw new Error(`Unsupported video format: ${mimeType}. Supported formats include: video/mp4, video/mov, video/avi, video/webm.`);
      } else {
        throw new Error(`Gemini API error: ${geminiError.message}. If this persists, the video file may be corrupted or incompatible.`);
      }
    }

    const response = await result.response;
    const rawAnalysis = response.text();
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2) + 's';

    if (showTerminalOutput) {
      console.log('âœ… Gemini analysis completed');
      console.log('â±ï¸ Processing time:', processingTime);
      console.log('ðŸ“„ Raw response length:', rawAnalysis.length, 'characters');
      
      // Show preview of the response
      console.log('\nðŸ” Raw response preview:');
      console.log('='.repeat(50));
      console.log(rawAnalysis.substring(0, 500) + (rawAnalysis.length > 500 ? '...' : ''));
      console.log('='.repeat(50));
    }

    // âœ… CRITICAL FIX: Use the enhanced parser here
    console.log('ðŸ” ===============================================');
    console.log('ðŸ” USING ENHANCED JSON PARSER WITH FALLBACK STRATEGIES');
    console.log('ðŸ” ===============================================');
    
    const { segments: musicSegments, parseError, strategy } = extractSegmentsFromGeminiResponse(rawAnalysis, maxSegments);
    const totalSegments = musicSegments.length;

    if (showTerminalOutput && totalSegments > 0) {
      console.log('\nðŸŽµ ===============================================');
      console.log('ðŸŽµ PARSED MUSIC SEGMENTS');
      console.log('ðŸŽµ ===============================================');
      console.log('ðŸ“Š Total segments found:', totalSegments);
      console.log('ðŸ› ï¸ Parsing strategy used:', strategy);
      
      musicSegments.forEach((segment, index) => {
        console.log(`\nðŸŽµ Segment ${index + 1}:`);
        console.log(`   â° Time: ${segment.start_time}s - ${segment.end_time}s`);
        console.log(`   ðŸ“ˆ Intensity: ${segment.intensity}`);
        console.log(`   ðŸŽ­ Type: ${segment.type}`);
        console.log(`   ðŸ“ Reason: ${segment.reason}`);
        console.log(`   ðŸŽµ Music: ${segment.music_summary}`);
        console.log(`   ðŸ”Š Volume: ${segment.volume}%`);
      });
      console.log('ðŸŽµ ===============================================');
    }

    if (showTerminalOutput) {
      if (totalSegments > 0) {
        console.log('\nâœ… ===============================================');
        console.log('âœ… ENHANCED ANALYSIS COMPLETED SUCCESSFULLY');
        console.log('âœ… ===============================================');
        console.log('ðŸ“Š Total segments found:', totalSegments);
        console.log('â±ï¸ Processing time:', processingTime);
        console.log('ðŸ› ï¸ Parse strategy used:', strategy);
        console.log('âœ… ===============================================\n');
      } else {
        console.log('\nâŒ ===============================================');
        console.log('âŒ NO SEGMENTS EXTRACTED');
        console.log('âŒ ===============================================');
        console.log('ðŸ’¥ Parse error:', parseError);
        console.log('ðŸ› ï¸ Strategy attempted:', strategy);
        console.log('ðŸ“„ Response length:', rawAnalysis.length);
        console.log('âŒ ===============================================\n');
      }
    }

    return {
      success: totalSegments > 0,
      musicSegments: musicSegments,
      totalSegments: totalSegments,
      rawResponse: rawAnalysis,
      processingTime: processingTime,
      analysisType: 'music_segments',
      parseError: parseError,
      parseStrategy: strategy,
      promptUsed: analysisPrompt,
      timeoutMs: TIMEOUT_MS
    };

  } catch (error) {
    console.error('âŒ Error in enhanced music segmentation analysis:', {
      message: error.message,
      name: error.name,
      videoSize: videoBuffer ? (videoBuffer.length / 1024 / 1024).toFixed(2) + 'MB' : 'unknown'
    });
    
    return {
      success: false,
      musicSegments: [],
      totalSegments: 0,
      error: error.message,
      processingTime: '0s',
      rawResponse: null,
      parseError: error.message,
      parseStrategy: 'error',
      timeoutMs: TIMEOUT_MS,
      videoSizeMB: videoBuffer ? (videoBuffer.length / 1024 / 1024).toFixed(2) : 'unknown'
    };
  }
}
module.exports = {  extractSegmentsFromGeminiResponse,
  validateAndNormalizeSegments,
  extractValidSegmentsFromBrokenJSON,
  createEmergencyFallbackSegments,
  normalizeIntensity,
  normalizeType,
  isValidSegment,
  
  analyzeVideoForMusicSegments,

  extractSegmentsFromText,
  extractSegmentsWithRegex,
  isValidSegment
};
/**
 * Analyze GCS video for music segments
 * @param {string} gcsUrl - GCS video URL
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis result with music segments
 */
// Fixed analyzeGCSVideoForMusicSegments function for gemini-utils.js
// Replace your existing function with this corrected version
// ADD these functions to your gemini-utils.js file
// This uses Gemini's Files API for videos > 20MB

// Use the correct import path:
const { GoogleAIFileManager } = require('@google/generative-ai/server');

const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
/**
 * Upload large video to Gemini Files API (supports up to 2GB)
 * @param {Buffer} videoBuffer - Video file buffer
 * @param {string} mimeType - Video MIME type
 * @param {string} displayName - Display name for the file
 * @returns {Object} Upload result with file URI
 */
async function uploadVideoToGeminiFiles(videoBuffer, mimeType = 'video/mp4', displayName = 'uploaded_video') {
  try {
    const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    
    console.log('ðŸ“¤ ===============================================');
    console.log('ðŸ“¤ UPLOADING TO GEMINI FILES API');
    console.log('ðŸ“¤ ===============================================');
    console.log('ðŸ“Š File size:', fileSizeMB, 'MB');
    console.log('ðŸŽ¬ MIME type:', mimeType);
    console.log('ðŸ“ Display name:', displayName);
    
    // Check file size limit (2GB = 2048MB)
    if (videoBuffer.length > 2 * 1024 * 1024 * 1024) {
      throw new Error(`Video file too large: ${fileSizeMB}MB. Maximum allowed: 2048MB (2GB)`);
    }
    
    // Create temporary file for upload
    const fs = require('fs');
    const path = require('path');
    const tempPath = path.join(__dirname, 'temp_videos', `gemini_upload_${Date.now()}.mp4`);
    
    // Write buffer to temporary file
    await fs.promises.writeFile(tempPath, videoBuffer);
    
    console.log('â³ Uploading to Gemini Files API...');
    const startTime = Date.now();
    
    // Upload using Files API
    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType: mimeType,
      displayName: displayName
    });
    
    const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Clean up temporary file
    await fs.promises.unlink(tempPath);
    
    console.log('âœ… Upload completed successfully!');
    console.log('â±ï¸ Upload time:', uploadTime, 'seconds');
    console.log('ðŸ“‹ File details:');
    console.log('   URI:', uploadResult.file.uri);
    console.log('   Name:', uploadResult.file.name);
    console.log('   Size:', uploadResult.file.sizeBytes, 'bytes');
    console.log('   State:', uploadResult.file.state);
    console.log('   Expires:', uploadResult.file.expirationTime);
    
    return {
      success: true,
      file: uploadResult.file,
      uri: uploadResult.file.uri,
      name: uploadResult.file.name,
      sizeBytes: uploadResult.file.sizeBytes,
      uploadTime: uploadTime + 's',
      expiresAt: uploadResult.file.expirationTime,
      state: uploadResult.file.state
    };
    
  } catch (error) {
    console.error('âŒ Error uploading to Gemini Files API:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid Gemini API key. Check GEMINI_API_KEY environment variable.';
    } else if (error.message.includes('quota')) {
      errorMessage = 'Gemini API quota exceeded. Please wait or upgrade your plan.';
    } else if (error.message.includes('too large')) {
      errorMessage = 'Video file exceeds 2GB limit for Gemini Files API.';
    }
    
    return {
      success: false,
      error: errorMessage,
      details: error.message
    };
  }
}

/**
 * Wait for Gemini file processing to complete
 * @param {string} fileName - File name from upload result
 * @param {number} maxWaitSeconds - Maximum wait time in seconds
 * @returns {Object} Processing result
 */
async function waitForGeminiFileProcessing(fileName, maxWaitSeconds = 300) {
  try {
    console.log('â³ Waiting for Gemini file processing...');
    console.log('ðŸ“ File name:', fileName);
    console.log('â° Max wait time:', maxWaitSeconds, 'seconds');
    
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = Math.floor(maxWaitSeconds / 10);
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        // Get current file status
        const file = await fileManager.getFile(fileName);
        
        console.log(`ðŸ”„ Check ${attempts}/${maxAttempts}: State = ${file.state}`);
        
        if (file.state === 'ACTIVE') {
          const waitTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log('âœ… File processing completed!');
          console.log('â±ï¸ Total wait time:', waitTime, 'seconds');
          
          return {
            success: true,
            file: file,
            state: file.state,
            waitTime: waitTime + 's',
            message: 'File is ready for analysis'
          };
        } else if (file.state === 'FAILED') {
          throw new Error('File processing failed on Gemini side');
        } else if (file.state === 'PROCESSING') {
          // Wait 10 seconds before next check
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          console.warn('âš ï¸ Unknown file state:', file.state);
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
      } catch (checkError) {
        console.error(`âŒ Error checking file status (attempt ${attempts}):`, checkError.message);
        
        if (attempts === maxAttempts) {
          throw checkError;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Timeout reached
    const waitTime = ((Date.now() - startTime) / 1000).toFixed(2);
    throw new Error(`File processing timeout after ${waitTime}s. Max wait time: ${maxWaitSeconds}s`);
    
  } catch (error) {
    console.error('âŒ Error waiting for file processing:', error);
    
    return {
      success: false,
      error: error.message,
      details: 'File processing did not complete within timeout period'
    };
  }
}

/**
 * Analyze large video using Gemini Files API
 * @param {Buffer} videoBuffer - Video file buffer
 * @param {string} mimeType - Video MIME type
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis result
 */
async function analyzeVideoForMusicSegmentsWithFilesAPI(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    const { 
      customPrompt = '', 
      maxSegments = 10,
      analysisType = 'segments',
      detailLevel = 'detailed' 
    } = options;

    const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    
    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸŽ¬ LARGE VIDEO ANALYSIS WITH GEMINI FILES API');
    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸ“Š Video size:', fileSizeMB, 'MB');
    console.log('ðŸ”¢ Max segments:', maxSegments);
    console.log('ðŸ”§ Method: Gemini Files API (supports up to 2GB)');
    
    // STEP 1: Upload to Gemini Files API
    console.log('\n1ï¸âƒ£ Uploading video to Gemini Files API...');
    
    const uploadResult = await uploadVideoToGeminiFiles(
      videoBuffer, 
      mimeType, 
      `music_analysis_${Date.now()}`
    );
    
    if (!uploadResult.success) {
      throw new Error(`Upload failed: ${uploadResult.error}`);
    }
    
    // STEP 2: Wait for processing
    console.log('\n2ï¸âƒ£ Waiting for file processing...');
    
    const processingResult = await waitForGeminiFileProcessing(uploadResult.name, 300);
    
    if (!processingResult.success) {
      throw new Error(`Processing failed: ${processingResult.error}`);
    }
    
    // STEP 3: Analyze using file reference
    console.log('\n3ï¸âƒ£ Analyzing video for music segments...');
const analysisPrompt = `
You are an expert music supervisor analyzing video content for optimal music placement. 

ANALYSIS TASK: Identify up to ${maxSegments} distinct segments in this video where different types of background music would enhance the viewing experience.

CUSTOM INSTRUCTIONS: ${customPrompt}

â° TIME FORMAT: Use M:SS format (e.g., "4:30", "1:15")

ðŸš¨ CRITICAL: The "detailed_description" field MUST contain exactly 2 lines separated by \\n:

Line 1: "Prompt: [visual description without musical terms]"
Line 2: "Music Style: [BPM, key, genre, instruments, progression with musical terms]"

EXAMPLE OF CORRECT detailed_description FORMAT:
"detailed_description": "Prompt: Family gathering in hotel room discussing wedding plans, warm lighting, intimate conversation, excited gestures, meaningful life moment.\\nMusic Style: 85 BPM, C major, acoustic folk, fingerpicked guitar and soft strings, gentle intro â†’ warm build â†’ emotional peak â†’ tender outro, legato phrasing."

OUTPUT FORMAT (MUST be valid JSON):
{
  "segments": [
    {
      "start_time": "1:30",
      "end_time": "2:15", 
      "reason": "Brief explanation for why this segment needs music",
      "intensity": "low|medium|high",
      "type": "ambient|rhythmic|emotional|energetic|dramatic",
      "music_summary": "Description of recommended music style",
      "detailed_description": "Prompt: Specific visual content description, setting, people actions, mood, atmosphere, no musical terminology allowed here.\\nMusic Style: 80 BPM, F major, contemporary instrumental, piano and strings, intro â†’ development â†’ climax â†’ resolution, andante tempo, mezzo-forte dynamics.",
      "volume": 60,
      "fade_algorithm": "linear",
      "fadein_duration": "2.0",
      "fadeout_duration": "2.0"
    }
  ]
}

MORE EXAMPLES OF CORRECT detailed_description FORMAT:

Example 1:
"detailed_description": "Prompt: Scenic car journey through mountain roads, family traveling together, beautiful landscape views, peaceful atmosphere, sense of adventure.\\nMusic Style: 75 BPM, G major, road trip acoustic, guitar and light percussion, steady intro â†’ building energy â†’ scenic climax â†’ gentle fade, moderato, dolce."

Example 2:
"detailed_description": "Prompt: Family arrival at upscale resort, walking through elegant lobby, excited conversations, impressive architecture, welcoming atmosphere.\\nMusic Style: 90 BPM, D major, uplifting contemporary, piano and strings ensemble, warm intro â†’ welcoming build â†’ joyful peak â†’ satisfied resolution, allegretto, mezzo-forte."

Example 3:
"detailed_description": "Prompt: Outdoor activities and exploration, children playing, natural settings, playful interactions, energetic movement, joyful atmosphere.\\nMusic Style: 100 BPM, A major, playful instrumental, acoustic guitar and light drums, energetic intro â†’ playful development â†’ happy climax â†’ fun outro, vivace, forte."

ðŸš¨ MANDATORY REQUIREMENTS:
1. Every segment MUST have "detailed_description" with exactly 2 lines
2. Line 1 starts with "Prompt: " - NO musical terms (BPM, major, minor, tempo, etc.)
3. Line 2 starts with "Music Style: " - MUST include musical terms (BPM, key, instruments, dynamics)
4. Use \\n between lines (JSON escaped newline)
5. Each line should be 50-280 characters
6. Time format: M:SS (e.g. "2:30" not "2 minutes 30 seconds")
7. Maximum ${maxSegments} segments

Do NOT write explanations outside the JSON. Provide ONLY the JSON with properly formatted detailed_description fields.
`;



    const startTime = Date.now();
    
    // Generate content using file reference
    const result = await model.generateContent([
      analysisPrompt,
      {
        fileData: {
          mimeType: mimeType,
          fileUri: uploadResult.uri
        }
      }
    ]);
    
    const response = await result.response;
    const analysisText = response.text();
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('âœ… Analysis completed using Files API');
    console.log('â±ï¸ Analysis time:', processingTime, 'seconds');
    console.log('ðŸ“„ Response length:', analysisText.length, 'characters');
    
    // STEP 4: Parse response (same as before)
    const { segments, parseError, strategy } = extractSegmentsFromGeminiResponse(analysisText, maxSegments);
    
    console.log('ðŸ“Š Segments extracted:', segments.length);
    console.log('ðŸ› ï¸ Parse strategy:', strategy);
    
    // STEP 5: Clean up file (optional - files auto-delete after 48 hours)
    try {
      await fileManager.deleteFile(uploadResult.name);
      console.log('ðŸ—‘ï¸ Temporary file deleted from Gemini');
    } catch (deleteError) {
      console.warn('âš ï¸ Could not delete temporary file:', deleteError.message);
    }
    
    return {
      success: segments.length > 0,
      musicSegments: segments,
      totalSegments: segments.length,
      rawResponse: analysisText,
      processingTime: processingTime + 's',
      analysisType: 'music_segments_files_api',
      parseError: parseError,
      parseStrategy: strategy,
      fileInfo: {
        originalSize: fileSizeMB + ' MB',
        uploadTime: uploadResult.uploadTime,
        processingWaitTime: processingResult.waitTime,
        geminiFileUri: uploadResult.uri,
        geminiFileName: uploadResult.name,
        fileState: processingResult.file.state
      },
      method: 'gemini_files_api'
    };
    
  } catch (error) {
    console.error('âŒ Error in Files API analysis:', error);
    
    return {
      success: false,
      musicSegments: [],
      totalSegments: 0,
      error: error.message,
      processingTime: '0s',
      method: 'gemini_files_api_failed'
    };
  }
}

module.exports = {
  uploadVideoToGeminiFiles,
  waitForGeminiFileProcessing,
  analyzeVideoForMusicSegmentsWithFilesAPI
};
async function analyzeGCSVideoForMusicSegments(gcsUrl, options = {}) {
  try {
    const { 
      customPrompt = '',
      maxSegments = 10,  // ðŸš¨ FIX: Define maxSegments parameter
      analysisType = 'music_segments',
      detailLevel = 'detailed' 
    } = options;

    console.log('ðŸŒ ===============================================');
    console.log('ðŸŒ GCS VIDEO MUSIC SEGMENTATION ANALYSIS');
    console.log('ðŸŒ ===============================================');
    console.log('ðŸ”— GCS URL:', gcsUrl);
    console.log('ðŸ“ Extracted file name:', extractFileNameFromUrl(gcsUrl));
    console.log('ðŸŽ¯ Max segments:', maxSegments);
    console.log('ðŸ“ Custom prompt:', customPrompt || 'None provided');

    // Step 1: Download video from GCS
    console.log('ðŸ” Using signed URL direct download...');
    
    let videoBuffer;
    let downloadAttempts = 0;
    const maxDownloadAttempts = 3;
    
    while (downloadAttempts < maxDownloadAttempts) {
      try {
        downloadAttempts++;
        console.log(`ðŸ“¥ Download attempt ${downloadAttempts}/${maxDownloadAttempts}...`);
        
        // Add delay for subsequent attempts
        if (downloadAttempts > 1) {
          const delay = 5000 * downloadAttempts;
          console.log(`â³ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const response = await fetch(gcsUrl, {
          method: 'GET',
          timeout: 120000 // 2 minute timeout
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        videoBuffer = Buffer.from(await response.arrayBuffer());
        console.log('ðŸ“Š Video downloaded successfully:');
        console.log('   Size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
        console.log('   MIME type: video/mp4');
        break;
        
      } catch (downloadError) {
        console.error(`âŒ Download attempt ${downloadAttempts} failed:`, downloadError.message);
        
        if (downloadAttempts === maxDownloadAttempts) {
          throw new Error(`Failed to download video after ${maxDownloadAttempts} attempts: ${downloadError.message}`);
        }
      }
    }

    // Step 2: Analyze video buffer with proper error handling
    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸŽ¬ STARTING CINEMATIC MUSIC SEGMENTATION ANALYSIS');
    console.log('ðŸŽ¬ ===============================================');
    console.log('ðŸ“Š Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('ðŸŽ­ Analysis type:', analysisType);
    console.log('ðŸ”¢ Maximum segments allowed:', maxSegments);

    // Call the buffer-based analysis function with proper error handling
    let segmentationResult;
    try {
      segmentationResult = await analyzeVideoForMusicSegments(videoBuffer, 'video/mp4', {
        customPrompt,
        maxSegments,  // ðŸš¨ FIX: Pass maxSegments to the function
        analysisType,
        detailLevel
      });
    } catch (analysisError) {
      console.error('âŒ Buffer analysis failed:', analysisError.message);
      
      // Enhanced error handling for common Gemini API issues
      if (analysisError.message.includes('fetch failed')) {
        throw new Error('Gemini API network error: Check your internet connection and API key. The video may be too large for processing.');
      } else if (analysisError.message.includes('API key')) {
        throw new Error('Gemini API key error: Please check your GEMINI_API_KEY environment variable.');
      } else if (analysisError.message.includes('quota')) {
        throw new Error('Gemini API quota exceeded: Please wait before making more requests.');
      } else {
        throw new Error(`Video analysis failed: ${analysisError.message}`);
      }
    }

    if (segmentationResult.success) {
      console.log('âœ… ===============================================');
      console.log('âœ… GCS MUSIC SEGMENTATION COMPLETED');
      console.log('âœ… ===============================================');
      console.log('ðŸ“Š Total segments found:', segmentationResult.totalSegments);
      console.log('â±ï¸ Processing time:', segmentationResult.processingTime);
      console.log('ðŸ“ Source file:', extractFileNameFromUrl(gcsUrl));

      return {
        success: true,
        musicSegments: segmentationResult.musicSegments || [],
        totalSegments: segmentationResult.totalSegments || 0,
        rawResponse: segmentationResult.rawResponse,
        processingTime: segmentationResult.processingTime,
        analysisType: 'music_segments',
        sourceFile: extractFileNameFromUrl(gcsUrl),
        gcsUrl: gcsUrl,
        promptUsed: segmentationResult.promptUsed,
        parseError: segmentationResult.parseError
      };
    } else {
      console.error('âŒ ===============================================');
      console.error('âŒ GCS MUSIC SEGMENTATION ERROR');
      console.error('âŒ ===============================================');
      console.error('ðŸ’¥ Error message:', segmentationResult.error);

      return {
        success: false,
        error: segmentationResult.error || 'Unknown analysis error',
        details: segmentationResult.details || 'Failed to analyze GCS video for music segments',
        gcsUrl: gcsUrl,
        rawResponse: segmentationResult.rawResponse,
        sourceFile: extractFileNameFromUrl(gcsUrl)
      };
    }

  } catch (error) {
    console.error('âŒ ===============================================');
    console.error('âŒ GCS MUSIC SEGMENTATION ERROR');
    console.error('âŒ ===============================================');
    console.error('ðŸ’¥ Error message:', error.message);
    console.error('ðŸ’¥ Error stack:', error.stack);

    // Enhanced error categorization
    let errorCategory = 'unknown';
    if (error.message.includes('download') || error.message.includes('fetch')) {
      errorCategory = 'download';
    } else if (error.message.includes('API key') || error.message.includes('quota')) {
      errorCategory = 'api';
    } else if (error.message.includes('maxSegments')) {
      errorCategory = 'parameter';
    }

    return {
      success: false,
      error: error.message,
      details: 'Failed to download or analyze GCS video for music segments',
      errorCategory: errorCategory,
      gcsUrl: gcsUrl || 'Not provided',
      sourceFile: gcsUrl ? extractFileNameFromUrl(gcsUrl) : 'Unknown'
    };
  }
}

// ðŸš¨ FIX: Also make sure you have the extractFileNameFromUrl helper function


// ðŸš¨ FIX: Make sure your analyzeVideoForMusicSegments function accepts maxSegments


module.exports = {
  analyzeGCSVideoForMusicSegments,
  analyzeVideoForMusicSegments,
  extractFileNameFromUrl,
  displaySegmentAnalysisResults
};
/**
 * Fallback function to extract segments from text when JSON parsing fails
 * @param {string} text - Raw response text
 * @returns {Array} Array of extracted segments
 */
// REPLACE this function in your gemini-utils.js file
// Enhanced JSON parsing with multiple fallback strategies

// Replace your existing extractSegmentsFromGeminiResponse function in gemini-utils.js with this enhanced version

/**
 * Enhanced JSON parsing with comprehensive fallback strategies
 * @param {string} geminiResponse - Raw response from Gemini
 * @param {number} maxSegments - Maximum segments to extract
 * @returns {Object} - Parsed segments with strategy info


/**
 * Extract valid segments from broken JSON by parsing individual segment blocks
 */
function extractValidSegmentsFromBrokenJSON(jsonString, maxSegments) {
  console.log('ðŸ”§ Extracting valid segments from broken JSON...');
  
  const segments = [];
  
  // Find all potential segment objects
  const segmentPattern = /\{\s*"start_time"[\s\S]*?\}/g;
  const segmentMatches = jsonString.match(segmentPattern) || [];
  
  console.log(`ðŸ” Found ${segmentMatches.length} potential segment blocks`);
  
  segmentMatches.forEach((segmentStr, index) => {
    if (segments.length >= maxSegments) return;
    
    try {
      // Try to fix this individual segment
      let fixedSegment = segmentStr;
      
      // Fix common issues in individual segments
      fixedSegment = fixedSegment.replace(/,\s*\}/g, '}'); // Remove trailing commas
      fixedSegment = fixedSegment.replace(/:\s*"([^"]*?)$/g, ': "$1"'); // Complete incomplete strings
      fixedSegment = fixedSegment.replace(/'/g, '"'); // Fix single quotes
      
      // Try to parse this segment
      const segment = JSON.parse(fixedSegment);
      
      if (isValidSegment(segment)) {
        segments.push(segment);
        console.log(`âœ… Extracted valid segment ${segments.length}: ${segment.start_time}s-${segment.end_time}s`);
      }
      
    } catch (error) {
      console.log(`âŒ Failed to parse segment ${index + 1}:`, error.message);
    }
  });
  
  return segments;
}

/**
 * Create emergency fallback segments when all parsing fails
 */

/**
 * Validate and normalize segments to ensure consistent format
 */
// âœ… FIXED: Add these time parsing functions to your gemini-utils.js

/**
 * Convert time string in M:SS or MM:SS format to seconds
 * @param {string} timeStr - Time string like "4:30", "04:30", "1:15", etc.
 * @returns {number} - Time in seconds
 */
function parseTimeToSeconds(timeStr) {
  if (typeof timeStr === 'number') {
    return timeStr; // Already in seconds
  }
  
  if (!timeStr || typeof timeStr !== 'string') {
    return 0;
  }
  
  // Handle M:SS or MM:SS format
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const minutes = parseInt(timeMatch[1]);
    const seconds = parseInt(timeMatch[2]);
    
    // Validate seconds (must be 0-59)
    if (seconds >= 60) {
      console.warn(`âš ï¸ Invalid seconds in time ${timeStr}: ${seconds} >= 60`);
      return 0;
    }
    
    const totalSeconds = (minutes * 60) + seconds;
    console.log(`ðŸ•’ Converted ${timeStr} â†’ ${totalSeconds} seconds`);
    return totalSeconds;
  }
  
  // Handle decimal format (fallback)
  const floatValue = parseFloat(timeStr);
  if (!isNaN(floatValue)) {
    return floatValue;
  }
  
  console.warn(`âš ï¸ Could not parse time format: ${timeStr}`);
  return 0;
}

/**
 * Convert seconds back to M:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} - Time in M:SS format
 */
function formatSecondsToTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * FIXED: Validate and normalize segments with proper time parsing
 */

// âœ… VALIDATION: Function to validate dual-output format in detailed_description
function validateDualOutputDescription(description) {
  if (!description) return false;
  
  // Check if it contains both "Prompt:" and "Music Style:"
  const hasPrompt = description.includes('Prompt:');
  const hasMusicStyle = description.includes('Music Style:');
  
  if (!hasPrompt || !hasMusicStyle) return false;
  
  // Check if it has the \\n separator or regular newline
  const hasNewline = description.includes('\\n') || description.includes('\n');
  
  return hasNewline;
}
// âœ… ENHANCED: Update segment validation to handle dual-output format
function validateAndNormalizeSegments(rawSegments) {
  console.log('ðŸ” Validating segments with IMPROVED dual-output handling...');
  
  const normalizedSegments = [];
  
  rawSegments.forEach((segment, index) => {
    try {
      const startSeconds = parseTimeToSeconds(segment.start_time || segment.start || 0);
      const endSeconds = parseTimeToSeconds(segment.end_time || segment.end || 30);
      
      let detailedDescription = segment.detailed_description || '';
      
      // âœ… IMPROVED: Try to repair partial dual-output format
      if (detailedDescription && !validateDualOutputDescription(detailedDescription)) {
        console.log(`ðŸ”§ Segment ${index + 1}: Attempting to repair dual-output format...`);
        
        // Try to extract existing content and reformat
        if (detailedDescription.includes('Prompt:') || detailedDescription.includes('Music Style:')) {
          // Has some dual-output elements, try to repair
          let prompt = '';
          let musicStyle = '';
          
          const promptMatch = detailedDescription.match(/Prompt:\s*([^\\n]*)/);
          const musicMatch = detailedDescription.match(/Music Style:\s*([^\\n]*)/);
          
          if (promptMatch) {
            prompt = promptMatch[1].trim();
          } else {
            // Create prompt from reason or other fields
            const reason = segment.reason || segment.music_summary || '';
            prompt = `Video segment with ${segment.type || 'background'} content, ${reason.toLowerCase().replace(/[.]/g, '')}`;
          }
          
          if (musicMatch) {
            musicStyle = musicMatch[1].trim();
          } else {
            // Create music style from segment info
            const type = segment.type || 'ambient';
            const intensity = segment.intensity || 'medium';
            musicStyle = `80 BPM, C major, ${type} instrumental, soft ${type === 'rhythmic' ? 'percussion' : 'strings'}, intro â†’ build â†’ resolution, ${intensity === 'high' ? 'forte' : 'mezzo-forte'} dynamics`;
          }
          
          detailedDescription = `Prompt: ${prompt}\\nMusic Style: ${musicStyle}`;
          console.log(`ðŸ”§ Repaired segment ${index + 1} dual-output format`);
          
        } else {
          // No dual-output elements, create from scratch
          const reason = segment.reason || segment.music_summary || `Segment ${index + 1}`;
          const type = segment.type || 'ambient';
          const intensity = segment.intensity || 'medium';
          
          const prompt = `Video segment with ${type} content requiring ${intensity} intensity background music, ${reason.toLowerCase().replace(/[.]/g, '')}`;
          const musicStyle = `80 BPM, C major, instrumental ${type}, soft ${type === 'rhythmic' ? 'percussion' : 'strings'}, intro â†’ build â†’ sustain â†’ outro, ${intensity === 'high' ? 'forte' : intensity === 'low' ? 'piano' : 'mezzo-forte'} dynamics`;
          
          detailedDescription = `Prompt: ${prompt}\\nMusic Style: ${musicStyle}`;
          console.log(`ðŸ†• Created new dual-output format for segment ${index + 1}`);
        }
      } else if (validateDualOutputDescription(detailedDescription)) {
        console.log(`âœ… Segment ${index + 1}: Valid dual-output format detected`);
      }
      
      const normalized = {
        start_time: startSeconds,
        end_time: endSeconds,
        reason: segment.reason || segment.description || `Segment ${index + 1}`,
        intensity: normalizeIntensity(segment.intensity),
        type: normalizeType(segment.type),
        music_summary: segment.music_summary || segment.reason || `Music for segment ${index + 1}`,
        detailed_description: detailedDescription,
        volume: parseInt(segment.volume) || 60,
        fade_algorithm: segment.fade_algorithm || "linear",
        fadein_duration: segment.fadein_duration || "2.0",
        fadeout_duration: segment.fadeout_duration || "2.0"
      };
      
      const duration = normalized.end_time - normalized.start_time;
      
      if (normalized.start_time >= 0 && 
          normalized.end_time > normalized.start_time && 
          duration >= 1) {
        
        normalizedSegments.push(normalized);
        
        console.log(`âœ… Processed segment ${index + 1}: ${formatSecondsToTime(normalized.start_time)} - ${formatSecondsToTime(normalized.end_time)}`);
        
        // Show dual-output preview
        const lines = normalized.detailed_description.split('\\n');
        if (lines.length === 2) {
          console.log(`   ðŸ“ ${lines[0].substring(0, 80)}...`);
          console.log(`   ðŸŽµ ${lines[1].substring(0, 80)}...`);
        }
      }
      
    } catch (error) {
      console.log(`âŒ Error processing segment ${index + 1}:`, error.message);
    }
  });
  
  return normalizedSegments;
}

// âœ… ENHANCED: Display function for dual-output descriptions
function displaySegmentAnalysisResults(segmentationResult, processingTime) {
  console.log('\nðŸŽ‰ ===============================================');
  console.log('ðŸŽ‰ DUAL-OUTPUT MUSIC SEGMENTATION COMPLETED');
  console.log('ðŸŽ‰ ===============================================');
  console.log('ðŸ“Š Total segments found:', segmentationResult.totalSegments);
  console.log('â±ï¸ Processing time:', processingTime);
  
  if (segmentationResult.musicSegments && segmentationResult.musicSegments.length > 0) {
    console.log('\nðŸ“‹ DUAL-OUTPUT SEGMENT DETAILS:');
    console.log('ðŸ“‹ ===============================================');
    
    segmentationResult.musicSegments.forEach((segment, index) => {
      console.log(`\nðŸŽµ Segment ${index + 1}:`);
      console.log(`   â° Time: ${segment.start_time}s - ${segment.end_time}s`);
      console.log(`   ðŸŽ­ Type: ${segment.type} | ðŸ“ˆ Intensity: ${segment.intensity}`);
      console.log(`   ðŸ”Š Volume: ${segment.volume}% | ðŸŽšï¸ Fade: ${segment.fade_algorithm}`);
      console.log(`   ðŸ“ Reason: ${segment.reason}`);
      
      // âœ… DISPLAY dual-output description properly formatted
      if (segment.detailed_description) {
        const lines = segment.detailed_description.split('\\n');
        if (lines.length === 2) {
          console.log(`   ðŸ“– ${lines[0]}`); // Prompt line
          console.log(`   ðŸŽ¼ ${lines[1]}`); // Music Style line
        } else {
          console.log(`   ðŸ“– ${segment.detailed_description}`);
        }
      }
      
      console.log('   ---');
    });
    console.log('ðŸ“‹ ===============================================');
  }
}

// âœ… UTILITY: Extract prompt and music style from dual-output description
function extractDualOutputFromDescription(detailedDescription) {
  if (!detailedDescription) return { prompt: '', musicStyle: '' };
  
  const lines = detailedDescription.split('\\n');
  if (lines.length !== 2) return { prompt: detailedDescription, musicStyle: '' };
  
  const prompt = lines[0].replace(/^Prompt:\s*/, '').trim();
  const musicStyle = lines[1].replace(/^Music Style:\s*/, '').trim();
  
  return { prompt, musicStyle };
}

// âœ… UTILITY: Create dual-output description from components
function createDualOutputDescription(prompt, musicStyle) {
  // Ensure proper formatting and length limits
  const formattedPrompt = prompt.length > 280 ? prompt.substring(0, 277) + '...' : prompt;
  const formattedMusicStyle = musicStyle.length > 280 ? musicStyle.substring(0, 277) + '...' : musicStyle;
  
  return `Prompt: ${formattedPrompt}\\nMusic Style: ${formattedMusicStyle}`;
}

// âœ… EXPORT: Add new functions to module.exports
module.exports = {
  // ... existing exports ...
  validateDualOutputDescription,
  extractDualOutputFromDescription,
  createDualOutputDescription,
  // ... rest of existing exports ...
};
/**
 * 
 * FIXED: Enhanced regex extraction with time parsing
 */

// âœ… UTILITY: Create prompt description from context
function createPromptFromContext(context, type, intensity) {
  const basePrompts = {
    'ambient': 'Peaceful scene with calm atmosphere, gentle pacing, serene visuals, creating relaxing mood for viewers',
    'emotional': 'Meaningful moment with personal connections, heartfelt interactions, touching scenes, evoking warm feelings',
    'rhythmic': 'Active segment with movement and energy, dynamic visuals, engaging activities, maintaining viewer interest',
    'dramatic': 'Intense moment with heightened emotions, significant events, tension building, compelling narrative elements',
    'energetic': 'High-energy scene with excitement and enthusiasm, upbeat activities, positive interactions, vibrant atmosphere'
  };
  
  let prompt = basePrompts[type] || 'Video segment requiring background musical accompaniment, visual content with moderate pacing';
  
  // Add intensity modifier
  if (intensity === 'high') {
    prompt = prompt.replace('calm atmosphere', 'dynamic atmosphere').replace('gentle pacing', 'quick pacing');
  } else if (intensity === 'low') {
    prompt = prompt.replace('dynamic', 'subtle').replace('active', 'quiet');
  }
  
  // Add context if available
  if (context && context.length > 10) {
    const contextWords = context.split(' ').slice(0, 5).join(' ');
    prompt = `${contextWords} scene with ${prompt.split(' ').slice(-8).join(' ')}`;
  }
  
  return prompt.substring(0, 270); // Leave room for "Prompt: "
}

// âœ… UTILITY: Create music style description from type and intensity
function createMusicStyleFromType(type, intensity, startSeconds, endSeconds) {
  const duration = endSeconds - startSeconds;
  
  const bpmMap = {
    'ambient': intensity === 'high' ? 85 : intensity === 'low' ? 60 : 70,
    'emotional': intensity === 'high' ? 95 : intensity === 'low' ? 75 : 85,
    'rhythmic': intensity === 'high' ? 110 : intensity === 'low' ? 90 : 100,
    'dramatic': intensity === 'high' ? 105 : intensity === 'low' ? 80 : 95,
    'energetic': intensity === 'high' ? 120 : intensity === 'low' ? 100 : 110
  };
  
  const keyMap = {
    'ambient': 'C major',
    'emotional': 'G major', 
    'rhythmic': 'F major',
    'dramatic': 'B minor',
    'energetic': 'D major'
  };
  
  const instrumentMap = {
    'ambient': 'soft piano and strings',
    'emotional': 'acoustic guitar and light strings',
    'rhythmic': 'guitar and percussion',
    'dramatic': 'orchestral strings and brass',
    'energetic': 'electric guitar and full band'
  };
  
  const dynamicsMap = {
    'low': 'piano to mezzo-piano',
    'medium': 'mezzo-forte',
    'high': 'forte to fortissimo'
  };
  
  const bpm = bpmMap[type] || 80;
  const key = keyMap[type] || 'C major';
  const instruments = instrumentMap[type] || 'acoustic instruments';
  const dynamics = dynamicsMap[intensity] || 'mezzo-forte';
  
  const progression = duration > 45 ? 'intro â†’ build â†’ climax â†’ outro' : 
                     duration > 20 ? 'intro â†’ build â†’ resolution' : 'intro â†’ sustain â†’ fade';
  
  return `${bpm} BPM, ${key}, ${type} instrumental, ${instruments}, ${progression}, ${dynamics} dynamics`;
}
function extractSegmentsWithRegex(text, maxSegments = 10) {
  console.log('ðŸ” Enhanced regex extraction with DUAL-OUTPUT descriptions...');
  
  const segments = [];
  
  // Pattern for M:SS format time ranges
  const timeRangePattern = /(?:(\d{1,2}:\d{2})\s*(?:to|-)?\s*(\d{1,2}:\d{2})[^.]*?([^.]{20,100}))/gi;
  const timeMatches = [...text.matchAll(timeRangePattern)];
  
  timeMatches.slice(0, maxSegments).forEach((match, index) => {
    const startSeconds = parseTimeToSeconds(match[1]);
    const endSeconds = parseTimeToSeconds(match[2]);
    const context = match[3] ? match[3].trim() : '';
    
    // Detect characteristics from context
    const intensity = detectIntensity(context);
    const type = detectType(context);
    
    // Create dual-output description based on detected characteristics
    const prompt = createPromptFromContext(context, type, intensity);
    const musicStyle = createMusicStyleFromType(type, intensity, startSeconds, endSeconds);
    
    const segment = {
      start_time: startSeconds,
      end_time: endSeconds,
      reason: `Segment ${index + 1} from regex extraction: ${context.substring(0, 50)}...`,
      intensity: intensity,
      type: type,
      music_summary: `${type} background music for segment ${index + 1}`,
      detailed_description: `Prompt: ${prompt}\\nMusic Style: ${musicStyle}`,
      volume: 60,
      fade_algorithm: "linear",
      fadein_duration: "2.0",
      fadeout_duration: "2.0"
    };
    
    if (segment.start_time >= 0 && segment.end_time > segment.start_time) {
      segments.push(segment);
      console.log(`âœ… Regex dual-output segment ${segments.length}: ${formatSecondsToTime(segment.start_time)} - ${formatSecondsToTime(segment.end_time)}`);
      console.log(`   ðŸ“ Prompt: ${prompt.substring(0, 60)}...`);
      console.log(`   ðŸŽµ Style: ${musicStyle.substring(0, 60)}...`);
    }
  });
  
  return segments;
}


/**
 * FIXED: Create emergency fallback with proper time format
 */
function createEmergencyFallbackSegments(responseText, maxSegments) {
  console.log('ðŸš¨ Creating emergency fallback segments with DUAL-OUTPUT descriptions...');
  
  const segments = [];
  
  // Predefined dual-output descriptions for common video types
  const fallbackDescriptions = [
    {
      start: 0,
      end: 30,
      type: 'ambient',
      intensity: 'low',
      description: "Prompt: Opening video segment with introductory content, establishing shots, calm pacing, setting the scene for viewers, welcoming atmosphere.\\nMusic Style: 75 BPM, C major, ambient acoustic, soft piano and strings, gentle intro â†’ warm build â†’ sustained ambience â†’ smooth transition, legato, piano to mezzo-piano dynamics."
    },
    {
      start: 30,
      end: 60,
      type: 'emotional',
      intensity: 'medium', 
      description: "Prompt: Main content section with dialogue or narration, medium energy, people interacting, conversational tone, engaging visual elements.\\nMusic Style: 85 BPM, G major, contemporary folk, acoustic guitar and light percussion, melodic intro â†’ rhythmic development â†’ emotional peak â†’ gentle resolution, andante, mezzo-forte dynamics."
    },
    {
      start: 60,
      end: 90,
      type: 'rhythmic',
      intensity: 'medium',
      description: "Prompt: Active segment with movement, transitions between scenes, moderate pacing, visual variety, maintaining viewer engagement and interest.\\nMusic Style: 95 BPM, F major, upbeat instrumental, guitar and drums, energetic intro â†’ building momentum â†’ dynamic climax â†’ satisfying outro, moderato, forte dynamics."
    },
    {
      start: 90,
      end: 120,
      type: 'ambient',
      intensity: 'low',
      description: "Prompt: Contemplative section with slower pacing, thoughtful moments, scenic views or quiet activities, peaceful atmosphere, reflective mood.\\nMusic Style: 65 BPM, A minor, neo-classical, solo piano and strings, introspective intro â†’ emotional development â†’ poignant peak â†’ gentle fade, rubato, piano to mezzo-forte."
    },
    {
      start: 120,
      end: 150,
      type: 'energetic',
      intensity: 'high',
      description: "Prompt: High-energy segment with excitement, celebrations, active scenes, upbeat interactions, positive emotions, engaging activities.\\nMusic Style: 110 BPM, D major, pop rock, electric guitar and full band, powerful intro â†’ driving beat â†’ triumphant climax â†’ satisfying conclusion, allegro, fortissimo dynamics."
    },
    {
      start: 150,
      end: 180,
      type: 'emotional',
      intensity: 'medium',
      description: "Prompt: Meaningful moments with personal connections, heartfelt conversations, important events, emotional significance, warm human interactions.\\nMusic Style: 80 BPM, Eâ™­ major, cinematic orchestral, strings and piano, tender intro â†’ building emotion â†’ heartfelt climax â†’ warm resolution, espressivo, dolce dynamics."
    },
    {
      start: 180,
      end: 210,
      type: 'dramatic',
      intensity: 'high',
      description: "Prompt: Intense or significant moments, dramatic revelations, important decisions, tension building, climactic events, heightened emotions.\\nMusic Style: 100 BPM, B minor, dramatic orchestral, full orchestra with brass, suspenseful intro â†’ tension building â†’ dramatic peak â†’ powerful resolution, allegro con fuoco, fortissimo."
    },
    {
      start: 210,
      end: 240,
      type: 'ambient',
      intensity: 'low',
      description: "Prompt: Closing section with resolution, peaceful endings, final thoughts, wrap-up content, satisfying conclusion, calm departure feeling.\\nMusic Style: 70 BPM, C major, acoustic ambient, guitar and soft strings, reflective intro â†’ gentle build â†’ peaceful sustain â†’ fade to silence, ritardando, diminuendo to pianissimo."
    }
  ];
  
  // Try to extract time patterns from response first
  const timeMatches = [...responseText.matchAll(/(\d{1,2}:\d{2})\s*(?:to|-)?\s*(\d{1,2}:\d{2})/gi)];
  
  if (timeMatches.length > 0) {
    timeMatches.slice(0, maxSegments).forEach((match, index) => {
      const startSeconds = parseTimeToSeconds(match[1]);
      const endSeconds = parseTimeToSeconds(match[2]);
      
      if (endSeconds > startSeconds) {
        // Use appropriate fallback description based on timing
        const fallbackIndex = index % fallbackDescriptions.length;
        const fallback = fallbackDescriptions[fallbackIndex];
        
        segments.push({
          start_time: startSeconds,
          end_time: endSeconds,
          reason: `Emergency segment ${index + 1} - extracted from time pattern ${match[1]} to ${match[2]}`,
          intensity: fallback.intensity,
          type: fallback.type,
          music_summary: `${fallback.type} background music for video segment`,
          detailed_description: fallback.description,
          volume: 60,
          fade_algorithm: "linear",
          fadein_duration: "2.0",
          fadeout_duration: "2.0"
        });
        
        console.log(`âœ… Emergency dual-output segment ${index + 1}: ${match[1]} (${startSeconds}s) to ${match[2]} (${endSeconds}s)`);
        console.log(`   ðŸŽ­ Type: ${fallback.type} | ðŸ“ˆ Intensity: ${fallback.intensity}`);
        
        // Show dual-output preview
        const lines = fallback.description.split('\\n');
        if (lines.length === 2) {
          console.log(`   ðŸ“ ${lines[0].substring(0, 80)}...`);
          console.log(`   ðŸŽµ ${lines[1].substring(0, 80)}...`);
        }
      }
    });
  }
  
  // Fallback to default segments if no time patterns found
  if (segments.length === 0) {
    console.log('ðŸ”„ No time patterns found, using default segment timing...');
    
    fallbackDescriptions.slice(0, maxSegments).forEach((fallback, index) => {
      segments.push({
        start_time: fallback.start,
        end_time: fallback.end,
        reason: `Emergency fallback segment ${index + 1} - default timing`,
        intensity: fallback.intensity,
        type: fallback.type,
        music_summary: `${fallback.type} background music for video segment`,
        detailed_description: fallback.description,
        volume: 60,
        fade_algorithm: "linear",
        fadein_duration: "2.0",
        fadeout_duration: "2.0"
      });
      
      console.log(`âœ… Default dual-output segment ${index + 1}: ${fallback.start}s - ${fallback.end}s`);
      console.log(`   ðŸŽ­ Type: ${fallback.type} | ðŸ“ˆ Intensity: ${fallback.intensity}`);
    });
  }
  
  console.log(`ðŸš¨ Created ${segments.length} emergency fallback segments with dual-output descriptions`);
  return segments;
}


// âœ… UPDATE: Also fix the main extraction function
function extractSegmentsFromGeminiResponse(geminiResponse, maxSegments = 10) {
  console.log('ðŸ” ===============================================');
  console.log('ðŸ” ENHANCED JSON PARSER WITH TIME FORMAT SUPPORT');
  console.log('ðŸ” ===============================================');
  console.log('ðŸ“„ Response length:', geminiResponse.length);
  console.log('ðŸ”¢ Max segments:', maxSegments);
  console.log('ðŸ•’ Supporting M:SS time format parsing');
  
  let segments = [];
  let parseError = null;
  let strategy = 'unknown';
  
  // Strategy 1: Clean and Direct JSON Parsing with Time Conversion
  try {
    console.log('ðŸ”„ Strategy 1: Clean JSON parsing with time format support...');
    
    let cleanResponse = geminiResponse.trim();
    
    // Remove markdown code blocks
    cleanResponse = cleanResponse.replace(/```json\s*/gi, '');
    cleanResponse = cleanResponse.replace(/```\s*/g, '');
    cleanResponse = cleanResponse.replace(/^```/gm, '');
    
    // Extract JSON object/array
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      console.log('âœ… Found JSON pattern, length:', jsonStr.length);
      
      const parsedData = JSON.parse(jsonStr);
      
      // Handle different response formats
      if (Array.isArray(parsedData)) {
        segments = parsedData;
      } else if (parsedData.segments && Array.isArray(parsedData.segments)) {
        segments = parsedData.segments;
      } else if (parsedData.data && Array.isArray(parsedData.data)) {
        segments = parsedData.data;
      }
      
      if (segments.length > 0) {
        console.log(`âœ… Strategy 1 SUCCESS: Parsed ${segments.length} segments directly`);
        strategy = 'clean_json_direct_with_time_parsing';
        
        if (segments.length > maxSegments) {
          segments = segments.slice(0, maxSegments);
          console.log(`âœ‚ï¸ Limited to ${maxSegments} segments`);
        }
        
        // âœ… USE FIXED VALIDATION WITH TIME PARSING
        return { segments: validateAndNormalizeSegments(segments), parseError: null, strategy };
      }
    }
    
    throw new Error('No valid JSON structure found');
    
  } catch (error) {
    console.log('âŒ Strategy 1 failed:', error.message);
    parseError = error.message;
  }
  
  // Continue with other strategies using the fixed functions...
  // (Rest of the strategies would use the same pattern)
  
  // Strategy 4: Extract Valid Segments from Broken JSON with Time Parsing
  try {
    console.log('ðŸ”„ Strategy 4: Extract valid segments with TIME PARSING...');
    
    segments = extractValidSegmentsFromBrokenJSON(geminiResponse, maxSegments);
    
    if (segments.length > 0) {
      console.log(`âœ… Strategy 4 SUCCESS: Extracted ${segments.length} valid segments`);
      strategy = 'valid_segment_extraction_with_time_parsing';
      return { segments: validateAndNormalizeSegments(segments), parseError, strategy };
    }
    
    throw new Error('No valid segments found in broken JSON');
    
  } catch (error) {
    console.log('âŒ Strategy 4 failed:', error.message);
  }
  
  // Strategy 5: Regex-based Extraction with Time Parsing
  try {
    console.log('ðŸ”„ Strategy 5: Regex-based extraction with TIME PARSING...');
    
    segments = extractSegmentsWithRegex(geminiResponse, maxSegments);
    
    if (segments.length > 0) {
      console.log(`âœ… Strategy 5 SUCCESS: Extracted ${segments.length} segments with regex`);
      strategy = 'regex_extraction_with_time_parsing';
      return { segments: validateAndNormalizeSegments(segments), parseError, strategy };
    }
    
    throw new Error('Regex extraction failed');
    
  } catch (error) {
    console.log('âŒ Strategy 5 failed:', error.message);
  }
  
  // All strategies failed - create emergency fallback segments with time parsing
  console.log('ðŸš¨ ALL STRATEGIES FAILED - Creating emergency fallback with TIME PARSING');
  
  segments = createEmergencyFallbackSegments(geminiResponse, maxSegments);
  strategy = 'emergency_fallback_with_time_parsing';
  
  console.log(`ðŸš¨ Emergency fallback created ${segments.length} basic segments`);
  
  return { 
    segments: segments, 
    parseError: parseError || 'All parsing strategies failed - using emergency fallback with time parsing',
    strategy: strategy
  };
}

// Export the new functions
module.exports = {
  // ... your existing exports
  parseTimeToSeconds,
  formatSecondsToTime,
  validateAndNormalizeSegments,
  extractSegmentsWithRegex,
  createEmergencyFallbackSegments,
  extractSegmentsFromGeminiResponse
};
/**
 * Normalize intensity values
 */
function normalizeIntensity(intensity) {
  if (!intensity) return 'medium';
  
  const normalized = intensity.toString().toLowerCase();
  
  if (normalized.includes('low') || normalized.includes('soft') || normalized.includes('quiet')) {
    return 'low';
  } else if (normalized.includes('high') || normalized.includes('loud') || normalized.includes('intense')) {
    return 'high';
  } else {
    return 'medium';
  }
}

/**
 * Normalize type values
 */
function normalizeType(type) {
  if (!type) return 'ambient';
  
  const normalized = type.toString().toLowerCase();
  
  const typeMap = {
    'rhythm': 'rhythmic',
    'beat': 'rhythmic',
    'emotion': 'emotional',
    'drama': 'dramatic',
    'energy': 'energetic',
    'action': 'energetic',
    'suspense': 'suspenseful',
    'mystery': 'suspenseful',
    'ambient': 'ambient'
  };
  
  for (const [key, value] of Object.entries(typeMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  
  return 'ambient';
}



/**
 * Enhanced text-based extraction for fallback
 */
function extractSegmentsFromText(text, maxSegments = 10) {
  console.log('ðŸ“ Enhanced text extraction...');
  
  const segments = [];
  const lines = text.split('\n');
  
  let currentSegment = null;
  
  for (let i = 0; i < lines.length && segments.length < maxSegments; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Look for segment indicators
    if (line.match(/^\d+[\.\)]/)) {
      // Save previous segment
      if (currentSegment && isValidSegment(currentSegment)) {
        segments.push(currentSegment);
      }
      
      // Start new segment
      currentSegment = {
        start_time: 0,
        end_time: 30,
        reason: line.replace(/^\d+[\.\)]\s*/, ''),
        intensity: 'medium',
        type: 'ambient',
        music_summary: 'Background music segment',
        volume: 60,
        fade_algorithm: 'linear',
        fadein_duration: '2.0',
        fadeout_duration: '2.0'
      };
    }
    
    // Extract timing information
    const timeMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:to|-)?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)/i);
    if (timeMatch && currentSegment) {
      currentSegment.start_time = parseFloat(timeMatch[1]);
      currentSegment.end_time = parseFloat(timeMatch[2]);
    }
    
    // Extract other properties
    updateSegmentFromLine(currentSegment, line);
  }
  
  // Don't forget the last segment
  if (currentSegment && isValidSegment(currentSegment)) {
    segments.push(currentSegment);
  }
  
  console.log(`ðŸ“ Text extraction found ${segments.length} segments`);
  return segments;
}

/**
 * Helper functions for text parsing
 */
function detectIntensity(text) {
  const lowWords = ['soft', 'quiet', 'gentle', 'calm', 'peaceful', 'low'];
  const highWords = ['loud', 'intense', 'dramatic', 'powerful', 'energetic', 'high'];
  
  const textLower = text.toLowerCase();
  
  if (lowWords.some(word => textLower.includes(word))) {
    return 'low';
  } else if (highWords.some(word => textLower.includes(word))) {
    return 'high';
  } else {
    return 'medium';
  }
}

function detectType(text) {
  const textLower = text.toLowerCase();
  
  if (textLower.includes('rhythm') || textLower.includes('beat') || textLower.includes('dance')) {
    return 'rhythmic';
  } else if (textLower.includes('emotion') || textLower.includes('feel')) {
    return 'emotional';
  } else if (textLower.includes('drama') || textLower.includes('tension')) {
    return 'dramatic';
  } else if (textLower.includes('energy') || textLower.includes('action')) {
    return 'energetic';
  } else if (textLower.includes('suspense') || textLower.includes('mystery')) {
    return 'suspenseful';
  } else {
    return 'ambient';
  }
}

function updateSegmentFromLine(segment, line) {
  if (!segment) return;
  
  // Extract intensity
  const intensityMatch = line.match(/intensity[:\s]*([^,\n]+)/i);
  if (intensityMatch) {
    segment.intensity = normalizeIntensity(intensityMatch[1].trim());
  }
  
  // Extract type
  const typeMatch = line.match(/type[:\s]*([^,\n]+)/i);
  if (typeMatch) {
    segment.type = normalizeType(typeMatch[1].trim());
  }
  
  // Extract volume
  const volumeMatch = line.match(/volume[:\s]*(\d+)/i);
  if (volumeMatch) {
    segment.volume = parseInt(volumeMatch[1]);
  }
  
  // Extract reason
  const reasonMatch = line.match(/reason[:\s]*(.+)/i);
  if (reasonMatch) {
    segment.reason = reasonMatch[1].trim();
  }
}

function isValidSegment(segment) {
  return segment && 
         typeof segment.start_time === 'number' && 
         typeof segment.end_time === 'number' && 
         segment.end_time > segment.start_time &&
         segment.start_time >= 0 &&
         segment.reason &&
         segment.intensity &&
         segment.type;
}
// Enhanced text extraction function
function extractSegmentsFromText(text, maxSegments = 10) {
  console.log('ðŸ“ Extracting segments from plain text...');
  
  const segments = [];
  const lines = text.split('\n');
  let currentSegment = null;
  
  for (let i = 0; i < lines.length && segments.length < maxSegments; i++) {
    const line = lines[i].trim();
    
    if (!line) continue;
    
    // Look for segment indicators
    if (line.match(/^\d+[\.\)]/)) {
      // Save previous segment if exists
      if (currentSegment && isValidSegment(currentSegment)) {
        segments.push(currentSegment);
      }
      
      // Start new segment
      currentSegment = {
        start: 0,
        end: 30,
        reason: line.replace(/^\d+[\.\)]\s*/, ''),
        intensity: 'medium',
        type: 'ambient'
      };
    }
    
    // Look for timing patterns
    const timeMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|s)\s*(?:to|-)?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)/i);
    if (timeMatch && currentSegment) {
      currentSegment.start = parseFloat(timeMatch[1]);
      currentSegment.end = parseFloat(timeMatch[2]);
    }
    
    // Look for single time values
    const singleTimeMatch = line.match(/^.*?(\d+(?:\.\d+)?)\s*(?:seconds?|s)/i);
    if (singleTimeMatch && currentSegment && !currentSegment.start) {
      currentSegment.start = parseFloat(singleTimeMatch[1]);
      currentSegment.end = currentSegment.start + 20; // Default 20 second duration
    }
    
    // Look for intensity
    const intensityMatch = line.match(/intensity[:\s]*([^,\n]+)/i);
    if (intensityMatch && currentSegment) {
      currentSegment.intensity = intensityMatch[1].trim().toLowerCase();
    }
    
    // Look for type
    const typeMatch = line.match(/type[:\s]*([^,\n]+)/i);
    if (typeMatch && currentSegment) {
      currentSegment.type = typeMatch[1].trim().toLowerCase();
    }
    
    // Look for reason/description
    const reasonMatch = line.match(/reason[:\s]*(.+)/i);
    if (reasonMatch && currentSegment) {
      currentSegment.reason = reasonMatch[1].trim();
    }
  }
  
  // Don't forget the last segment
  if (currentSegment && isValidSegment(currentSegment)) {
    segments.push(currentSegment);
  }
  
  console.log(`ðŸ“ Text extraction found ${segments.length} segments`);
  return segments;
}



// Helper function to validate segment
function isValidSegment(segment) {
  return segment && 
         typeof segment.start === 'number' && 
         typeof segment.end === 'number' && 
         segment.end > segment.start &&
         segment.start >= 0 &&
         segment.reason &&
         segment.intensity &&
         segment.type;
}


// Export 
// âœ… MISSING FUNCTION: Calculate quality score
function calculateQualityScore(analysis) {
  let score = 0;
  const maxScore = 100;

  // Length score (30 points max)
  const lengthScore = Math.min((analysis.length / 2000) * 30, 30);
  score += lengthScore;

  // Musical terminology score (40 points max)
  const musicalTerms = [
    'chord', 'progression', 'melody', 'rhythm', 'dynamics', 'tempo',
    'key', 'scale', 'harmony', 'instrumentation', 'orchestration',
    'modulation', 'voice leading', 'articulation', 'phrasing', 'texture'
  ];
  
  const foundTerms = musicalTerms.filter(term => 
    analysis.toLowerCase().includes(term)
  ).length;
  
  const terminologyScore = Math.min((foundTerms / musicalTerms.length) * 40, 40);
  score += terminologyScore;

  // Structure score (20 points max)
  const structuralElements = [
    'opening', 'development', 'climax', 'resolution', 'section', 'build'
  ];
  
  const foundStructure = structuralElements.filter(element => 
    analysis.toLowerCase().includes(element)
  ).length;
  
  const structureScore = Math.min((foundStructure / structuralElements.length) * 20, 20);
  score += structureScore;

  // Technical details score (10 points max)
  const technicalTerms = [
    'reverb', 'delay', 'compression', 'eq', 'filter', 'effects',
    'panning', 'stereo', 'mix', 'production'
  ];
  
  const foundTechnical = technicalTerms.filter(term => 
    analysis.toLowerCase().includes(term)
  ).length;
  
  const technicalScore = Math.min((foundTechnical / technicalTerms.length) * 10, 10);
  score += technicalScore;

  return Math.round(score);
}

// âœ… NEW: Validate musical terminology usage
function validateMusicalTerminology(analysis) {
  const validation = {
    score: 0,
    categories: {},
    missingElements: [],
    strengths: []
  };

  // Define musical terminology categories with point values
  const musicalCategories = {
    harmony: {
      terms: ['chord progression', 'roman numeral', 'voice leading', 'modulation', 'cadence', 'resolution', 'suspension', 'extension', 'alteration', 'secondary dominant', 'tritone substitution', 'modal interchange'],
      weight: 25,
      found: []
    },
    rhythm: {
      terms: ['time signature', 'polyrhythm', 'hemiola', 'syncopation', 'metric modulation', 'subdivision', 'tuplet', 'cross-rhythm', 'displacement', 'augmentation', 'diminution'],
      weight: 20,
      found: []
    },
    melody: {
      terms: ['interval', 'scale degree', 'step', 'leap', 'contour', 'sequence', 'motif', 'phrase', 'period', 'antecedent', 'consequent', 'inversion', 'retrograde'],
      weight: 20,
      found: []
    },
    orchestration: {
      terms: ['timbre', 'articulation', 'dynamics', 'texture', 'voicing', 'doubling', 'register', 'tessitura', 'color', 'blend', 'balance', 'scoring'],
      weight: 15,
      found: []
    },
    form: {
      terms: ['section', 'development', 'recapitulation', 'bridge', 'transition', 'climax', 'coda', 'introduction', 'verse', 'chorus', 'build', 'breakdown'],
      weight: 10,
      found: []
    },
    production: {
      terms: ['reverb', 'delay', 'compression', 'eq', 'filter', 'saturation', 'panning', 'stereo', 'processing', 'effects', 'mix', 'master'],
      weight: 10,
      found: []
    }
  };

  const analysisLower = analysis.toLowerCase();

  // Check each category
  Object.keys(musicalCategories).forEach(category => {
    const categoryData = musicalCategories[category];
    
    categoryData.terms.forEach(term => {
      if (analysisLower.includes(term)) {
        categoryData.found.push(term);
      }
    });

    // Calculate category score
    const categoryScore = Math.min(
      (categoryData.found.length / categoryData.terms.length) * categoryData.weight,
      categoryData.weight
    );
    
    validation.categories[category] = {
      score: Math.round(categoryScore),
      maxScore: categoryData.weight,
      termsFound: categoryData.found.length,
      totalTerms: categoryData.terms.length,
      percentage: Math.round((categoryData.found.length / categoryData.terms.length) * 100),
      foundTerms: categoryData.found
    };

    validation.score += categoryScore;

    // Track strengths and missing elements
    if (categoryData.found.length >= categoryData.terms.length * 0.5) {
      validation.strengths.push(category);
    }
    if (categoryData.found.length < categoryData.terms.length * 0.3) {
      validation.missingElements.push(category);
    }
  });

  validation.score = Math.round(validation.score);
  validation.grade = getMusicalTerminologyGrade(validation.score);

  return validation;
}

// âœ… UTILITY: Get grade based on musical terminology score
function getMusicalTerminologyGrade(score) {
  if (score >= 90) return 'A+ (Professional Composer Level)';
  if (score >= 80) return 'A (Advanced Musical Knowledge)';
  if (score >= 70) return 'B+ (Strong Musical Terminology)';
  if (score >= 60) return 'B (Good Musical Understanding)';
  if (score >= 50) return 'C+ (Basic Musical Terms)';
  if (score >= 40) return 'C (Limited Musical Vocabulary)';
  return 'D (Insufficient Musical Terminology)';
}

// âœ… UTILITY: Get MIME type from filename
function getMimeTypeFromFileName(fileName) {
  const ext = fileName.toLowerCase().split('.').pop();
  const mimeTypes = {
    'mp4': 'video/mp4',
    'avi': 'video/avi',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'webm': 'video/webm',
    'mkv': 'video/x-matroska',
    '3gp': 'video/3gpp'
  };
  return mimeTypes[ext] || 'video/mp4';
}

// âœ… ENHANCED: Add test function for GCS access
async function testGCSAccess(gcsUrl) {
  try {
    console.log('ðŸ§ª Testing GCS access for:', gcsUrl);
    
    const fileName = extractFileNameFromUrl(gcsUrl);
    console.log('ðŸ“ Testing file:', fileName);
    
    // Test 1: Direct URL access
    if (gcsUrl.includes('storage.googleapis.com')) {
      try {
        const response = await fetch(gcsUrl, { method: 'HEAD' });
        if (response.ok) {
          return {
            success: true,
            accessible: true,
            method: 'direct-url',
            status: response.status,
            contentLength: response.headers.get('content-length'),
            contentType: response.headers.get('content-type')
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (directError) {
        console.log('âŒ Direct URL test failed:', directError.message);
      }
    }
    
    // Test 2: Signed URL generation
    try {
      const signedUrl = await getSignedDownloadUrl(fileName, 1);
      
      const response = await fetch(signedUrl, { method: 'HEAD' });
      if (response.ok) {
        return {
          success: true,
          accessible: true,
          method: 'signed-url',
          status: response.status,
          contentLength: response.headers.get('content-length'),
          contentType: response.headers.get('content-type'),
          signedUrl: signedUrl
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (signedError) {
      console.log('âŒ Signed URL test failed:', signedError.message);
      return {
        success: false,
        accessible: false,
        error: signedError.message,
        details: 'Both direct URL and signed URL access failed'
      };
    }
    
  } catch (error) {
    console.error('âŒ GCS access test error:', error);
    return {
      success: false,
      accessible: false,
      error: error.message,
      details: 'Failed to test GCS access'
    };
  }
}

// âœ… UTILITY: Add genre template
function addGenreTemplate(genreId, template) {
  DETAILED_GENRE_TEMPLATES[genreId] = template;
  console.log(`âœ… Added genre template: ${genreId}`);
}

// âœ… UTILITY: Get available genres
function getAvailableGenres() {
  return Object.keys(DETAILED_GENRE_TEMPLATES);
}

// âœ… UTILITY: Add advanced genre template
function addAdvancedGenreTemplate(genreId, template) {
  ADVANCED_GENRE_TEMPLATES[genreId] = template;
  console.log(`âœ… Added advanced genre template: ${genreId}`);
}

// âœ… UTILITY: Get available advanced genres
function getAvailableAdvancedGenres() {
  return Object.keys(ADVANCED_GENRE_TEMPLATES);
}

// âœ… ENHANCED: Format output for Suno AI
function formatForSunoAI(analysisResult, includeMetadata = true) {
  if (!analysisResult.success) {
    return {
      error: analysisResult.error,
      details: analysisResult.details
    };
  }

  const analysis = analysisResult.analysis;
  
  // Extract key musical elements for Suno AI formatting
  const keyMatch = analysis.match(/Key:\s*([A-G][#b]?\s*(?:major|minor|maj|min))/i);
  const bpmMatch = analysis.match(/â‰ˆ?(\d+)\s*BPM/i);
  const genreMatch = analysis.match(/Genre.*?:\s*([^\.]+)/i);
  
  const sunoFormat = {
    // Core Suno AI parameters
    key: keyMatch ? keyMatch[1] : 'C major',
    bpm: bpmMatch ? parseInt(bpmMatch[1]) : 120,
    genre: genreMatch ? genreMatch[1].trim() : 'Cinematic',
    
    // Formatted prompt for Suno AI
    prompt: analysis,
    
    // Custom mode recommendations
    customMode: {
      style: extractStyleElements(analysis),
      mood: extractMoodElements(analysis),
      instruments: extractInstrumentList(analysis),
      structure: extractStructuralElements(analysis)
    }
  };

  if (includeMetadata) {
    sunoFormat.metadata = {
      processingTime: analysisResult.processingTime,
      qualityScore: analysisResult.musicalTermsValidation?.score || 0,
      grade: analysisResult.musicalTermsValidation?.grade || 'Not evaluated',
      videoSize: analysisResult.videoSize,
      analysisType: analysisResult.analysisType,
      musicalComplexity: analysisResult.musicalComplexity
    };
  }

  return sunoFormat;
}

// âœ… UTILITY: Extract style elements for Suno AI
function extractStyleElements(analysis) {
  const styleKeywords = [
    'cinematic', 'orchestral', 'electronic', 'ambient', 'jazz', 'rock', 'classical', 
    'minimalist', 'epic', 'dramatic', 'ethereal', 'dark', 'bright', 'warm', 'cold'
  ];
  
  const foundStyles = styleKeywords.filter(style => 
    analysis.toLowerCase().includes(style)
  );
  
  return foundStyles.slice(0, 3).join(', ');
}

// âœ… UTILITY: Extract mood elements for Suno AI
function extractMoodElements(analysis) {
  const moodKeywords = [
    'mysterious', 'hopeful', 'melancholic', 'energetic', 'peaceful', 'tense',
    'dramatic', 'romantic', 'nostalgic', 'uplifting', 'contemplative', 'intense',
    'gentle', 'powerful', 'ethereal', 'dark', 'bright', 'somber', 'joyful'
  ];
  
  const foundMoods = moodKeywords.filter(mood => 
    analysis.toLowerCase().includes(mood)
  );
  
  return foundMoods.slice(0, 2).join(', ');
}

// âœ… UTILITY: Extract instrument list for Suno AI
function extractInstrumentList(analysis) {
  const instruments = [
    'piano', 'rhodes', 'guitar', 'bass', 'drums', 'strings', 'violin', 'cello',
    'trumpet', 'saxophone', 'flute', 'clarinet', 'oboe', 'french horn', 'trombone',
    'synthesizer', 'moog', 'prophet', 'organ', 'harp', 'timpani', 'vibraphone',
    'marimba', 'xylophone', 'celesta', 'accordion', 'harmonica', 'banjo'
  ];
  
  const foundInstruments = instruments.filter(instrument => 
    analysis.toLowerCase().includes(instrument)
  );
  
  return foundInstruments.slice(0, 5).join(', ');
}

// âœ… UTILITY: Extract structural elements for Suno AI
function extractStructuralElements(analysis) {
  const structures = [];
  
  // Look for time-based sections
  const timeRegex = /(\d+:\d+)/g;
  const timeMatches = analysis.match(timeRegex);
  
  if (timeMatches && timeMatches.length >= 3) {
    structures.push('Multi-section composition');
  }
  
  // Look for dynamic changes
  if (analysis.toLowerCase().includes('build') || analysis.toLowerCase().includes('crescendo')) {
    structures.push('Dynamic build-ups');
  }
  
  if (analysis.toLowerCase().includes('climax')) {
    structures.push('Climactic structure');
  }
  
  if (analysis.toLowerCase().includes('fade') || analysis.toLowerCase().includes('outro')) {
    structures.push('Fade outro');
  }
  
  return structures.join(', ') || 'Standard song structure';
}

// âœ… ENHANCED: Generate Suno AI prompt with advanced formatting
function generateSunoPrompt(analysisResult, options = {}) {
  const {
    includeTimestamps = true,
    includeInstruments = true,
    includeEffects = true,
    maxLength = 2000,
    style = 'detailed'
  } = options;

  if (!analysisResult.success) {
    return {
      error: 'Cannot generate Suno prompt from failed analysis',
      details: analysisResult.error
    };
  }

  const analysis = analysisResult.analysis;
  
  // Extract core elements
  const keyMatch = analysis.match(/Key:\s*([A-G][#b]?\s*(?:major|minor|maj|min))/i);
  const bpmMatch = analysis.match(/â‰ˆ?(\d+)\s*BPM/i);
  const genreMatch = analysis.match(/Genre.*?:\s*([^\.]+)/i);
  
  let sunoPrompt = '';
  
  // Start with basic parameters
  if (keyMatch) sunoPrompt += `${keyMatch[1]}, `;
  if (bpmMatch) sunoPrompt += `â‰ˆ${bpmMatch[1]} BPM, `;
  if (genreMatch) sunoPrompt += `${genreMatch[1].trim()}. `;
  
  // Add core composition description
  sunoPrompt += extractCoreComposition(analysis, includeInstruments, includeEffects);
  
  // Add structural elements if requested
  if (includeTimestamps) {
    sunoPrompt += ' ' + extractTimestampedSections(analysis);
  }
  
  // Trim to max length
  if (sunoPrompt.length > maxLength) {
    sunoPrompt = sunoPrompt.substring(0, maxLength - 3) + '...';
  }
  
  return {
    success: true,
    prompt: sunoPrompt,
    metadata: {
      originalLength: analysis.length,
      compressedLength: sunoPrompt.length,
      compressionRatio: ((analysis.length - sunoPrompt.length) / analysis.length * 100).toFixed(1) + '%',
      extractedElements: {
        key: keyMatch ? keyMatch[1] : 'Not specified',
        bpm: bpmMatch ? bpmMatch[1] : 'Not specified',
        genre: genreMatch ? genreMatch[1].trim() : 'Not specified',
        instruments: extractInstrumentList(analysis),
        mood: extractMoodElements(analysis),
        style: extractStyleElements(analysis)
      }
    }
  };
}

// âœ… UTILITY: Extract core composition for Suno
function extractCoreComposition(analysis, includeInstruments = true, includeEffects = true) {
  // Find the main composition description (usually the first detailed section)
  const compositionMatch = analysis.match(/Begins with[^\.]+\.[^\.]+\.[^\.]+\./i);
  if (compositionMatch) {
    let composition = compositionMatch[0];
    
    if (!includeInstruments) {
      // Remove specific instrument mentions
      composition = composition.replace(/\b(Rhodes|Moog|Prophet|Fender|Marshall|Gibson|Yamaha)\s+\w+/gi, 'instrument');
    }
    
    if (!includeEffects) {
      // Remove specific effect mentions
      composition = composition.replace(/\b(reverb|delay|compression|distortion|chorus|flanger|phaser)[\w\s-]*,?\s*/gi, '');
    }
    
    return composition;
  }
  
  // Fallback: extract first substantial sentence
  const sentences = analysis.split('.').filter(s => s.length > 50);
  return sentences[0] || 'Instrumental composition based on visual analysis';
}

// âœ… UTILITY: Extract timestamped sections for Suno
function extractTimestampedSections(analysis) {
  const sections = [];
  
  // Find development section
  const devMatch = analysis.match(/Development.*?(\d+:\d+.*?)(?=\n\n|\*\*|$)/is);
  if (devMatch) {
    sections.push(`Development ${devMatch[1].substring(0, 100)}...`);
  }
  
  // Find climax section
  const climaxMatch = analysis.match(/Climax.*?(\d+:\d+.*?)(?=\n\n|\*\*|$)/is);
  if (climaxMatch) {
    sections.push(`Climax ${climaxMatch[1].substring(0, 100)}...`);
  }
  
  return sections.join(' ');
}

// âœ… ENHANCED: Batch processing for multiple videos
async function batchAnalyzeVideos(videoSources, options = {}) {
  const {
    concurrency = 3,
    delayBetween = 1000,
    genre = null,
    analysisType = 'full',
    includeValidation = true
  } = options;

  console.log(`ðŸ”„ Starting batch analysis of ${videoSources.length} videos...`);
  console.log(`âš™ï¸ Concurrency: ${concurrency}, Delay: ${delayBetween}ms`);

  const results = [];
  const errors = [];

  // Process in batches
  for (let i = 0; i < videoSources.length; i += concurrency) {
    const batch = videoSources.slice(i, i + concurrency);
    
    console.log(`ðŸ“¦ Processing batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(videoSources.length/concurrency)}`);
    
    const batchPromises = batch.map(async (source, index) => {
      try {
        await new Promise(resolve => setTimeout(resolve, index * delayBetween));
        
        let result;
        if (typeof source === 'string') {
          // GCS URL
          result = await analyzeVideoFromGCS(source, { genre, analysisType });
        } else {
          // Buffer with metadata
          result = includeValidation 
            ? await analyzeVideoForMusicWithValidation(source.buffer, source.mimeType, { genre, analysisType })
            : await analyzeVideoForAdvancedMusic(source.buffer, source.mimeType, { genre, analysisType });
        }
        
        return {
          index: i + index,
          source: typeof source === 'string' ? source : source.name || 'buffer',
          ...result
        };
        
      } catch (error) {
        console.error(`âŒ Error processing video ${i + index}:`, error);
        return {
          index: i + index,
          source: typeof source === 'string' ? source : source.name || 'buffer',
          success: false,
          error: error.message
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(result => {
      if (result.success) {
        results.push(result);
      } else {
        errors.push(result);
      }
    });
    
    // Delay between batches
    if (i + concurrency < videoSources.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetween * 2));
    }
  }

  console.log(`âœ… Batch processing completed: ${results.length} successful, ${errors.length} failed`);

  return {
    success: true,
    results: results,
    errors: errors,
    summary: {
      total: videoSources.length,
      successful: results.length,
      failed: errors.length,
      successRate: ((results.length / videoSources.length) * 100).toFixed(1) + '%',
      averageProcessingTime: results.length > 0 
        ? (results.reduce((sum, r) => sum + parseFloat(r.processingTime), 0) / results.length).toFixed(2) + 's'
        : 'N/A'
    }
  };
}

// âœ… UTILITY: Export analysis results
function exportAnalysisResults(results, format = 'json') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `music-analysis-${timestamp}`;

  switch (format.toLowerCase()) {
    case 'json':
      return {
        filename: `${filename}.json`,
        content: JSON.stringify(results, null, 2),
        mimeType: 'application/json'
      };
      
    case 'csv':
      const csvContent = convertToCsv(results);
      return {
        filename: `${filename}.csv`,
        content: csvContent,
        mimeType: 'text/csv'
      };
      
    case 'markdown':
      const mdContent = convertToMarkdown(results);
      return {
        filename: `${filename}.md`,
        content: mdContent,
        mimeType: 'text/markdown'
      };
      
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

// âœ… UTILITY: Convert results to CSV
function convertToCsv(results) {
  if (!Array.isArray(results)) {
    results = [results];
  }

  const headers = [
    'Index', 'Source', 'Success', 'Processing Time', 'Key', 'BPM', 'Genre',
    'Analysis Length', 'Quality Score', 'Musical Grade', 'Video Size'
  ];

  const rows = results.map(result => [
    result.index || 0,
    result.source || 'Unknown',
    result.success || false,
    result.processingTime || 'N/A',
    extractKeyFromAnalysis(result.analysis) || 'N/A',
    extractBpmFromAnalysis(result.analysis) || 'N/A',
    extractGenreFromAnalysis(result.analysis) || 'N/A',
    result.analysis ? result.analysis.length : 0,
    result.musicalTermsValidation?.score || 0,
    result.musicalTermsValidation?.grade || 'N/A',
    result.videoSize || 'N/A'
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

// âœ… UTILITY: Convert results to Markdown
function convertToMarkdown(results) {
  if (!Array.isArray(results)) {
    results = [results];
  }

  let markdown = '# Music Analysis Results\n\n';
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;

  results.forEach((result, index) => {
    markdown += `## Analysis ${index + 1}\n\n`;
    markdown += `**Source:** ${result.source || 'Unknown'}\n`;
    markdown += `**Success:** ${result.success ? 'âœ…' : 'âŒ'}\n`;
    markdown += `**Processing Time:** ${result.processingTime || 'N/A'}\n`;
    
    if (result.success && result.analysis) {
      markdown += `**Quality Score:** ${result.musicalTermsValidation?.score || 'N/A'}/100\n`;
      markdown += `**Musical Grade:** ${result.musicalTermsValidation?.grade || 'N/A'}\n\n`;
      markdown += '### Composition Instructions\n\n';
      markdown += '```\n' + result.analysis + '\n```\n\n';
    } else {
      markdown += `**Error:** ${result.error || 'Unknown error'}\n\n`;
    }
    
    markdown += '---\n\n';
  });

  return markdown;
}

// âœ… UTILITY: Helper functions for CSV extraction
function extractKeyFromAnalysis(analysis) {
  if (!analysis) return null;
  const match = analysis.match(/Key:\s*([A-G][#b]?\s*(?:major|minor|maj|min))/i);
  return match ? match[1] : null;
}

function extractBpmFromAnalysis(analysis) {
  if (!analysis) return null;
  const match = analysis.match(/â‰ˆ?(\d+)\s*BPM/i);
  return match ? parseInt(match[1]) : null;
}

function extractGenreFromAnalysis(analysis) {
  if (!analysis) return null;
  const match = analysis.match(/Genre.*?:\s*([^\.]+)/i);
  return match ? match[1].trim() : null;
}

// âœ… NEW: Specialized prompt for generating TWO 280-char outputs
const DUAL_OUTPUT_MUSIC_PROMPT = `Analyze the uploaded videoS visuals, dialogues, and pacing. Then produce exactly 2 lines, each â‰¤280 characters:
1. Prompt â€” concise description of the videoS emotional tone, vibe, and type, written neatly and clearly. No musical terms here.
2. Music Style â€” BPM, key, genre, primary instruments, and progression (intro â†’ build-up â†’ climax â†’ outro), including appropriate musical terms for tempo, dynamics, articulation, and mood.
Rules: Do not exceed 280 characters for either line. Avoid repetition, vague terms, or extra commentary. Output in the exact format below:
RULE2:IF THERE IS CUSTOM PROMPT ENTERED CUSTOM PROMPT DETERMINES THE PROMPT OR MUSIC STYLE IF VIDEO ANALYZES ANGRY AND BETRAYA VIBE BUT CUSTOM PROMPT SAYS HAPPY VIB HAPY VIBE WILL BE USED FOR PROMPT LIN
`;

// âœ… NEW: Extract dual outputs from Gemini response
function extractDualMusicOutputs(geminiResponse) {
  const outputs = {
    prompt: '',
    music_style: '',
    success: false
  };

  try {
    // Look for PROMPT: section
    const promptMatch = geminiResponse.match(/PROMPT:\s*([^]*?)(?=\n\s*MUSIC_STYLE:|$)/i);
    if (promptMatch) {
      outputs.prompt = promptMatch[1].trim().substring(0, 280);
    }

    // Look for MUSIC_STYLE: section  
    const styleMatch = geminiResponse.match(/MUSIC_STYLE:\s*([^]*?)$/i);
    if (styleMatch) {
      outputs.music_style = styleMatch[1].trim().substring(0, 280);
    }

    // Fallback: if structured format not found, try to extract from content
    if (!outputs.prompt && !outputs.music_style) {
      const lines = geminiResponse.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.toLowerCase().includes('prompt') && !outputs.prompt) {
          // Take next non-empty line as prompt
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim()) {
              outputs.prompt = lines[j].trim().substring(0, 280);
              break;
            }
          }
        }
        
        if (line.toLowerCase().includes('music_style') && !outputs.music_style) {
          // Take next non-empty line as music_style
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim()) {
              outputs.music_style = lines[j].trim().substring(0, 280);
              break;
            }
          }
        }
      }
    }

    // Final fallback: split the response in half
    if (!outputs.prompt || !outputs.music_style) {
      const cleanResponse = geminiResponse.replace(/PROMPT:|MUSIC_STYLE:/gi, '').trim();
      const mid = Math.floor(cleanResponse.length / 2);
      
      if (!outputs.prompt) {
        outputs.prompt = cleanResponse.substring(0, mid).trim().substring(0, 280);
      }
      if (!outputs.music_style) {
        outputs.music_style = cleanResponse.substring(mid).trim().substring(0, 280);
      }
    }

    outputs.success = outputs.prompt.length > 0 && outputs.music_style.length > 0;

    return outputs;

  } catch (error) {
    console.error('âŒ Error extracting dual outputs:', error);
    return {
      prompt: geminiResponse.substring(0, 280),
      music_style: 'Cinematic',
      success: false,
      error: error.message
    };
  }
}
const YOUTUBE_SEARCH_DESCRIPTION_PROMPT = `"Analyze the content and style of this video. Respond with only one word that best describes the type or genre of the video (for example: vlog, tutorial, music, documentary, interview, etc). Do not provide any explanation or extra words—just the single word."
`;

async function analyzeVideoForYouTubeSearchDescription(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    const { customPrompt = '' } = options;

    console.log('🎬 Starting YouTube search description analysis...');
    console.log('📦 Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');

    // Build the full prompt
    let fullPrompt = YOUTUBE_SEARCH_DESCRIPTION_PROMPT;
    if (customPrompt) {
      fullPrompt += `\n\nCUSTOM PROMPT:\n${customPrompt}`;
    }

    // Prepare video part for Gemini
    const videoPart = {
      inlineData: {
        data: videoBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    console.log('🤖 Sending video to Gemini for search description...');
    const startTime = Date.now();

    // Assume you have initialized `model` from Google Generative AI SDK
    const result = await model.generateContent([fullPrompt, videoPart]);
    const response = await result.response;
    const descriptionText = response.text();

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ YouTube search description completed!');
    console.log('⏱️ Processing time:', processingTime, 'seconds');
    console.log('📝 Raw response:', descriptionText);

    // Optionally: Clean and trim the output to just the 5-6 words
    // For now, just return as-is
    return {
      success: true,
      searchDescription: descriptionText,
      processingTime: processingTime + 's',
      promptUsed: fullPrompt,
      videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB'
    };

  } catch (error) {
    console.error('❌ YouTube search description analysis error:', error);

    return {
      success: false,
      error: error.message,
      details: 'Failed to generate YouTube search description'
    };
  }
}
// âœ… NEW: Analyze video for dual music outputs
async function analyzeVideoForDualMusicOutputs(videoBuffer, mimeType = 'video/mp4', options = {}) {
  try {
    const { customPrompt = '' } = options;

    console.log('ðŸŽ¼ Starting DUAL OUTPUT visual-to-musical analysis...');
    console.log('ðŸ“Š Video buffer size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('ðŸ”‡ Audio handling: STRIPPED (visual analysis only)');

    // Use the specialized dual output prompt
    let fullPrompt = DUAL_OUTPUT_MUSIC_PROMPT;
    
    if (customPrompt) {
      fullPrompt += `\n\n**CUSTOM PROMPTS:**\n${customPrompt}`;
    }

    // Prepare video data for Gemini (audio will be ignored)
    const videoPart = {
      inlineData: {
        data: videoBuffer.toString('base64'),
        mimeType: mimeType
      }
    };

    console.log('ðŸ¤– Sending video to Gemini for dual output analysis...');
    const startTime = Date.now();

    const result = await model.generateContent([fullPrompt, videoPart]);
    const response = await result.response;
    const analysisText = response.text();

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('âœ… Dual output analysis completed!');
    console.log('â±ï¸ Processing time:', processingTime, 'seconds');
    console.log('ðŸ“„ Raw response length:', analysisText.length, 'characters');

    // Extract the two 280-char outputs
    const dualOutputs = extractDualMusicOutputs(analysisText);

    return {
      success: dualOutputs.success,
      rawAnalysis: analysisText,
      prompt: dualOutputs.prompt,
      music_style: dualOutputs.music_style,
      processingTime: processingTime + 's',
      promptUsed: fullPrompt,
      videoSize: (videoBuffer.length / 1024 / 1024).toFixed(2) + ' MB',
      focusType: 'dual-output-visual-to-musical-composition',
      outputs: dualOutputs
    };

  } catch (error) {
    console.error('âŒ Dual output musical analysis error:', error);
    
    return {
      success: false,
      error: error.message,
      details: 'Failed to generate dual musical outputs'
    };
  }
}
module.exports = {
  // Core analysis functions
  analyzeVideoForYouTubeSearchDescription,
  analyzeVideoForMusic,
  analyzeVideoFromGCS,
  analyzeVideoForAdvancedMusic,
  analyzeVideoForMusicWithValidation,
  analyzeVideoWithAudioFiles,
  stripAudioFromVideo,
  analyzeVideoForMusicSegments,
  analyzeGCSVideoForMusicSegments,
  
  // âœ… ADD THESE MISSING EXPORTS:
  analyzeVideoForMusicSegmentsWithFilesAPI,
  uploadVideoToGeminiFiles,
  waitForGeminiFileProcessing,
  
  // Enhanced parsing functions
  extractSegmentsFromGeminiResponse,
  validateAndNormalizeSegments,
  extractValidSegmentsFromBrokenJSON,
  createEmergencyFallbackSegments,
  normalizeIntensity,
  normalizeType,
  isValidSegment,
  extractSegmentsFromText,
  extractSegmentsWithRegex,
  
  // ... rest of your existing exports
  batchAnalyzeVideos,
  buildDetailedPrompt,
  buildAdvancedMusicPrompt,
  formatForSunoAI,
  generateSunoPrompt,
  validateMusicAnalysisResponse,
  validateMusicalTerminology,
  calculateQualityScore,
  getMusicalTerminologyGrade,
  addGenreTemplate,
  getAvailableGenres,
  addAdvancedGenreTemplate,
  getAvailableAdvancedGenres,
  exportAnalysisResults,
  convertToCsv,
  convertToMarkdown,
  extractStyleElements,
  extractMoodElements,
  extractInstrumentList,
  extractStructuralElements,
  extractCoreComposition,
  extractTimestampedSections,
  extractKeyFromAnalysis,
  extractBpmFromAnalysis,
  extractGenreFromAnalysis,
  getMimeTypeFromFileName,
  testGCSAccess,
  analyzeVideoForDualMusicOutputs,
  extractDualMusicOutputs,
  DUAL_OUTPUT_MUSIC_PROMPT,
  ULTRA_DETAILED_MUSIC_PROMPT,
  ULTRA_DETAILED_MUSIC_COMPOSITION_PROMPT,
  DETAILED_GENRE_TEMPLATES,
  ADVANCED_GENRE_TEMPLATES
};