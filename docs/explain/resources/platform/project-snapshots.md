---
topic: project-snapshots
description: create project snapshots for versioning (flow-level versioning does not exist in the API)
---

## project-snapshots — Project Versioning via Snapshots

### Flow-level versioning does not exist

POST /v2.0/flows/{flowId}/versions returns 404. The "Save Version" button in the Cognigy UI
creates a project-level snapshot, not a flow-scoped version. There is no API for flow-scoped versioning.

### Create a project snapshot (captures entire project state)

cognigy_create(resource_type="snapshot", body={
"name": "Task 0 — Foundation",
"description": "Baseline before AI Agent job additions",
"projectId": "<projectId>"
})

Required fields: name, description, projectId
"description" is required — omitting it returns HTTP 400.

### Response: async job (not the snapshot itself)

Snapshot creation is asynchronous. The response is a queued job:
{
"\_id": "<jobId>",
"status": "queued",
"type": "createSnapshot",
"progress": 0,
"parameters": {
"properties": {"name": "...", "description": "..."}
}
}
The jobId is NOT the snapshotId. The snapshot appears in the Cognigy UI once the job completes
(usually within a few seconds). There is no polling endpoint for job completion.

### List existing snapshots

cognigy_list(resource_type="snapshots", project_id="<projectId>")
Returns: {"items": [...], "count": N}

### When to snapshot

Use at task completion milestones during multi-agent builds:

- Before starting a major new component (safety checkpoint)
- After a working demo state is confirmed (named "DEMO READY")
- Before destructive operations (delete/replace flow nodes)

### Exporting a full project zip (offline backup / handoff)

Snapshots capture project state server-side; for a portable offline zip use `export_package`:
export_package {
project_id: "<projectId>",
output_path: "$DEMO_DIR/<customer>-package.zip" // $DEMO_DIR is build-orchestrator's resolved absolute build directory — see its S0.0 Step 0
}
The tool posts an async export job, polls a task endpoint until the task reaches a terminal
status, resolves the resulting package ID, fetches a pre-signed download link, and writes the
zip locally. Typical completion time is 10–60 seconds depending on project size.
