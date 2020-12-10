INSERT INTO ${worldId:name}.conquests (
    old_owner,
    new_owner,
    village_id,
    village_points_then,
    old_owner_tribe_id,
    old_owner_tribe_tag_then,
    new_owner_tribe_id,
    new_owner_tribe_tag_then
) VALUES (
    ${oldOwner},
    ${newOwner},
    ${village_id},
    ${village_points_then},
    ${old_owner_tribe_id},
    ${old_owner_tribe_tag_then},
    ${new_owner_tribe_id},
    ${new_owner_tribe_tag_then}
)
