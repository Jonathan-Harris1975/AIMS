# Comms Hub wake worker

This Worker verifies signed CoginPal/Zernio wake requests, rejects replays through KV, and wakes AIMS with `runContentJobs: false`. Deploy it independently of the Koyeb Eco service, bind a KV namespace, and store both tokens as encrypted Worker secrets.
