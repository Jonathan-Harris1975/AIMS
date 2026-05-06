# RSS links Short.io removal package

Copy these files into the repo using the same paths contained in this zip.

## Changed files

- env.template
- scripts/envBootstrap.js
- services/rss-feed-creator/utils/models.js
- services/rss-links/routes/redirect.js
- services/rss-links/routes/shorten.js
- services/rss-links/store.js
- services/rss-links/service.js

## Delete files

- services/rss-feed-creator/utils/shortio.js
- services/rss-links/utils/1

## R2 object key pattern

- rss-links/_records/{key}.json
- rss-links/_index/by-url/{sha512}.json
- rss-links/{key}/index.html

## Public short URL

`${R2_PUBLIC_BASE_URL_RSS}/rss-links/{key}/`

## Bucket alias

`rss`, backed by `R2_BUCKET_RSS_FEEDS` and `R2_PUBLIC_BASE_URL_RSS`.
