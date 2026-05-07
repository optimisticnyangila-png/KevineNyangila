/**
 * FLOWPOST DATABASE SCHEMA - MULTI-ACCOUNT UPGRADE
 * 
 * This document outlines the Firestore collections and data structure
 * for the multi-account social media platform.
 */

// ============================================
// COLLECTION: platformAccounts
// ============================================
// Purpose: Stores each user's connected social media accounts
// 
// Sample Document:
{
    id: "acc_fb_page_123", // Document ID (auto-generated)
    uid: "user_456", // User ID (FK to users collection)
    platform: "facebook", // Platform: facebook, instagram, youtube, tiktok
    accountId: "109876543210", // Platform-specific account ID (page ID, channel ID, etc.)
    accountName: "My Business Page", // Display name
    accessToken: "EABcDeFgHijKlMnOpQrStUvWxYz", // Current access token
    refreshToken: "1234567890abcdef", // Refresh token (for YouTube, sometimes Facebook)
    tokenExpiresAt: Timestamp, // When token expires (Firestore Timestamp)
    lastRefreshedAt: Timestamp, // Last time token was refreshed
    status: "active", // "active" | "expired" | "revoked"
    createdAt: Timestamp, // Account connection date
    updatedAt: Timestamp // Last update
}

// Firebase Query Examples:
db.collection('platformAccounts')
    .where('uid', '==', 'user_123')
    .get() // Get all accounts for user

db.collection('platformAccounts')
    .where('uid', '==', 'user_123')
    .where('platform', '==', 'facebook')
    .get() // Get all Facebook accounts for user

db.collection('platformAccounts')
    .where('tokenExpiresAt', '<', Date.now())
    .get() // Find all expired tokens (for refresh job)

// ============================================
// COLLECTION: posts (UPDATED)
// ============================================
{
    id: "post_xyz789",
    uid: "user_123",
    content: "Check out this amazing feature!",
    mediaUrls: [
        "https://storage.googleapis.com/...",
        "https://cloudinary.com/..."
    ],
    // OLD STRUCTURE (deprecated):
    // platforms: ["facebook", "instagram"]

    // NEW STRUCTURE (preferred):
    targets: [
        "acc_fb_page_123", // Account IDs, not platform names
        "acc_ig_account_456",
        "acc_yt_channel_789"
    ],

    // For backward compatibility, still include platforms:
    platforms: ["facebook", "instagram", "youtube"],

    scheduledTime: null, // null = draft, or Timestamp for scheduled
    status: "draft", // "draft" | "scheduled" | "published"
    publishResults: { // Results from publishing
        "acc_fb_page_123": {
            success: true,
            platform: "facebook",
            accountName: "My Business Page",
            postId: "123_456789",
            publishedAt: Timestamp,
            error: null
        },
        "acc_ig_account_456": {
            success: false,
            platform: "instagram",
            accountName: "Business Account",
            error: "Token expired - needs re-authentication",
            requiresReauth: true
        }
    },
    createdAt: Timestamp,
    updatedAt: Timestamp
}

// ============================================
// COLLECTION: publishHistory (NEW - optional)
// ============================================
// Purpose: Track all publish attempts for debugging and analytics
// Retention: Keep for 90 days
{
    id: "pub_hist_123",
    uid: "user_456",
    postId: "post_xyz789",
    accountId: "acc_fb_page_123",
    platform: "facebook",
    accountName: "My Business Page",

    success: true,
    publishedPostId: "123_456789", // Platform's post ID
    error: null, // Error message if failed

    startTime: Timestamp,
    endTime: Timestamp,
    duration: 1234, // milliseconds

    createdAt: Timestamp
}

// Query: Get publish history for a user
db.collection('publishHistory')
    .where('uid', '==', 'user_123')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

// ============================================
// COLLECTION: users (UPDATED)
// ============================================
// The 'users' collection still exists for authentication and user info
// The platform tokens are now mostly in platformAccounts collection
// Keep the old structure for backward compatibility
{
    id: "user_123",
    email: "user@example.com",
    password: "hashed_password",

    // DEPRECATED: These are now in platformAccounts
    // facebook: { access_token: "...", pages: [...] }
    // instagram: { access_token: "..." }
    // youtube: { access_token: "...", refresh_token: "..." }
    // tiktok: { access_token: "..." }

    // NEW: Just keep user metadata
    createdAt: Timestamp,
    lastLogin: Timestamp,
    preferences: {
        timezone: "UTC",
        defaultPrivacy: "private", // for YouTube uploads
        theme: "light"
    }
}

// ============================================
// Firestore Rules Updates
// ============================================
/*

rules_version = '2';
service cloud.firestore {
    match /databases/{database}/documents {
        
        // Users can only read their own user doc
        match /users/{uid} {
            allow read, write: if request.auth.uid == uid;
        }
        
        // Users can only read/write their own platform accounts
        match /platformAccounts/{document=**} {
            allow read, write: if request.auth.uid == resource.data.uid;
            allow create: if request.auth.uid == request.resource.data.uid;
        }
        
        // Users can only read/write their own posts
        match /posts/{document=**} {
            allow read, write: if request.auth.uid == resource.data.uid;
            allow create: if request.auth.uid == request.resource.data.uid;
        }
        
        // Users can only read their own publish history
        match /publishHistory/{document=**} {
            allow read: if request.auth.uid == resource.data.uid;
            allow create: if request.auth.uid == request.resource.data.uid;
        }
        
        // Scheduled posts (for cron to access)
        match /scheduledPosts/{document=**} {
            allow read: if true;  // Cron job reads this
            allow write: if request.auth.uid == request.resource.data.uid;
        }
    }
}

*/

// ============================================
// Migration Path (if migrating from old structure)
// ============================================
/*

1. For each user in the 'users' collection:
   - Read user.facebook, user.instagram, user.youtube, user.tiktok
   
2. For each platform connection:
   - If facebook:
     - Create platformAccounts doc for each page in user.facebook.pages
     - accountId = page.id
     - accountName = page.name
     - accessToken = page.access_token
   
   - If instagram:
     - Create platformAccounts doc for each instagram account
     - accountId = account.id
     - accountName = account.username
     - accessToken = page.access_token (parent page's token)
   
   - If youtube:
     - Create platformAccounts doc
     - accountId = "primary" (YouTube uses one channel per OAuth)
     - accountName = channel name from API
     - accessToken = user.youtube.access_token
     - refreshToken = user.youtube.refresh_token
   
   - If tiktok:
     - Create platformAccounts doc
     - accountId = user.tiktok.open_id
     - accountName = user.tiktok.nickname
     - accessToken = user.tiktok.access_token

3. For each post in the 'posts' collection:
   - Read post.platforms (array like ["facebook", "instagram"])
   - Map to actual account IDs from platformAccounts
   - Set post.targets = [list of account IDs]

4. Keep old fields for backward compatibility during transition

*/

module.exports = {
    // This is documentation - no exports
    note: "See comments above for Firestore schema updates"
};
