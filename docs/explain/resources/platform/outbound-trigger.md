---
topic: outbound-trigger
description: 6-step CXone trigger, Accept-Encoding: identity requirement
---

## outbound-trigger — CXone Outbound Call Trigger

### 6-step sequence (run in backend/code node)

Step 1: OAuth token
POST https://na1.nice-incontact.com/authentication/v1/token/access-token
Headers: Accept-Encoding: identity ← CRITICAL (Node 18+ undici decompression bug)
Body: {grant_type, username, password, ...}

Step 2: Extract tenantId from JWT
const payload = JSON.parse(atob(token.split('.')[1]));
const tenantId = payload.tenantId;

Step 3: Get cluster API base URL
GET https://cxone-configuration.niceincontact.com/config?tenantId={tenantId}
Headers: Accept-Encoding: identity
Returns: {api_base_url: "https://na1.nice-incontact.com"}

Step 4: Find script by PATH (not by static ID)
GET {api_base_url}/services/v16.0/scripts
Headers: Accept-Encoding: identity, Authorization: Bearer {token}
Script ID is at: response.header.masterId (not obvious)
Filter: scripts.find(s => s.scriptName === "My Script Name")
→ DO NOT hardcode script IDs — they differ across environments

Step 5: PATCH claim/session state FIRST
Do this BEFORE starting the outbound call.
Reason: UI must update even if CXone call fails.

Step 6: Start script
POST {api_base_url}/services/v16.0/scripts/{scriptId}/start
Headers: Accept-Encoding: identity
Body: {scriptId, parameters: {phone: "+61412345678", ...}}

### Accept-Encoding: identity — WHY THIS IS CRITICAL

Node 18 switched HTTP client to undici. Undici auto-decompresses gzip but
CXone sends malformed compressed responses. identity disables compression.
Omitting this header causes JSON parse errors on ALL CXone API responses.
