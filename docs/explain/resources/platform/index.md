---
description: Project-level platform resources — connections, endpoints, extensions, LLMs, locales, playbooks, knowledge store, and resource_type discovery recipes
---

## platform — Platform Resources Overview

Everything in this group is a project-level resource — connections, endpoints, extensions, LLM
resources, locales, playbooks, the project resource, project snapshots, and the knowledge store —
rather than a node inside a flow chart.

Several topics here (`extensions-resource`, `flow-resource`, `lexicons`, `locales`,
`playbooks`, `project-resource`) have no verified create/update body shape yet — their topics are
honest discovery recipes (via `list_resources`/`get_resource` with full detail) rather than
confirmed examples. Reach for this group whenever you're about to call a resource-type API you
haven't used before.

Note: illustrative tool-call snippets in this group's topics (e.g. `cognigy_create`,
`cognigy_get`, `cognigy_update`, `cognigy_list`) were ported from a sibling implementation's
generic CRUD tool. In this server, use the equivalent purpose-built tool for the same REST
operation — `list_resources` / `get_resource` for reads, `create_tool` / `update_tool` /
`manage_flow_nodes` / `manage_settings` / `manage_packages` / `delete_resource` for writes — the
field shapes, gotchas, and endpoint paths described still apply.
