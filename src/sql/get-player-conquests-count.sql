SELECT
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE old_owner = ${playerId}) +
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE new_owner = ${playerId})
    AS count
