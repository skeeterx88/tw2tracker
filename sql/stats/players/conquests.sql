SELECT
    conquests.old_owner,
    conquests.new_owner,
    conquests.date,
    conquests.village_id,
    conquests.village_points_then,
    conquests.old_owner_tribe_id,
    conquests.old_owner_tribe_tag_then,
    conquests.new_owner_tribe_id,
    conquests.new_owner_tribe_tag_then,
    villages.name village_name,
    villages.x village_x,
    villages.y village_y,
    (SELECT name FROM ${worldId:name}.players WHERE id = conquests.new_owner) AS new_owner_name,
    (SELECT name FROM ${worldId:name}.players WHERE id = conquests.old_owner) AS old_owner_name,
    (SELECT tribe_id FROM ${worldId:name}.players WHERE id = conquests.new_owner) AS new_owner_tribe_id_now,
    (SELECT tribe_id FROM ${worldId:name}.players WHERE id = conquests.old_owner) AS old_owner_tribe_id_now,
    (SELECT tag FROM ${worldId:name}.tribes WHERE id = conquests.new_owner_tribe_id) AS new_owner_tribe_tag_now,
    (SELECT tag FROM ${worldId:name}.tribes WHERE id = conquests.old_owner_tribe_id) AS old_owner_tribe_tag_now
FROM ${worldId:name}.conquests
LEFT OUTER JOIN ${worldId:name}.villages
ON (${worldId:name}.villages.id = conquests.village_id)
WHERE old_owner = ${playerId} OR new_owner = ${playerId}
ORDER BY conquests.date DESC
LIMIT ${limit} OFFSET ${offset}
