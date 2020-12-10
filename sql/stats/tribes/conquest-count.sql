SELECT
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE old_owner_tribe_id = ${tribeId}) loss,
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE new_owner_tribe_id = ${tribeId}) gain
