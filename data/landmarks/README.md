# Supplemental landmark directory

Create `<scene_id>.json` for each scene as an array of landmark records. Scenes without a file use the official GeoJSON and graph index.

Each record requires `id`, `scene_id`, `node_id`, an indoor `level_id`, `names`, `category`, `descriptions`, and `source`. The node must be a public-path location near the landmark in the current map, and its level must match the record's level. The source records the mall-directory reference or the date of on-site verification. Omit `level_id` for outdoor landmarks.

This directory does not contain fictional shop names. Example shop names and appearances are used only in test fixtures. See the [GenAI integration guide](../../docs/genai-integration.md) for the full format.
