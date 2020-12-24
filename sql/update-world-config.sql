UPDATE main.worlds SET config = ${worldConfig}::json WHERE world_id = ${worldId}::text
