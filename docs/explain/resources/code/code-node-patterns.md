---
topic: code-node-patterns
description: api.* functions, execution model, runtime objects (input/context/profile/analyticsdata), utility functions (getVar/setVar/mergeVar), as const bug, httpRequest response shape and storage config
---

## code-node-patterns — Writing Cognigy Code Nodes

### Where to write the source before `push_code_node`

Write the `.js` source to a file **inside the project directory** (e.g. `nodes/<node-name>.js`), not to a scratchpad or temp directory. `push_code_node` takes `script_file` as a path — it doesn't care where the file lives, but the choice has lasting effect:

- A file in the project tree is discoverable by a future session (this one or another) without regenerating the source from a `get_flow_chart` read or from memory.
- Editing an existing file (small diff) is far cheaper in tokens than reconstructing the full script from scratch.
- It also gives you a local diffable history of the node's logic, independent of Cognigy's own versioning.

Keep this convention for `push_html_node` xApp content too — see explain("xapp-delivery").

### Execution Model

- Flow waits until the code node finishes
- 1 second maximum execution time (non-configurable)
- No top-level `await` — wrap async logic in `async function main() {}`
- No `import` or `require` — sandboxed scope, no module loading
- No `console.log` — use `api.log()` instead
- Maximum 100 `api.*` calls per node
- Uncaught errors halt flow execution; timeout errors write to `input.codeNodeError.message`

### Runtime Objects

These objects are available as globals in every code node.

#### `input`

The incoming message for the current turn. Read-only — use `setVar`/`mergeVar` to write back.

| Property                      | Description                          |
| ----------------------------- | ------------------------------------ |
| `input.text`                  | Raw user text                        |
| `input.data`                  | Structured payload object            |
| `input.intentScore`           | NLU intent confidence (0–1)          |
| `input.intent`                | Matched intent name                  |
| `input.slots`                 | Detected NLU slots                   |
| `input.sessionId`             | Session identifier                   |
| `input.userId`                | User identifier                      |
| `input.flowName`              | Name of current flow                 |
| `input.codeNodeError.message` | Error message if execution timed out |

#### `context`

Session-scoped persistent storage. Survives across turns.

Direct read access: `const val = context.myKey`

For writes, prefer `setVar`/`mergeVar` (see Utility Functions) over `api.setContext`. Use `api.addToContext` only when you need array-push semantics (`'array'` mode).

#### `profile`

Contact profile data (persistent across sessions). The `profile` global is a **read-only snapshot** — direct mutation (`profile.key = value`) does not persist to the contact store. Use `api.updateProfile(key, value)` directly for simple one-liners, or see `explain('profile-editing')` for utility functions consistent with the `setVar`/`mergeVar` convention.

#### `analyticsdata`

Analytics record for the current execution. Write to capture custom analytics.

```js
analyticsdata.custom1 = "value"; // custom1 through custom10 (max 1024 chars each)
analyticsdata.intent = "override"; // override detected intent in analytics
analyticsdata.inputText = "text";
```

#### `lastConversationEntries`

Array of the last 10 conversation turns.

```js
const lastTurn = lastConversationEntries[0]; // { user: '...', bot: '...' }
```

### NOT available

fetch() // NO — use HTTP Request node for outbound HTTP
require() // NO — no module system
import // NO — not ES modules
console.log() // NO — use api.log() instead

### API Functions

#### Output

api.say('Hello!') // send reply to user
api.output('Hello!', data?) // alias for api.say()

For channel-specific output (quick replies, buttons, gallery) pass a `_cognigy` payload as `data`.
See explain('output-formats') for all supported shapes.

#### Context

Prefer `setVar`/`mergeVar` for writes — see Utility Functions below. Use `api.addToContext` with `'array'` mode when you need array-push semantics.
api.setContext('key', value)
api.getContext('key')
api.addToContext('key', value, 'simple' | 'array')
api.removeFromContext('key')
api.deleteContext('key')
api.resetContext()
api.getConversationTranscript()

#### Flow Control

api.setNextNode('nodeId') // override next node in execution path
api.stopExecution() // halt flow
api.addConditionalEntrypoint() // trigger flow on conditional event
api.resetNextNodes() // clear navigation overrides

#### Logging & Analytics

api.log('debug' | 'info' | 'error', message)
api.completeGoal('goalName')
api.trackAnalyticsStep('stepName')
api.getLLMTokenUsageForSession()

#### Input Enrichment

For modifying input objects, use the setVar/mergeVar utility functions:
await setVar('input.smsNumber', number)
await mergeVar('input.requestPayload', { url, method, body })

#### Profile

api.updateProfile('fieldName', value)
api.addContactMemory("text to remember")
api.activateProfile()
api.deactivateProfile()
api.deleteProfile()
api.mergeProfile('targetProfileId')

#### Handover

api.handover('provider', options?)

#### xApps

api.setAppState(stateObject) // non-HTML state only; does NOT push HTML

#### CognigyScript

api.parseCognigyScript('{{ input.text }}')
api.parseCognigyScriptCondition('{{ input.slots.city.value == "Sydney" }}')
api.parseCognigyScriptText('Hello {{ input.text }}!')

### Available Libraries

\_ // lodash (full docs: lodash.com/docs/4.17.10)
moment // date/time (full docs: momentjs.com/docs)
xmljs // XML parsing: xmljs.xml2json(str, {compact: true, spaces: 4})
getTextCleaner // text utilities: getTextCleaner('en-US', {}).clean(input.text)

### TypeScript Pitfalls

#### No "as const"

// WRONG — Cognigy code nodes don't support TypeScript generics/assertions:
const STATUS = {PENDING: 'pending'} as const;
// RIGHT:
const STATUS = {PENDING: 'pending'};

#### Bare return at top level → transpile error

return; // WRONG — "Illegal return statement"
// Fix: wrap in function, or just omit the return

#### Deep copy before multi-path assignment

// WRONG — serializer collapses repeated object references:
context.pathA.data = myObject;
context.pathB.data = myObject; // corruption
// RIGHT:
context.pathB.data = JSON.parse(JSON.stringify(myObject));

### httpRequest Node Response Wrapping

The httpRequest node stores its response as a wrapper object. The default identifier
is `httprequest`, stored in `input` by default. Set `contextStore` on the node config
to store to context instead.

**Node config storage options:**
{ "contextStore": "httpResponse" } → stores to context.httpResponse
(no config) → stores to input.httprequest (default)

**Response object shape** (same regardless of storage location):
{
result: <parsed body — object for JSON responses, string otherwise>,
statusCode: 200,
length: <bytes>,
responseHeaders: { "content-type": "application/json", ... }
}

**Reading examples:**
// Default (input) — no node config needed:
const body = input.httprequest.result;
const status = input.httprequest.statusCode;

// Custom context key — requires contextStore: "httpResponse" on the node:
const body = context.httpResponse.result;

The key gotcha: the response body is at `.result`, not directly on the wrapper object.
WRONG: input.httprequest.meals
RIGHT: input.httprequest.result.meals

### Standard Structure

Every code node follows this layout (main defined first so intent is immediately readable):

async function main() { ... }

async function getVar(path, required) { ... }
async function setVar(path, value) { ... }
async function mergeVar(path, value) { ... }
function log(level, ctx, message) { ... }
function allSettled(promises) { ... }

main()

Pattern inside main — get all inputs in parallel with allSettled, surface ALL errors at once:

async function main() {
const [userIdResult, prefsResult] = await allSettled([
getVar('input.data.userId', true),
getVar('context.userPrefs', false)
])
const errors = [userIdResult, prefsResult]
.filter(r => r.status === 'rejected')
.map(r => r.reason.message)
if (errors.length > 0) {
errors.forEach(e => log('error', 'main', e))
return
}
const userId = userIdResult.value
const prefs = prefsResult.value
// business logic
await setVar('context.userId', userId)
}

### Utility Functions (copy into every node that uses them)

async function getVar(path, required) {
const parts = path.split('.')
let val = { input, context }[parts.shift()]
for (const part of parts) {
if (val == null) { val = undefined; break }
val = val[part]
}
if (val == null) {
if (required) return Promise.reject(new Error(`Required: '${path}' is missing or null`))
return Promise.resolve(null)
}
return Promise.resolve(val)
}

async function setVar(path, value) {
const parts = path.split('.')
const root = parts.shift()
const key = parts.pop()
let obj = { input, context }[root]
for (const part of parts) {
if (obj[part] == null) obj[part] = {}
obj = obj[part]
}
obj[key] = value
}

async function mergeVar(path, value) {
const parts = path.split('.')
const root = parts.shift()
const key = parts.pop()
let obj = { input, context }[root]
for (const part of parts) {
if (obj[part] == null) obj[part] = {}
obj = obj[part]
}
obj[key] = deepMerge(obj[key], value)
function deepMerge(target, source) {
if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
const result = Object.assign({}, target)
for (const k of Object.keys(source)) {
const tgt = target != null ? target[k] : undefined
result[k] = (typeof source[k] === 'object' && source[k] !== null && !Array.isArray(source[k])
&& typeof tgt === 'object' && !Array.isArray(tgt))
? deepMerge(tgt, source[k]) : source[k]
}
return result
}
}

function allSettled(promises) {
return Promise.all(promises.map(p =>
p.then(value => ({ status: 'fulfilled' as const, value }))
.catch(reason => ({ status: 'rejected' as const, reason }))
))
}

function log(level, ctx, message) {
const msg = (ctx ? `[${ctx}] ` : '') + (typeof message === 'object' ? JSON.stringify(message) : String(message))
if (level === 'error') { api.log('error', msg); api.logDebugError(msg) }
else if (level === 'debug') { api.log('debug', msg); api.logDebugMessage(msg) }
else { api.log('info', msg) }
}

### When to use setVar vs mergeVar

| Scenario                             | Use        |
| ------------------------------------ | ---------- |
| Writing a primitive                  | Either     |
| Writing an object, keep sibling keys | `mergeVar` |
| Writing an object, clean slate       | `setVar`   |
| Writing an array                     | `setVar`   |
