#!/usr/bin/env bash

gzip --decompress /any/tw2tracker.db.gz --stdout > /any/tw2tracker.db
dropdb --username postgres tw2tracker
createdb --username postgres tw2tracker
psql --username postgres --dbname tw2tracker < /any/tw2tracker.db
rsync --recursive --verbose /any/static-maps /var/www/tw2tracker/data/
