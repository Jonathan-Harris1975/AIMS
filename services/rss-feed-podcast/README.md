# Podcast RSS support

This directory contains podcast RSS generation/support logic used by the production podcast workflow. It is not mounted as an independent HTTP service.

## Responsibilities

- Generate/update the Turing's Torch RSS XML from approved episode metadata.
- Preserve podcast-level metadata such as title, description, language, category, owner, artwork, funding and explicit/type declarations.
- Add episode enclosure/transcript/artwork metadata from the completed podcast pipeline.
- Store the resulting feed in the configured podcast RSS R2 bucket/public URL.

## Configuration

The contract is controlled by `PODCAST_*`, `PODCAST_RSS_*`, podcast RSS bucket/public-base settings and the final episode metadata produced by the script/podcast pipeline.
