# FlowPost Backend API Specification

## Base URL
`http://localhost:5000` (development)

## Authentication
All endpoints (except `/auth/*`) require:
- Cookie: `token=<jwt_token>` (set by `/auth/login` or `/auth/signup`)

---

## 🔐 Authentication Routes (`/auth/*`)

### POST /auth/login
Login with email/password
- **Response:** `{ token, email, name }`

### POST /auth/signup
Register new user
- **Response:** `{ token, email, name }`

### POST /auth/logout
Logout user
- **Response:** `{ success: true }`

---

## 📱 Platforms Routes (`/platforms`)

### GET /platforms ⭐ NEW
Fetch connected OAuth platforms status for current user
- **Auth:** Required
- **Request:**
  ```
  GET /platforms
  ```
- **Response (200):**
  ```json
  {
    "facebook": true,
    "instagram": false,
    "youtube": true,
    "tiktok": false
  }
  ```
- **Error (404):** `{ error: "User not found" }`
- **Error (500):** `{ error: "Unable to load platform status" }`

---

## 📝 Draft Posts Routes (`/create-post`)

### POST /create-post
Create a new draft post
- **Auth:** Required
- **Request Body:**
  ```json
  {
    "content": "Post content text",
    "mediaUrls": ["https://...image.jpg"],
    "platforms": ["facebook", "instagram"],
    "platformTargets": {
      "facebook": { "pageId": "123456" },
      "instagram": { "accountId": "789012" }
    }
  }
  ```
- **Response (200):**
  ```json
  { "postId": "generated_post_id" }
  ```
- **Error (500):** `{ error: "Unable to create post" }`

### GET /create-post
Retrieve all draft posts (with scheduled status flag)
- **Auth:** Required
- **Response (200):**
  ```json
  {
    "posts": [
      {
        "id": "post_id",
        "uid": "user_id",
        "content": "...",
        "mediaUrls": [...],
        "platforms": [...],
        "platformTargets": {...},
        "createdAt": "2026-04-20T10:00:00.000Z",
        "updatedAt": "2026-04-20T10:00:00.000Z",
        "scheduled": false
      }
    ]
  }
  ```
- **Error (500):** `{ error: "Unable to load drafts" }`

### PUT /create-post/:id ⭐ NEW
Edit/update an existing draft post
- **Auth:** Required
- **URL Param:** `id` = post ID
- **Request Body:** (same as POST)
  ```json
  {
    "content": "Updated content",
    "mediaUrls": [...],
    "platforms": [...],
    "platformTargets": {...}
  }
  ```
- **Response (200):** `{ "success": true }`
- **Error (404):** `{ error: "Post not found" }`
- **Error (403):** `{ error: "Unauthorized" }`
- **Error (500):** `{ error: "Unable to update post" }`
- **Behavior:** 
  - Updates both `posts` collection (draft) and `scheduledPosts` collection if post is scheduled
  - Only owner (validated by uid) can edit

### DELETE /create-post/:id ⭐ NEW
Delete a draft post and any associated scheduled post
- **Auth:** Required
- **URL Param:** `id` = post ID
- **Response (200):** `{ "success": true }`
- **Error (404):** `{ error: "Post not found" }`
- **Error (403):** `{ error: "Unauthorized" }`
- **Error (500):** `{ error: "Unable to delete post" }`
- **Behavior:** 
  - Deletes from both `posts` and `scheduledPosts` collections
  - Only owner (validated by uid) can delete

---

## ⏰ Scheduled Posts Routes (`/schedule-post`)

### POST /schedule-post
Schedule an existing draft post for publishing
- **Auth:** Required
- **Request Body:**
  ```json
  {
    "postId": "post_id_to_schedule",
    "scheduledTime": "2026-04-20T15:00:00.000Z"
  }
  ```
- **Validation:**
  - `postId` must exist and belong to user
  - `scheduledTime` must be a future date
- **Response (200):** `{ "success": true }`
- **Error (400):** `{ error: "postId and scheduledTime are required" }`
- **Error (400):** `{ error: "scheduledTime must be a valid future date" }`
- **Error (404):** `{ error: "Post not found" }`
- **Error (403):** `{ error: "Unauthorized" }`
- **Error (400):** `{ error: "This post is already scheduled" }`
- **Error (500):** `{ error: "Unable to schedule post" }`

### GET /schedule-post
Retrieve all scheduled posts for current user
- **Auth:** Required
- **Response (200):**
  ```json
  {
    "posts": [
      {
        "id": "post_id",
        "uid": "user_id",
        "content": "...",
        "mediaUrls": [...],
        "platforms": [...],
        "platformTargets": {...},
        "createdAt": "2026-04-20T10:00:00.000Z",
        "updatedAt": "2026-04-20T10:00:00.000Z",
        "scheduledTime": "2026-04-20T15:00:00.000Z"
      }
    ]
  }
  ```
- **Error (500):** `{ error: "Unable to load scheduled posts" }`

### DELETE /schedule-post/:id ⭐ NEW
Cancel a scheduled post (unschedule)
- **Auth:** Required
- **URL Param:** `id` = post ID
- **Response (200):** `{ "success": true }`
- **Error (404):** `{ error: "Scheduled post not found" }`
- **Error (403):** `{ error: "Unauthorized" }`
- **Error (500):** `{ error: "Unable to cancel scheduled post" }`
- **Behavior:** 
  - Only removes from `scheduledPosts` collection
  - Draft in `posts` collection remains untouched
  - Only owner (validated by uid) can cancel

---

## 🚀 Publish Routes (`/publish-post`)

### POST /publish-post
Publish a draft post immediately to all connected platforms
- **Auth:** Required
- **Request Body:**
  ```json
  {
    "postId": "post_id",
    "platforms": ["facebook", "instagram"]
  }
  ```
- **Response (200):** `{ postId, results: { facebook: { success, url }, ... } }`
- **Error (404):** `{ error: "Post not found" }`
- **Error (403):** `{ error: "Unauthorized" }`

---

## Firestore Collections

### `posts` (Draft Posts)
```
{
  uid: string,              // User ID
  content: string,          // Post content
  mediaUrls: string[],      // Array of image URLs
  platforms: string[],      // ["facebook", "instagram", ...]
  platformTargets: object,  // Platform-specific config
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### `scheduledPosts`
```
{
  uid: string,
  content: string,
  mediaUrls: string[],
  platforms: string[],
  platformTargets: object,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  scheduledTime: Timestamp  // When to publish
}
```

### `users`
```
{
  email: string,
  authProvider: string,
  facebook: { access_token?, pages?, selectedPageId? },
  instagram: { access_token?, accounts?, selectedAccountId? },
  youtube: { access_token?, refresh_token?, channels?, selectedChannelId? },
  tiktok: { access_token?, account? }
}
```

---

## Security Features

✅ **User Ownership Validation**
- All delete/edit operations validate `uid` matches current user
- Returns 403 Unauthorized if mismatch

✅ **Input Validation**
- Required fields validated
- Timestamps validated (scheduledTime must be future)
- Firestore prevents orphaned records

✅ **Atomic Operations**
- When editing scheduled post, both collections updated
- When deleting draft with schedule, both collections cleaned

✅ **CORS**
- Configured for `localhost:3000` and frontend origin
- Credentials (cookies) allowed

---

## Cron Job (Background)

**Every minute:**
- Queries `scheduledPosts` where `scheduledTime <= now`
- Publishes to platforms
- Deletes completed scheduled posts

**File:** `server.js` lines 80-100

---

## Error Handling Standard

All errors follow this format:
```json
{ "error": "Description of what went wrong" }
```

HTTP Status Codes:
- `200` - Success
- `400` - Bad Request (validation failed)
- `403` - Forbidden (unauthorized user)
- `404` - Not Found (resource doesn't exist)
- `500` - Server Error (database/processing failure)

---

## Frontend Integration Checklist

✅ Platforms UI fetches `GET /platforms`  
✅ Edit draft calls `PUT /create-post/:id`  
✅ Delete draft calls `DELETE /create-post/:id`  
✅ Cancel scheduled calls `DELETE /schedule-post/:id`  
✅ All requests include auth cookie  
✅ All responses handled for success/error states
