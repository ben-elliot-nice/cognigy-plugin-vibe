---
topic: profile-editing
description: Writing to the Cognigy contact profile — why direct mutation doesn't persist, api.updateProfile behaviour, and getProfileVar/setProfileVar/mergeProfileVar utility functions
---

## profile-editing — Writing to the Contact Profile

### Why direct mutation doesn't persist

The `profile` global in a code node is a read-only snapshot of the contact's profile taken at node entry. Setting `profile.firstname = "Ben"` only mutates the local in-memory copy — the contact store is not updated. All writes must go through `api.updateProfile(key, value)`, which is async and must be awaited.

### When to use which API

- **One-liner update** — call `await api.updateProfile(key, value)` directly. No abstraction needed.
- **Node already using setVar/mergeVar conventions** — use the utility functions below for consistency.

### Utility Functions (copy into nodes that use them)

```javascript
async function getProfileVar(key, required) {
  const val = profile[key];
  if (val == null) {
    if (required)
      return Promise.reject(
        new Error(`Required: 'profile.${key}' is missing or null`),
      );
    return Promise.resolve(null);
  }
  return Promise.resolve(val);
}

async function setProfileVar(key, value) {
  await api.updateProfile(key, value);
}

async function mergeProfileVar(key, value) {
  const current = profile[key];
  const merged = deepMerge(current, value);
  await api.updateProfile(key, merged);
  function deepMerge(target, source) {
    if (source === null || typeof source !== "object" || Array.isArray(source))
      return source;
    const result = Object.assign({}, target);
    for (const k of Object.keys(source)) {
      const tgt = target != null ? target[k] : undefined;
      result[k] =
        typeof source[k] === "object" &&
        source[k] !== null &&
        !Array.isArray(source[k]) &&
        typeof tgt === "object" &&
        !Array.isArray(tgt)
          ? deepMerge(tgt, source[k])
          : source[k];
    }
    return result;
  }
}
```

**Key difference from context utilities:** `setProfileVar` and `mergeProfileVar` make an async API call (`api.updateProfile`) — they must be awaited. Context utilities (`setVar`/`mergeVar`) do direct object mutation and do not need await.

**Flat keys only.** `setProfileVar` and `mergeProfileVar` accept flat top-level profile keys only (e.g. `'firstname'`, `'address'`) — no dotted-path notation. To update a nested field inside a Complex-type key, pass the whole updated object.

**Do not mix `setProfileVar` and `mergeProfileVar` on the same key within a single node.** The `profile` snapshot is taken at node entry and does not reflect writes made earlier in the same execution — a `mergeProfileVar` call after `setProfileVar` on the same key will merge against the pre-node value, silently clobbering the earlier write.

### Usage example

```javascript
async function main() {
  const [nameResult, prefsResult] = await allSettled([
    getProfileVar("firstname", true),
    getProfileVar("preferences", false),
  ]);
  const errors = [nameResult, prefsResult]
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason.message);
  if (errors.length > 0) {
    errors.forEach((e) => log("error", "main", e));
    return;
  }
  const firstname = nameResult.value;
  // Overwrite a top-level field using the retrieved value
  await setProfileVar("firstname", firstname.trim());
  // Deep-merge into a Complex-type field (e.g. preferences is Complex type)
  await mergeProfileVar("preferences", { theme: "dark" });
}
```
