INSERT INTO ${worldId:name}.conquests (
    old_owner,
    new_owner,
    village_id,
    old_owner_tribe_id,
    old_owner_tribe_tag,
    new_owner_tribe_id,
    new_owner_tribe_tag
) VALUES (
    ${oldOwner},
    ${newOwner},
    ${village_id},
    ${old_owner_tribe_id},
    ${old_owner_tribe_tag},
    ${new_owner_tribe_id},
    ${new_owner_tribe_tag}
)
