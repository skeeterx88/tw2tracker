#!/usr/bin/env bash

ssh arch@tw2tracker pg_dump --verbose --username=postgres --dbname=tw2tracker > /any/tw2tracker.db
ssh arch@tw2tracker gzip --best --force --stdout /any/tw2tracker.db > /any/tw2tracker.db.gz
rsync arch@tw2tracker:/any/tw2tracker.db.gz /any/tw2tracker.db.gz
rsync --recursive --verbose arch@tw2tracker:/home/arch/tw2tracker/data/static-maps /any/
