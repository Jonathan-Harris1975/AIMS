# PodSEO hopr.fm tracking for Turing's Torch

The AIMS podcast RSS generator adds the PodSEO redirect prefix
`https://hopr.fm/k/e4dxbwh0/` to every published episode audio
`<enclosure>` URL, including the back catalogue.

Original R2 audio locations remain stored in `podcastUrl` episode
metadata. Canonical episode page, GUID, artwork and transcript URLs
are not rewritten. The helper prevents duplicate prefixes and rejects
insecure audio URLs or different hopr.fm keys.

To validate a deployment, inspect the live XML at
`https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml`
and confirm every episode enclosure contains the prefix. Check PodSEO
Analytics > hopr.fm > Already added it? Check now, after the live feed
is updated. Historical downloads cannot be backfilled.

The prefix is specific to the podcast owner's PodSEO account.
Switching providers, changing keys or rolling back should be done by a
reviewed code change followed by RSS republishing. The original
unprefixed RSS can be restored from the backup created before rollout.
