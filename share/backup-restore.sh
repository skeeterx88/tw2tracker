#!/usr/bin/env bash

dropdb --username postgres tw2tracker
createdb --username postgres tw2tracker
gzip --decompress /any/tw2tracker.db.gz --stdout | psql --username postgres --dbname tw2tracker
rsync --recursive --verbose /any/static-maps /var/www/tw2tracker/data/
