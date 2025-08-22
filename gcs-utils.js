const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');

// Initialize Storage client using environment variables
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

// Generate signed URL for upload with proper permissions
async function generateUploadUrl(fileName = null) {
  try {
    const finalFileName = fileName || `videos/${uuidv4()}.mp4`;
    const file = bucket.file(finalFileName);

    // Generate signed URL for upload (PUT)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      contentType: 'video/mp4',
    });

    // Generate signed URL for reading (GET) - longer expiry for analysis
    const [publicReadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours for analysis
    });

    const gcsUri = `gs://${process.env.GCS_BUCKET_NAME}/${finalFileName}`;

    return {
      put_url: signedUrl,
      gcs_uri: gcsUri,
      public_url: publicReadUrl, // Use signed read URL instead of public URL
      file_name: finalFileName
    };
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

// Upload buffer directly to GCS with proper permissions
async function uploadBuffer(buffer, fileName, contentType = 'video/mp4') {
  try {
    const finalFileName = fileName || `videos/${uuidv4()}.mp4`;
    const file = bucket.file(finalFileName);

    // Upload the buffer
    await file.save(buffer, {
      metadata: {
        contentType,
      },
    });

    // Try to make the file publicly readable (optional)
    try {
      await file.makePublic();
      console.log(`File ${finalFileName} made public`);
    } catch (publicError) {
      console.warn('Could not make file public:', publicError.message);
    }

    // Generate signed read URL for reliable access
    const [publicReadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    const gcsUri = `gs://${process.env.GCS_BUCKET_NAME}/${finalFileName}`;
    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${finalFileName}`;

    return {
      gcs_uri: gcsUri,
      public_url: publicReadUrl, // Use signed URL for reliable access
      public_direct_url: publicUrl, // Direct URL (may not work if bucket is private)
      file_name: finalFileName
    };
  } catch (error) {
    console.error('Error uploading to GCS:', error);
    throw error;
  }
}

// Get a signed download URL for an existing file
async function getSignedDownloadUrl(fileName, expiryHours = 24) {
  try {
    const file = bucket.file(fileName);
    
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiryHours * 60 * 60 * 1000,
    });

    return signedUrl;
  } catch (error) {
    console.error('Error generating signed download URL:', error);
    throw error;
  }
}

// Check if file exists and get its metadata
async function getFileInfo(fileName) {
  try {
    const file = bucket.file(fileName);
    const [exists] = await file.exists();
    
    if (!exists) {
      return { exists: false };
    }

    const [metadata] = await file.getMetadata();
    
    return {
      exists: true,
      size: parseInt(metadata.size),
      contentType: metadata.contentType,
      created: metadata.timeCreated,
      updated: metadata.updated,
      name: metadata.name,
      isPublic: metadata.acl ? metadata.acl.some(acl => acl.entity === 'allUsers' && acl.role === 'READER') : false
    };
  } catch (error) {
    console.error('Error getting file info:', error);
    throw error;
  }
}

// Make an existing file publicly accessible
async function makeFilePublic(fileName) {
  try {
    const file = bucket.file(fileName);
    await file.makePublic();
    console.log(`File ${fileName} is now publicly accessible`);
    
    return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${fileName}`;
  } catch (error) {
    console.error('Error making file public:', error);
    throw error;
  }
}

// Extract filename from GCS URI or public URL
function extractFileNameFromUrl(url) {
  if (url.startsWith('gs://')) {
    // Extract from gs://bucket-name/path/to/file.ext
    const parts = url.split('/');
    return parts.slice(2).join('/'); // Remove gs:// and bucket name
  } else if (url.includes('storage.googleapis.com')) {
    // Extract from https://storage.googleapis.com/bucket/path/to/file.ext
    const parts = url.split('/');
    const bucketIndex = parts.findIndex(part => part === process.env.GCS_BUCKET_NAME);
    if (bucketIndex !== -1) {
      return parts.slice(bucketIndex + 1).join('/');
    }
  }
  
  throw new Error('Could not extract filename from URL: ' + url);
}

module.exports = {
  generateUploadUrl,
  uploadBuffer,
  getSignedDownloadUrl,
  getFileInfo,
  makeFilePublic,
  extractFileNameFromUrl,
  bucket,
  storage
};