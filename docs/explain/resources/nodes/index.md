---
description: Flow chart structure, node type strings, node wiring/positioning, and the full node-type reference
---

## nodes — Node & Flow Chart Overview

A Cognigy flow is a chart of nodes connected by a `relations` array. This group covers how to read
a chart's structure (`flow-chart-reading`), the exact `type` string and `extension` for every node
kind (`node-types`, `extension-map`), how nodes are wired together (`node-wiring`), and how to
correctly position new nodes — including branch population for Once/IF/ifThenElse nodes
(`node-positioning`).

Reach for this group any time you're creating, moving, or inspecting nodes via
`manage_flow_nodes` and need the exact API shape, not just the UI concept.
