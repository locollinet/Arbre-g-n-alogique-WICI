# Security Specification — L’Arbre des Wici (Firebase Firestore)

## Phase 0: Payload-First Security & Data Invariants

### 1. Data Invariants
1. **Public Readability**: Any authenticated or unauthenticated visitor of the family tree archive can view portraits (`get` and `list` on `/personPhotos/{personId}`).
2. **Authorized Modifications**:
   - Creating or updating a portrait photo requires authentication (`isSignedIn()`).
   - The document ID `{personId}` in `/personPhotos/{personId}` must match the `incoming().personId` attribute to prevent ID confusion / hijacking.
   - The `personId` must be a sanitized string matching `^[a-zA-Z0-9_\-]+$` with length <= 128 characters.
   - The photo payload must be bounded: `photoDataUrl` must be a string <= 500,000 characters (compressed JPEG data URL ~25KB–40KB).
   - Deleting a photo requires authentication.

### 2. The Dirty Dozen Payloads (Rejection Matrix)
1. **Unauthenticated Write**: An unauthenticated user attempts to create or overwrite a portrait (`auth == null`) -> MUST FAIL with PERMISSION_DENIED.
2. **Path ID Mismatch**: Payload has `personId: "victoria"`, but written to `/personPhotos/aloisi` -> MUST FAIL with PERMISSION_DENIED.
3. **Payload Bloat Attack**: `photoDataUrl` exceeds 500,000 bytes -> MUST FAIL with PERMISSION_DENIED.
4. **Invalid ID Poisoning**: Document path `{personId}` contains non-alphanumeric characters (e.g., `../../etc`) -> MUST FAIL with PERMISSION_DENIED.
5. **Ghost Field Injection**: Adding an unpermitted field `adminOverride: true` or `role: "superuser"` -> MUST FAIL with PERMISSION_DENIED (`hasOnly()` guard).
6. **Missing Required Fields**: Payload lacks `photoDataUrl` or `personId` -> MUST FAIL with PERMISSION_DENIED (`hasAll()` guard).
7. **Type Spoofing**: `personId` sent as a number `123` or boolean `true` -> MUST FAIL with PERMISSION_DENIED.
8. **Catch-All Probe**: Attempt to write to `/unmapped_collection/leak` -> MUST FAIL with default deny.
9. **Unbounded String Injection**: `caption` exceeding 256 characters -> MUST FAIL with PERMISSION_DENIED.
10. **Spoofed Author ID**: `uploadedBy` does not match `request.auth.uid` when provided -> MUST FAIL with PERMISSION_DENIED.
11. **Empty Photo String**: `photoDataUrl` with size < 10 -> MUST FAIL with PERMISSION_DENIED.
12. **Malformed Filter**: `filter` exceeding 32 characters -> MUST FAIL with PERMISSION_DENIED.
