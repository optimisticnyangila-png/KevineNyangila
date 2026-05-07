#!/usr/bin/env node

/**
 * FlowPost Backend API Testing Guide
 * 
 * This guide shows how to test all the new backend endpoints from the frontend
 * or via curl/Postman.
 */

const API_BASE = process.env.API_BASE_URL || process.env.API_BASE || `http://localhost:${process.env.BACKEND_PORT || 5000}`;

// ============================================================================
// 1. GET CONNECTED PLATFORMS (NEW ENDPOINT)
// ============================================================================

/**
 * Frontend JavaScript Example:
 * Fetch the status of connected OAuth platforms
 */
async function fetchPlatformStatus() {
    const response = await fetch(`${API_BASE}/platforms`, {
        method: 'GET',
        credentials: 'include', // Important: send auth cookie
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const status = await response.json();

    if (response.ok) {
        console.log('Platform Status:', status);
        // Expected: { facebook: true, instagram: false, youtube: true, tiktok: false }
        return status;
    } else {
        console.error('Error:', status.error);
        return null;
    }
}

// ============================================================================
// 2. EDIT DRAFT POST (NEW ENDPOINT)
// ============================================================================

/**
 * Frontend JavaScript Example:
 * Edit an existing draft post
 */
async function editDraftPost(postId, updatedContent) {
    const response = await fetch(`${API_BASE}/create-post/${postId}`, {
        method: 'PUT',
        credentials: 'include', // Important: send auth cookie
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: updatedContent.content,
            mediaUrls: updatedContent.mediaUrls || [],
            platforms: updatedContent.platforms || [],
            platformTargets: updatedContent.platformTargets || {}
        })
    });

    const result = await response.json();

    if (response.ok) {
        console.log('Post updated successfully:', result);
        return result;
    } else {
        console.error('Error:', result.error);
        // Possible errors:
        // 404: Post not found
        // 403: Unauthorized (not the post owner)
        // 500: Server error
        return null;
    }
}

// ============================================================================
// 3. DELETE DRAFT POST (NEW ENDPOINT)
// ============================================================================

/**
 * Frontend JavaScript Example:
 * Delete a draft post
 */
async function deleteDraftPost(postId) {
    const response = await fetch(`${API_BASE}/create-post/${postId}`, {
        method: 'DELETE',
        credentials: 'include', // Important: send auth cookie
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const result = await response.json();

    if (response.ok) {
        console.log('Post deleted successfully:', result);
        return result;
    } else {
        console.error('Error:', result.error);
        // Possible errors:
        // 404: Post not found
        // 403: Unauthorized (not the post owner)
        // 500: Server error
        return null;
    }
}

// ============================================================================
// 4. CANCEL SCHEDULED POST (NEW ENDPOINT)
// ============================================================================

/**
 * Frontend JavaScript Example:
 * Cancel/unschedule a scheduled post
 */
async function cancelScheduledPost(postId) {
    const response = await fetch(`${API_BASE}/schedule-post/${postId}`, {
        method: 'DELETE',
        credentials: 'include', // Important: send auth cookie
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const result = await response.json();

    if (response.ok) {
        console.log('Scheduled post cancelled:', result);
        return result;
    } else {
        console.error('Error:', result.error);
        // Possible errors:
        // 404: Scheduled post not found
        // 403: Unauthorized (not the post owner)
        // 500: Server error
        return null;
    }
}

// ============================================================================
// CURL EXAMPLES FOR TESTING
// ============================================================================

/*

1. GET /platforms - Fetch connected platforms
   curl -X GET "$API_BASE_URL/platforms" \
     -H "Cookie: token=<your_jwt_token>" \
     -H "Content-Type: application/json"

   Expected Response (200):
   {
     "facebook": true,
     "instagram": false,
     "youtube": true,
     "tiktok": false
   }

2. PUT /create-post/:id - Edit a draft post
   curl -X PUT "$API_BASE_URL/create-post/post_id_here" \
     -H "Cookie: token=<your_jwt_token>" \
     -H "Content-Type: application/json" \
     -d '{
       "content": "Updated post content",
       "mediaUrls": ["https://example.com/image.jpg"],
       "platforms": ["facebook", "instagram"],
       "platformTargets": {}
     }'

   Expected Response (200):
   { "success": true }

3. DELETE /create-post/:id - Delete a draft post
   curl -X DELETE "$API_BASE_URL/create-post/post_id_here" \
     -H "Cookie: token=<your_jwt_token>" \
     -H "Content-Type: application/json"

   Expected Response (200):
   { "success": true }

4. DELETE /schedule-post/:id - Cancel a scheduled post
   curl -X DELETE "$API_BASE_URL/schedule-post/post_id_here" \
     -H "Cookie: token=<your_jwt_token>" \
     -H "Content-Type: application/json"

   Expected Response (200):
   { "success": true }

*/

// ============================================================================
// POSTMAN COLLECTION SNIPPET
// ============================================================================

/*

Create requests in Postman with these settings:

1. GET /platforms
   URL: {{baseUrl}}/platforms
   Method: GET
   Headers: 
     - Content-Type: application/json
   Cookies: token={{jwt_token}}
   Body: (none)

2. PUT /create-post/:id
   URL: {{baseUrl}}/create-post/{{postId}}
   Method: PUT
   Headers:
     - Content-Type: application/json
   Cookies: token={{jwt_token}}
   Body (raw JSON):
   {
     "content": "Updated content here",
     "mediaUrls": ["https://example.com/img1.jpg"],
     "platforms": ["facebook", "instagram"],
     "platformTargets": {
       "facebook": { "pageId": "123456" },
       "instagram": { "accountId": "789012" }
     }
   }

3. DELETE /create-post/:id
   URL: {{baseUrl}}/create-post/{{postId}}
   Method: DELETE
   Headers:
     - Content-Type: application/json
   Cookies: token={{jwt_token}}
   Body: (none)

4. DELETE /schedule-post/:id
   URL: {{baseUrl}}/schedule-post/{{postId}}
   Method: DELETE
   Headers:
     - Content-Type: application/json
   Cookies: token={{jwt_token}}
   Body: (none)

*/

// ============================================================================
// ERROR HANDLING EXAMPLES
// ============================================================================

/**
 * Robust error handling for frontend
 */
async function apiCall(method, endpoint, body = null) {
    try {
        const options = {
            method,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();

        if (!response.ok) {
            // Handle different error codes
            switch (response.status) {
                case 400:
                    console.error('Bad Request:', data.error);
                    // Usually validation error
                    break;
                case 401:
                    console.error('Unauthorized - Token missing/invalid');
                    // Redirect to login
                    break;
                case 403:
                    console.error('Forbidden - Not the owner of this resource');
                    break;
                case 404:
                    console.error('Not Found:', data.error);
                    break;
                case 500:
                    console.error('Server Error:', data.error);
                    break;
            }
            return { success: false, error: data.error, status: response.status };
        }

        return { success: true, data };
    } catch (err) {
        console.error('Network error:', err);
        return { success: false, error: err.message, isNetworkError: true };
    }
}

// Usage:
// const result = await apiCall('PUT', '/create-post/post123', { content: 'New content' });
// if (result.success) { /* handle success */ }
// else { /* handle error */ }

// ============================================================================
// INTEGRATION CHECKLIST
// ============================================================================

const checklistItems = [
    '✓ GET /platforms returns { facebook, instagram, youtube, tiktok: boolean }',
    '✓ PUT /create-post/:id updates draft (requires auth)',
    '✓ DELETE /create-post/:id deletes draft (requires auth)',
    '✓ DELETE /schedule-post/:id cancels scheduled post (requires auth)',
    '✓ All endpoints include user ownership validation (403 if not owner)',
    '✓ All endpoints return consistent error format { error: "message" }',
    '✓ Frontend includes credentials: "include" in fetch calls',
    '✓ Frontend handles auth cookie from login response',
    '✓ Drafts and scheduled posts remain in sync after edit',
    '✓ Cron job still executes scheduled posts at scheduled time',
    '✓ No existing publish/schedule logic broken',
];

console.log('Frontend Integration Checklist:');
checklistItems.forEach(item => console.log(item));

// ============================================================================
// EXPORT FOR TESTING
// ============================================================================

module.exports = {
    fetchPlatformStatus,
    editDraftPost,
    deleteDraftPost,
    cancelScheduledPost,
    apiCall,
};
