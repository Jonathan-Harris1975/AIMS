# CI fix application

1. Replace:
   - services/comms-hub/emailService.js
   - services/comms-hub/replyDraftService.js
2. Delete:
   - services/emailService.js
   - services/replyDraftService.js
3. Leave test/comms-hub-business-hours-contact.test.js as it is in the supplied fresh repository.

The root-level files are accidental duplicates. Leaving either one in the repository will keep the build check red.
