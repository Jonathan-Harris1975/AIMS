# Turing's Torch audio ident

Production uses the approved **Deep Signal v2** sound design from 14 November 2026: a warm analogue synth bed, low double pulse, spacious echoes and clean digital tones, with no static, speech, vocals or sampled recordings.

| Asset | R2 key | Duration | Size | MD5 |
| --- | --- | --- | --- | --- |
| Intro | `deep-signal-v2-2026-11-14/intro.mp3` | 14 seconds | 562604 bytes | `355363495cf4b2ede6bcb094c775d327` |
| Outro | `deep-signal-v2-2026-11-14/outro.mp3` | 9 seconds | 361964 bytes | `22ba3e45b1f5651ca6d689ab614aba38` |

Bucket: `podcast-intro-outro-music`. Both MP3s are stereo, 48 kHz, 320 kbps. WAV masters and the original synthesis source are retained in the approved sound ident pack.

`PODCAST_INTRO_URL` and `PODCAST_OUTRO_URL` in `config/production.defaults.env` are the production source of truth. Koyeb loads these defaults through `config/loadEnv.js`; any explicit environment override must point to the same approved assets. Versioned filenames avoid stale cached audio.

The TTS post-processing chain is retained. `podcastProcessor` downloads the intro and outro, probes their actual durations, fits the main audio within the episode duration limit and concatenates intro, edited main and outro. Published episodes are not retroactively changed.

The old `intro-outro.mp3` object is retained for rollback. To roll back, restore both environment URLs to that object and redeploy AIMS. Next scheduled weekly use after approval: Friday 20 November 2026.
