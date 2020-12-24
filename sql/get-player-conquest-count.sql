SELECT
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE old_owner = ${playerId}) loss,
    (SELECT COUNT(*)::int FROM ${worldId:name}.conquests WHERE new_owner = ${playerId}) gain
